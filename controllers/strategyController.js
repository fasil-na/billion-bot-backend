import axios from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import strategies from '../strategies/index.js';
import { formatPair } from '../strategies/StrategyUtils.js';
import { COINDCX_URL } from '../config/constants.js';

dayjs.extend(utc);
dayjs.extend(timezone);

async function getCandlesticks(params) {
    try {
        const { pair, ...rest } = params;
        const formattedPair = formatPair(pair);
        const response = await axios.get(COINDCX_URL, { params: { ...rest, pair: formattedPair, pcode: 'f' } });

        if (response.data && Array.isArray(response.data.data)) {
            response.data.data = response.data.data.map((c) => ({
                ...c,
                time: c.time < 10000000000 ? c.time * 1000 : c.time
            }));
        }

        return response.data;






        // const params = {
        //     pair,
        //     interval: resolution.includes('m') || resolution.includes('h') || resolution.includes('d') ? resolution : `${resolution}m`,
        //     startTime: from * 1000,
        //     endTime: to * 1000,
        //     limit: 1000
        // };
        // const response = await axios.get(COINDCX_URL, { params });
        // let data = response.data;
         return response.data;
    } catch (error) {
        console.error('Error fetching candlesticks:', error.message);
        return { s: 'error', data: [] };
    }
}

async function getPaginatedCandlesticks(params, maxDataPointsPerRequest = 2000) {
    const { from, to, resolution } = params;
    
    // Determine chunk size based on resolution
    const resValue = parseInt(resolution) || 1;
    const chunkSeconds = resValue * 60 * (maxDataPointsPerRequest - 50); // Leave a small buffer
    
    const allCandles = [];
    const promises = [];

    for (let currentFrom = from; currentFrom < to; currentFrom += chunkSeconds) {
        let currentTo = Math.min(currentFrom + chunkSeconds, to);
        
        const res = await getCandlesticks({ ...params, from: currentFrom, to: currentTo });
        if (res && res.s === 'ok' && Array.isArray(res.data)) {
            allCandles.push(...res.data);
            console.log(`[Backtest Fetch] Resolution: ${resolution}, Date: ${dayjs(currentFrom * 1000).format('YYYY-MM-DD')}, Fetched: ${res.data.length} candles`);
        }
        
        // Small delay to prevent CoinDCX rate limits (HTTP 429)
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Deduplicate by time (sometimes chunks overlap at the boundaries)
    const uniqueCandlesMap = new Map();
    for (const c of allCandles) {
        uniqueCandlesMap.set(c.time, c);
    }

    return { s: 'ok', data: Array.from(uniqueCandlesMap.values()) };
}

export const runBacktest = async (req, res) => {
    try {
        const date = req.body.date || req.query.date;
        const pair = req.body.pair || req.query.pair || "B-BTC_USDT";
        const riskAmountFromReq = parseFloat(req.body.riskAmount) || 100;
        const resolutionReq = req.body.interval || req.query.resolution || "15";
        const resolution = resolutionReq;

        let fetchStart, end, simulationStartUnix;

        if (req.body.startDate && req.body.endDate) {
            const startObj = dayjs(req.body.startDate).tz('Asia/Kolkata');
            const endObj = dayjs(req.body.endDate).tz('Asia/Kolkata');
            const start = Math.floor(startObj.startOf('day').valueOf() / 1000);
            end = Math.floor(endObj.endOf('day').valueOf() / 1000);

            fetchStart = start - 172800; // 2 days before for indicators
            simulationStartUnix = start;
        } else {
            // Default to last 30 days if no dates
            end = Math.floor(Date.now() / 1000);
            const start = end - (30 * 24 * 60 * 60);
            fetchStart = start - 172800;
            simulationStartUnix = start;
        }

        const [resMain, resSub] = await Promise.all([
            getPaginatedCandlesticks({ pair, from: fetchStart, to: end, resolution: resolution }),
            getPaginatedCandlesticks({ pair, from: fetchStart, to: end, resolution: '1m' })
        ]);

        if (resMain.s !== 'ok' || !Array.isArray(resMain.data)) {
            return res.status(400).json({ error: 'Failed to fetch main data' });
        }

        const candles = resMain.data.sort((a, b) => a.time - b.time);
        const subCandles = Array.isArray(resSub.data) ? resSub.data.sort((a, b) => a.time - b.time) : [];

        const strategy = strategies['fvg-imbalance'];
        if (!strategy) return res.status(404).json({ error: 'FVG strategy not found' });

        const riskAmount = riskAmountFromReq;

        // 1. Run strategy simulation ONLY for indicators (FVG boxes)
        const simulationResult = strategy.run(candles, {
            pair,
            leverage: 1, // Mock liveConfig?.leverage
            riskAmount: riskAmount,
            simulationStartUnix: simulationStartUnix,
            type: 'backtest',
            resolution: resolution
        }, subCandles);

        // 2. Fetch REAL executed trades from Database for this pair/day
        // Mocking realTrades since DB is not connected
        const realTrades = [];

        res.json({
            pair,
            riskAmount,
            trades: realTrades,
            simulatedTrades: (simulationResult.trades || []).sort((a, b) => new Date(b.entryTime || b.time).getTime() - new Date(a.entryTime || a.time).getTime()),
            tradesCount: realTrades.length,
            dailyPnl: realTrades.reduce((a, t) => a + (t.profit || 0), 0),
            candles: candles.filter(c => c.time >= simulationStartUnix * 1000),
            indicators: simulationResult.indicators
        });

    } catch (err) {
        console.error('Backtest Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};
