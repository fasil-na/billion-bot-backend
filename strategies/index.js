import { FVGStrategy } from './FVGStrategy.js';
import { SMAStrategy } from './SMAStrategy.js';

const strategies = {
    'fvg-imbalance': new FVGStrategy(),
    'sma_crossover': new SMAStrategy()
};

export default strategies;
