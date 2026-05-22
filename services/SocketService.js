import { Server as SocketIOServer } from "socket.io";
import { coinDCXSocket } from "./CoinDCXSocketService.js";
import { DEFAULT_RESOLUTION } from "../config/constants.js";
import strategies from "../strategies/index.js";
import { FVG_EXPIRY_CANDLES } from "../strategies/FVGStrategy.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
dayjs.extend(utc);
dayjs.extend(timezone);
import { TradeService } from "./TradeService.js";
import { TradeHistoryService } from "./TradeHistoryService.js";
import { calculateTradeProfit } from "../strategies/StrategyUtils.js";
import { PriceStore } from "./PriceStore.js";
import { LiveConfigService } from "./LiveConfigService.js";
import { LoggerService } from "./LoggerService.js";
class SocketService {
  static io;
  static configStates = /* @__PURE__ */ new Map();
  static marketRegistry = /* @__PURE__ */ new Map();
  static channelConfigs = /* @__PURE__ */ new Map();
  // channel -> Set of configIds
  static emitSystemLog(log) {
    if (this.io) {
      this.io.emit("system_log", log);
    }
  }
  static async init(server) {
    this.io = new SocketIOServer(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket"],
      pingInterval: 25e3,
      pingTimeout: 6e4
    });
    LoggerService.setBroadcaster((log) => this.emitSystemLog(log));
    this.io.on("connection", (socket) => {
      console.log("Frontend connected:", socket.id);
      socket.on("subscribe", (pair) => {
        if (pair) {
          const channel = this.formatChannel(pair, "1");
          console.log(`Subscribing to: ${channel}`);
          coinDCXSocket.subscribe(channel);
        }
      });
    });
    this.setupCoinDCXListeners();
    coinDCXSocket.connect();
    try {
      const configs = await LiveConfigService.getEnabledConfigs();
      console.log(`[Lifecycle] \u{1F680} Initializing ${configs.length} enabled configurations...`);
      for (const config of configs) {
        await this.addConfigState(config);
      }
    } catch (err) {
      console.error("[Lifecycle] \u274C Failed to load configs:", err.message);
    }
    coinDCXSocket.on("connected", () => {
      console.log(`[Self-Healing] \u{1F504} Socket reconnected. Synchronizing all channels...`);
      for (const [channel] of this.marketRegistry.entries()) {
        coinDCXSocket.subscribe(channel);
      }
    });
    this.startMemorySync();
  }
  static async addConfigState(config) {
    this.configStates.set(config._id.toString(), {
      config,
      activeTrade: null,
      currentPosition: null,
      isStrategyRunning: false,
      isPlacingOrder: false,
      isClosingPosition: false,
      lastProcessedCandleTime: null,
      lastSignalTime: null
    });
    const channel = this.formatChannel(config.pair, "1");
    if (!this.channelConfigs.has(channel)) {
      this.channelConfigs.set(channel, /* @__PURE__ */ new Set());
    }
    this.channelConfigs.get(channel).add(config._id.toString());
    if (!this.marketRegistry.has(channel)) {
      this.marketRegistry.set(channel, { candles: [], candleIndexMap: /* @__PURE__ */ new Map() });
      coinDCXSocket.subscribe(channel);
    }
  }
  static startMemorySync() {
    setInterval(() => {
      for (const [channel, registry] of this.marketRegistry.entries()) {
        if (registry.candles.length > 5e3) {
          registry.candles = registry.candles.slice(-2e3);
          registry.candleIndexMap.clear();
          registry.candles.forEach((c, i) => registry.candleIndexMap.set(c.time, i));
        }
      }
    }, 6e4 * 60);
  }
  static formatChannel(pair, resolution = DEFAULT_RESOLUTION) {
    const instrument = pair?.includes("B-") ? pair : `B-${pair}`;
    return `${instrument}_${resolution}m-futures`;
  }
  static setupCoinDCXListeners() {
    coinDCXSocket.on("candlestick", async (data) => {
      const incomingPair = data.pair;
      if (!incomingPair) return;
      this.io.emit("candlestick", data);
      this.io.emit("price-change", { m: incomingPair, p: data.close });
      PriceStore.update(incomingPair, data.close);
      const channel = this.formatChannel(incomingPair, data.resolution || "1");
      const registry = this.marketRegistry.get(channel);
      if (!registry) return;
      if (registry.candleIndexMap.has(data.time)) {
        const idx = registry.candleIndexMap.get(data.time);
        registry.candles[idx] = data;
      } else {
        const isNewCandleTrigger = registry.candles.length > 0;
        registry.candleIndexMap.set(data.time, registry.candles.length);
        registry.candles.push(data);
        if (registry.candles.length > 3e3) {
          const removed = registry.candles.shift();
          if (removed) {
            registry.candleIndexMap.clear();
            registry.candles.forEach((c, i) => registry.candleIndexMap.set(c.time, i));
          }
        }
        const targetConfigs = this.channelConfigs.get(channel);
        if (targetConfigs && isNewCandleTrigger) {
          for (const configId of targetConfigs) {
            const state = this.configStates.get(configId);
            if (!state) continue;
            const closedCandle = registry.candles[registry.candles.length - 2];
            if (closedCandle && state.lastProcessedCandleTime !== closedCandle.time) {
              state.lastProcessedCandleTime = closedCandle.time;
              const interval = Number(state.config.timeInterval);
              const currentTime = new Date(closedCandle.time);
              if (currentTime.getMinutes() % interval === 0 && !state.isStrategyRunning) {
                state.isStrategyRunning = true;
                this.executeLiveStrategy(configId, state, registry.candles).catch((err) => console.error(`[Strategy] ${configId} Error:`, err.message)).finally(() => state.isStrategyRunning = false);
              }
            }
          }
        }
      }
      const tickerConfigs = this.channelConfigs.get(this.formatChannel(incomingPair, "1"));
      if (tickerConfigs) {
        for (const configId of tickerConfigs) {
          const state = this.configStates.get(configId);
          if (!state) continue;
          if (state.activeTrade?.status === "open") {
            this.monitorRealTimeSL(data, state).catch((err) => console.error(`[Monitor] ${configId} Error:`, err.message));
          }
        }
      }
    });
    coinDCXSocket.on("df-position-update", async (positions) => {
      let posList = [];
      try {
        const raw = Array.isArray(positions) ? positions : positions ? [positions] : [];
        posList = raw.flatMap((item) => {
          if (typeof item === "string") {
            try {
              const parsed = JSON.parse(item);
              return Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              return [];
            }
          }
          return item;
        });
      } catch (err) {
      }
      for (const [id, state] of this.configStates.entries()) {
        const pair = state.config.pair;
        const wasActive = !!state.currentPosition && state.currentPosition.active_pos !== 0;
        const pos = posList.find((p) => {
          const cleanP = (p.pair || "").replace("B-", "").toLowerCase();
          const cleanS = (pair || "").replace("B-", "").toLowerCase();
          return cleanP === cleanS;
        });
        const isActive = !!pos && pos.active_pos !== 0;
        if (isActive) {
          state.currentPosition = pos;
          console.log(pos, "pos-----------");
          if (state.activeTrade && state.activeTrade.status === "open" && state.activeTrade.type === "real") {
            const exchangeSL = pos.stop_loss_trigger || 0;
            const exchangeTP = pos.take_profit_trigger || 0;
            const changed = state.activeTrade.entryPrice !== pos.avg_price || exchangeSL > 0 && state.activeTrade.sl !== exchangeSL || exchangeTP > 0 && state.activeTrade.tp !== exchangeTP;
            if (changed && pos.avg_price > 0) {
              state.activeTrade.entryPrice = pos.avg_price;
              if (exchangeSL > 0) state.activeTrade.sl = exchangeSL;
              if (exchangeTP > 0) state.activeTrade.tp = exchangeTP;
              TradeHistoryService.saveTrade(state.activeTrade);
              this.io.emit("trade-history-update", state.activeTrade);
              console.log(`[SocketService] \u{1F504} Synced Slippage from CoinDCX for ${pair}: Entry=${pos.avg_price}, SL=${pos.stop_loss_trigger}, TP=${pos.take_profit_trigger}`);
            }
          }
        }
        if (wasActive && !isActive) {
          console.log(`[Position] Trade CLOSED on exchange for ${pair}`);
          const tradeToClose = state.activeTrade;
          state.activeTrade = null;
          state.currentPosition = null;
          if (tradeToClose) {
            tradeToClose.status = "closed";
            tradeToClose.exitTime = dayjs().tz("Asia/Kolkata").format();
            tradeToClose.exitReason = "Exchange Position Closed";
            try {
              await new Promise((r) => setTimeout(r, 500));
              const orders = await TradeService.getOrders();
              const exitOrder = Array.isArray(orders) ? orders.find((o) => o.pair === pair && o.status === "filled" && (o.stage === "exit" || o.order_category === "complete_tpsl" || o.order_type === "stop_market" || o.order_type === "take_profit_market")) : null;
              let exitPrice = exitOrder && exitOrder.avg_price > 0 ? exitOrder.avg_price : null;
              if (!exitPrice) {
                const registry = this.marketRegistry.get(this.formatChannel(pair, "1"));
                const lastCandle = registry?.candles && registry.candles.length > 0 ? registry.candles[registry.candles.length - 1] : null;
                exitPrice = lastCandle ? lastCandle.close : tradeToClose.sl;
              }
              if (exitPrice) {
                const { profit, fee, pnlPercent, grossProfit, entryFee, exitFee } = calculateTradeProfit(tradeToClose, exitPrice, 5e-4);
                tradeToClose.profit = profit;
                tradeToClose.fee = fee;
                tradeToClose.grossProfit = grossProfit;
                tradeToClose.entryFee = entryFee;
                tradeToClose.exitFee = exitFee;
                tradeToClose.pnlPercent = pnlPercent;
                tradeToClose.exitPrice = exitPrice;
                if (exitOrder) {
                  tradeToClose.exitReason = `Exchange Auto-Closed (${exitOrder.order_type === "stop_market" ? "SL Hit" : "TP Hit"})`;
                }
              }
            } catch (err) {
              console.error(`[Position] Error fetching exact exit price for ${pair}:`, err);
            }
            await TradeHistoryService.saveTrade(tradeToClose);
            this.io.emit("trade-history-update", tradeToClose);
          }
        }
      }
    });
  }
  static async executeLiveStrategy(configId, state, candles) {
    try {
      const config = state.config;
      const pair = config.pair;
      const strategy = strategies[config.strategyId];
      const globalActiveTrade = await TradeHistoryService.getActiveTradeByPair(pair);
      if (globalActiveTrade) {
        if (!state.activeTrade) {
          state.activeTrade = globalActiveTrade;
        }
        return;
      }
      if (candles.length < 10) return;
      const latestCandle = candles[candles.length - 1];
      if (!latestCandle || state.lastSignalTime === latestCandle.time) return;
      console.log(`[Strategy] \u{1F50D} Scanning ${pair} for '${config.strategyId}' signal...`);
      const result = strategy.run(candles, {
        pair,
        type: "live",
        riskAmount: config.riskAmount || 5,
        leverage: config.leverage || 10,
        maxPositionSize: config.maxPositionSize || 85,
        atrMultiplierSL: 1,
        simulationStartUnix: Math.floor(Date.now() / 1e3) - 86400
      });
      console.log(result.matched, result.trade, "result.matched && result.trade");
      if (result.matched && result.trade) {
        state.lastSignalTime = latestCandle?.time || 0;
        await LoggerService.log("info", `\u{1F3AF} Signal Detected: ${result.trade.direction.toUpperCase()} for ${pair}`, "SocketService", { configId, pair, metadata: result.trade });
        await this.handleOrderEntry(configId, state, result.trade);
      }
    } catch (err) {
      await LoggerService.log("error", `Routine failed: ${err.message}`, "SocketService", { pair: "SYSTEM" });
    }
  }
  static async handleOrderEntry(configId, state, trade) {
    const config = state.config;
    const pair = config.pair;
    console.log(config, "config.autoTrade--------");
    console.log(state.isPlacingOrder, "state.isPlacingOrder-------");
    if (config.autoTrade) {
      if (state.isPlacingOrder) return;
      state.isPlacingOrder = true;
      try {
        await LoggerService.log("info", `\u{1F680} Executing REAL entry for ${pair}...`, "SocketService", { configId, pair });
        await TradeService.executeFutureOrder({
          ...trade,
          pair,
          leverage: config.leverage,
          maxPositionSize: config.maxPositionSize,
          stop_loss_price: trade.sl,
          riskAmount: config.riskAmount
        });
        await new Promise((res) => setTimeout(res, 1500));
        const savedTrade = await TradeHistoryService.saveTrade({
          ...trade,
          pair,
          configId,
          strategyId: config.strategyId,
          status: "open",
          type: "real",
          leverage: config.leverage,
          maxPositionSize: config.maxPositionSize,
          entryTime: dayjs().tz("Asia/Kolkata").format()
        });
        state.activeTrade = savedTrade;
        await LoggerService.log("success", `\u2705 REAL Position Opened for ${pair}`, "SocketService", { configId, pair, metadata: savedTrade });
      } catch (err) {
        await LoggerService.log("error", `\u274C REAL Execution Failed for ${pair}: ${err.message}`, "SocketService", { configId, pair });
        throw err;
      } finally {
        state.isPlacingOrder = false;
      }
    } else {
      const savedTrade = await TradeHistoryService.saveTrade({
        ...trade,
        pair,
        configId,
        strategyId: config.strategyId,
        leverage: config.leverage,
        status: "open",
        type: "paper",
        entryTime: dayjs().tz("Asia/Kolkata").format()
      });
      state.activeTrade = savedTrade;
      await LoggerService.log("info", `\u{1F3C1} Paper Trade Initialized for ${pair}`, "SocketService", { configId, pair, metadata: savedTrade });
      this.io.emit("trade-history-update", state.activeTrade);
    }
  }
  static async monitorRealTimeSL(tick, state) {
    try {
      const activeTrade = state.activeTrade;
      if (!activeTrade || activeTrade.status !== "open") return;
      if (activeTrade.type === "real" && !state.currentPosition) {
        const intervalStr = state.config.interval || "1";
        let intervalMinutes = 1;
        if (intervalStr === "5") intervalMinutes = 5;
        if (intervalStr === "15") intervalMinutes = 15;
        if (intervalStr === "30") intervalMinutes = 30;
        if (intervalStr === "60") intervalMinutes = 60;
        if (intervalStr === "1D") intervalMinutes = 1440;
        const maxWaitMinutes = FVG_EXPIRY_CANDLES * intervalMinutes;
        const entryTime = dayjs(activeTrade.entryTime);
        const now = dayjs();
        const minutesElapsed = now.diff(entryTime, "minute");
        if (minutesElapsed >= maxWaitMinutes) {
          await LoggerService.log("warning", `\u23F3 Limit order expired after ${FVG_EXPIRY_CANDLES} candles (${maxWaitMinutes}m) for ${activeTrade.pair}. Cancelling on exchange...`, "SocketService", { configId: activeTrade.configId || "", pair: activeTrade.pair || "" });
          if (activeTrade.pair) {
            await TradeService.cancelAllOrders(activeTrade.pair);
          }
          activeTrade.status = "closed";
          activeTrade.exitPrice = tick.close;
          activeTrade.exitTime = now.tz("Asia/Kolkata").format();
          activeTrade.exitReason = `Expired/Missed (100 Candles)`;
          activeTrade.profit = 0;
          activeTrade.fee = 0;
          await TradeHistoryService.saveTrade(activeTrade);
          state.activeTrade = null;
          this.io.emit("trade-history-update", activeTrade);
        }
        return;
      }
      if (activeTrade.type === "real") {
        return;
      }
      const currentPrice = tick.close;
      const high = tick.high || currentPrice;
      const low = tick.low || currentPrice;
      const sl = activeTrade.sl || activeTrade.stop_loss_price || 0;
      const tp = activeTrade.tp || activeTrade.take_profit_price || 0;
      const isBuy = activeTrade.direction === "buy";
      let exitHit = false;
      let reason = "";
      if (isBuy) {
        if (sl > 0 && low <= sl) {
          exitHit = true;
          reason = "SL Hit";
        } else if (tp > 0 && high >= tp) {
          exitHit = true;
          reason = "TP Hit";
        }
      } else {
        if (sl > 0 && high >= sl) {
          exitHit = true;
          reason = "SL Hit";
        } else if (tp > 0 && low <= tp) {
          exitHit = true;
          reason = "TP Hit";
        }
      }
      if (exitHit) {
        activeTrade.status = "closed";
        const targetPrice = reason === "SL Hit" ? sl : tp;
        activeTrade.exitPrice = targetPrice;
        activeTrade.exitTime = dayjs().tz("Asia/Kolkata").format();
        activeTrade.exitReason = `PAPER ${reason}`;
        const { profit, fee, pnlPercent, grossProfit, entryFee, exitFee } = calculateTradeProfit(activeTrade, targetPrice, 5e-4);
        activeTrade.profit = profit;
        activeTrade.fee = fee;
        activeTrade.grossProfit = grossProfit;
        activeTrade.entryFee = entryFee;
        activeTrade.exitFee = exitFee;
        activeTrade.pnlPercent = pnlPercent;
        await TradeHistoryService.saveTrade(activeTrade);
        state.activeTrade = null;
        this.io.emit("trade-history-update", activeTrade);
        console.log(`[Monitor] \u{1F3AF} PAPER ${reason} for ${activeTrade.pair}. PnL: ${profit}`);
      }
    } catch (err) {
      console.error("Monitor status failed:", err.message);
    }
  }
}
export {
  SocketService
};
