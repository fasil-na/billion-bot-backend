import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { calculatePnL, checkIntraCandleExit } from './StrategyUtils.js';

dayjs.extend(utc);

export class OpeningBreakoutStrategy {
    id = "opening-breakout";
    name = "Opening Breakout";

    run(candles, params, subCandles = []) {
        let balance = parseFloat(params.riskAmount) || 100;
        const session = params.session || 'gold';

        let dayHigh = -Infinity;
        let dayLow = Infinity;
        let dayDate = null;
        let tradeLog = [];
        let executedTrades = [];
        let tradesCount = 0;
        let wins = 0;
        let losses = 0;

        let currentSignal = null;
        let inPosition = false;
        let activeTrade = null;
        let priceReturnedToRange = false;

        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            const candleTime = dayjs(candle.time).utcOffset('+05:30');
            const currentDate = candleTime.format('YYYY-MM-DD');
            const hour = candleTime.hour();
            const minute = candleTime.minute();
            const dayOfWeek = candleTime.day();

            // Exclude trading on weekends for Gold session
            if (session === 'gold' && (dayOfWeek === 0 || dayOfWeek === 6)) {
                continue;
            }

            // Session specific times
            let isRangeBuildingCandle = false;
            let isReferenceTime = false;
            let isCutoff = false;

            if (session === 'gold') {
                if ((hour === 3 && minute === 45) || (hour === 4 && minute === 0)) isRangeBuildingCandle = true;
                if ((hour > 2 || (hour === 2 && minute >= 15)) && (hour < 4 || (hour === 4 && minute === 0))) isReferenceTime = true;
                if (hour === 2 && minute === 15) isCutoff = true;
            } else if (session === 'london') {
                if ((hour === 13 && minute === 45) || (hour === 14 && minute === 0)) isRangeBuildingCandle = true;
                if ((hour === 13 && minute >= 0) || (hour === 14 && minute === 0)) isReferenceTime = true;
                if (hour === 13 && minute === 0) isCutoff = true;
            } else if (session === 'asia') {
                if ((hour === 5 && minute === 45) || (hour === 6 && minute === 0)) isRangeBuildingCandle = true;
                if ((hour === 5 && minute >= 0) || (hour === 6 && minute === 0)) isReferenceTime = true;
                if (hour === 5 && minute === 0) isCutoff = true;
            } else if (session === 'newyork') {
                if ((hour === 18 && minute === 45) || (hour === 19 && minute === 0)) isRangeBuildingCandle = true;
                if ((hour === 18 && minute >= 0) || (hour === 19 && minute === 0)) isReferenceTime = true;
                if (hour === 18 && minute === 0) isCutoff = true;
            }

            // Cutoffs and Resets
            if (isCutoff || (session === 'gold' && dayDate !== currentDate)) {
                if (inPosition && activeTrade) {
                    const exitPrice = candle.open;
                    const exitTime = dayjs(candle.time).format();
                    const { profit } = calculatePnL(activeTrade, exitPrice, balance);
                    balance += profit;
                    tradesCount++;
                    if (profit > 0) wins++; else losses++;

                    executedTrades.push({
                        direction: activeTrade.direction,
                        entryPrice: activeTrade.entryPrice,
                        exitPrice,
                        profit,
                        entryTime: activeTrade.time,
                        exitTime: exitTime,
                        reason: isCutoff ? "Time Cutoff" : "Midnight Cutoff",
                        dayHigh: dayHigh,
                        dayLow: dayLow,
                        quantity: activeTrade.units
                    });

                    const lastLog = tradeLog[tradeLog.length - 1];
                    if (lastLog) {
                        lastLog.exitPrice = exitPrice;
                        lastLog.exitTime = exitTime;
                        lastLog.pnl = profit;
                    }
                }

                inPosition = false;
                activeTrade = null;
                currentSignal = null;
                dayHigh = -Infinity;
                dayLow = Infinity;
                priceReturnedToRange = false;

                if (dayDate !== currentDate) dayDate = currentDate;
            } else if (dayDate !== currentDate) {
                dayDate = currentDate;
            }

            // Collect day high/low
            if (isRangeBuildingCandle) {
                dayHigh = Math.max(dayHigh, parseFloat(candle.high));
                dayLow = Math.min(dayLow, parseFloat(candle.low));
                priceReturnedToRange = true;
            }

            if (dayHigh !== -Infinity && dayLow !== Infinity && !isReferenceTime) {
                const minRange = parseFloat(params.minRange) || 8;
                if (dayHigh - dayLow < minRange) {
                    continue; // Skip tight range sessions to avoid false breakouts
                }

                const high = parseFloat(candle.high);
                const low = parseFloat(candle.low);
                const close = parseFloat(candle.close);

                let isEntryCandle = false;

                if (close >= dayLow && close <= dayHigh) {
                    priceReturnedToRange = true;
                    if (!inPosition) currentSignal = null; // Cancel setup if price returns to range
                }

                if (!inPosition) {
                    if (!currentSignal) {
                        if (priceReturnedToRange) {
                            if (close >= dayHigh + 2 && low <= dayHigh - 2) {
                                const sl = low;
                                const entryPrice = high;
                                const risk = entryPrice - sl;
                                const tp = entryPrice + (2 * risk);
                                if (risk > 0) {
                                    currentSignal = { direction: 'buy', entryPrice, sl, tp };
                                    priceReturnedToRange = false;
                                }
                            } else if (close <= dayLow - 2 && high >= dayLow + 2) {
                                const sl = high;
                                const entryPrice = low;
                                const risk = sl - entryPrice;
                                const tp = entryPrice - (2 * risk);
                                if (risk > 0) {
                                    currentSignal = { direction: 'sell', entryPrice, sl, tp };
                                    priceReturnedToRange = false;
                                }
                            }
                        }
                    } else {
                        // Check if entry price is hit
                        if (currentSignal.direction === 'buy' && high >= currentSignal.entryPrice) {
                            inPosition = true;
                            isEntryCandle = true;

                            let exactEntryTime = candle.time;
                            if (subCandles && subCandles.length > 0) {
                                const res = params.interval || '15';
                                const intervalMs = Number(res) * 60 * 1000;
                                const relevantSubs = subCandles.filter(s => s.time >= candle.time && s.time < candle.time + intervalMs);
                                for (const sub of relevantSubs) {
                                    if (sub.high >= currentSignal.entryPrice) {
                                        exactEntryTime = dayjs(sub.time).tz('Asia/Kolkata').format();
                                        break;
                                    }
                                }
                            }

                            const entryPrice = currentSignal.entryPrice;
                            const riskPerUnit = entryPrice - currentSignal.sl;
                            const units = (parseFloat(params.riskAmount) || 100) / riskPerUnit;

                            activeTrade = {
                                direction: 'buy',
                                entryPrice,
                                time: exactEntryTime,
                                units: units,
                                sl: currentSignal.sl,
                                tp: currentSignal.tp,
                                resolution: params.interval || '15'
                            };
                            tradeLog.push({ type: 'BUY', price: entryPrice, time: exactEntryTime, pnl: 0 });
                        } else if (currentSignal.direction === 'sell' && low <= currentSignal.entryPrice) {
                            inPosition = true;
                            isEntryCandle = true;

                            let exactEntryTime = candle.time;
                            if (subCandles && subCandles.length > 0) {
                                const res = params.interval || '15';
                                const intervalMs = Number(res) * 60 * 1000;
                                const relevantSubs = subCandles.filter(s => s.time >= candle.time && s.time < candle.time + intervalMs);
                                for (const sub of relevantSubs) {
                                    if (sub.low <= currentSignal.entryPrice) {
                                        exactEntryTime = dayjs(sub.time).tz('Asia/Kolkata').format();
                                        break;
                                    }
                                }
                            }

                            const entryPrice = currentSignal.entryPrice;
                            const riskPerUnit = currentSignal.sl - entryPrice;
                            const units = (parseFloat(params.riskAmount) || 100) / riskPerUnit;

                            activeTrade = {
                                direction: 'sell',
                                entryPrice,
                                time: exactEntryTime,
                                units: units,
                                sl: currentSignal.sl,
                                tp: currentSignal.tp,
                                resolution: params.interval || '15'
                            };
                            tradeLog.push({ type: 'SELL', price: entryPrice, time: exactEntryTime, pnl: 0 });
                        }
                    }
                }

                if (inPosition && activeTrade) {
                    // Check for SL/TP using intra-candle exit logic
                    const exitInfo = checkIntraCandleExit(activeTrade, candle, subCandles, isEntryCandle, 'Asia/Kolkata', params.interval || '15', 'stop');

                    if (exitInfo) {
                        const exitPrice = exitInfo.price;
                        const exitTime = exitInfo.time || candle.time;
                        const { profit } = calculatePnL(activeTrade, exitPrice, balance);
                        balance += profit;

                        tradesCount++;
                        if (profit > 0) wins++;
                        else losses++;

                        executedTrades.push({
                            direction: activeTrade.direction,
                            entryPrice: activeTrade.entryPrice,
                            exitPrice,
                            profit,
                            entryTime: activeTrade.time,
                            exitTime: exitTime,
                            reason: exitInfo.reason,
                            dayHigh: dayHigh,
                            dayLow: dayLow,
                            quantity: activeTrade.units
                        });

                        const lastLog = tradeLog[tradeLog.length - 1];
                        if (lastLog) {
                            lastLog.exitPrice = exitPrice;
                            lastLog.exitTime = exitTime;
                            lastLog.pnl = profit;
                        }

                        inPosition = false;
                        activeTrade = null;
                        currentSignal = null;
                        // Trades allowed again if priceReturnsToRange becomes true on subsequent candles
                    }
                }
            }
        }

        return {
            simulatedTrades: executedTrades,
            initialBalance: parseFloat(params.riskAmount) || 100,
            finalBalance: balance,
            totalTrades: tradesCount,
            winRate: tradesCount > 0 ? (wins / tradesCount) * 100 : 0,
            netProfit: balance - (parseFloat(params.riskAmount) || 100),
            tradeLog,
            indicators: { fvgs: [] }
        };
    }
}
