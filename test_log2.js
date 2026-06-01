import { FVGStrategy } from './strategies/FVGStrategy.js';
const strategy = new FVGStrategy();
const candles = [
  { time: 1000, open: 100, high: 110, low: 90, close: 100 },
  { time: 2000, open: 100, high: 110, low: 90, close: 100 },
  { time: 3000, open: 72750, high: 72750, low: 72700, close: 72700 }, // c1 (index 2)
  { time: 4000, open: 72700, high: 72700, low: 72600, close: 72600 }, // c2 (index 3)
  { time: 5000, open: 72600, high: 72600, low: 72500, close: 72500 }, // c3 (index 4) fvg.formedAt
  { time: 6000, open: 72500, high: 72550, low: 72400, close: 72500 }, // index 5
  { time: 7000, open: 72500, high: 72550, low: 72400, close: 72500 }  // index 6
];

// let's copy the `run` loop inside here and trace it
let fvgAt = -1;
let enteredAt = -1;
for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    
    // fvg form
    if (c3.high < c1.low) {
        if (i === 4) { fvgAt = i; }
    }
    
    // active fvg check
    if (fvgAt !== -1 && i > fvgAt) {
        if (i === fvgAt + 1) {
            enteredAt = candles[i].time;
            break;
        }
    }
}
console.log("fvgAt:", fvgAt, "enteredAt:", enteredAt);
