import axios from "axios";
import crypto from "crypto";
import { formatPair } from "../strategies/StrategyUtils.js";
import { LoggerService } from "./LoggerService.js";
class TradeService {
  static get credentials() {
    return {
      apiKey: process.env.COINDCX_API_KEY || "",
      apiSecret: process.env.COINDCX_API_SECRET || ""
    };
  }
  static baseUrl = "https://api.coindcx.com";
  static instrumentCache = /* @__PURE__ */ new Map();
  static STATIC_INSTRUMENTS = {
    "B-BTC_USDT": { maxLeverage: 20, qtyStep: 1e-3, priceStep: 0.1, minNotional: 6 },
    "B-SUSHI_USDT": { maxLeverage: 10, qtyStep: 1, priceStep: 1e-4, minNotional: 6 },
    "B-XAU_USDT": { maxLeverage: 20, qtyStep: 0.01, priceStep: 0.01, minNotional: 6 },
    "SUSHIUSDT": { maxLeverage: 10, qtyStep: 1, priceStep: 1e-4, minNotional: 6 }
  };
  static formatTradeParams(rawPair, rawQty, leverage, customTp = 0, customSl = 0, tradeDirection = "buy", entryPrice = 0, maxNotional = 1e6, riskAmount = 0) {
    const pair = formatPair(rawPair);
    const staticData = this.STATIC_INSTRUMENTS[pair] || this.STATIC_INSTRUMENTS["B-BTC_USDT"];
    const maxLeverage = Math.min(leverage, staticData.maxLeverage);
    const pricePrecision = staticData.priceStep.toString().split(".")[1]?.length || 0;
    const tpPrice = customTp > 0 ? Number(Number(customTp).toFixed(pricePrecision)) : 0;
    const slPrice = customSl > 0 ? Number(Number(customSl).toFixed(pricePrecision)) : 0;
    let qty = rawQty;
    if (riskAmount > 0 && entryPrice > 0 && slPrice > 0) {
      const riskPerUnit = Math.abs(entryPrice - slPrice);
      if (riskPerUnit > 0) {
        qty = riskAmount / riskPerUnit;
      }
    }
    const step = staticData.qtyStep;
    const qtyPrecision = step.toString().split(".")[1]?.length || 0;
    qty = Math.floor(qty / step) * step;
    qty = Number(qty.toFixed(qtyPrecision));
    if (entryPrice > 0) {
      const minNotional = staticData.minNotional || 6;
      const step2 = staticData.qtyStep;
      const minQty = Math.ceil(minNotional / entryPrice / step2) * step2;
      if (qty < minQty) {
        throw new Error(`Calculated quantity ${qty.toFixed(qtyPrecision)} is less than minimum required ${minQty.toFixed(qtyPrecision)} for ${pair}. Skipping trade to avoid excessive risk.`);
      }
    }
    const marginName = pair.includes("USDT") ? "USDT" : "INR";
    const formattedEntryPrice = entryPrice > 0 ? Number(Number(entryPrice).toFixed(pricePrecision)) : 0;
    return { pair, qty: Number(qty.toFixed(qtyPrecision)), maxLeverage, tpPrice, slPrice, marginName, formattedEntryPrice };
  }
  // final excecution of trade
  static async executeFutureOrder(trade) {
    const { apiKey, apiSecret } = this.credentials;
    if (!apiKey || !apiSecret) {
      console.error("\u274C CoinDCX API Key or Secret missing in .env. Skipping trade execution.");
      return;
    }

    const timeStamp = Math.floor(Date.now());
    try {
      const { pair, qty, maxLeverage, tpPrice, slPrice, marginName, formattedEntryPrice } = this.formatTradeParams(
        trade.pair,
        Number(trade.units),
        Number(trade.leverage) || 20,
        // Use leverage from trade config (LiveConfig), default to 10 if missing
        Number(trade.take_profit_price || trade.tp || 0),
        Number(trade.stop_loss_price || trade.sl || 0),
        trade.direction || "buy",
        trade.entryPrice || 0,
        trade.maxPositionSize || 85,
        trade.riskAmount || 0.05
      );
      const baseOrder = {
        side: trade.direction?.toLowerCase() || "buy",
        pair,
        order_type: trade.orderType || "market_order",
        price: trade.orderType === "limit_order" ? formattedEntryPrice : null,
        total_quantity: qty,
        leverage: maxLeverage,
        notification: "no_notification",
        time_in_force: trade.orderType === "limit_order" ? "good_till_cancel" : null,
        margin_currency_short_name: marginName
      };
      if (tpPrice > 0) baseOrder.take_profit_price = tpPrice;
      if (slPrice > 0) baseOrder.stop_loss_price = slPrice;
      const body = {
        "timestamp": timeStamp,
        "order": baseOrder
      };
      const payload = Buffer.from(JSON.stringify(body)).toString();
      const signature = crypto.createHmac("sha256", apiSecret).update(payload).digest("hex");
      await LoggerService.log("info", `\u{1F680} Sending ${trade.direction?.toUpperCase()} order for ${pair}...`, "TradeService", { pair, metadata: body });
      const response = await axios.post(`${this.baseUrl}/exchange/v1/derivatives/futures/orders/create`, body, {
        headers: {
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
          "Content-Type": "application/json"
        },
        timeout: 1e4
        // 10s timeout
      });
      await LoggerService.log("success", `\u2705 Trade Executed: ${trade.direction?.toUpperCase()} ${qty} ${pair} @ Market`, "TradeService", { pair, metadata: response.data });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data;
      const status = error.response?.status;
      const errorMsg = errorData?.message || error.message;
      throw new Error(errorMsg);
    }
  }
  static async getPositions() {
    const { apiKey, apiSecret } = this.credentials;
    if (!apiKey || !apiSecret) return [];
    const timeStamp = Math.floor(Date.now());
    const body = { timestamp: timeStamp };
    const bodyString = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", apiSecret).update(bodyString).digest("hex");
    try {
      const response = await axios.post(`${this.baseUrl}/exchange/v1/derivatives/futures/positions`, bodyString, {
        headers: {
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
          "Content-Type": "application/json"
        }
      });
      return response.data;
    } catch (error) {
      console.error("\u274C Failed to fetch positions:", error.response?.data || error.message);
      return null;
    }
  }
  static async getOrders() {
    const { apiKey, apiSecret } = this.credentials;
    if (!apiKey || !apiSecret) return [];
    const timeStamp = Math.floor(Date.now());
    const body = { timestamp: timeStamp };
    const bodyString = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", apiSecret).update(bodyString).digest("hex");
    try {
      const response = await axios.post(`${this.baseUrl}/exchange/v1/derivatives/futures/orders`, bodyString, {
        headers: {
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
          "Content-Type": "application/json"
        }
      });
      return response.data;
    } catch (error) {
      console.error("\u274C Failed to fetch orders:", error.response?.data || error.message);
      return null;
    }
  }
  static async cancelAllOrders(pair) {
    const { apiKey, apiSecret } = this.credentials;
    if (!apiKey || !apiSecret) return;
    try {
      const orders = await this.getOrders();
      if (!Array.isArray(orders)) return;
      const openOrders = orders.filter((o) => o.pair === pair && o.status === "open");
      if (openOrders.length === 0) {
        console.log(`\u2139\uFE0F No active limit orders to cancel for ${pair}`);
        return;
      }
      console.log(`[TradeService] Found ${openOrders.length} open orders for ${pair}. Cancelling...`);
      for (const order of openOrders) {
        const timeStamp = Math.floor(Date.now());
        const cancelBody = { timestamp: timeStamp, id: order.id };
        const cancelBodyString = JSON.stringify(cancelBody);
        const cancelSignature = crypto.createHmac("sha256", apiSecret).update(cancelBodyString).digest("hex");
        await axios.post(`${this.baseUrl}/exchange/v1/derivatives/futures/orders/cancel`, cancelBodyString, {
          headers: {
            "X-AUTH-APIKEY": apiKey,
            "X-AUTH-SIGNATURE": cancelSignature,
            "Content-Type": "application/json"
          }
        });
        console.log(`\u2705 Cancelled order ${order.id} for ${pair}`);
        await new Promise((r) => setTimeout(r, 200));
      }
      return { message: "success" };
    } catch (error) {
      console.error(`\u274C Failed to cancel orders for ${pair}:`, error.response?.data || error.message);
      return null;
    }
  }
  static async closePosition({ positionId }) {
    const { apiKey, apiSecret } = this.credentials;
    if (!apiKey || !apiSecret) {
      console.error("\u274C CoinDCX API Key or Secret missing in .env. Skipping trade execution.");
      return;
    }
    const timeStamp = Math.floor(Date.now());
    const body = {
      timestamp: timeStamp,
      id: positionId
    };
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = crypto.createHmac("sha256", apiSecret).update(payload).digest("hex");
    try {
      console.log(`[TradeService] \u{1F680} Exit order for ${positionId}...`);
      const response = await axios.post(`${this.baseUrl}/exchange/v1/derivatives/futures/positions/exit`, body, {
        headers: {
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
          "Content-Type": "application/json"
        }
      });
      console.log("\u2705 CoinDCX Trade Executed Successfully:", JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error("\u274C CoinDCX Trade Execution Failed:", error.response?.data || error.message);
      throw error;
    }
  }
}
export {
  TradeService
};
