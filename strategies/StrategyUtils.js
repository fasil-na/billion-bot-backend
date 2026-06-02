import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

export function calculateEMA(data, period) {
    if (!data || data.length < period) return [];
    const k = 2 / (period + 1);
    const ema = new Array(data.length).fill(0);

    // SMA for the first valid EMA value
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i];
    }
    ema[period - 1] = sum / period;

    for (let i = period; i < data.length; i++) {
        ema[i] = (data[i] * k) + (ema[i - 1] * (1 - k));
    }
    return ema;
}

export function calculateRSI(closes, period = 14) {
    if (!closes || closes.length < period + 1) return new Array(closes.length).fill(50);
    const rsi = new Array(closes.length).fill(50);
    let avgGain = 0;
    let avgLoss = 0;

    // Initial average gain and loss
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

    // Wilder's Smoothing
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;

        if (avgLoss === 0) {
            rsi[i] = 100;
        } else {
            rsi[i] = 100 - (100 / (1 + (avgGain / avgLoss)));
        }
    }
    return rsi;
}

export function formatPair(pair) {
    if (!pair) return '';
    if (pair.startsWith('B-')) return pair;

    let formatted = pair;
    if (!formatted.includes('_')) {
        if (formatted.endsWith('USDT')) {
            formatted = formatted.replace('USDT', '_USDT');
        } else if (formatted.endsWith('INR')) {
            formatted = formatted.replace('INR', '_INR');
        }
    }

    return `B-${formatted}`;
}

// export function calculateTradeProfit(trade, exitPrice, feeRate) {
//   const isBuy = trade.direction === 'buy';
//   const entryPriceToUse = trade.actualEntryPrice || trade.entryPrice;
//   const priceDiff = isBuy ? exitPrice - entryPriceToUse : entryPriceToUse - exitPrice;
//   const qty = trade.units || trade.qty || 1;
//   const grossProfit = priceDiff * qty;
//   const entryFee = entryPriceToUse * qty * feeRate;
//   const exitFee = exitPrice * qty * feeRate;
//   const fee = entryFee + exitFee;
//   const profit = grossProfit - fee;
//   const pnlPercent = (profit / (entryPriceToUse * qty)) * 100 * (trade.leverage || 1);
//   return { profit, fee, pnlPercent, grossProfit, entryFee, exitFee };
// }

export function calculateTradeProfit(
    trade,
    exitPrice,
) {
    const units = trade.units || 0;
 
    const grossProfit = trade.direction === 'buy'
        ? (exitPrice - trade.entryPrice) * units
        : (trade.entryPrice - exitPrice) * units;
 
    const pnlPercent = trade.entryPrice > 0 ? (grossProfit / (trade.entryPrice * units / (trade.leverage || 1))) * 100 : 0;
    
    const MAKER_FEE_RATE = 0.0003;
    const TAKER_FEE_RATE = 0.0006;

    const entryFee = Math.ceil(trade.entryPrice * units * MAKER_FEE_RATE * 1000) / 1000;
    const exitFee = Math.ceil(exitPrice * units * TAKER_FEE_RATE * 1000) / 1000;
    const totalFee = entryFee + exitFee;

    return {
        profit: parseFloat((grossProfit - totalFee).toFixed(3)),
        fee: parseFloat(totalFee.toFixed(3)),
        grossProfit: parseFloat(grossProfit.toFixed(3)),
        entryFee: parseFloat(entryFee.toFixed(3)),
        exitFee: parseFloat(exitFee.toFixed(3)),
        points: parseFloat((exitPrice - trade.entryPrice).toFixed(3)),
        pnlPercent: parseFloat(pnlPercent.toFixed(2))
    };
}

export function calculatePnL(trade, exitPrice, balance) {
    const units = trade.units || 0;
    const grossProfit = trade.direction === "buy"
        ? (exitPrice - trade.entryPrice) * units
        : (trade.entryPrice - exitPrice) * units;

    const MAKER_FEE_RATE = 0.0003;
    const TAKER_FEE_RATE = 0.0006;
    const entryFee = Math.ceil(trade.entryPrice * units * MAKER_FEE_RATE * 1000) / 1000;
    const exitFee = Math.ceil(exitPrice * units * TAKER_FEE_RATE * 1000) / 1000;
    const totalFee = entryFee + exitFee;

    return { profit: grossProfit - totalFee, fee: totalFee, grossProfit, entryFee, exitFee };
}

export function checkIntraCandleExit(trade, mainCandle, subCandles, isEntryCandle = false, TRADE_TIMEZONE = 'Asia/Kolkata', DEFAULT_RESOLUTION = '15', entryType = 'limit') {
    const isBuy = trade.direction === "buy";
    const sl = trade.sl || 0;
    const tp = trade.tp || 0;
    const entryPrice = trade.entryPrice;

    if (subCandles && subCandles.length > 0) {
        const res = trade.resolution || DEFAULT_RESOLUTION;
        const intervalMs = Number(res) * 60 * 1000;
        const candleEndUnix = mainCandle.time + intervalMs;
        const relevantSubs = subCandles.filter(s => s.time >= mainCandle.time && s.time < candleEndUnix);

        let entryHit = !isEntryCandle;

        for (const sub of relevantSubs) {
            if (!entryHit) {
                if (entryType === 'limit') {
                    if (isBuy && sub.low <= entryPrice) entryHit = true;
                    else if (!isBuy && sub.high >= entryPrice) entryHit = true;
                } else if (entryType === 'stop') {
                    if (isBuy && sub.high >= entryPrice) entryHit = true;
                    else if (!isBuy && sub.low <= entryPrice) entryHit = true;
                }
            }

            if (entryHit) {
                if (isBuy) {
                    const hitSL = sub.low <= sl;
                    const hitTP = sub.high >= tp;
                    if (hitSL && hitTP) {
                        if (sub.close < sub.open) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit (Sub)" };
                        else return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss (Sub)" };
                    } else if (hitSL) return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss (Sub)" };
                    else if (hitTP) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit (Sub)" };
                } else {
                    const hitSL = sub.high >= sl;
                    const hitTP = sub.low <= tp;
                    if (hitSL && hitTP) {
                        if (sub.close > sub.open) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit (Sub)" };
                        else return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss (Sub)" };
                    } else if (hitSL) return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss (Sub)" };
                    else if (hitTP) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit (Sub)" };
                }
            }
        }
        if (isEntryCandle && !entryHit) return null;
    }

    if (isBuy) {
        const hitSL = mainCandle.low <= sl;
        const hitTP = mainCandle.high >= tp;
        if (hitSL && hitTP) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss" };
        else if (hitSL) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss" };
        else if (hitTP) return { price: tp, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit" };
    } else {
        const hitSL = mainCandle.high >= sl;
        const hitTP = mainCandle.low <= tp;
        if (hitSL && hitTP) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss" };
        else if (hitSL) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Stop Loss" };
        else if (hitTP) return { price: tp, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: "Take Profit" };
    }
    return null;
}
