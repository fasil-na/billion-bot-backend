import axios from 'axios';
const COINDCX_URL = 'https://public.coindcx.com/market_data/candlesticks';
const from = Math.floor(Date.now() / 1000) - 86400 * 5;
const to = Math.floor(Date.now() / 1000) - 86400 * 4;

axios.get(COINDCX_URL, { params: { pair: 'B-BTC_USDT', from, to, resolution: '15' } }).then(res => {
    console.log('With from/to/resolution:');
    console.log(res.data[0].time, res.data[res.data.length - 1].time);
}).catch(console.error);

axios.get(COINDCX_URL, { params: { pair: 'B-BTC_USDT', startTime: from * 1000, endTime: to * 1000, interval: '15m' } }).then(res => {
    console.log('With startTime/endTime/interval:');
    console.log(res.data[0].time, res.data[res.data.length - 1].time);
}).catch(console.error);
