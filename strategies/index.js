import { FVGStrategy } from './FVGStrategy.js';
import { SMAStrategy } from './SMAStrategy.js';
import { OpeningBreakoutStrategy } from './OpeningBreakoutStrategy.js';

const strategies = {
    'fvg-imbalance': new FVGStrategy(),
    'sma_crossover': new SMAStrategy(),
    'opening-breakout': new OpeningBreakoutStrategy()
};

export default strategies;
