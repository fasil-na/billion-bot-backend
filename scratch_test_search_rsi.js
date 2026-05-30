import { runBacktest } from './controllers/strategyController.js';
import { STRATEGY_CONFIGS } from './strategies/FVGStrategy.js';
import dayjs from 'dayjs';

async function testRSI(rmin, rmax, gap) {
    STRATEGY_CONFIGS['b-btc_usdt'].riskRewardRatio = 3.5;
    STRATEGY_CONFIGS['b-btc_usdt'].minRiskPerUnit = 50;
    STRATEGY_CONFIGS['b-btc_usdt'].minGapSizeRatio = gap;
    STRATEGY_CONFIGS['b-btc_usdt'].rsiBullishMin = rmin;
    STRATEGY_CONFIGS['b-btc_usdt'].rsiBullishMax = rmax;
    STRATEGY_CONFIGS['b-btc_usdt'].rsiBearishMin = 100 - rmax;
    STRATEGY_CONFIGS['b-btc_usdt'].rsiBearishMax = 100 - rmin;
    
    const req = {
        body: { date: null, pair: 'B-BTC_USDT', interval: '15', startDate: '2026-01-01', endDate: '2026-05-30', riskAmount: 5 },
        query: {}
    };

    let monthlyProfits = [];
    const res = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const simulatedTrades = data.simulatedTrades || [];
            const monthlyStats = {};
            simulatedTrades.forEach(t => {
                const m = dayjs(t.entryTime || t.time).format('YYYY-MM');
                if (!monthlyStats[m]) monthlyStats[m] = { profit: 0 };
                monthlyStats[m].profit += t.profit;
            });
            monthlyProfits = Object.keys(monthlyStats).sort().map(m => monthlyStats[m].profit);
        }
    };

    await runBacktest(req, res);
    console.log(`RSI: ${rmin}-${rmax} | Gap: ${gap} | Profits: ${monthlyProfits.map(p => p.toFixed(0)).join(', ')}`);
}

async function run() {
    await testRSI(20, 60, 0.0006);
    await testRSI(20, 50, 0.0008);
    await testRSI(0, 100, 0.001);
}
run();
