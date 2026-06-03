import fs from 'fs';
import axios from 'axios';
import dayjs from 'dayjs';
import { ThreeSoldiersStrategy, THREE_SOLDIERS_CONFIGS } from './strategies/ThreeWhiteSolider.js';

const COINDCX_URL = "https://public.coindcx.com/market_data/candlesticks";

async function getCandlesticks(params) {
    try {
        const response = await axios.get(COINDCX_URL, { params });
        if (response.data && Array.isArray(response.data.data)) {
            response.data.data = response.data.data.map(c => ({
                ...c,
                time: c.time < 10000000000 ? c.time * 1000 : c.time
            }));
        }
        return response.data;
    } catch (e) {
        return { s: 'error', data: [] };
    }
}

async function fetchAll(pair, from, to, res) {
    const all = [];
    const chunk = parseInt(res) * 60 * 1950;
    for (let c = from; c < to; c += chunk) {
        const cTo = Math.min(c + chunk, to);
        const ans = await getCandlesticks({ pair: 'B-ETH_USDT', from: c, to: cTo, resolution: res, pcode: 'f' });
        if (ans && ans.s === 'ok' && Array.isArray(ans.data)) {
            all.push(...ans.data);
            console.log(`Fetched ${res}: ${dayjs(c*1000).format('YYYY-MM-DD')}`);
        }
        await new Promise(r => setTimeout(r, 200));
    }
    const map = new Map();
    for (const item of all) map.set(item.time, item);
    return Array.from(map.values()).sort((a,b) => a.time - b.time);
}

async function run() {
    const cacheFile = './eth_3s_cache.json';
    let data;
    if (fs.existsSync(cacheFile)) {
        data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } else {
        const end = Math.floor(Date.now() / 1000);
        // Last 6 months for speed
        const start = end - (180 * 24 * 60 * 60);
        const fetchStart = start - 864000;
        console.log("Fetching 6 months of data...");
        const main = await fetchAll('B-ETH_USDT', fetchStart, end, '15');
        const sub = await fetchAll('B-ETH_USDT', fetchStart, end, '1');
        data = { main, sub, simulationStartUnix: start };
        fs.writeFileSync(cacheFile, JSON.stringify(data));
        console.log("Saved cache!");
    }

    const strategy = new ThreeSoldiersStrategy();
    const rrs = [1.5, 2.0, 2.5, 3.0];
    const minRisks = [0.5, 1.0, 2.0];
    const minBodies = [0.4, 0.45, 0.5];
    const volMults = [1.0, 1.15, 1.3];
    const rsiBullMins = [30, 40];

    const results = [];
    let count = 0;

    for (let rr of rrs) {
        for (let mr of minRisks) {
            for (let mb of minBodies) {
                for (let vm of volMults) {
                    for (let rsi of rsiBullMins) {
                        THREE_SOLDIERS_CONFIGS['b-eth_usdt'] = {
                            riskRewardRatio: rr,
                            minRiskPerUnit: mr,
                            maxRiskPerUnit: 100,
                            minBodyRatio: mb,
                            minProgressRatio: 0.25,
                            maxUpperWickRatio: 0.35,
                            maxLowerWickRatio: 0.35,
                            minC3BodyRatio: Math.min(mb + 0.05, 0.9),
                            atrPeriod: 7,
                            minCandleSizeATR: 0.25,
                            volumeWindow: 20,
                            volumeMultiplier: vm,
                            requireIncreasingVolume: true,
                            emaPeriod: 200,
                            emaSlopeLookback: 5,
                            rsiPeriod: 14,
                            rsiBullishMin: rsi,
                            rsiBullishMax: 100 - rsi,
                            rsiBearishMin: rsi,
                            rsiBearishMax: 100 - rsi,
                            sessionFilter: true,
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

                        if (sim.netProfit > 50) {
                            results.push({
                                rr, mr, mb, vm, rsi,
                                np: sim.netProfit,
                                wr: sim.winRate,
                                tr: sim.totalTrades
                            });
                        }
                        count++;
                        if (count % 50 === 0) console.log(`Tested ${count} combinations...`);
                    }
                }
            }
        }
    }

    results.sort((a,b) => b.np - a.np);
    console.log("\n--- TOP CONFIGS ---");
    results.slice(0, 15).forEach((r, i) => {
        console.log(`${i+1}. RR:${r.rr} | MinRisk:${r.mr} | MinBody:${r.mb.toFixed(2)} | VolMult:${r.vm} | RSI:${r.rsi} -> NP:$${r.np.toFixed(1)} | WR:${r.wr.toFixed(1)}% | Trades:${r.tr}`);
    });
}
run();
