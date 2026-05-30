import { runBacktest } from './controllers/strategyController.js';
import dayjs from 'dayjs';

const req = {
    body: {
        date: null,
        pair: 'B-BTC_USDT',
        interval: '15m',
        startDate: '2026-01-01',
        endDate: '2026-05-30',
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
        
        const monthlyStats = {};
        simulatedTrades.forEach(t => {
            const month = dayjs(t.entryTime || t.time).format('YYYY-MM');
            if (!monthlyStats[month]) monthlyStats[month] = { trades: 0, profit: 0, wins: 0 };
            monthlyStats[month].trades++;
            monthlyStats[month].profit += t.profit;
            if (t.profit > 0) monthlyStats[month].wins++;
        });

        console.log(`\n--- 5-MONTH SUMMARY ---`);
        const totalTrades = simulatedTrades.length;
        const profitableTrades = simulatedTrades.filter(t => t.profit > 0).length;
        const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
        const netProfit = simulatedTrades.reduce((acc, t) => acc + t.profit, 0);
        console.log(`Total Trades: ${totalTrades}`);
        console.log(`Overall Win Rate: ${winRate.toFixed(2)}%`);
        console.log(`Overall Net Profit: $${netProfit.toFixed(2)}`);

        console.log(`\n--- MONTHLY BREAKDOWN ---`);
        for (const [month, stats] of Object.entries(monthlyStats).sort()) {
            const monthlyWinRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;
            console.log(`[${month}] Trades: ${stats.trades} | Win Rate: ${monthlyWinRate.toFixed(2)}% | Profit: $${stats.profit.toFixed(2)}`);
        }
    }
};

runBacktest(req, res).catch(console.error);
