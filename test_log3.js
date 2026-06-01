import { FVGStrategy } from './strategies/FVGStrategy.js';
const strategy = new FVGStrategy();
const candles = [
  { time: 1000, open: 100, high: 110, low: 90, close: 100 },
  { time: 2000, open: 100, high: 110, low: 90, close: 100 },
  { time: 3000, open: 72750, high: 72750, low: 72700, close: 72700 }, // c1
  { time: 4000, open: 72700, high: 72700, low: 72600, close: 72600 }, // c2
  { time: 5000, open: 72600, high: 72600, low: 72500, close: 72500 }, // c3 (fvg forms)
  { time: 6000, open: 72500, high: 72550, low: 72400, close: 72500 }, // fvg+1
  { time: 7000, open: 72500, high: 72550, low: 72400, close: 72500 },
  { time: 8000, open: 72500, high: 72550, low: 72400, close: 72500 }
];
let res = strategy.run(candles, { type: 'live_signal', riskAmount: 100 });
console.log(res.indicators.fvgs);
console.log(res.trade);
