import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const TradeSchema = new mongoose.Schema({}, { strict: false });
const Trade = mongoose.model('Trade', TradeSchema, 'trades');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const t = await Trade.find({ entryPrice: 74151.7000 });
  console.log("FOUND EXACT TRADE:", t);
  const anyTrades = await Trade.find({}).sort({_id: -1}).limit(2);
  console.log("ANY TRADES:", anyTrades);
  process.exit(0);
}
run();
