import dayjs from 'dayjs';
import { FVGStrategy } from './strategies/FVGStrategy.js';

const strategy = new FVGStrategy();
// let's simulate a case where FVG forms, price doesn't hit it for a while, then hits it.
// Or wait, the user's case is a SELL trade.
// Bearish FVG.
const candles = [
  { time: 1000, open: 100, high: 110, low: 90, close: 100 },
  { time: 2000, open: 100, high: 110, low: 90, close: 100 },
  { time: 3000, open: 72750, high: 72750, low: 72700, close: 72700 }, // c1 (low = 72700)
  { time: 4000, open: 72700, high: 72700, low: 72600, close: 72600 }, // c2
  { time: 5000, open: 72600, high: 72600, low: 72500, close: 72500 }, // c3 (high = 72600). Gap = 72700 - 72600 = 100. Midpoint = 72650.
  // fvg.formedAt = index 4 (time 5000).
  // At time 6000, i = 5 (fvg.formedAt + 1). live_signal will force entryCondition = true, isPendingEntry = true.
  { time: 6000, open: 72500, high: 72550, low: 72400, close: 72500 }, // candle right after
  // At time 7000, price hits midpoint 72650
  { time: 7000, open: 72500, high: 72660, low: 72400, close: 72500 }, // hits FVG
];

console.log("Check at time 6000 (candles up to 6000 + forming 7000)");
let res1 = strategy.checkSignal(candles.slice(0, 6).concat([{ time: 7000, open: 72500, high: 72550, low: 72400, close: 72500 }]), { type: 'live_signal' });
console.log(res1);

console.log("Check at time 7000 (candles up to 7000 + forming 8000)");
let res2 = strategy.checkSignal(candles.concat([{ time: 8000, open: 72500, high: 72550, low: 72400, close: 72500 }]), { type: 'live_signal' });
console.log(res2);
