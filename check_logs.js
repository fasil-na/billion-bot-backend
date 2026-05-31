import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const SystemLogSchema = new mongoose.Schema({}, { strict: false });
const SystemLog = mongoose.model('SystemLog', SystemLogSchema, 'systemlogs');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const logs = await SystemLog.find({ level: { $in: ['warn', 'error', 'imp'] } }).sort({ _id: -1 }).limit(10);
  for (const l of logs) {
    const doc = l.toObject();
    console.log(`[${doc.level}] ${doc.createdAt} ${doc.message}`);
  }
  process.exit(0);
}
run();
