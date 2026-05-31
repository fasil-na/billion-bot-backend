import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { calculateRSI, calculateEMA } from './StrategyUtils.js';
import { TradeService } from '../services/TradeService.js';

dayjs.extend(utc);
dayjs.extend(timezone);
export const STRATEGY_CONFIGS = {
    'b-btc_usdt':

    // {
    //     riskRewardRatio: 1.8,
    //     fvgExpiryCandles: 20,
    //     rangeLookback: 10,
    //     minGapSizeRatio: 0.0008,
    //     minC2BodyRatio: 0.001,
    //     rsiPeriod: 14,
    //     rsiBullishMin: 0,
    //     rsiBullishMax: 100,
    //     rsiBearishMin: 0,
    //     rsiBearishMax: 100,
    //     minRiskPerUnit: 60,
    //     maxRiskPerUnit: 200,
    //     bearishSlBufferRatio: 0.001,
    //     initialBalance: 1000
    // },
{
        riskRewardRatio: 4.5,        // higher RR → compensate more SL hits

        fvgExpiryCandles: 50,        // allow older FVGs (more trades)

        rangeLookback: 5,            // smaller range → more signals

        minGapSizeRatio: 0.00002,    // accept smaller gaps

        minC2BodyRatio: 0.0006,      // weaker confirmation candle allowed

        rsiPeriod: 12,               // faster RSI reaction

        rsiBullishMin: 10,           // allow early entries
        rsiBullishMax: 80,

        rsiBearishMin: 15,
        rsiBearishMax: 85,

        minRiskPerUnit: 5,           // allow smaller moves
        maxRiskPerUnit: 200,         // allow bigger volatility trades

        bearishSlBufferRatio: 0.0007, // tighter SL → more trades, more SL hits

        initialBalance: 5
    },



    'b-eth_usdt': {
        riskRewardRatio: 1.5,
        fvgExpiryCandles: 15,
        rangeLookback: 10,
        minGapSizeRatio: 0.00004,
        minC2BodyRatio: 0.0011,
        rsiPeriod: 17,
        rsiBullishMin: 19,
        rsiBullishMax: 75,
        rsiBearishMin: 23,
        rsiBearishMax: 72,
        minRiskPerUnit: 3,
        maxRiskPerUnit: 100,
        bearishSlBufferRatio: 0.0023,
        initialBalance: 5
    }
};


const DEFAULT_PAIR_KEY = 'B-BTC_USDT';
const TRADE_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_RESOLUTION = "15";
const MAKER_FEE_RATE = 0.0003;
const TAKER_FEE_RATE = 0.0006;


export class FVGStrategy {
    id = "fvg-imbalance";
    name = "Fair Value Gap Strategy";
    description = "Institutional imbalance detection with consequent encroachment entry logic.";
    run(candles, params, subCandles = []) {

        if (params.type === 'live') {
            return this.checkSignal(candles, params);
        }


        const cleanPairStr = (params.pair || DEFAULT_PAIR_KEY).toLowerCase();
        const config = STRATEGY_CONFIGS[cleanPairStr] || STRATEGY_CONFIGS['b-btc_usdt'];

        const trades = [];
        let balance = params.initialBalance || config.initialBalance;
        const rr = params.riskRewardRatio || config.riskRewardRatio;
        const riskAmount = parseFloat(params.riskAmount) || 100;
        const fvgExpiryCandles = config.fvgExpiryCandles;
        const minGapSizeRatio = config.minGapSizeRatio;
        const minC2BodyRatio = config.minC2BodyRatio;
        const rsiPeriod = config.rsiPeriod;
        const rsiBullishMin = config.rsiBullishMin;
        const rsiBullishMax = config.rsiBullishMax;
        const rsiBearishMin = config.rsiBearishMin;
        const rsiBearishMax = config.rsiBearishMax;
        const minRiskPerUnit = config.minRiskPerUnit;
        const maxRiskPerUnit = config.maxRiskPerUnit;
        const bearishSlBufferRatio = config.bearishSlBufferRatio;
        const rangeLookback = config.rangeLookback;
        const simulationStart = params.simulationStartUnix ? params.simulationStartUnix * 1000 : 0;

        const cleanPair = (params.pair || DEFAULT_PAIR_KEY).replace('B-', '').toLowerCase();

        const staticData = TradeService.STATIC_INSTRUMENTS[cleanPair] || TradeService.STATIC_INSTRUMENTS[params.pair] || TradeService.STATIC_INSTRUMENTS[DEFAULT_PAIR_KEY];
        const pricePrecision = staticData.priceStep.toString().split('.')[1]?.length || 0;

        const closes = candles.map(c => c.close);
        const rsiValues = calculateRSI(closes, rsiPeriod);
        const ema200 = calculateEMA(closes, 200);

        const allFVGs = [];
        let activeFVGs = [];
        let activeTrade = null;
        let lastExitIndex = -1;

        for (let i = 2; i < candles.length; i++) {
            const c1 = candles[i - 2];
            const c2 = candles[i - 1];
            const c3 = candles[i];

            const c2Range = c2.high - c2.low;
            const c2Body = Math.abs(c2.open - c2.close);
            const c2BodyRatio = c2Range > 0 ? c2Body / c2Range : 0;

            const isClosedCandle = (params.type !== 'live_signal') || (i < candles.length - 1);

            if (isClosedCandle) {
                if (c3.low > c1.high) {
                    const gapSize = c3.low - c1.high;
                    if (gapSize > (c3.close * minGapSizeRatio) && c2BodyRatio >= minC2BodyRatio) {
                        const currentEma = ema200[i] || 0;
                        if (currentEma === 0 || c3.close > currentEma) {
                            const fvg = {
                                top: c3.low,
                                bottom: c1.high,
                                direction: "bullish",
                                formedAt: i,
                                filled: false,
                                startTime: c1.time,
                                endTime: c3.time
                            };
                            
                            fvg.midpoint = (fvg.top + fvg.bottom) / 2;
                            const formedRSI = rsiValues[i] || 50;
                            const buffer = 0;
                            const riskPerUnit = Math.abs(fvg.midpoint - (fvg.bottom - buffer));
                            
                            const step = staticData.qtyStep;
                            let units = riskAmount / riskPerUnit;
                            units = Math.floor(units / step) * step;
                            units = Number(units.toFixed(3));
                            const minQty = Math.ceil((staticData.minNotional / fvg.midpoint) / staticData.qtyStep) * staticData.qtyStep;

                            let isValid = true;
                            let rejectReason = "";

                            if (formedRSI <= rsiBullishMin || formedRSI >= rsiBullishMax) {
                                isValid = false;
                                rejectReason = `RSI LIMIT (${formedRSI.toFixed(1)})`;
                            } else if (riskPerUnit < minRiskPerUnit || riskPerUnit > maxRiskPerUnit) {
                                isValid = false;
                                rejectReason = 'RISK LIMIT';
                            } else if (units < minQty || units <= 0) {
                                isValid = false;
                                rejectReason = 'MIN QTY LIMIT';
                            }

                            if (!isValid) {
                                fvg.filled = true;
                                fvg.filledAt = c3.time;
                                fvg.status = 'skipped';
                                fvg.rejectReason = rejectReason;
                                allFVGs.push(fvg);
                            } else {
                                fvg.units = units;
                                fvg.tp = Number((fvg.midpoint + (riskPerUnit * rr)).toFixed(pricePrecision));
                                fvg.sl = Number((fvg.midpoint - riskPerUnit).toFixed(pricePrecision));
                                
                                allFVGs.push(fvg);
                                activeFVGs.forEach(oldFvg => {
                                    oldFvg.filled = true;
                                    oldFvg.filledAt = c3.time;
                                    oldFvg.status = 'cancelled';
                                });
                                activeFVGs = [fvg];

                                if (activeTrade && activeTrade.status === "pending") {
                                    activeTrade = null;
                                }
                            }
                        }
                    }
                } else if (c3.high < c1.low) {
                    const gapSize = c1.low - c3.high;
                    if (gapSize > (c3.close * minGapSizeRatio) && c2BodyRatio >= minC2BodyRatio) {
                        const currentEma = ema200[i] || 0;
                        if (currentEma === 0 || c3.close < currentEma) {
                            const fvg = {
                                top: c1.low,
                                bottom: c3.high,
                                direction: "bearish",
                                formedAt: i,
                                filled: false,
                                startTime: c1.time,
                                endTime: c3.time
                            };
                            
                            fvg.midpoint = (fvg.top + fvg.bottom) / 2;
                            const formedRSI = rsiValues[i] || 50;
                            const gapSizeVal = fvg.top - fvg.bottom;
                            const buffer = gapSizeVal * bearishSlBufferRatio;
                            const riskPerUnit = Math.abs((fvg.top + buffer) - fvg.midpoint);
                            
                            const step = staticData.qtyStep;
                            let units = riskAmount / riskPerUnit;
                            units = Math.floor(units / step) * step;
                            units = Number(units.toFixed(3));
                            const minQty = Math.ceil((staticData.minNotional / fvg.midpoint) / staticData.qtyStep) * staticData.qtyStep;

                            let isValid = true;
                            let rejectReason = "";

                            if (formedRSI >= rsiBearishMax || formedRSI <= rsiBearishMin) {
                                isValid = false;
                                rejectReason = `RSI LIMIT (${formedRSI.toFixed(1)})`;
                            } else if (riskPerUnit < minRiskPerUnit || riskPerUnit > maxRiskPerUnit) {
                                isValid = false;
                                rejectReason = 'RISK LIMIT';
                            } else if (units < minQty || units <= 0) {
                                isValid = false;
                                rejectReason = 'MIN QTY LIMIT';
                            }

                            if (!isValid) {
                                fvg.filled = true;
                                fvg.filledAt = c3.time;
                                fvg.status = 'skipped';
                                fvg.rejectReason = rejectReason;
                                allFVGs.push(fvg);
                            } else {
                                fvg.units = units;
                                fvg.tp = Number((fvg.midpoint - (riskPerUnit * rr)).toFixed(pricePrecision));
                                fvg.sl = Number((fvg.midpoint + riskPerUnit).toFixed(pricePrecision));
                                
                                allFVGs.push(fvg);
                                activeFVGs.forEach(oldFvg => {
                                    oldFvg.filled = true;
                                    oldFvg.filledAt = c3.time;
                                    oldFvg.status = 'cancelled';
                                });
                                activeFVGs = [fvg];

                                if (activeTrade && activeTrade.status === "pending") {
                                    activeTrade = null;
                                }
                            }
                        }
                    }
                }
            }

            if (activeTrade) {
                if (params.type === 'live_signal') {
                    // In live_signal mode, we only care about generating the signal.
                    // The SocketService handles the actual trade lifecycle (entry/SL/TP).
                    // We leave it as 'pending' so it can be cleanly replaced by newer FVGs.
                    continue;
                }

                const curr = candles[i];
                const isBuy = activeTrade.direction === "buy";

                if (activeTrade.status === "pending") {
                    const hitEntry = isBuy ? (curr.low <= activeTrade.entryPrice) : (curr.high >= activeTrade.entryPrice);
                    if (hitEntry) {
                        activeTrade.status = "open";
                    }
                }

                if (activeTrade.status === "open") {
                    const hitSL = isBuy ? curr.low <= (activeTrade.sl || 0) : curr.high >= (activeTrade.sl || Infinity);
                    const hitTP = isBuy ? curr.high >= (activeTrade.tp || Infinity) : curr.low <= (activeTrade.tp || 0);

                    if (hitSL || hitTP) {
                        activeTrade.status = "closed";
                        activeTrade.exitTime = dayjs(curr.time).tz(TRADE_TIMEZONE).format();

                        if (hitSL) {
                            activeTrade.exitPrice = activeTrade.sl || (isBuy ? curr.low : curr.high);
                            activeTrade.exitReason = "Stop Loss";
                        } else if (hitTP) {
                            activeTrade.exitPrice = activeTrade.tp || (isBuy ? curr.high : curr.low);
                            activeTrade.exitReason = "Take Profit";
                        }

                        const units = activeTrade.units || 0;
                        let grossProfit = 0;
                        if (isBuy) {
                            grossProfit = (activeTrade.exitPrice - activeTrade.entryPrice) * units;
                        } else {
                            grossProfit = (activeTrade.entryPrice - activeTrade.exitPrice) * units;
                        }

                        const entryFee = Math.ceil(activeTrade.entryPrice * units * MAKER_FEE_RATE * 1000) / 1000;
                        const exitFee = Math.ceil(activeTrade.exitPrice * units * TAKER_FEE_RATE * 1000) / 1000;

                        activeTrade.grossProfit = Number(grossProfit.toFixed(3));
                        activeTrade.entryFee = entryFee;
                        activeTrade.exitFee = exitFee;
                        activeTrade.fee = entryFee + exitFee;
                        activeTrade.profit = grossProfit - entryFee - exitFee;
                        activeTrade.pnlPercent = (activeTrade.profit / balance) * 100;
                        balance += activeTrade.profit;
                        trades.push({ ...activeTrade });
                        activeTrade = null;
                        lastExitIndex = i;
                    }
                }
            }

            if (activeTrade || i === lastExitIndex) continue;

            const curr = candles[i];
            const currentRSI = rsiValues[i] || 50;

            for (let j = 0; j < activeFVGs.length; j++) {
                const fvg = activeFVGs[j];
                if (!fvg) continue;

                if (i <= fvg.formedAt) continue;

                if (i - fvg.formedAt > fvgExpiryCandles) {
                    fvg.filled = true;
                    fvg.filledAt = curr.time;
                    activeFVGs.splice(j, 1);
                    j--;
                    continue;
                }

                const midpoint = fvg.midpoint;

                if (fvg.direction === "bullish") {
                    let entryCondition = false;
                    let isPendingEntry = false;
                    
                    if (params.type === 'live_signal' && i === fvg.formedAt + 1) {
                        entryCondition = true;
                        isPendingEntry = true;
                    } else {
                        entryCondition = (curr.low <= midpoint);
                    }
                    
                    if (entryCondition) {
                        if (curr.time < simulationStart) {
                            fvg.filled = true;
                            fvg.filledAt = curr.time;
                            activeFVGs.splice(j, 1);
                            j--;
                            continue;
                        }

                        const tp = fvg.tp;
                        const sl = fvg.sl;

                        activeTrade = {
                            entryTime: dayjs(curr.time).tz(TRADE_TIMEZONE).format(),
                            direction: "buy",
                            entryPrice: midpoint,
                            units: fvg.units,
                            sl: sl,
                            tp: tp,
                            resolution: params.resolution || DEFAULT_RESOLUTION,
                            status: isPendingEntry ? "pending" : "open",
                            orderType: "limit_order",
                            profit: 0,
                            indicators: { fvgTop: fvg.top, fvgBottom: fvg.bottom }
                        };

                        if (activeTrade.status === "open") {
                            const exitInfo = this.checkIntraCandleExit(activeTrade, curr, subCandles);
                            if (exitInfo) {
                                activeTrade.status = "closed";
                                activeTrade.exitPrice = exitInfo.price;
                                activeTrade.exitTime = exitInfo.time;
                                activeTrade.exitReason = exitInfo.reason;
                                const pnlResult = this.calculatePnL(activeTrade, activeTrade.exitPrice, balance);

                                activeTrade.grossProfit = Number(pnlResult.grossProfit.toFixed(4));
                                activeTrade.entryFee = pnlResult.entryFee;
                                activeTrade.exitFee = pnlResult.exitFee;
                                activeTrade.fee = pnlResult.fee;
                                activeTrade.profit = pnlResult.profit;
                                activeTrade.pnlPercent = (pnlResult.profit / balance) * 100;
                                balance += pnlResult.profit;
                                trades.push({ ...activeTrade });
                                activeTrade = null;
                                lastExitIndex = i;
                            }
                        }

                        fvg.filled = true;
                        fvg.filledAt = curr.time;
                        fvg.status = 'trade_executed';
                        activeFVGs.splice(j, 1);
                        break;
                    }

                    if (curr.low < fvg.bottom) {
                        fvg.filled = true;
                        fvg.filledAt = curr.time;
                        activeFVGs.splice(j, 1);
                        j--;
                        continue;
                    }
                } else {
                    let entryCondition = false;
                    let isPendingEntry = false;
                    if (params.type === 'live_signal' && i === fvg.formedAt + 1) {
                        entryCondition = true;
                        isPendingEntry = true;
                    } else {
                        entryCondition = (curr.high >= midpoint);
                    }
                    if (entryCondition) {
                        if (curr.time < simulationStart) {
                            fvg.filled = true;
                            fvg.filledAt = curr.time;
                            activeFVGs.splice(j, 1);
                            j--;
                            continue;
                        }

                        const tp = fvg.tp;
                        const sl = fvg.sl;

                        activeTrade = {
                            entryTime: dayjs(curr.time).tz(TRADE_TIMEZONE).format(),
                            direction: "sell",
                            entryPrice: midpoint,
                            units: fvg.units,
                            sl: sl,
                            tp: tp,
                            resolution: params.resolution || DEFAULT_RESOLUTION,
                            status: isPendingEntry ? "pending" : "open",
                            orderType: "limit_order",
                            profit: 0,
                            indicators: { fvgTop: fvg.top, fvgBottom: fvg.bottom }
                        };

                        if (activeTrade.status === "open") {
                            const exitInfo = this.checkIntraCandleExit(activeTrade, curr, subCandles);
                            if (exitInfo) {
                                activeTrade.status = "closed";
                                activeTrade.exitPrice = exitInfo.price;
                                activeTrade.exitTime = exitInfo.time;
                                activeTrade.exitReason = exitInfo.reason;
                                const pnlResult = this.calculatePnL(activeTrade, activeTrade.exitPrice, balance);

                                activeTrade.grossProfit = Number(pnlResult.grossProfit.toFixed(4));
                                activeTrade.entryFee = pnlResult.entryFee;
                                activeTrade.exitFee = pnlResult.exitFee;
                                activeTrade.fee = pnlResult.fee;
                                activeTrade.profit = pnlResult.profit;
                                activeTrade.pnlPercent = (pnlResult.profit / balance) * 100;
                                balance += pnlResult.profit;
                                trades.push({ ...activeTrade });
                                activeTrade = null;
                                lastExitIndex = i;
                            }
                        }

                        fvg.filled = true;
                        fvg.filledAt = curr.time;
                        fvg.status = 'trade_executed';
                        activeFVGs.splice(j, 1);
                        break;
                    }

                    if (curr.high > fvg.top) {
                        fvg.filled = true;
                        fvg.filledAt = curr.time;
                        activeFVGs.splice(j, 1);
                        j--;
                        continue;
                    }
                }
            }
        }
        return {
            trades,
            initialBalance: params.initialBalance,
            finalBalance: balance,
            trade: activeTrade,
            totalTrades: trades.length,
            winRate: trades.length > 0 ? (trades.filter(t => t.profit > 0).length / trades.length) * 100 : 0,
            netProfit: balance - (params.initialBalance),
            tradeLog: trades.map(t => ({
                type: t.direction === 'buy' ? 'BUY' : 'SELL',
                price: t.entryPrice,
                time: dayjs(t.entryTime).valueOf(),
                pnl: t.profit,
                exitPrice: t.exitPrice,
                exitTime: dayjs(t.exitTime).valueOf()
            })),
            indicators: {
                totalFVGsDetected: allFVGs.length,
                fvgs: allFVGs.map(f => ({
                    ...f,
                    formationStartTime: f.startTime,
                    formationEndTime: candles[Math.min(f.formedAt, candles.length - 1)]?.time || f.endTime,
                    fillTime: f.filledAt || (candles.length > 0 ? candles[candles.length - 1].time : f.endTime)
                }))
            }
        };
    }

    checkIntraCandleExit(trade, mainCandle, subCandles) {
        const isBuy = trade.direction === "buy";
        const sl = trade.sl || 0;
        const tp = trade.tp || 0;

        if (subCandles && subCandles.length > 0) {
            const entryUnix = dayjs(trade.entryTime).valueOf();
            const res = trade.resolution || DEFAULT_RESOLUTION;
            const intervalMs = Number(res) * 60 * 1000;
            const candleEndUnix = mainCandle.time + intervalMs;
            const relevantSubs = subCandles.filter(s => s.time >= entryUnix && s.time < candleEndUnix);

            for (const sub of relevantSubs) {
                if (isBuy) {
                    if (sub.low <= sl) return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss (Sub)" };
                    if (sub.high >= tp) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit (Sub)" };
                } else {
                    if (sub.high >= sl) return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss (Sub)" };
                    if (sub.low <= tp) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit (Sub)" };
                }
            }
        }

        if (isBuy) {
            if (mainCandle.low <= sl) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss" };
            if (mainCandle.high >= tp) return { price: tp, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit" };
        } else {
            if (mainCandle.high >= sl) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss" };
            if (mainCandle.low <= tp) return { price: tp, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit" };
        }
        return null;
    }

    calculatePnL(trade, exitPrice, balance) {
        const units = trade.units || 0;
        const grossProfit = trade.direction === "buy"
            ? (exitPrice - trade.entryPrice) * units
            : (trade.entryPrice - exitPrice) * units;

        const entryFee = Math.ceil(trade.entryPrice * units * MAKER_FEE_RATE * 1000) / 1000;
        const exitFee = Math.ceil(exitPrice * units * TAKER_FEE_RATE * 1000) / 1000;
        const totalFee = entryFee + exitFee;

        return { profit: grossProfit - totalFee, fee: totalFee, grossProfit, entryFee, exitFee };
    }

    checkSignal(candles, params) {
        if (candles.length < 5) return { matched: false };
        const result = this.run(candles, { ...params, type: 'live_signal' });

        if (!result.trade) {
            return { matched: false };
        }

        // Live bot trigger safety: 
        // Only accept the signal if the simulated trade was entered on the most recently closed candle
        // (or the currently forming candle). If it's older, it's a stale trade that the live bot already handled.
        const tradeEntryUnix = dayjs(result.trade.entryTime).valueOf();

        // candles.length - 1 is the new opening candle, candles.length - 2 is the most recently closed candle
        const recentlyClosedCandleTime = candles[candles.length - 2].time;

        if (tradeEntryUnix < recentlyClosedCandleTime) {
            return { matched: false };
        }

        return {
            matched: true,
            trade: result.trade
        };
    }
}

