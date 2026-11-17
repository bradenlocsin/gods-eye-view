/**
 * Chokepoint maths: how far a strait's ship traffic is from normal.
 * Pure functions over a normalized record (see records.js).
 *
 * Two comparisons, because one alone misleads:
 * - **Level** (`vsNormal`): the latest 7-day mean against PortWatch's
 *   2019–2024 average for that strait. This decides the status. A strait
 *   that has been shut for months still reads as disrupted.
 * - **Trend** (`vsTrend`): the same 7-day mean against the 90 days before
 *   it. This says whether things are getting better or worse. On its own it
 *   would call a long closure "normal", since the 90 days are closed too.
 */

import { VESSEL_TYPES } from './records.js';

export const CHOKEPOINT_STATUSES = Object.freeze([
  'disrupted',
  'reduced',
  'normal',
  'elevated',
  'unknown',
]);

export const STATUS_COLORS = Object.freeze({
  disrupted: '#ff4d4f',
  reduced: '#ffb020',
  normal: '#3ddc97',
  elevated: '#4fc3f7',
  unknown: '#9aa7b4',
});

/** Level thresholds, as a share of the 2019–2024 average. */
export const DISRUPTED_BELOW = -0.5;
export const REDUCED_BELOW = -0.2;
export const ELEVATED_ABOVE = 0.2;
/**
 * Below this many ships a day in a normal year, one ship is a large share of
 * the day's count, so the strait is not given a status.
 */
export const MIN_JUDGEABLE_PER_DAY = 5;
const RECENT_DAYS = 7;
const TREND_DAYS = 90;
/** A 7-day mean needs at least this many reported days. */
const MIN_RECENT_DAYS = 4;
const MIN_TREND_DAYS = 30;

const mean = (values) =>
  values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);
const share = (value, base) =>
  value === null || !(base > 0) ? null : value / base - 1;

/**
 * The status a level earns.
 * @param {number|null} vsNormal Share above or below the average (−0.96 = 96 % below).
 * @param {number} referencePerDay The strait's 2019–2024 average ships a day.
 * @returns {'disrupted'|'reduced'|'normal'|'elevated'|'unknown'}
 */
export function statusOf(vsNormal, referencePerDay) {
  if (vsNormal === null || !(referencePerDay >= MIN_JUDGEABLE_PER_DAY))
    return 'unknown';
  if (vsNormal <= DISRUPTED_BELOW) return 'disrupted';
  if (vsNormal <= REDUCED_BELOW) return 'reduced';
  if (vsNormal >= ELEVATED_ABOVE) return 'elevated';
  return 'normal';
}

/**
 * Summarize one chokepoint's daily series against its reference.
 * @param {object} record A normalized chokepoint (`reference`, `series`).
 * @returns {object} `{ status, latestDate, latest, recent, trendBase, vsNormal, vsTrend, mix, days }`;
 *   numbers are null when the series is too short to give them.
 */
export function summarizeChokepoint(record) {
  const series = Array.isArray(record?.series) ? record.series : [];
  const referenceTotal = record?.reference?.total ?? null;
  const recentRows = series.slice(-RECENT_DAYS);
  const trendRows = series.slice(-(RECENT_DAYS + TREND_DAYS), -RECENT_DAYS);
  const recent =
    recentRows.length >= MIN_RECENT_DAYS
      ? mean(recentRows.map((row) => row.total))
      : null;
  const trendBase =
    recent !== null && trendRows.length >= MIN_TREND_DAYS
      ? mean(trendRows.map((row) => row.total))
      : null;
  const vsNormal = share(recent, referenceTotal);
  const latest = series.at(-1) ?? null;
  // Which vessel types make up the recent traffic, as daily means.
  const mix = {};
  for (const type of VESSEL_TYPES)
    mix[type] =
      recent === null ? null : round1(mean(recentRows.map((row) => row[type])));
  return {
    status: statusOf(vsNormal, referenceTotal),
    latestDate: latest?.date ?? null,
    latest: latest?.total ?? null,
    recent: round1(recent),
    trendBase: round1(trendBase),
    vsNormal,
    vsTrend: share(recent, trendBase),
    mix,
    days: series.length,
  };
}

/** The newest day any chokepoint reports, `YYYY-MM-DD`, or null. */
export function latestDataDate(records) {
  let newest = null;
  for (const record of records || []) {
    const date = record?.series?.at?.(-1)?.date;
    if (date && (!newest || date > newest)) newest = date;
  }
  return newest;
}

const BARS = '▁▂▃▄▅▆▇█';

/**
 * A text sparkline of daily totals, scaled from zero to the larger of the
 * series maximum and the reference, so a collapse reads as a collapse.
 * @param {Array<{total:number}>} series Oldest first.
 * @param {number|null} referencePerDay
 * @param {number} [width=30] Days shown, newest last.
 * @returns {string}
 */
export function sparkline(series, referencePerDay, width = 30) {
  const rows = (series || []).slice(-width);
  if (rows.length < 2) return '';
  const top = Math.max(referencePerDay || 0, ...rows.map((row) => row.total));
  if (!(top > 0)) return BARS[0].repeat(rows.length);
  return rows
    .map(
      (row) =>
        BARS[Math.min(BARS.length - 1, Math.round((row.total / top) * 7))],
    )
    .join('');
}

/** Marker size in pixels: 18 px for a quiet strait to 34 px for the busiest. */
export function markerPixelSize(referencePerDay) {
  const n = referencePerDay > 0 ? referencePerDay : 0;
  return Math.round(18 + Math.min(16, Math.sqrt(n)));
}

/** Most disrupted first, then by how busy the strait normally is. */
export function compareByDisruption(a, b) {
  const rank = (entry) => CHOKEPOINT_STATUSES.indexOf(entry.summary.status);
  return (
    rank(a) - rank(b) ||
    (a.summary.vsNormal ?? 0) - (b.summary.vsNormal ?? 0) ||
    (b.record.reference.total ?? 0) - (a.record.reference.total ?? 0)
  );
}
