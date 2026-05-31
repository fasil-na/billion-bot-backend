import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const TradeSchema = new mongoose.Schema({
  pair: String,
  status: String,
  entryTime: Date,
  exitTime: Date,
  profit: Number,
  type: String
}, { strict: false });
const Trade = mongoose.model('Trade', TradeSchema);

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const trades = await Trade.find().sort({ _id: -1 }).limit(5);
  console.log(JSON.stringify(trades, null, 2));
  process.exit(0);
}
run();
