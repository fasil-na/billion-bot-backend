import { TradeService } from './services/TradeService.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const positions = await TradeService.getPositions();
  console.log(JSON.stringify(positions, null, 2));
  process.exit(0);
}
run();
