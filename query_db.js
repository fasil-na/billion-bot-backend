import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/billion_bot_backend');

const LiveConfigSchema = new mongoose.Schema({}, { strict: false });
const LiveConfig = mongoose.model('LiveConfig', LiveConfigSchema, 'liveconfigs');

async function check() {
  const configs = await LiveConfig.find({});
  console.log(JSON.stringify(configs, null, 2));
  process.exit(0);
}
check();
