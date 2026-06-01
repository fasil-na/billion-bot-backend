import dayjs from 'dayjs';
import { FVGStrategy } from './strategies/FVGStrategy.js';

class FixedFVGStrategy extends FVGStrategy {
    checkSignal(candles, params) {
        if (candles.length < 5) return { matched: false };
        const result = this.run(candles, { ...params, type: 'live_signal' });

        if (!result.trade) {
            return { matched: false };
        }

        const tradeEntryUnix = dayjs(result.trade.entryTime).valueOf();
        const recentlyClosedCandleTime = candles[candles.length - 2].time;

        if (tradeEntryUnix <= recentlyClosedCandleTime) {
            return { matched: false };
        }

        return {
            matched: true,
            trade: result.trade
        };
    }
}

const strategy = new FixedFVGStrategy();

const candles = [
  { time: 1000, open: 100, high: 110, low: 90, close: 100 },
  { time: 2000, open: 100, high: 110, low: 90, close: 100 },
  { time: 3000, open: 72750, high: 72750, low: 72700, close: 72700 }, // c1 (15:51)
  { time: 4000, open: 72700, high: 72700, low: 72600, close: 72600 }, // c2 (15:52)
  { time: 5000, open: 72600, high: 72600, low: 72500, close: 72500 }, // c3 (15:53, fvg gap 100)
];

// Event 1: 15:54 tick arrives
console.log("Event 1 (15:54 forming, 15:53 closed):");
// high 72600 to prevent a new FVG with c1=4000
let candles1 = [...candles, { time: 6000, open: 72500, high: 72600, low: 72400, close: 72500 }];
console.log(strategy.checkSignal(candles1, { type: 'live_signal', riskAmount: 100 }).matched);

// Event 2: 15:55 tick arrives (15:54 closed)
console.log("Event 2 (15:55 forming, 15:54 closed):");
let candles2 = [...candles1, { time: 7000, open: 72500, high: 72600, low: 72400, close: 72500 }];
console.log(strategy.checkSignal(candles2, { type: 'live_signal', riskAmount: 100 }).matched);

