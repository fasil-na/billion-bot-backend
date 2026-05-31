import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const TradeSchema = new mongoose.Schema({}, { strict: false });
const Trade = mongoose.model('Trade', TradeSchema, 'trades');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  // Find trades around 09:52 or with the specific entry price
  const trades = await Trade.find({ 
    status: { $in: ['open', 'pending', 'cancelled', 'closed'] }
  }).sort({ _id: -1 }).limit(5);
  
  console.log("RECENT TRADES IN DB:");
  for (const t of trades) {
    const doc = t.toObject();
    console.log(`[${doc.status}] Pair: ${doc.pair}, EntryTime: ${doc.entryTime}, Type: ${doc.type}, Reason: ${doc.exitReason || 'N/A'}, Price: ${doc.entryPrice}`);
  }
  
  process.exit(0);
}
run();
