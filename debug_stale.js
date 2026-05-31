import dayjs from 'dayjs';

const entryTime = '2026-05-31T09:15:00+05:30';
const tradeEntryUnix = dayjs(entryTime).valueOf();
const latestCandleTime = 1780208700000; // Let's see what the timestamp would be

console.log("tradeEntryUnix:", tradeEntryUnix);
console.log("tradeEntryUnix str:", dayjs(tradeEntryUnix).format());
