import mongoose from 'mongoose';

const LiveConfigSchema = new mongoose.Schema({
  pair: {
    type: String,
    required: true,
  },
  strategyId: {
    type: String,
    required: true,
  },
  timeInterval: {
    type: String,
    required: true,
  },
  riskAmount: {
    type: Number,
    required: true,
    default: 5,
  },
  autoTrade: {
    type: Boolean,
    default: false,
  },
  isEnabled: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true
});

const LiveConfig = mongoose.model('LiveConfig', LiveConfigSchema);
export default LiveConfig;
