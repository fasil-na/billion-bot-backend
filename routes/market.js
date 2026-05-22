import express from 'express';
import axios from 'axios';
import { runBacktest } from '../controllers/strategyController.js';
import { COINDCX_URL } from '../config/constants.js';

const router = express.Router();

// Utility to format pair like B-BTC_USDT if needed, or we just pass it from frontend
function formatPair(pair) {
    // Basic formatting, assuming standard futures pairs for CoinDCX
    // e.g., BTCUSDT -> B-BTC_USDT
    if (!pair) return 'B-BTC_USDT';

    // If it already looks like a CoinDCX formatted pair
    if (pair.includes('-') || pair.includes('_')) return pair;

    const base = pair.replace('USDT', '');
    return `B-${base}_USDT`;
}

router.get('/candlesticks', async (req, res) => {
    try {
        const { pair, interval, startTime, endTime, limit } = req.query;

        const formattedPair = formatPair(pair);

        const params = {
            pair: formattedPair
        };

        if (interval) params.interval = interval; // might need to be 'resolution' based on API but user used interval in their snippet. I'll pass both just in case, or map it.
        // Actually public.coindcx.com/market_data/candles uses interval like 1m, 5m etc.
        if (interval) params.interval = interval;
        if (startTime) params.startTime = startTime;
        if (endTime) params.endTime = endTime;
        if (limit) params.limit = limit;

        const response = await axios.get(COINDCX_URL, { params, pcode: 'f' });

        let data = response.data;
        if (Array.isArray(data)) {
            data = data.map(c => ({
                ...c,
                time: c.time < 10000000000 ? c.time * 1000 : c.time
            }));
        }

        res.json({ data });
    } catch (error) {
        console.error('Error fetching candlesticks:', error.message);
        res.status(500).json({ error: 'Failed to fetch candlestick data' });
    }
});

router.post('/backtest', runBacktest);

export default router;
