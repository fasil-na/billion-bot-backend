// StrategyUtils.js
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

export function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return new Array(candles.length).fill(0);
    const atr = new Array(candles.length).fill(0);
    const tr = new Array(candles.length).fill(0);

    // Calculate True Range (TR)
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        
        tr[i] = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
    }

    // First ATR is the simple average of the first 'period' TRs
    let sumTR = 0;
    for (let i = 1; i <= period; i++) {
        sumTR += tr[i];
    }
    atr[period] = sumTR / period;

    // Wilder's Smoothing for the rest
    for (let i = period + 1; i < candles.length; i++) {
        atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period;
    }

    return atr;
}
