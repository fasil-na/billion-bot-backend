import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
const endTime = dayjs('2026-06-01T11:27:00+05:30').valueOf();
async function run() {
    try {
        const res = await axios.get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/candles?pair=B-BTC_USDT&interval=1m&startTime=${endTime - 1000 * 60 * 10}&endTime=${endTime}`);
        console.log(res.data);
    } catch(e) {
        console.error(e.response ? e.response.data : e.message);
    }
}
run();
