import { runBacktest } from './controllers/strategyController.js';
import { STRATEGY_CONFIGS } from './strategies/FVGStrategy.js';
import dayjs from 'dayjs';

STRATEGY_CONFIGS['b-btc_usdt'].riskRewardRatio = 3;
STRATEGY_CONFIGS['b-btc_usdt'].minRiskPerUnit = 55;
STRATEGY_CONFIGS['b-btc_usdt'].minGapSizeRatio = 0.0006;
STRATEGY_CONFIGS['b-btc_usdt'].rsiBullishMin = 0;
STRATEGY_CONFIGS['b-btc_usdt'].rsiBullishMax = 100;
STRATEGY_CONFIGS['b-btc_usdt'].rsiBearishMin = 0;
STRATEGY_CONFIGS['b-btc_usdt'].rsiBearishMax = 100;

const req = {
    body: { date: null, pair: 'B-BTC_USDT', interval: '15m', startDate: '2026-01-01', endDate: '2026-05-30', riskAmount: 5 },
    query: {}
};

const res = {
    status: () => ({ json: () => {} }),
    json: (data) => {
        const simulatedTrades = data.simulatedTrades || [];
        const monthlyStats = {};
        simulatedTrades.forEach(t => {
            const m = dayjs(t.entryTime || t.time).format('YYYY-MM');
            if (!monthlyStats[m]) monthlyStats[m] = { profit: 0, wins: 0, total: 0 };
            monthlyStats[m].profit += t.profit;
            monthlyStats[m].total++;
            if (t.profit > 0) monthlyStats[m].wins++;
        });

        console.log(`\n--- MONTHLY BREAKDOWN ---`);
        for (const [month, stats] of Object.entries(monthlyStats).sort()) {
            const wr = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
            console.log(`[${month}] Trades: ${stats.total} | WR: ${wr.toFixed(1)}% | Profit: $${stats.profit.toFixed(2)}`);
        }
    }
};

runBacktest(req, res).catch(console.error);
