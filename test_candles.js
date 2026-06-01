import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

async function run() {
    try {
        const endTime = 1717222800000; // Just an example, we will use a recent timestamp
        const res = await axios.get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/candles?pair=B-BTC_USDT&interval=1m&limit=10');
        const candles = res.data;
        candles.sort((a, b) => a.time - b.time);
        for (const c of candles) {
            console.log(dayjs(c.time).tz('Asia/Kolkata').format('HH:mm:ss'), 'O:', c.open, 'H:', c.high, 'L:', c.low, 'C:', c.close);
        }
    } catch(e) {
        console.error(e.message);
    }
}
run();
