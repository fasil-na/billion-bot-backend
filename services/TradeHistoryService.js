import Trade from '../models/Trade.js';

export class TradeHistoryService {
  static async saveTrade(tradeData) {
    if (tradeData._id) {
      return await Trade.findByIdAndUpdate(tradeData._id, tradeData, { new: true }).lean();
    }
    const newTrade = new Trade(tradeData);
    const saved = await newTrade.save();
    return saved.toObject();
  }

  static async getActiveTradeByPair(pair) {
    return await Trade.findOne({ pair, status: 'open' }).lean();
  }
}
