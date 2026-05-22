import Trade from '../models/Trade.js';

export const getTrades = async (req, res) => {
  try {
    const trades = await Trade.find().sort({ createdAt: -1 });
    res.json(trades);
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
};
