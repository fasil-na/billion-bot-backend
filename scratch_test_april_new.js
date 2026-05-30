import { runBacktest } from './controllers/strategyController.js';
import dayjs from 'dayjs';

const req = {
    body: {
        date: null,
        pair: 'B-BTC_USDT',
        interval: '15',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        riskAmount: 5
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
        console.log(`[2026-04] Trades: ${totalTrades} | Win Rate: ${winRate.toFixed(2)}% | ${profitableTrades}W / ${totalTrades - profitableTrades}L | PnL: $${data.simulatedTrades.reduce((a, t) => a + t.profit, 0).toFixed(2)}`);
    }
};

runBacktest(req, res).catch(console.error);
