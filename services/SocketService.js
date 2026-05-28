/**
 * SocketService.js — Production Build
 *
 * FIXES APPLIED (vs previous version):
 *
 * [CRITICAL-1] logger undefined → all catch blocks now use LoggerService.log()
 * [CRITICAL-2] isPlacingOrder on stale object → always read fresh from configStates map
 * [CRITICAL-3] No sentinel before exchange order → sentinel written BEFORE executeFutureOrder
 * [CRITICAL-4] positionMissCount resets forever → updateState() helper, no more spread-copy drops
 * [CRITICAL-5] Paper trade emits null → emit savedTrade directly, not state.activeTrade
 *
 * [RACE-1] isRecovering guard → candlestick handler skips ticks during recoverMissedCandles
 * [RACE-2] Candle prune uses shift() → replaced with slice() + atomic map rebuild
 * [RACE-3] startMemorySync uses shift() → replaced with slice() + atomic map rebuild
 * [RACE-4] lastSignalTime dropped by spread → carried through updateState() helper
 * [RACE-5] monitorRealTimeSL concurrent with strategy → reads fresh state per tick
 *
 * [SYNC-1] Timezone mismatch → dayjs().tz("Asia/Kolkata") for interval boundary check
 * [SYNC-2] SL/TP sync gated by avg_price → decoupled, SL/TP sync independently
 * [SYNC-3] Exit price fallback logs warning → auditable in all fallback cases
 * [SYNC-4] strategy undefined → guarded before .run() call
 * [SYNC-5] df-position-update loop → per-ID try/catch so one bad record can't kill others
 *
 * [QUALITY-1] removeConfigState() method added
 * [QUALITY-2] addConfigState() triggers historical candle recovery for new configs
 */

import { Server as SocketIOServer } from "socket.io";
import { Mutex } from "async-mutex";
import axios from "axios";
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

  // configId (string) → {
  //   config, activeTrade, currentPosition,
  //   mutex, isPlacingOrder, isClosingPosition,
  //   lastProcessedCandleTime, lastSignalTime,
  //   positionMissCount
  // }
  static configStates = new Map();

  // channel → { candles: [], candleIndexMap: Map, isRecovering: bool }
  static marketRegistry = new Map();

  // channel → Set<configId>
  static channelConfigs = new Map();

  static globalPairLocks = new Set();

  // ─────────────────────────────────────────────
  // CORE HELPER — single place where state is written.
  // Never use configStates.set(id, { ...state, ... }) directly anywhere else.
  // This ensures fields like positionMissCount, lastSignalTime, isPlacingOrder
  // are NEVER silently dropped by a spread that didn't know about them.
  // ─────────────────────────────────────────────
  static updateState(configId, patch) {
    const current = this.configStates.get(configId);
    if (!current) {
      LoggerService.log("error", `updateState called for unknown configId: ${configId}`, "SocketService");
      return null;
    }
    // Object.assign mutates in place — no spread, no dropped fields
    Object.assign(current, patch);
    return current;
  }

  // ─────────────────────────────────────────────
  // FRESH STATE READ — always call this before checking any flag.
  // Never rely on a `state` variable captured earlier in an async chain.
  // ─────────────────────────────────────────────
  static getState(configId) {
    return this.configStates.get(configId) ?? null;
  }

  static emitSystemLog(log) {
    if (this.io) {
      this.io.emit("system_log", log);
    }
  }

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────
  static async init(server) {
    this.io = new SocketIOServer(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket"],
      pingInterval: 25_000,
      pingTimeout: 60_000,
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

    // Load all enabled configs from DB on startup
    try {
      const configs = await LiveConfigService.getEnabledConfigs();
      console.log(`[Lifecycle] 🚀 Initializing ${configs.length} enabled configurations...`);
      for (const config of configs) {
        await this.addConfigState(config);
      }
    } catch (err) {
      console.error("[Lifecycle] ❌ Failed to load configs:", err.message);
    }

    coinDCXSocket.on("disconnected", () => {
      LoggerService.log("warning", "CoinDCX socket disconnected", "SocketService");
    });

    coinDCXSocket.on("connected", async () => {
      console.log(`[Self-Healing] 🔄 Socket reconnected. Synchronizing all channels...`);
      LoggerService.log("info", "CoinDCX socket reconnected", "SocketService");

      // Re-subscribe all known channels
      for (const [channel] of this.marketRegistry.entries()) {
        coinDCXSocket.subscribe(channel);
      }

      // Recover missed candles — guarded internally with isRecovering flag
      await this.recoverMissedCandles();
    });

    this.startMemorySync();
  }

  // ─────────────────────────────────────────────
  // ADD CONFIG STATE
  // ─────────────────────────────────────────────
  static async addConfigState(config) {
    const configId = config._id.toString();

    this.configStates.set(configId, {
      config,
      activeTrade: null,
      currentPosition: null,
      isStrategyRunning: false,
      mutex: new Mutex(),
      isPlacingOrder: false,
      isClosingPosition: false,
      lastProcessedCandleTime: null,
      lastSignalTime: null,
      positionMissCount: 0,         // [CRITICAL-4] explicitly initialized
    });

    const channel = this.formatChannel(config.pair, config.timeInterval || "15");

    if (!this.channelConfigs.has(channel)) {
      this.channelConfigs.set(channel, new Set());
    }
    this.channelConfigs.get(channel).add(configId);

    if (!this.marketRegistry.has(channel)) {
      this.marketRegistry.set(channel, {
        candles: [],
        candleIndexMap: new Map(),
        isRecovering: false,          // [RACE-1] recovery guard
      });
      coinDCXSocket.subscribe(channel);

      // [QUALITY-2] Immediately seed historical candles for this new channel
      await this.recoverCandlesForChannel(channel);
    }
  }

  // ─────────────────────────────────────────────
  // REMOVE CONFIG STATE (runtime disable support)
  // [QUALITY-1] Previously missing — disabled configs kept firing real orders
  // ─────────────────────────────────────────────
  static removeConfigState(configId) {
    const state = this.configStates.get(configId);
    if (!state) return;

    const channel = this.formatChannel(state.config.pair, state.config.timeInterval || "15");
    this.configStates.delete(configId);

    const channelSet = this.channelConfigs.get(channel);
    if (channelSet) {
      channelSet.delete(configId);
      // Unsubscribe channel if no other config is using it
      if (channelSet.size === 0) {
        this.channelConfigs.delete(channel);
        this.marketRegistry.delete(channel);
        coinDCXSocket.unsubscribe?.(channel); // safe call — only if method exists
        console.log(`[Lifecycle] Channel ${channel} unsubscribed — no active configs.`);
      }
    }

    LoggerService.log("imp", `Config ${configId} removed from SocketService`, "SocketService");
  }

  // ─────────────────────────────────────────────
  // RECOVER MISSED CANDLES — full pass over all channels
  // ─────────────────────────────────────────────
  static async recoverMissedCandles() {
    for (const [channel] of this.marketRegistry.entries()) {
      await this.recoverCandlesForChannel(channel);
    }
  }

  // ─────────────────────────────────────────────
  // RECOVER CANDLES FOR ONE CHANNEL
  // [RACE-1] Sets isRecovering = true so candlestick handler skips ticks
  //          during the HTTP fetch + map rebuild window.
  // ─────────────────────────────────────────────
  static async recoverCandlesForChannel(channel) {
    const registry = this.marketRegistry.get(channel);
    if (!registry) return;

    // [RACE-1] Guard: block candlestick handler from mutating registry
    registry.isRecovering = true;

    try {
      const resolutionMatch = channel.match(/_(\d+[A-Za-z]+)-futures/);
      const resolution = resolutionMatch ? resolutionMatch[1] : "1m";
      const pair = channel.replace(`_${resolution}-futures`, "");

      const to = Math.floor(Date.now() / 1000);
      const from = to - (48 * 60 * 60); // 48 hours lookback (perfect sync with backtester)

      const response = await axios.get(
        "https://public.coindcx.com/market_data/candlesticks",
        {
          params: {
            pair,
            resolution: resolution,
            from: from,
            to: to,
            pcode: "f",
          },
          timeout: 10_000, // don't hang forever
        }
      );

      let candles = response.data?.data || response.data;

      if (Array.isArray(candles) && candles.length > 0) {
        // Normalize timestamps and sort ascending
        candles = candles
          .map((c) => ({
            ...c,
            time: c.time < 10_000_000_000 ? c.time * 1000 : c.time,
          }))
          .sort((a, b) => a.time - b.time);

        // [RACE-2] Atomic assignment — build new map from new array before assigning
        const newMap = new Map(candles.map((c, i) => [c.time, i]));
        registry.candles = candles;
        registry.candleIndexMap = newMap;

        LoggerService.log(
          "info",
          `Recovered ${candles.length} candles for ${channel}`,
          "SocketService"
        );
      }
    } catch (err) {
      LoggerService.log(
        "error",
        `Recovery failed for ${channel}: ${err.message}`,
        "SocketService"
      );
    } finally {
      // [RACE-1] Always release the guard
      registry.isRecovering = false;
    }
  }

  // ─────────────────────────────────────────────
  // MEMORY SYNC — prune old candles hourly
  // [RACE-3] Uses slice() not shift() so in-flight reads stay valid
  // ─────────────────────────────────────────────
  static startMemorySync() {
    setInterval(() => {
      for (const [channel, registry] of this.marketRegistry.entries()) {
        if (registry.isRecovering) continue; // skip if mid-recovery

        if (registry.candles.length > 5_000) {
          // [RACE-3] slice creates a new array — old references held by in-flight
          // strategy scans remain valid; they just see slightly stale tail data
          const trimmed = registry.candles.slice(-2_000);
          const newMap = new Map(trimmed.map((c, i) => [c.time, i]));
          registry.candles = trimmed;
          registry.candleIndexMap = newMap;
          console.log(`[MemSync] Trimmed candles for ${channel}: 5000 → 2000`);
        }
      }
    }, 60 * 60_000); // every 60 minutes
  }

  // ─────────────────────────────────────────────
  // FORMAT CHANNEL
  // ─────────────────────────────────────────────
  static formatChannel(pair, resolution = DEFAULT_RESOLUTION) {
    // Strict prefix check to avoid "B-XBTB-INR" style double-prefix
    const instrument =
      pair?.startsWith("B-") ? pair : `B-${pair}`;
    return `${instrument}_${resolution}m-futures`;
  }

  // ─────────────────────────────────────────────
  // SETUP COINDCX LISTENERS
  // ─────────────────────────────────────────────
  static setupCoinDCXListeners() {

    // ── CANDLESTICK ──────────────────────────────
    coinDCXSocket.on("candlestick", async (data) => {
      try {
        const incomingPair = data.pair;
        if (!incomingPair) return;
        // Broadcast to frontend
        this.io.emit("candlestick", data);
        this.io.emit("price-change", { m: incomingPair, p: data.close });
        PriceStore.update(incomingPair, data.close);

        // Note: the socket natively streams the timeframe we subscribed to, so we don't need '1'
        const channel = this.formatChannel(incomingPair, data.resolution || "15");
        const registry = this.marketRegistry.get(channel);
        if (!registry) return;

        // [RACE-1] Skip all mutation while recovery is rewriting the registry
        if (registry.isRecovering) return;

        if (registry.candleIndexMap.has(data.time)) {
          // Update existing candle in place (live tick update)
          const idx = registry.candleIndexMap.get(data.time);
          registry.candles[idx] = data;
        } else {
          // New candle — validate ordering
          const lastCandle = registry.candles[registry.candles.length - 1];
          if (lastCandle && data.time < lastCandle.time) {
            LoggerService.log(
              "imp",
              `Out-of-order candle ignored for ${channel}: incoming=${data.time} last=${lastCandle.time}`,
              "SocketService"
            );
            return;
          }

          const isNewCandleTrigger = registry.candles.length > 0;
          registry.candleIndexMap.set(data.time, registry.candles.length);
          registry.candles.push(data);

          // Fire strategy for each config watching this channel
          const targetConfigs = this.channelConfigs.get(channel);
     
          if (targetConfigs && isNewCandleTrigger) {
            for (const configId of targetConfigs) {
              // [CRITICAL-2] Always read fresh state — never use a captured variable
              const state = this.getState(configId);
              if (!state) continue;

              // The candle that just closed is the second-to-last
              const closedCandle = registry.candles[registry.candles.length - 2];
              if (!closedCandle) continue;
              await state.mutex.runExclusive(async () => {
                // Re-read inside mutex — state may have changed while we awaited the lock
                const freshState = this.getState(configId);
                if (!freshState) return;

                if (freshState.lastProcessedCandleTime === closedCandle.time) {
                  return; // Already processed this candle
                }

                this.updateState(configId, { lastProcessedCandleTime: closedCandle.time });

                try {
                  await this.executeLiveStrategy(configId, registry.candles);
                } catch (err) {
                  // [CRITICAL-1] No more undefined `logger`
                  LoggerService.log(
                    "error",
                    `[Strategy] ${configId} Error: ${err.message}`,
                    "SocketService",
                    { configId }
                  );
                }
              });
            }
          }
        }

        // ── Real-time SL/TP monitoring (paper trades + limit order expiry) ──
        // Fix: Check EVERY active config for this pair, regardless of its timeframe (1m, 15m, 1H)
        const cleanIncoming = incomingPair.replace(/^B-/, "").toLowerCase();
        
        for (const [configId, state] of this.configStates.entries()) {
          const configPair = (state.config.pair || "").replace(/^B-/, "").toLowerCase();
          
          if (configPair === cleanIncoming && state.activeTrade?.status === "open") {
            this.monitorRealTimeSL(data, configId).catch((err) =>
              LoggerService.log(
                "error",
                `[Monitor] ${configId} Error: ${err.message}`,
                "SocketService",
                { configId }
              )
            );
          }
        }
      } catch (err) {
        // [CRITICAL-1] logger was undefined here — now uses LoggerService
        LoggerService.log(
          "error",
          `Candlestick handler error: ${err.message}`,
          "SocketService"
        );
      }
    });

    // ── POSITION UPDATE ──────────────────────────
    coinDCXSocket.on("df-position-update", async (positions) => {
      let posList = [];
console.log(positions,'positions=======')
      try {
        const raw = Array.isArray(positions)
          ? positions
          : positions
          ? [positions]
          : [];

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
        // [CRITICAL-1] logger was undefined here
        LoggerService.log(
          "error",
          `df-position-update parse error: ${err.message}`,
          "SocketService"
        );
        return;
      }

      // [SYNC-5] Wrap each config in its own try/catch
      // A single bad record can't abort processing for all other configs
      for (const [id, state] of this.configStates.entries()) {
        try {
          await this._processPositionUpdate(id, state, posList);
        } catch (err) {
          LoggerService.log(
            "error",
            `Position update failed for config ${id}: ${err.message}`,
            "SocketService",
            { configId: id }
          );
        }
      }
    });
  }

  // ─────────────────────────────────────────────
  // PROCESS ONE CONFIG'S POSITION UPDATE
  // Extracted so each config has its own try/catch scope
  // ─────────────────────────────────────────────
  static async _processPositionUpdate(id, state, posList) {
    const pair = state.config.pair;

    // Was there an active position before this update?
    const wasActive =
      !!state.currentPosition && state.currentPosition.active_pos !== 0;

    // Find the matching position from the exchange payload
    const pos = posList.find((p) => {
      const cleanP = (p.pair || "").replace("B-", "").toLowerCase();
      const cleanS = (pair || "").replace("B-", "").toLowerCase();
      return cleanP === cleanS;
    });

    const isActive = !!pos && pos.active_pos !== 0;

    if (isActive) {
      this.updateState(id, { currentPosition: pos });

      // Sync slippage — entry price, SL, TP changes from exchange
      if (
        state.activeTrade &&
        state.activeTrade.status === "open" &&
        state.activeTrade.type === "real"
      ) {
        const exchangeSL = pos.stop_loss_trigger || 0;
        const exchangeTP = pos.take_profit_trigger || 0;

        // [SYNC-2] Decouple price guard from SL/TP sync
        const priceChanged =
          pos.avg_price > 0 &&
          state.activeTrade.actualEntryPrice !== pos.avg_price;
        const slChanged =
          exchangeSL > 0 && state.activeTrade.actualSl !== exchangeSL;
        const tpChanged =
          exchangeTP > 0 && state.activeTrade.actualTp !== exchangeTP;

        if (priceChanged || slChanged || tpChanged) {
          const updatedTrade = {
            ...state.activeTrade,
            ...(priceChanged && { actualEntryPrice: pos.avg_price }),
            ...(slChanged && { actualSl: exchangeSL }),
            ...(tpChanged && { actualTp: exchangeTP }),
          };

          this.updateState(id, { activeTrade: updatedTrade });
          TradeHistoryService.saveTrade(updatedTrade).catch((err) =>
            LoggerService.log(
              "error",
              `Failed to persist slippage sync for ${pair}: ${err.message}`,
              "SocketService"
            )
          );
          this.io.emit("trade-history-update", updatedTrade);

          console.log(
            `[SocketService] 🔄 Synced from exchange for ${pair}: ` +
              `Entry=${pos.avg_price}, SL=${exchangeSL}, TP=${exchangeTP}`
          );
        }
      }
    }

    // Reset miss counter when position is confirmed active
    if (!wasActive || isActive) {
      // [CRITICAL-4] updateState — not spread, so positionMissCount is never dropped
      this.updateState(id, { positionMissCount: 0 });
    }

    // Detect position closed
    if (wasActive && !isActive) {
      // [CRITICAL-4] Read fresh from map — the local `state` reference may be stale
      const freshState = this.getState(id);
      if (!freshState) return;

      // Confirmed closed — proceed instantly
      console.log(`[Position] Trade CLOSED on exchange for ${pair} (closing instantly)`);
      this.updateState(id, { positionMissCount: 0 });

      const tradeToClose = freshState.activeTrade;

      // Clear active trade and position immediately
      this.updateState(id, { activeTrade: null, currentPosition: null });

      if (!tradeToClose) return;

      tradeToClose.status = "closed";
      tradeToClose.exitTime = dayjs().tz("Asia/Kolkata").format();
      tradeToClose.exitReason = "Exchange Position Closed";

      try {
        // Give exchange a moment to settle the final fill
        await new Promise((r) => setTimeout(r, 2000));

        const orders = await TradeService.getOrders();
        const exitOrder = Array.isArray(orders)
          ? orders.find(
              (o) =>
                o.pair === pair &&
                o.status === "filled" &&
                (o.stage === "exit" ||
                  o.order_category === "complete_tpsl" ||
                  o.order_type === "stop_market" ||
                  o.order_type === "take_profit_market")
            )
          : null;

        let exitPrice =
          exitOrder && exitOrder.avg_price > 0 ? exitOrder.avg_price : null;

        if (!exitPrice) {
          // [SYNC-3] Log a warning every time we fall back — must be auditable
          LoggerService.log(
            "warning",
            `No filled exit order found for ${pair} — falling back to last candle close`,
            "SocketService",
            { configId: id, pair }
          );

          const registry = this.marketRegistry.get(
            this.formatChannel(pair, "1")
          );
          const lastCandle =
            registry?.candles?.length > 0
              ? registry.candles[registry.candles.length - 1]
              : null;

          // Use last candle close as best approximation, then SL as last resort
          exitPrice = lastCandle?.close ?? tradeToClose.sl;
        }

        if (exitPrice) {
          if (exitOrder) {
            tradeToClose.exitReason = `Exchange Auto-Closed (${
              exitOrder.order_type === "stop_market" ? "SL Hit" : "TP Hit"
            })`;
          }

          const { profit, fee, pnlPercent, grossProfit, entryFee, exitFee } =
            calculateTradeProfit(tradeToClose, exitPrice);

          tradeToClose.profit = profit;
          tradeToClose.fee = fee;
          tradeToClose.grossProfit = grossProfit;
          tradeToClose.entryFee = entryFee;
          tradeToClose.exitFee = exitFee;
          tradeToClose.pnlPercent = pnlPercent;
          tradeToClose.actualExitPrice = exitPrice;
          tradeToClose.exitPrice = exitPrice;
        }
      } catch (err) {
        LoggerService.log(
          "error",
          `Error fetching exit price for ${pair}: ${err.message}`,
          "SocketService",
          { configId: id, pair }
        );
      }

      await TradeHistoryService.saveTrade(tradeToClose);
      this.io.emit("trade-history-update", tradeToClose);
    }
  }

  // ─────────────────────────────────────────────
  // EXECUTE LIVE STRATEGY
  // Note: called inside mutex — only one execution per configId at a time
  // ─────────────────────────────────────────────
  static async executeLiveStrategy(configId, candles) {
    try {
      // [CRITICAL-2] Always read fresh — never use a parameter captured before the mutex
      const state = this.getState(configId);
      if (!state) return;

      const config = state.config;
      const pair = config.pair;

      // [SYNC-4] Guard against misconfigured strategyId
      const strategy = strategies[config.strategyId];
      if (!strategy) {
        LoggerService.log(
          "error",
          `Unknown strategyId "${config.strategyId}" for config ${configId} — skipping`,
          "SocketService",
          { configId, pair }
        );
        return;
      }

      if (state.activeTrade || this.globalPairLocks?.has(pair)) return;
      this.globalPairLocks.add(pair);

      try {
        // Check DB for any active trade on this pair (cross-config safety check)
        const globalActiveTrade = await TradeHistoryService.getActiveTradeByPair(pair);
        console.log(globalActiveTrade, "globalActiveTrade");

        if (globalActiveTrade) {
          if (!state.activeTrade) {
            this.updateState(configId, { activeTrade: globalActiveTrade });
          }
          return;
        }

        if (candles.length < 2) return;

        const latestCandle = candles[candles.length - 1];
        if (!latestCandle) return;

        // Re-read fresh state to get latest lastSignalTime
        const freshState = this.getState(configId);
        if (freshState?.lastSignalTime === latestCandle.time) return;

        console.log(`[Strategy] 🔍 Scanning ${pair} for '${config.strategyId}' signal...`);

        const result = strategy.run(candles, {
          pair,
          type: "live",
          riskAmount: config.riskAmount || 0.05,
          leverage: config.leverage || 20,
          maxPositionSize: config.maxPositionSize || 85,
          atrMultiplierSL: 1,
          simulationStartUnix: Math.floor(Date.now() / 1000) - 86400,
        });

        console.log(result.matched, result.trade, "result.matched && result.trade");

        if (result.matched && result.trade) {
          this.updateState(configId, { lastSignalTime: latestCandle.time });

          await this.handleOrderEntry(configId, result.trade);
        }
      } finally {
        this.globalPairLocks.delete(pair);
      }
    } catch (err) {
      LoggerService.log(
        "error",
        `executeLiveStrategy failed: ${err.message}`,
        "SocketService",
        { configId }
      );
    }
  }

  // ─────────────────────────────────────────────
  // HANDLE ORDER ENTRY
  // ─────────────────────────────────────────────
  static async handleOrderEntry(configId, trade) {
    // [CRITICAL-2] Always read fresh state — never use a stale reference
    const state = this.getState(configId);
    if (!state) return;

    const config = state.config;
    const pair = config.pair;

    if (config.autoTrade) {
      // [CRITICAL-2] Check isPlacingOrder from the live map, not a captured variable
      if (this.getState(configId)?.isPlacingOrder) {
        console.log(`[Order] Skipping — order already in progress for ${pair}`);
        return;
      }

      // [CRITICAL-3] Write sentinel BEFORE exchange call, not after.
      // If the process dies or DB fails after executeFutureOrder(), this sentinel
      // prevents a second order from being placed on the next candle.
      this.updateState(configId, {
        isPlacingOrder: true,
        activeTrade: {
          ...trade,
          pair,
          configId,
          strategyId: config.strategyId,
          status: "open",
          type: "real",
          leverage: config.leverage,
          maxPositionSize: config.maxPositionSize,
          entryTime: dayjs().tz("Asia/Kolkata").format(),
          _sentinel: true, // marks as unconfirmed — replaced by real saveTrade result
        },
      });

      try {
     

        await TradeService.executeFutureOrder({
          ...trade,
          pair,
          leverage: config.leverage,
          maxPositionSize: config.maxPositionSize,
          stop_loss_price: trade.sl,
          riskAmount: config.riskAmount,
          client_order_id: `${configId}-${Date.now()}`,
        });

        // Small delay to let exchange confirm
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
          entryTime: dayjs().tz("Asia/Kolkata").format(),
        });

        // Replace sentinel with confirmed saved trade
        this.updateState(configId, { activeTrade: savedTrade, isPlacingOrder: false });

        await LoggerService.log(
          "success",
          `✅ REAL Position Opened for ${pair}`,
          "SocketService",
          { configId, pair, metadata: savedTrade }
        );

        this.io.emit("trade-history-update", savedTrade);
      } catch (err) {
        await LoggerService.log(
          "error",
          `❌ REAL Execution Failed for ${pair}: ${err.message}`,
          "SocketService",
          { configId, pair }
        );

        // Save the failed trade to the DB so you can see it in the UI
        const failedTrade = await TradeHistoryService.saveTrade({
          ...trade,
          pair,
          configId,
          strategyId: config.strategyId,
          status: "cancelled",
          type: "real",
          leverage: config.leverage,
          entryTime: dayjs().tz("Asia/Kolkata").format(),
          exitTime: dayjs().tz("Asia/Kolkata").format(),
          exitReason: `Failed: ${err.message}`, // Store the exact error
        });

        this.io.emit("trade-history-update", failedTrade);

        // Clear memory completely so the bot can immediately look for a new trade
        this.updateState(configId, { activeTrade: null, isPlacingOrder: false });

        throw err; // Re-throw so mutex caller can log
      }
    } else {
      // Paper trade — no exchange interaction, just save and emit
      const savedTrade = await TradeHistoryService.saveTrade({
        ...trade,
        pair,
        configId,
        strategyId: config.strategyId,
        leverage: config.leverage,
        status: "open",
        type: "paper",
        entryTime: dayjs().tz("Asia/Kolkata").format(),
      });

      this.updateState(configId, { activeTrade: savedTrade });

      await LoggerService.log(
        "imp",
        `🏁 Paper Trade Initialized for ${pair}`,
        "SocketService",
        { configId, pair, metadata: savedTrade }
      );

      // [CRITICAL-5] Emit savedTrade — NOT state.activeTrade (which was null before updateState)
      this.io.emit("trade-history-update", savedTrade);
    }
  }

  // ─────────────────────────────────────────────
  // MONITOR REAL-TIME SL/TP (paper trades + limit order expiry)
  // [RACE-5] Takes configId, reads state fresh at entry — not a passed-in reference
  // ─────────────────────────────────────────────
  static async monitorRealTimeSL(tick, configId) {
    try {
      // [RACE-5] Read fresh — this runs concurrently with strategy execution
      const state = this.getState(configId);
      if (!state) return;

      const activeTrade = state.activeTrade;
      if (!activeTrade || activeTrade.status !== "open") return;

      // Real trade with no confirmed position yet — check for limit order expiry
      if (activeTrade.type === "real" && !state.currentPosition) {
        // Skip sentinel trades — not confirmed on exchange yet
        if (activeTrade._sentinel) return;

        const intervalStr = state.config.timeInterval || state.config.interval || "15";
        const intervalMinutes =
          intervalStr === "1D"
            ? 1440
            : parseInt(intervalStr, 10) || 1;

        const maxWaitMinutes = FVG_EXPIRY_CANDLES * intervalMinutes;
        const entryTime = dayjs(activeTrade.entryTime);
        const now = dayjs();
        const minutesElapsed = now.diff(entryTime, "minute");

        if (minutesElapsed >= maxWaitMinutes) {
          await LoggerService.log(
            "imp",
            `⏳ Limit order expired after ${FVG_EXPIRY_CANDLES} candles ` +
              `(${maxWaitMinutes}m) for ${activeTrade.pair}. Cancelling...`,
            "SocketService",
            { configId, pair: activeTrade.pair || "" }
          );

          if (activeTrade.pair) {
            await TradeService.cancelAllOrders(activeTrade.pair);
          }

          const expired = {
            ...activeTrade,
            status: "closed",
            exitPrice: tick.close,
            exitTime: now.tz("Asia/Kolkata").format(),
            exitReason: `Expired/Missed (${FVG_EXPIRY_CANDLES} Candles)`,
            profit: 0,
            fee: 0,
          };

          await TradeHistoryService.saveTrade(expired);
          this.updateState(configId, { activeTrade: null });
          this.io.emit("trade-history-update", expired);
        }
    
        return;
      }

      // Real trade with confirmed position — exchange handles SL/TP, we don't touch it
      if (activeTrade.type === "real") return;
      // ── Paper trade SL/TP monitoring ──
      const currentPrice = tick.close;

      const high = tick.high || currentPrice;
      const low = tick.low || currentPrice;
      const sl = activeTrade.sl || activeTrade.stop_loss_price || 0;
      const tp = activeTrade.tp || activeTrade.take_profit_price || 0;
      const isBuy = activeTrade.direction === "buy";

      let exitHit = false;
      let reason = "";

      if (isBuy) {
        if (sl > 0 && low <= sl) { exitHit = true; reason = "SL Hit"; }
        else if (tp > 0 && high >= tp) { exitHit = true; reason = "TP Hit"; }
      } else {
        if (sl > 0 && high >= sl) { exitHit = true; reason = "SL Hit"; }
        else if (tp > 0 && low <= tp) { exitHit = true; reason = "TP Hit"; }
      }

      if (!exitHit) return;

      const targetPrice = reason === "SL Hit" ? sl : tp;
      const { profit, fee, pnlPercent, grossProfit, entryFee, exitFee } =
        calculateTradeProfit(activeTrade, targetPrice);

      const closedTrade = {
        ...activeTrade,
        status: "closed",
        exitPrice: targetPrice,
        exitTime: dayjs().tz("Asia/Kolkata").format(),
        exitReason: `PAPER ${reason}`,
        profit,
        fee,
        grossProfit,
        entryFee,
        exitFee,
        pnlPercent,
      };
      await TradeHistoryService.saveTrade(closedTrade);
      this.updateState(configId, { activeTrade: null });
      this.io.emit("trade-history-update", closedTrade);

      console.log(
        `[Monitor] 🎯 PAPER ${reason} for ${activeTrade.pair}. PnL: ${profit}`
      );
    } catch (err) {
      LoggerService.log(
        "error",
        `monitorRealTimeSL failed for ${configId}: ${err.message}`,
        "SocketService",
        { configId }
      );
    }
  }
}

export { SocketService };