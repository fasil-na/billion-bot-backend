import { FVGStrategy } from './FVGStrategy.js';
import { SMAStrategy } from './SMAStrategy.js';
import { DailyHLBreakoutStrategy } from './ThreeWhiteSolider.js';
const strategies = {
    'fvg-imbalance': new FVGStrategy(),
    'sma_crossover': new SMAStrategy(),
    'three-soldiers': new DailyHLBreakoutStrategy()
};

export default strategies;
