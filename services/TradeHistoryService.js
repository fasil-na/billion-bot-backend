import Trade from '../models/Trade.js';

export class TradeHistoryService {
  static async saveTrade(tradeData) {
    if (tradeData._id) {
      return await Trade.findByIdAndUpdate(tradeData._id, tradeData, { new: true });
    }
    const newTrade = new Trade(tradeData);
    return await newTrade.save();
  }

  static async getActiveTradeByPair(pair) {
    return await Trade.findOne({ pair, status: 'open' });
  }
}
