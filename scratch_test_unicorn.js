import { runBacktest } from './controllers/strategyController.js';
import { STRATEGY_CONFIGS } from './strategies/FVGStrategy.js';
import dayjs from 'dayjs';

async function testConfig(rr, gap, minRisk) {
    STRATEGY_CONFIGS['b-btc_usdt'].riskRewardRatio = rr;
    STRATEGY_CONFIGS['b-btc_usdt'].minGapSizeRatio = gap;
    STRATEGY_CONFIGS['b-btc_usdt'].minRiskPerUnit = minRisk;
    
    const req = {
        body: { date: null, pair: 'B-BTC_USDT', interval: '15', startDate: '2026-01-01', endDate: '2026-05-30', riskAmount: 5 },
        query: {}
    };

    let totalTrades = 0;
    const res = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const simulatedTrades = data.simulatedTrades || [];
            totalTrades = simulatedTrades.length;
            const monthlyStats = {};
            simulatedTrades.forEach(t => {
                const m = dayjs(t.entryTime || t.time).format('YYYY-MM');
                if (!monthlyStats[m]) monthlyStats[m] = { profit: 0, total: 0, wins: 0 };
                monthlyStats[m].profit += t.profit;
                monthlyStats[m].total++;
                if (t.profit > 0) monthlyStats[m].wins++;
            });
            const p = Object.keys(monthlyStats).sort().map(m => monthlyStats[m].profit);
            const w = Object.keys(monthlyStats).sort().map(m => monthlyStats[m].total > 0 ? (monthlyStats[m].wins / monthlyStats[m].total * 100).toFixed(0) : 0);
            console.log(`RR: ${rr} | Gap: ${gap} | Risk: ${minRisk} | Trades: ${totalTrades} | Profits: ${p.map(x=>x.toFixed(0)).join(', ')} | WRs: ${w.join(', ')}`);
        }
    };

    await runBacktest(req, res);
}

async function run() {
    await testConfig(4.5, 0.0015, 120);
    await testConfig(5.0, 0.001, 150);
}
run();
