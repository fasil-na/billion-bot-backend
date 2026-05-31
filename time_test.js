import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

const TRADE_TIMEZONE = "Asia/Kolkata";
const currTime = 1780201980000; // Some unix timestamp
const entryTimeStr = dayjs(currTime).tz(TRADE_TIMEZONE).format();
const tradeEntryUnix = dayjs(entryTimeStr).valueOf();

console.log("currTime:", currTime);
console.log("entryTimeStr:", entryTimeStr);
console.log("tradeEntryUnix:", tradeEntryUnix);
console.log("tradeEntryUnix < currTime :", tradeEntryUnix < currTime);
