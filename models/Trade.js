import mongoose from 'mongoose';

const TradeSchema = new mongoose.Schema({
  pair: { type: String, required: true },
  configId: { type: String, required: true },
  strategyId: { type: String, required: true },
  direction: { type: String, enum: ['buy', 'sell'] },
  type: { type: String, enum: ['real', 'paper'], default: 'paper' },
  status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open' },
  entryPrice: { type: Number },
  exitPrice: { type: Number },
  sl: { type: Number },
  tp: { type: Number },
  units: { type: Number },
  actualEntryPrice: { type: Number },
  actualExitPrice: { type: Number },
  actualSl: { type: Number },
  actualTp: { type: Number },
  qty: { type: Number },
  profit: { type: Number, default: 0 },
  entryTime: { type: Date },
  exitTime: { type: Date },
  exitReason: { type: String },
  orderType: { type: String },
  leverage: { type: Number },
}, { timestamps: true });

export default mongoose.model('Trade', TradeSchema);
