import { runBacktest } from './controllers/strategyController.js';
import dayjs from 'dayjs';

const req = {
    body: {
        date: null,
        pair: 'B-BTC_USDT',
        resolution: '15',
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-30T23:59:59.000Z',
        riskAmount: 100
    },
    query: {}
};

const res = {
    status: (code) => ({
        json: (data) => console.log(`Error ${code}:`, data)
    }),
    json: (data) => {
        const simulatedTrades = data.simulatedTrades || [];
        const totalTrades = simulatedTrades.length;
        const profitableTrades = simulatedTrades.filter(t => t.profit > 0).length;
        const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
        console.log(`[2026-04] Trades: ${totalTrades} | Win Rate: ${winRate.toFixed(2)}% | ${profitableTrades}W / ${totalTrades - profitableTrades}L`);
    }
};

runBacktest(req, res).catch(console.error);
