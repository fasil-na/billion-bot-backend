export class TradeService {
    static STATIC_INSTRUMENTS = {
        'B-BTC_USDT': { maxLeverage: 20, qtyStep: 0.001, priceStep: 0.1, minNotional: 6 },
        'B-SUSHI_USDT': { maxLeverage: 10, qtyStep: 1, priceStep: 0.0001, minNotional: 6 },
        'B-XAU_USDT': { maxLeverage: 20, qtyStep: 0.01, priceStep: 0.01, minNotional: 6 },
        'SUSHIUSDT': { maxLeverage: 10, qtyStep: 1, priceStep: 0.0001, minNotional: 6 },
    };
}
