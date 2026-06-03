import { runBacktest } from './controllers/strategyController.js';
import { THREE_SOLDIERS_CONFIGS } from './strategies/ThreeWhiteSolider.js';

async function testConfig(rr, minRisk, minBody, volMult, rsiBullMin) {
    THREE_SOLDIERS_CONFIGS['b-eth_usdt'].riskRewardRatio = rr;
    THREE_SOLDIERS_CONFIGS['b-eth_usdt'].minRiskPerUnit = minRisk;
    THREE_SOLDIERS_CONFIGS['b-eth_usdt'].minBodyRatio = minBody;
    THREE_SOLDIERS_CONFIGS['b-eth_usdt'].volumeMultiplier = volMult;
    THREE_SOLDIERS_CONFIGS['b-eth_usdt'].rsiBullishMin = rsiBullMin;
    THREE_SOLDIERS_CONFIGS['b-eth_usdt'].rsiBearishMax = 100 - rsiBullMin; // symmetric

    const req = {
        body: { 
            pair: 'B-ETH_USDT', 
            strategyId: 'three-soldiers',
            startDate: '2025-06-01', 
            endDate: '2026-06-01', 
            riskAmount: 10
        },
        query: {}
    };

    let totalTrades = 0, overallWinRate = 0, netProfit = 0;

    const res = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const simulatedTrades = data.simulatedTrades || [];
            totalTrades = simulatedTrades.length;
            const wins = simulatedTrades.filter(t => t.profit > 0).length;
            overallWinRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
            netProfit = data.netProfit || 0;
        }
    };

    await runBacktest(req, res);
    
    // Only print if profitable or somewhat interesting to avoid log spam
    if (netProfit > 100) {
        console.log(`RR: ${rr.toFixed(1)} | MinRisk: ${minRisk.toFixed(1)} | MinBody: ${minBody.toFixed(2)} | VolMult: ${volMult.toFixed(2)} | rsiBullMin: ${rsiBullMin} -> NetProfit: $${netProfit.toFixed(1)} | WR: ${overallWinRate.toFixed(1)}% | Trades: ${totalTrades}`);
    }
    return netProfit;
}

async function run() {
    const rrs = [1.5, 2.0, 2.5, 3.0];
    const minRisks = [0.5, 1.0, 2.0];
    const minBodies = [0.40, 0.50, 0.60];
    const volMults = [1.0, 1.15, 1.3];
    const rsiBullMins = [30, 40];

    console.log("Starting grid search for ThreeSoldiersStrategy on ETH/USDT...");
    for (let rr of rrs) {
        for (let mr of minRisks) {
            for (let mb of minBodies) {
                for (let vm of volMults) {
                    for (let rsi of rsiBullMins) {
                        await testConfig(rr, mr, mb, vm, rsi);
                    }
                }
            }
        }
    }
    console.log("Grid search complete.");
}
run();
