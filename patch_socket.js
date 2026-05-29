import fs from 'fs';

const socketFile = '/Users/maheendran/Desktop/Project 12/personal/billion/billion-bot-backend/services/SocketService.js';
let content = fs.readFileSync(socketFile, 'utf8');

const syncFunction = `
  // ─────────────────────────────────────────────
  // SYNC HISTORY API (Background)
  // ─────────────────────────────────────────────
  static async syncHistoricalCandles(channel) {
    const registry = this.pairCandleRegistry.get(channel);
    if (!registry) return;

    try {
      const resolutionMatch = channel.match(/_(\\d+[A-Za-z]+)-futures/);
      const resolution = resolutionMatch ? resolutionMatch[1] : "1m";
      const pair = channel.replace(\`_\${resolution}-futures\`, "");

      const to = Math.floor(Date.now() / 1000);
      const from = to - (48 * 60 * 60);

      const response = await axios.get(
        "https://public.coindcx.com/market_data/candlesticks",
        {
          params: { pair, resolution: resolution, from: from, to: to, pcode: "f" },
          timeout: 5000,
        }
      );

      let fetchedCandles = response.data?.data || response.data;

      if (Array.isArray(fetchedCandles) && fetchedCandles.length > 0) {
        fetchedCandles = fetchedCandles
          .map((c) => ({
            ...c,
            time: c.time < 10_000_000_000 ? c.time * 1000 : c.time,
          }))
          .sort((a, b) => a.time - b.time);

        const liveCandle = registry.candles[registry.candles.length - 1];
        if (!liveCandle) return;

        const newMap = new Map();
        const newCandles = [];

        fetchedCandles.forEach((c) => {
          if (c.time === liveCandle.time) {
            newCandles.push(liveCandle); // keep live tick precision for the currently forming candle
          } else {
            newCandles.push(c);
          }
          newMap.set(c.time, newCandles.length - 1);
        });

        if (!newMap.has(liveCandle.time)) {
          newCandles.push(liveCandle);
          newMap.set(liveCandle.time, newCandles.length - 1);
        }

        registry.candles = newCandles;
        registry.candleIndexMap = newMap;
      }
    } catch (err) {
      LoggerService.log("warn", \`Failed to sync History API for \${channel}: \${err.message}\`, "SocketService");
    }
  }
`;

if (!content.includes('syncHistoricalCandles')) {
    content = content.replace('static async recoverCandlesForChannel(channel) {', syncFunction + '\n  static async recoverCandlesForChannel(channel) {');
}

const targetCall = `
          const isNewCandleTrigger = registry.candles.length > 0;
          registry.candleIndexMap.set(data.time, registry.candles.length);
          registry.candles.push(data);

          if (isNewCandleTrigger) {
              // Await the history sync so our strategy uses official History API data for the closed candles!
              await this.syncHistoricalCandles(channel);
          }
`;

content = content.replace(
    `          const isNewCandleTrigger = registry.candles.length > 0;
          registry.candleIndexMap.set(data.time, registry.candles.length);
          registry.candles.push(data);`,
    targetCall
);

fs.writeFileSync(socketFile, content);
console.log('SocketService patched successfully.');
