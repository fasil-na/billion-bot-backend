import fs from 'fs';

const socketFile = '/Users/maheendran/Desktop/Project 12/personal/billion/billion-bot-backend/services/SocketService.js';
let content = fs.readFileSync(socketFile, 'utf8');

const syncFunction = `
  // ─────────────────────────────────────────────
  // SYNC HISTORY API (Polling for perfect parity)
  // ─────────────────────────────────────────────
  static async syncHistoricalCandles(channel, expectedClosedTime) {
    const registry = this.pairCandleRegistry.get(channel) || this.marketRegistry.get(channel);
    if (!registry) return;

    try {
      const resolutionMatch = channel.match(/_(\\d+[A-Za-z]+)-futures/);
      const resolution = resolutionMatch ? resolutionMatch[1] : "15";
      const pair = channel.replace(\`_\${resolution}-futures\`, "");

      const to = Math.floor(Date.now() / 1000);
      const from = to - (48 * 60 * 60);

      let fetchedCandles = [];
      let foundExpected = false;
      let attempts = 0;
      const maxAttempts = 10;

      // Poll until the official History API returns the closed candle
      while (!foundExpected && attempts < maxAttempts) {
        attempts++;
        const response = await axios.get(
          "https://public.coindcx.com/market_data/candlesticks",
          {
            params: { pair, resolution, from, to, pcode: "f" },
            timeout: 5000,
          }
        );

        let data = response.data?.data || response.data;
        if (Array.isArray(data) && data.length > 0) {
          fetchedCandles = data
            .map((c) => ({
              ...c,
              time: c.time < 10_000_000_000 ? c.time * 1000 : c.time,
            }))
            .sort((a, b) => a.time - b.time);

          if (fetchedCandles[fetchedCandles.length - 1].time >= expectedClosedTime) {
            foundExpected = true;
          } else {
            // Wait 1 second and poll again
            await new Promise(r => setTimeout(r, 1000));
          }
        } else {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (fetchedCandles.length > 0) {
        const liveCandle = registry.candles[registry.candles.length - 1];
        if (!liveCandle) return;

        const newMap = new Map();
        const newCandles = [];

        // 1. Fully depend on History API for all closed candles!
        fetchedCandles.forEach((c) => {
          if (c.time !== liveCandle.time) {
             newCandles.push(c);
             newMap.set(c.time, newCandles.length - 1);
          }
        });

        // 2. Append ONLY the live, currently-forming WebSocket candle for live midpoint checks
        newCandles.push(liveCandle);
        newMap.set(liveCandle.time, newCandles.length - 1);

        registry.candles = newCandles;
        registry.candleIndexMap = newMap;
      }
    } catch (err) {
      LoggerService.log("warn", \`Failed to sync History API for \${channel}: \${err.message}\`, "SocketService");
    }
  }
`;

// Replace the old syncHistoricalCandles completely
const startIdx = content.indexOf('  // ─────────────────────────────────────────────\n  // SYNC HISTORY API');
const endIdx = content.indexOf('  static async recoverCandlesForChannel(channel) {');
if (startIdx !== -1 && endIdx !== -1) {
    content = content.substring(0, startIdx) + syncFunction + '\n' + content.substring(endIdx);
}

// Update the call site
const callRegex = /await this\.syncHistoricalCandles\(channel\);/g;
content = content.replace(callRegex, `const resMs = parseInt(channel.match(/_(\\d+[A-Za-z]+)-futures/)?.[1] || "15") * 60 * 1000;\n              const expectedClosedTime = data.time - resMs;\n              await this.syncHistoricalCandles(channel, expectedClosedTime);`);

fs.writeFileSync(socketFile, content);
console.log('Poller applied.');
