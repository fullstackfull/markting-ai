/**
 * Phase 2J — conservative forecasting foundation. Transparent methods only (straight-line run-rate and
 * trailing moving average); no ML, no hidden model. Every forecast carries its method, the window it
 * was built from, an uncertainty band, and explicit limitations. Forecasts are never presented as
 * certainties — the band and limitations travel with the number so a consumer cannot read a point
 * estimate as a promise.
 */
export type ForecastMethod = 'run_rate' | 'trailing_moving_average';
export type ForecastMetric = 'spend' | 'conversions' | 'cpa' | 'revenue';

export interface Forecast {
  metric: ForecastMetric;
  method: ForecastMethod;
  /** Point estimate for the horizon (best transparent guess, not a promise). */
  estimate: number;
  /** Uncertainty band [low, high] from the dispersion of the input window. */
  low: number;
  high: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  windowDays: number;
  horizonDays: number;
  limitations: string[];
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Forecast a cumulative metric (spend/conversions/revenue) over `horizonDays` from a daily history.
 * Uses the trailing-window daily mean × horizon, with a band from the daily std scaled by √horizon.
 */
export function forecastCumulative(metric: Exclude<ForecastMetric, 'cpa'>, dailyHistory: number[], horizonDays: number, windowDays = 7): Forecast {
  const limitations: string[] = ['straight-line run-rate; assumes no change in strategy, seasonality, or auction dynamics'];
  const window = dailyHistory.slice(-windowDays);
  if (window.length < 3) limitations.push('short history; estimate is weak');
  const dailyMean = mean(window);
  const dailyStd = std(window);
  const estimate = dailyMean * horizonDays;
  const band = dailyStd * Math.sqrt(horizonDays);
  const conf: Forecast['confidence'] = window.length < 3 ? 'LOW' : dailyMean > 0 && dailyStd / dailyMean > 0.5 ? 'LOW' : dailyStd / Math.max(dailyMean, 1e-9) > 0.25 ? 'MEDIUM' : 'HIGH';
  return { metric, method: 'run_rate', estimate: round(estimate), low: round(Math.max(0, estimate - band)), high: round(estimate + band), confidence: conf, windowDays: window.length, horizonDays, limitations };
}

/**
 * Forecast a ratio metric (CPA) as a trailing moving average of the daily ratio — NOT a sum. The band
 * comes from the dispersion of the daily ratios. CPA is undefined on zero-conversion days, which are
 * dropped (and noted as a limitation).
 */
export function forecastCpa(dailySpend: number[], dailyConversions: number[], windowDays = 7): Forecast {
  const limitations: string[] = ['trailing moving average of the daily ratio; not a modelled projection'];
  const n = Math.min(dailySpend.length, dailyConversions.length);
  const ratios: number[] = [];
  for (let i = Math.max(0, n - windowDays); i < n; i++) {
    const c = dailyConversions[i]!;
    if (c > 0) ratios.push(dailySpend[i]! / c);
  }
  if (ratios.length === 0) {
    limitations.push('no conversion days in the window — CPA not forecastable');
    return { metric: 'cpa', method: 'trailing_moving_average', estimate: 0, low: 0, high: 0, confidence: 'LOW', windowDays: 0, horizonDays: 1, limitations };
  }
  if (ratios.length < windowDays) limitations.push('some days had zero conversions and were dropped');
  const m = mean(ratios);
  const s = std(ratios);
  const conf: Forecast['confidence'] = ratios.length < 3 ? 'LOW' : s / Math.max(m, 1e-9) > 0.4 ? 'LOW' : s / Math.max(m, 1e-9) > 0.2 ? 'MEDIUM' : 'HIGH';
  return { metric: 'cpa', method: 'trailing_moving_average', estimate: round(m), low: round(Math.max(0, m - s)), high: round(m + s), confidence: conf, windowDays: ratios.length, horizonDays: 1, limitations };
}
function round(n: number): number { return Math.round(n * 100) / 100; }
