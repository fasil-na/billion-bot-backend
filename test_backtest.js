import { runBacktest } from './controllers/strategyController.js';

const req = {
    body: {
        date: null,
        pair: 'B-BTC_USDT',
        resolution: '15',
        startDate: '2026-05-28T12:00:00.000Z',
        endDate: '2026-05-28T23:59:59.000Z',
        riskAmount: 100
    },
    query: {}
};

const res = {
    status: function(code) {
        return {
            json: function(data) {
                console.log(`Keys:`, Object.keys(data));
                if (data.indicators && data.indicators.fvgs) {
                    console.log(`Total FVGs: ${data.indicators.fvgs.length}`);
                    console.log(JSON.stringify(data.indicators.fvgs.slice(0, 5), null, 2));
                }
            }
        };
    },
    json: function(data) {
        console.log(`Keys:`, Object.keys(data));
    }
};

runBacktest(req, res).catch(console.error);
