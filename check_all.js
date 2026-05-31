import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const TradeSchema = new mongoose.Schema({}, { strict: false });
const Trade = mongoose.model('Trade', TradeSchema, 'trades');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const trades = await Trade.find().sort({ _id: -1 }).limit(10);
  console.log("ALL RECENT TRADES IN DB:");
  for (const t of trades) {
    console.log(`- EntryTime: ${t.entryTime}, Status: ${t.status}, Pair: ${t.pair}, Reason: ${t.exitReason}`);
  }
  process.exit(0);
}
run();
