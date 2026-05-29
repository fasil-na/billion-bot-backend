import { runBacktest } from './controllers/strategyController.js';
import dayjs from 'dayjs';

const req = {
    body: {
        date: null,
        pair: 'B-BTC_USDT',
        resolution: '15',
        startDate: '2026-05-28T00:00:00.000Z',
        endDate: '2026-05-28T23:59:59.000Z',
        riskAmount: 100
    },
    query: {}
};

const res = {
    status: (code) => ({
        json: (data) => console.log(`Error ${code}: ${data.error}`)
    }),
    json: (data) => {
        data.indicators.fvgs.forEach(f => {
            const fTime = dayjs(f.formationEndTime).format('YYYY-MM-DD HH:mm');
            if (fTime.includes('2026-05-28')) {
                console.log(`FVG: ${fTime} ${f.direction} [${f.bottom.toFixed(1)} to ${f.top.toFixed(1)}]`);
            }
        });
    }
};

runBacktest(req, res).catch(console.error);
