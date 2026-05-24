import { io } from "socket.io-client";
import crypto from "crypto";
import EventEmitter from "events";
class CoinDCXSocketService extends EventEmitter {
  socket = null;
  apiKey;
  apiSecret;
  endpoint;
  authenticated = false;
  subscriptions = /* @__PURE__ */ new Set();
  lastPrices = /* @__PURE__ */ new Map();
  lastBalances = [];
  lastCandleTime = Date.now();
  constructor(config) {
    super();
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.endpoint = "wss://stream.coindcx.com/";
    setInterval(() => {
      const diff = Date.now() - this.lastCandleTime;
      if (diff > 6e4 && this.subscriptions.size > 0) {
        console.error("\u{1F6A8} No candle data detected for 60s! Reconnecting socket...");
        this.disconnect();
        this.connect();
      }
    }, 3e4);
  }
  connect() {
    if (this.socket?.connected) return;
    console.log(`Connecting to CoinDCX Socket at ${this.endpoint}...`);
    this.socket = io(this.endpoint, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1e3,
      reconnectionDelayMax: 5e3,
      timeout: 2e4,
      query: { EIO: "3" }
    });
    this.socket.removeAllListeners();
    this.socket.on("connect", () => {
      console.log("Connected to CoinDCX Socket");
      this.authenticate();
      this.resubscribe();
      this.emit("connected");
    });
    this.socket.on("disconnect", (reason) => {
      console.log(`Disconnected from CoinDCX Socket: ${reason}`);
      this.authenticated = false;
      this.emit("disconnected", reason);
    });
    this.socket.on("connect_error", (error) => {
      console.error("CoinDCX Socket Connection Error:", error.message);
      this.emit("socket_error", error);
    });
    this.registerListeners();
  }
  authenticate() {
    if (!this.socket) return;
    const body = { channel: "coindcx" };
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
    console.log("Authenticating with CoinDCX...");
    this.socket.emit("join", {
      "channelName": "coindcx",
      "authSignature": signature,
      "apiKey": this.apiKey
    });
    this.authenticated = true;
  }
  subscribe(channelName) {
    this.subscriptions.add(channelName);
    if (this.socket?.connected) {
      console.log(`Subscribing to channel: ${channelName}`);
      this.socket.emit("join", { channelName });
    }
  }
  unsubscribe(channelName) {
    this.subscriptions.delete(channelName);
    if (this.socket?.connected) {
      console.log(`Unsubscribing from channel: ${channelName}`);
      this.socket.emit("leave", { channelName });
    }
  }
  resubscribe() {
    if (!this.socket?.connected) return;
    for (const channel of this.subscriptions) {
      console.log(`Resubscribing to channel: ${channel}`);
      this.socket.emit("join", { channelName: channel });
    }
  }
  registerListeners() {
    if (!this.socket) return;
    this.socket.on("balance-update", (response) => {
      this.lastBalances = response.data;
      this.emit("balance-update", response.data);
    });
    this.socket.on("order-update", (response) => {
      this.emit("order-update", response.data);
    });
    this.socket.on("candlestick", (response) => {
      this.lastCandleTime = Date.now();
      try {
        const parsed = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
        const candleData = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data || parsed;
        if (candleData && (candleData.open_time || candleData.t)) {
          let time = candleData.open_time || candleData.t;
          if (time < 1e10) time *= 1e3;
          let pair = candleData.pair || candleData.s || parsed.channel || response.channel;
          if (pair && pair.includes("_")) {
            pair = pair.split("_").slice(0, 2).join("_");
            if (pair.includes("-futures")) pair = pair.replace("-futures", "");
            const parts = (parsed.channel || response.channel || "").split("_");
            if (parts.length >= 2) {
              pair = `${parts[0]}_${parts[1]}`.replace("-futures", "");
            }
          }
          let resolution = null;
          const channelStr = parsed.channel || response.channel || "";
          const resMatch = channelStr.match(/_(\d+)[A-Za-z]+-futures/);
          if (resMatch) {
            resolution = resMatch[1];
          }

          const safe = (v) => {
            const n = Number(v);
            return isNaN(n) ? 0 : n;
          };
          const formattedCandle = {
            time,
            pair,
            resolution,
            open: safe(candleData.open || candleData.o),
            high: safe(candleData.high || candleData.h),
            low: safe(candleData.low || candleData.l),
            close: safe(candleData.close || candleData.c),
            volume: safe(candleData.volume || candleData.v)
          };
          this.emit("candlestick", formattedCandle);
        } else {
          console.log("[Socket Service] No valid candle data in response");
        }
      } catch (err) {
        console.error("Error parsing candlestick data:", err);
        this.emit("candlestick", response.data || response);
      }
    });
    this.socket.on("new-trade", (response) => {
      this.emit("new-trade", response.data);
    });
    this.socket.on("df-position-update", (response) => {
      this.emit("df-position-update", response.data);
    });
  }
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.authenticated = false;
    }
  }
  isConnected() {
    return this.socket?.connected || false;
  }
  isAuthenticated() {
    return this.authenticated;
  }
  getLastPrices() {
    return Object.fromEntries(this.lastPrices);
  }
  getLastBalances() {
    return this.lastBalances;
  }
}
const coinDCXSocket = new CoinDCXSocketService({
  apiKey: process.env.COINDCX_API_KEY || "",
  apiSecret: process.env.COINDCX_API_SECRET || ""
});
export {
  CoinDCXSocketService,
  coinDCXSocket
};
