import dayjs from 'dayjs';

const INITIAL_BALANCE = 10000;

export class SMAStrategy {
    id = "sma_crossover";
    name = "SMA Crossover";

    run(candles, params) {
        if (!candles || candles.length < 30) {
            return {
                trades: [],
                initialBalance: params.riskAmount,
                finalBalance: params.riskAmount,
                totalTrades: 0,
                winRate: 0,
                netProfit: 0,
                tradeLog: []
            };
        }

        const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
        
        let balance = parseFloat(params.riskAmount) || 100;
        let trades = 0;
        let wins = 0;
        let losses = 0;
        let inPosition = false;
        let entryPrice = 0;
        const tradeLog = [];
        const executedTrades = [];

        for (let i = 31; i < sortedCandles.length; i++) {
            const currentCandle = sortedCandles[i];
            const closePrice = parseFloat(currentCandle.close);

            let fastSum = 0;
            for (let j = i - 10; j < i; j++) fastSum += parseFloat(sortedCandles[j].close);
            const fastSMA = fastSum / 10;

            let slowSum = 0;
            for (let j = i - 30; j < i; j++) slowSum += parseFloat(sortedCandles[j].close);
            const slowSMA = slowSum / 30;

            let prevFastSum = 0;
            for (let j = i - 11; j < i - 1; j++) prevFastSum += parseFloat(sortedCandles[j].close);
            const prevFastSMA = prevFastSum / 10;

            let prevSlowSum = 0;
            for (let j = i - 31; j < i - 1; j++) prevSlowSum += parseFloat(sortedCandles[j].close);
            const prevSlowSMA = prevSlowSum / 30;

            const isBullishCross = prevFastSMA <= prevSlowSMA && fastSMA > slowSMA;
            const isBearishCross = prevFastSMA >= prevSlowSMA && fastSMA < slowSMA;

            if (!inPosition && isBullishCross) {
                inPosition = true;
                entryPrice = closePrice;
                tradeLog.push({ type: 'BUY', price: entryPrice, time: currentCandle.time, pnl: 0, exitPrice: null, exitTime: null });
            } else if (inPosition && isBearishCross) {
                inPosition = false;
                const exitPrice = closePrice;
                const profitLoss = exitPrice - entryPrice;
                const profitPercentage = profitLoss / entryPrice;
                
                const tradeProfit = balance * profitPercentage;
                balance += tradeProfit;

                trades++;
                if (tradeProfit > 0) wins++;
                else losses++;

                const entryTrade = tradeLog[tradeLog.length - 1];
                entryTrade.exitPrice = exitPrice;
                entryTrade.exitTime = currentCandle.time;
                entryTrade.pnl = tradeProfit;

                executedTrades.push({
                    direction: 'buy',
                    entryPrice,
                    exitPrice,
                    profit: tradeProfit,
                    entryTime: entryTrade.time,
                    exitTime: currentCandle.time
                });
            }
        }

        return {
            trades: executedTrades,
            initialBalance: parseFloat(params.riskAmount),
            finalBalance: balance,
            totalTrades: trades,
            winRate: trades > 0 ? (wins / trades) * 100 : 0,
            netProfit: balance - parseFloat(params.riskAmount),
            tradeLog
        };
    }
}
