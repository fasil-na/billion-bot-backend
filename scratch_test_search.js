import { runBacktest } from './controllers/strategyController.js';
import { STRATEGY_CONFIGS } from './strategies/FVGStrategy.js';
import dayjs from 'dayjs';

async function testConfig(rr, minRisk, minGap) {
    STRATEGY_CONFIGS['b-btc_usdt'].riskRewardRatio = rr;
    STRATEGY_CONFIGS['b-btc_usdt'].minRiskPerUnit = minRisk;
    STRATEGY_CONFIGS['b-btc_usdt'].minGapSizeRatio = minGap;
    
    const req = {
        body: { date: null, pair: 'B-BTC_USDT', interval: '15m', startDate: '2026-01-01', endDate: '2026-05-30', riskAmount: 5 },
        query: {}
    };

    let totalTrades = 0, overallWinRate = 0, monthlyProfits = [];

    const res = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const simulatedTrades = data.simulatedTrades || [];
            totalTrades = simulatedTrades.length;
            const wins = simulatedTrades.filter(t => t.profit > 0).length;
            overallWinRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

            const monthlyStats = {};
            simulatedTrades.forEach(t => {
                const m = dayjs(t.entryTime || t.time).format('YYYY-MM');
                if (!monthlyStats[m]) monthlyStats[m] = { profit: 0, wins: 0, total: 0 };
                monthlyStats[m].profit += t.profit;
                monthlyStats[m].total++;
                if (t.profit > 0) monthlyStats[m].wins++;
            });

            monthlyProfits = Object.keys(monthlyStats).sort().map(m => monthlyStats[m].profit);
        }
    };

    await runBacktest(req, res);
    console.log(`RR: ${rr.toFixed(1)} | MinRisk: ${minRisk} | Gap: ${minGap} -> WR: ${overallWinRate.toFixed(1)}% | Trades: ${totalTrades} | Profits: ${monthlyProfits.map(p => p.toFixed(0)).join(', ')}`);
}

async function run() {
    await testConfig(3.5, 75, 0.001);
    await testConfig(4.0, 75, 0.001);
    await testConfig(3.0, 100, 0.0015);
    await testConfig(3.5, 100, 0.0015);
}
run();
