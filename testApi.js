import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

const COINDCX_URL = "https://public.coindcx.com/market_data/candlesticks";

function formatPair(pair) {
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

async function getCandlesticks(params) {
    const { pair, ...rest } = params;
    const formattedPair = formatPair(pair);
    const response = await axios.get(COINDCX_URL, { params: { ...rest, pair: formattedPair, pcode: 'f' } });
    if (response.data && Array.isArray(response.data.data)) {
        response.data.data = response.data.data.map((c) => ({
            ...c,
            time: c.time < 10000000000 ? c.time * 1000 : c.time
        }));
    }
    return response.data;
}

async function test() {
    const date = '2026-05-21';
    const targetDate = dayjs(date).tz('Asia/Kolkata');
    const start = Math.floor(targetDate.startOf('day').valueOf() / 1000);
    const end = Math.floor(targetDate.endOf('day').valueOf() / 1000);
    const fetchStart = start - 172800; // 2 days before

    const res = await getCandlesticks({ pair: 'B-BTC_USDT', from: fetchStart, to: end, resolution: '15m' });
}
test();
