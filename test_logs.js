import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const SystemLogSchema = new mongoose.Schema({
  timestamp: Date,
  level: String,
  message: String,
  source: String,
  metadata: Object
});
const SystemLog = mongoose.model('SystemLog', SystemLogSchema);

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const logs = await SystemLog.find({ message: /REAL Position Opened/ }).sort({ _id: -1 }).limit(10);
  for (const l of logs) {
    console.log(`[${l.level}] ${l.message} - Metadata: ${JSON.stringify(l.metadata)}`);
  }
  process.exit(0);
}
run();
