import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log("COLLECTIONS:", collections.map(c => c.name));
  
  const trades = await mongoose.connection.db.collection('trades').find().sort({ _id: -1 }).limit(3).toArray();
  console.log("TRADES:", trades);
  process.exit(0);
}
run();
