import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareByDisruption,
  latestDataDate,
  markerPixelSize,
  sparkline,
  statusOf,
  summarizeChokepoint,
} from './model.js';

/** `days` daily rows ending 2026-11-08, each with `total` ships. */
function series(days, total, { tanker = 0 } = {}) {
  const end = Date.UTC(2026, 10, 8);
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    total: typeof total === 'function' ? total(i) : total,
    tanker,
    container: 0,
    dryBulk: 0,
    generalCargo: 0,
    roro: 0,
    capacity: 0,
  }));
}
const record = (total, rows) => ({
  id: 'chokepoint6',
  name: 'Strait of Hormuz',
  reference: { total },
  series: rows,
});

test('status follows the level against the 2019–2024 average', () => {
  assert.equal(statusOf(-0.96, 89), 'disrupted');
  assert.equal(statusOf(-0.5, 89), 'disrupted');
  assert.equal(statusOf(-0.3, 89), 'reduced');
  assert.equal(statusOf(-0.1, 89), 'normal');
  assert.equal(statusOf(0.19, 89), 'normal');
  assert.equal(statusOf(0.3, 59), 'elevated');
  assert.equal(statusOf(null, 89), 'unknown');
});

test('a strait with too few ships in a normal year gets no status', () => {
  // Bering Strait: 0.8 ships a day. Two ships is +150 % and means nothing.
  assert.equal(statusOf(1.5, 0.8), 'unknown');
  assert.equal(statusOf(-1, 3.9), 'unknown');
});

test('a long closure stays disrupted even though its trend is flat', () => {
  // Hormuz, November 2026: about 3 ships a day for the whole window against
  // an average of 89. Measured against the last 90 days alone this is "no
  // change"; the status must come from the long-run level.
  const summary = summarizeChokepoint(record(89, series(97, 3, { tanker: 1 })));
  assert.equal(summary.status, 'disrupted');
  assert.equal(summary.recent, 3);
  assert.ok(Math.abs(summary.vsNormal - (3 / 89 - 1)) < 1e-9);
  assert.equal(summary.vsTrend, 0);
  assert.equal(summary.latestDate, '2026-11-08');
  assert.equal(summary.mix.tanker, 1);
});

test('the trend compares the last 7 days with the 90 before them', () => {
  // 90 days at 100, then a week at 50.
  const rows = series(97, (i) => (i < 90 ? 100 : 50));
  const summary = summarizeChokepoint(record(100, rows));
  assert.equal(summary.recent, 50);
  assert.equal(summary.trendBase, 100);
  assert.equal(summary.vsTrend, -0.5);
  assert.equal(summary.status, 'disrupted');
});

test('too few days give no number rather than a wrong one', () => {
  const none = summarizeChokepoint(record(89, []));
  assert.equal(none.status, 'unknown');
  assert.equal(none.recent, null);
  assert.equal(none.latestDate, null);
  // Three reported days are not a 7-day mean.
  assert.equal(summarizeChokepoint(record(89, series(3, 3))).recent, null);
  // A week of data has a level but no 90-day trend yet.
  const week = summarizeChokepoint(record(89, series(7, 80)));
  assert.equal(week.status, 'normal');
  assert.equal(week.vsTrend, null);
});

test('sparkline scales to the reference so a collapse looks like one', () => {
  assert.equal(sparkline(series(5, 3), 89), '▁▁▁▁▁');
  assert.equal(sparkline(series(3, 89), 89), '███');
  assert.equal(sparkline(series(1, 5), 89), '');
  assert.equal(sparkline(series(40, 10), 10).length, 30);
});

test('markers grow with normal traffic, within bounds', () => {
  assert.equal(markerPixelSize(0), 18);
  assert.equal(markerPixelSize(89), 27);
  assert.equal(markerPixelSize(10_000), 34);
});

test('ordering puts the most disrupted first; latest date is the newest', () => {
  const entry = (name, total, rows) => {
    const r = { ...record(total, rows), name };
    return { record: r, summary: summarizeChokepoint(r) };
  };
  const hormuz = entry('Hormuz', 89, series(97, 3));
  const malacca = entry('Malacca', 196, series(97, 231));
  const cape = entry('Cape', 59, series(97, 77));
  const sorted = [malacca, cape, hormuz].sort(compareByDisruption);
  assert.deepEqual(
    sorted.map((e) => e.record.name),
    ['Hormuz', 'Malacca', 'Cape'],
  );
  assert.equal(latestDataDate([hormuz.record, { series: [] }]), '2026-11-08');
  assert.equal(latestDataDate([]), null);
});
