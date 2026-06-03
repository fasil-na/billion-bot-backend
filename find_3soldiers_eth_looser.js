import fs from 'fs';
import { ThreeSoldiersStrategy, THREE_SOLDIERS_CONFIGS } from './strategies/ThreeWhiteSolider.js';

async function run() {
    const cacheFile = './eth_3s_cache.json';
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

    const strategy = new ThreeSoldiersStrategy();
    
    // Looser constraints to increase trade frequency
    const rrs = [1.5, 2.0, 3.0, 4.0];
    const maxWicks = [0.4, 0.5];
    const minProgresses = [0.15, 0.25];
    const minATRs = [0.15, 0.20];
    const volMults = [1.0, 1.1];

    const results = [];
    let count = 0;

    for (let rr of rrs) {
        for (let maxW of maxWicks) {
            for (let minP of minProgresses) {
                for (let minA of minATRs) {
                    for (let vm of volMults) {
                        THREE_SOLDIERS_CONFIGS['b-eth_usdt'] = {
                            riskRewardRatio: rr,
                            minRiskPerUnit: 1,
                            maxRiskPerUnit: 100,
                            minBodyRatio: 0.4,
                            minProgressRatio: minP,
                            maxUpperWickRatio: maxW,
                            maxLowerWickRatio: maxW,
                            minC3BodyRatio: 0.45,
                            atrPeriod: 7,
                            minCandleSizeATR: minA,
                            volumeWindow: 20,
                            volumeMultiplier: vm,
                            requireIncreasingVolume: false, // Turn off strict volume increasing rule
                            emaPeriod: 200,
                            emaSlopeLookback: 5,
                            rsiPeriod: 14,
                            rsiBullishMin: 30,
                            rsiBullishMax: 70,
                            rsiBearishMin: 30,
                            rsiBearishMax: 70,
                            sessionFilter: false, // turn off session filter
                            sessionStartHour: 13,
                            sessionEndHour: 23,
                            slBufferRatio: 0.0005,
                            slCooldownCandles: 4,
                            initialBalance: 5
                        };

                        const sim = strategy.run(data.main, {
                            pair: 'B-ETH_USDT',
                            riskAmount: 10,
                            simulationStartUnix: data.simulationStartUnix,
                            type: 'backtest',
                            resolution: '15'
                        }, data.sub);

                        results.push({
                            rr, maxW, minP, minA, vm,
                            np: sim.netProfit,
                            wr: sim.winRate,
                            tr: sim.totalTrades
                        });
                        count++;
                    }
                }
            }
        }
    }

    results.sort((a,b) => b.np - a.np);
    console.log("\n--- TOP CONFIGS (LOOSER SEARCH) ---");
    results.slice(0, 15).forEach((r, i) => {
        console.log(`${i+1}. RR:${r.rr} | MaxWick:${r.maxW} | MinProg:${r.minP} | minATR:${r.minA} | VolMult:${r.vm} -> NP:$${r.np.toFixed(1)} | WR:${r.wr.toFixed(1)}% | Trades:${r.tr}`);
    });
}
run();
