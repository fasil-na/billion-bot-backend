import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { calculateRSI, calculateEMA } from './StrategyUtils.js';
import { TradeService } from '../services/TradeService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ─────────────────────────────────────────────
//  Per-pair config  (mirrors FVGStrategy shape)
// ─────────────────────────────────────────────
export const STRATEGY_CONFIGS = {
    'b-btc_usdt': {
        riskRewardRatio: 3,
        riskAmount: 0,
        initialBalance: 1000,

        // EMA trend filter
        emaPeriod: 50,               // daily 50 EMA

        // RSI filter (applied on the same TF as candles = daily)
        rsiPeriod: 14,
        rsiBullishMin: 40,           // BUY only when RSI 40–70
        rsiBullishMax: 70,
        rsiBearishMin: 30,           // SELL only when RSI 30–60
        rsiBearishMax: 60,

        // Volume spike filter
        volumeMaPeriod: 20,          // 20-bar volume MA
        volumeSpikeMultiplier: 1.5,  // break candle vol must be ≥ 1.5× MA

        // Risk guard
        minRiskPerUnit: 150,
        maxRiskPerUnit: 1500,
    },

    'b-eth_usdt': {
        riskRewardRatio: 3,
        riskAmount: 0,
        initialBalance: 1000,

        emaPeriod: 100,

        rsiPeriod: 14,
        rsiBullishMin: 40,
        rsiBullishMax: 70,
        rsiBearishMin: 30,
        rsiBearishMax: 60,

        volumeMaPeriod: 20,
        volumeSpikeMultiplier: 1.5,

        minRiskPerUnit: 4,
        maxRiskPerUnit: 150,
    },
};

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const DEFAULT_PAIR_KEY   = 'B-BTC_USDT';
const TRADE_TIMEZONE     = 'Asia/Kolkata';
const DEFAULT_RESOLUTION = '15';        // main candle TF (daily feed uses '1D')
const MAKER_FEE_RATE     = 0.0003;
const TAKER_FEE_RATE     = 0.0006;

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

/** Rolling simple-moving-average of an array (returns array, same length, NaN before window fills) */
function rollingMA(arr, period) {
    return arr.map((_, i) => {
        if (i < period - 1) return NaN;
        let sum = 0;
        for (let k = i - period + 1; k <= i; k++) sum += arr[k];
        return sum / period;
    });
}

// ─────────────────────────────────────────────
//  Strategy class
// ─────────────────────────────────────────────
export class DailyHLBreakoutStrategy {
    id          = 'three-soldiers';
    name        = 'Daily H/L Breakout Strategy';
    description =
        'Breaks the previous daily high/low as entry trigger, filtered by ' +
        'EMA trend, RSI momentum, volume spike. SL is previous candle H/L. ' +
        'TP/SL resolved on 1-minute sub-candles.';

    // ── public entry-point ──────────────────────────────────────────────
    run(candles, params, subCandles = []) {
        if (params.type === 'live') {
            return this.checkSignal(candles, params);
        }

        // ── config resolution ──────────────────────────────────────────
        const cleanPairStr = (params.pair || DEFAULT_PAIR_KEY).toLowerCase();
        const config       = STRATEGY_CONFIGS[cleanPairStr] || STRATEGY_CONFIGS['b-btc_usdt'];

        const rr                     = params.riskRewardRatio        || config.riskRewardRatio;
        const riskAmount             = parseFloat(params.riskAmount) || config.riskAmount;
        const initialBalance         = params.initialBalance         || config.initialBalance;
        const emaPeriod              = config.emaPeriod;
        const rsiPeriod              = config.rsiPeriod;
        const rsiBullishMin          = config.rsiBullishMin;
        const rsiBullishMax          = config.rsiBullishMax;
        const rsiBearishMin          = config.rsiBearishMin;
        const rsiBearishMax          = config.rsiBearishMax;
        const volumeMaPeriod         = config.volumeMaPeriod;
        const volumeSpikeMultiplier  = config.volumeSpikeMultiplier;
        const minRiskPerUnit         = config.minRiskPerUnit;
        const maxRiskPerUnit         = config.maxRiskPerUnit;
        const simulationStart        = params.simulationStartUnix
            ? params.simulationStartUnix * 1000
            : 0;

        // ── instrument meta ────────────────────────────────────────────
        const cleanPair  = (params.pair || DEFAULT_PAIR_KEY).replace('B-', '').toLowerCase();
        const staticData = TradeService.STATIC_INSTRUMENTS[cleanPair]
            || TradeService.STATIC_INSTRUMENTS[params.pair]
            || TradeService.STATIC_INSTRUMENTS[DEFAULT_PAIR_KEY];
        const pricePrecision = staticData.priceStep.toString().split('.')[1]?.length || 0;

        // ── pre-compute indicators across all candles ──────────────────
        const closes   = candles.map(c => c.close);
        const highs    = candles.map(c => c.high);
        const lows     = candles.map(c => c.low);
        const volumes  = candles.map(c => c.volume ?? 0);

        const emaValues    = calculateEMA(closes, emaPeriod);   // same call as FVG uses
        const rsiValues    = calculateRSI(closes, rsiPeriod);
        const volumeMA     = rollingMA(volumes, volumeMaPeriod);

        // ── state ──────────────────────────────────────────────────────
        const trades     = [];
        let   balance    = initialBalance;
        let   activeTrade    = null;
        let   lastExitIndex  = -1;
        let   lastTradeDayStr = null;

        // Signal log — every detected breakout (whether traded or skipped)
        const allSignals = [];

        // ── main loop — starts at i=1 (need previous day) ─────────────
        for (let i = 1; i < candles.length; i++) {
            const prev = candles[i - 1];   // previous day candle
            const curr = candles[i];        // current day candle (breakout day)

            // ── 1. Manage open trade first (same priority as FVGStrategy) ──
            if (activeTrade) {
                if (params.type === 'live_signal') continue;

                if (activeTrade.status === 'pending') {
                    const isBuy    = activeTrade.direction === 'buy';
                    const hitEntry = isBuy
                        ? curr.low  <= activeTrade.entryPrice
                        : curr.high >= activeTrade.entryPrice;
                    if (hitEntry) activeTrade.status = 'open';
                }

                if (activeTrade.status === 'open') {
                    const exitInfo = this.checkIntraCandleExit(activeTrade, curr, subCandles, false);
                    if (exitInfo) {
                        activeTrade = this._closeAndRecord(
                            activeTrade, exitInfo, balance, trades
                        );
                        balance    += activeTrade.profit;
                        trades[trades.length - 1] = { ...activeTrade };
                        activeTrade  = null;
                        lastExitIndex = i;
                    }
                }
                continue;  // one trade at a time
            }

            if (i === lastExitIndex) continue;

            // ── 2. Gather indicator values for this candle ─────────────
            const ema       = emaValues[i];
            const rsi       = rsiValues[i] ?? 50;
            const volMA     = volumeMA[i];
            const currVol   = volumes[i];

            // Skip until all indicators are warm
            if (!ema || isNaN(volMA)) continue;

            const prevDayHigh = prev.high;
            const prevDayLow  = prev.low;

            // ── 3. Detect breakout direction ───────────────────────────
            //    BUY  → current candle's high breaks above prev day high
            //    SELL → current candle's low  breaks below prev day low
            const breaksBullish = curr.high > prevDayHigh;
            const breaksBearish = curr.low  < prevDayLow;

            if (!breaksBullish && !breaksBearish) continue;

            // If both fire in same candle, take the one aligned with EMA trend
            let direction;
            if (breaksBullish && breaksBearish) {
                direction = curr.close > ema ? 'buy' : 'sell';
            } else {
                direction = breaksBullish ? 'buy' : 'sell';
            }

            const entryPrice = direction === 'buy' ? prevDayHigh : prevDayLow;

            const currentDayStr = dayjs(curr.time).tz(TRADE_TIMEZONE).format('YYYY-MM-DD');

            // ── 3.5 Filter: One trade per day ──────────────────────────
            if (currentDayStr === lastTradeDayStr) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, 'MAX 1 TRADE PER DAY', prevDayHigh, prevDayLow));
                continue;
            }

            // ── 4. Filter: EMA trend ───────────────────────────────────
            //    BUY  → price must be above EMA (bullish trend)
            //    SELL → price must be below EMA (bearish trend)
            if (direction === 'buy'  && curr.close < ema) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, 'EMA FILTER (below EMA)', prevDayHigh, prevDayLow));
                continue;
            }
            if (direction === 'sell' && curr.close > ema) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, 'EMA FILTER (above EMA)', prevDayHigh, prevDayLow));
                continue;
            }

            // ── 6. Filter: RSI ─────────────────────────────────────────
            if (direction === 'buy') {
                if (rsi < rsiBullishMin || rsi > rsiBullishMax) {
                    allSignals.push(this._skippedSignal(curr, direction, entryPrice, `RSI FILTER (${rsi.toFixed(1)})`, prevDayHigh, prevDayLow));
                    continue;
                }
            } else {
                if (rsi < rsiBearishMin || rsi > rsiBearishMax) {
                    allSignals.push(this._skippedSignal(curr, direction, entryPrice, `RSI FILTER (${rsi.toFixed(1)})`, prevDayHigh, prevDayLow));
                    continue;
                }
            }

            // ── 7. Filter: volume spike ────────────────────────────────
            if (currVol < volMA * volumeSpikeMultiplier) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, `VOLUME FILTER (${(currVol / volMA).toFixed(2)}× MA)`, prevDayHigh, prevDayLow));
                continue;
            }

            // ── 8. Calculate SL and TP ──────────────────────
            const sl        = direction === 'buy' ? prevDayLow : prevDayHigh;
            const stopDist  = Math.abs(entryPrice - sl);
            const tp        = direction === 'buy'
                ? Number((entryPrice + stopDist * rr).toFixed(pricePrecision))
                : Number((entryPrice - stopDist * rr).toFixed(pricePrecision));

            const riskPerUnit = stopDist;

            // ── 9. Risk guard ──────────────────────────────────────────
            if (riskPerUnit < minRiskPerUnit || riskPerUnit > maxRiskPerUnit) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, `RISK LIMIT (${riskPerUnit.toFixed(2)})`, prevDayHigh, prevDayLow));
                continue;
            }

            // ── 10. Position sizing ────────────────────────────────────
            const step   = staticData.qtyStep;
            let   units  = riskAmount / riskPerUnit;
            units = Math.floor(units / step) * step;
            units = Number(units.toFixed(3));
            const minQty = Math.ceil(
                (staticData.minNotional / entryPrice) / staticData.qtyStep
            ) * staticData.qtyStep;

            if (units < minQty || units <= 0) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, 'MIN QTY LIMIT', prevDayHigh, prevDayLow));
                continue;
            }

            // ── 11. Simulation start guard ─────────────────────────────
            if (curr.time < simulationStart) {
                allSignals.push(this._skippedSignal(curr, direction, entryPrice, 'BEFORE SIM START', prevDayHigh, prevDayLow));
                continue;
            }

            // ── 12. All filters passed → open trade ───────────────────
            lastTradeDayStr = currentDayStr;
            activeTrade = {
                entryTime    : dayjs(curr.time).tz(TRADE_TIMEZONE).format(),
                direction,
                entryPrice,
                units,
                sl,
                tp,
                resolution   : params.resolution || DEFAULT_RESOLUTION,
                status       : 'open',               // immediate market entry on break
                orderType    : 'market_order',
                profit       : 0,
                indicators   : {
                    prevDayHigh,
                    prevDayLow,
                    ema         : Number(ema.toFixed(pricePrecision)),
                    rsi         : Number(rsi.toFixed(2)),
                    volumeRatio : Number((currVol / volMA).toFixed(2)),
                },
            };

            // Record in signal log
            allSignals.push({
                time        : curr.time,
                direction,
                entryPrice,
                sl,
                tp,
                prevDayHigh,
                prevDayLow,
                status      : 'trade_executed',
                indicators  : activeTrade.indicators,
            });

            // Check if same candle already hit TP or SL (via sub-candles)
            if (activeTrade.status === 'open') {
                const exitInfo = this.checkIntraCandleExit(activeTrade, curr, subCandles, true);
                if (exitInfo) {
                    activeTrade = this._closeAndRecord(activeTrade, exitInfo, balance, trades);
                    balance    += activeTrade.profit;
                    trades[trades.length - 1] = { ...activeTrade };
                    activeTrade  = null;
                    lastExitIndex = i;
                }
            }
        }

        // ── Return (mirrors FVGStrategy shape exactly) ─────────────────
        return {
            trades,
            initialBalance,
            finalBalance  : balance,
            trade         : activeTrade,             // active/pending trade for live bot
            totalTrades   : trades.length,
            winRate       : trades.length > 0
                ? (trades.filter(t => t.profit > 0).length / trades.length) * 100
                : 0,
            netProfit     : balance - initialBalance,
            tradeLog      : trades.map(t => ({
                type      : t.direction === 'buy' ? 'BUY' : 'SELL',
                price     : t.entryPrice,
                time      : dayjs(t.entryTime).valueOf(),
                pnl       : t.profit,
                exitPrice : t.exitPrice,
                exitTime  : dayjs(t.exitTime).valueOf(),
            })),
            indicators: {
                totalSignalsDetected : allSignals.length,
                signals              : allSignals,
            },
        };
    }

    // ── checkIntraCandleExit ────────────────────────────────────────────
    // Identical contract to FVGStrategy — checks 1M sub-candles first,
    // then falls back to main candle H/L if no sub-candles available.
    checkIntraCandleExit(trade, mainCandle, subCandles, isEntryCandle = false) {
        const isBuy      = trade.direction === 'buy';
        const sl         = trade.sl || 0;
        const tp         = trade.tp || 0;
        const entryPrice = trade.entryPrice;

        if (subCandles && subCandles.length > 0) {
            const res         = trade.resolution || DEFAULT_RESOLUTION;
            const intervalMs  = Number(res) * 60 * 1000;
            const candleEnd   = mainCandle.time + intervalMs;
            const relevantSubs = subCandles.filter(
                s => s.time >= mainCandle.time && s.time < candleEnd
            );

            let entryHit = !isEntryCandle;

            for (const sub of relevantSubs) {
                // Wait for entry price to be touched first (on entry candle)
                if (!entryHit) {
                    if (isBuy  && sub.low  <= entryPrice) entryHit = true;
                    if (!isBuy && sub.high >= entryPrice) entryHit = true;
                }

                if (entryHit) {
                    if (isBuy) {
                        const hitSL = sub.low  <= sl;
                        const hitTP = sub.high >= tp;
                        if (hitSL && hitTP) {
                            // Both on same 1M candle — bearish candle body → SL first
                            return sub.close < sub.open
                                ? { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss (Sub)' }
                                : { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Take Profit (Sub)' };
                        }
                        if (hitSL) return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss (Sub)' };
                        if (hitTP) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Take Profit (Sub)' };
                    } else {
                        const hitSL = sub.high >= sl;
                        const hitTP = sub.low  <= tp;
                        if (hitSL && hitTP) {
                            return sub.close > sub.open
                                ? { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss (Sub)' }
                                : { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Take Profit (Sub)' };
                        }
                        if (hitSL) return { price: sl, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss (Sub)' };
                        if (hitTP) return { price: tp, time: dayjs(sub.time).tz(TRADE_TIMEZONE).format(), reason: 'Take Profit (Sub)' };
                    }
                }
            }
            if (isEntryCandle && !entryHit) return null;
        }

        // Fallback: main candle H/L only
        if (isBuy) {
            const hitSL = mainCandle.low  <= sl;
            const hitTP = mainCandle.high >= tp;
            if (hitSL && hitTP) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss' };
            if (hitSL)          return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss' };
            if (hitTP)          return { price: tp, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: 'Take Profit' };
        } else {
            const hitSL = mainCandle.high >= sl;
            const hitTP = mainCandle.low  <= tp;
            if (hitSL && hitTP) return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss' };
            if (hitSL)          return { price: sl, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: 'Stop Loss' };
            if (hitTP)          return { price: tp, time: dayjs(mainCandle.time).tz(TRADE_TIMEZONE).format(), reason: 'Take Profit' };
        }
        return null;
    }

    // ── calculatePnL ───────────────────────────────────────────────────
    // Identical to FVGStrategy — maker entry fee, taker exit fee.
    calculatePnL(trade, exitPrice, balance) {
        const units = trade.units || 0;
        const grossProfit = trade.direction === 'buy'
            ? (exitPrice - trade.entryPrice) * units
            : (trade.entryPrice - exitPrice) * units;

        const entryFee = Math.ceil(trade.entryPrice * units * MAKER_FEE_RATE * 1000) / 1000;
        const exitFee  = Math.ceil(exitPrice        * units * TAKER_FEE_RATE * 1000) / 1000;
        const fee      = entryFee + exitFee;

        return { profit: grossProfit - fee, fee, grossProfit, entryFee, exitFee };
    }

    // ── checkSignal (live bot) ─────────────────────────────────────────
    checkSignal(candles, params) {
        if (candles.length < 5) return { matched: false };

        const result = this.run(candles, { ...params, type: 'live_signal' });
        if (!result.trade) return { matched: false };

        const tradeEntryUnix       = dayjs(result.trade.entryTime).valueOf();
        const recentlyClosedTime   = candles[candles.length - 2].time;

        // Reject stale signals (entered on an older candle)
        if (tradeEntryUnix <= recentlyClosedTime) return { matched: false };

        return { matched: true, trade: result.trade };
    }

    // ── private helpers ────────────────────────────────────────────────

    /** Attach PnL fields to activeTrade, push to trades array, return mutated trade */
    _closeAndRecord(trade, exitInfo, balance, trades) {
        trade.status    = 'closed';
        trade.exitTime  = exitInfo.time;
        trade.exitPrice = exitInfo.price;
        trade.exitReason = exitInfo.reason;

        const pnl = this.calculatePnL(trade, trade.exitPrice, balance);
        trade.grossProfit = Number(pnl.grossProfit.toFixed(4));
        trade.entryFee    = pnl.entryFee;
        trade.exitFee     = pnl.exitFee;
        trade.fee         = pnl.fee;
        trade.profit      = pnl.profit;
        trade.pnlPercent  = (pnl.profit / balance) * 100;
        trades.push({ ...trade });
        return trade;
    }

    /** Build a skipped-signal record for the indicators log */
    _skippedSignal(candle, direction, entryPrice, rejectReason, prevDayHigh, prevDayLow) {
        return {
            time        : candle.time,
            direction,
            entryPrice,
            prevDayHigh,
            prevDayLow,
            status      : 'skipped',
            rejectReason,
        };
    }
}