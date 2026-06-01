import axios from 'axios';

async function run() {
    try {
        const response = await axios.post('http://localhost:5001/api/market/backtest', {
            pair: "B-BTC_USDT",
            timeframe: "15m",
            startDate: "2026-05-31T20:00:00.000Z",
            endDate: "2026-06-01T08:00:00.000Z",
            strategy: "fvg-imbalance",
            riskAmount: 100
        });
        const trades = response.data.trades;
        if (!trades || trades.length === 0) {
            console.log("No trades found in response");
            return;
        }
        
        for (const t of trades) {
            console.log(`Trade: ${t.direction} | Entry Time: ${t.entryTime} | Entry: ${t.entryPrice} | Exit Time: ${t.exitTime} | Exit: ${t.exitPrice} | Reason: ${t.exitReason}`);
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}
run();
