import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const logs = await mongoose.connection.db.collection('systemlogs').find().sort({ _id: -1 }).limit(3).toArray();
  console.log(JSON.stringify(logs, null, 2));
  process.exit(0);
}
run();
