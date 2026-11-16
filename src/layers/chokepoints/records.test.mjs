import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_WINDOW_DAYS,
  arcgisError,
  normalizeChokepointSnapshot,
  normalizeDaily,
  normalizeReference,
  portwatchDailyUrl,
} from './records.js';

// Rows as IMF PortWatch answered on 2026-11-16.
const REFERENCE = {
  features: [
    {
      attributes: {
        portid: 'chokepoint6',
        portname: 'Strait of Hormuz',
        lat: 26.29685349,
        lon: 56.85984844,
        vessel_count_total: 32496,
        vessel_count_tanker: 19540,
        vessel_count_container: 5274,
        vessel_count_dry_bulk: 5414,
        vessel_count_general_cargo: 1412,
        vessel_count_RoRo: 856,
        industry_top1: 'Mineral Products',
        industry_top2: 'Chemical & Allied Industries',
        industry_top3: null,
      },
    },
    { attributes: { portid: 'port12', portname: 'Not a chokepoint' } },
  ],
};
const day = (date, total, extra = {}) => ({
  attributes: {
    date,
    portid: 'chokepoint6',
    n_total: total,
    n_tanker: 1,
    n_container: 0,
    n_dry_bulk: 1,
    n_general_cargo: 1,
    n_roro: 0,
    capacity: 792,
    ...extra,
  },
});

test('reference rows become per-day averages with a position', () => {
  const [hormuz, ...rest] = normalizeReference(REFERENCE);
  assert.equal(rest.length, 0, 'rows that are not chokepoints are dropped');
  assert.equal(hormuz.id, 'chokepoint6');
  assert.equal(hormuz.reference.total, 89); // 32,496 a year / 365
  assert.equal(hormuz.reference.tanker, 53.5);
  assert.deepEqual(hormuz.industries, [
    'Mineral Products',
    'Chemical & Allied Industries',
  ]);
  assert.equal(normalizeReference({ features: [] }), null);
  assert.equal(normalizeReference({ error: { code: 499 } }), null);
});

test('daily rows group by chokepoint, oldest first, one row a day', () => {
  const series = normalizeDaily({
    features: [
      day('2026-11-08', 3),
      day('2026-11-06', 6),
      day('2026-11-07', 2),
      day('2026-11-07', 4), // a repeated day keeps the later row
      day(Date.UTC(2026, 10, 5), 9), // other tables give epoch milliseconds
      day('2026-11-04', -1), // not a count
      day('yesterday', 5),
      day('2026-11-08', 7, { portid: 'port1' }),
    ],
  });
  assert.deepEqual(Object.keys(series), ['chokepoint6']);
  assert.deepEqual(
    series.chokepoint6.map((row) => [row.date, row.total]),
    [
      ['2026-11-05', 9],
      ['2026-11-06', 6],
      ['2026-11-07', 4],
      ['2026-11-08', 3],
    ],
  );
  assert.equal(series.chokepoint6[0].capacity, 792);
  assert.equal(normalizeDaily({ features: [] }), null);
});

test('daily series are cut to the newest window', () => {
  const start = Date.UTC(2026, 0, 1);
  const features = Array.from({ length: 150 }, (_, i) =>
    day(new Date(start + i * 86_400_000).toISOString().slice(0, 10), i),
  );
  const { chokepoint6 } = normalizeDaily({ features });
  assert.equal(chokepoint6.length, DAILY_WINDOW_DAYS);
  assert.equal(chokepoint6.at(-1).total, 149);
});

test('the daily request selects by date and never pages by offset', () => {
  const url = new URL(portwatchDailyUrl(Date.UTC(2026, 10, 16)));
  assert.equal(url.hostname, 'services9.arcgis.com');
  assert.match(
    url.pathname,
    /\/Daily_Chokepoints_Data\/FeatureServer\/0\/query$/,
  );
  assert.equal(url.searchParams.get('where'), "date >= DATE '2026-07-21'");
  assert.equal(url.searchParams.has('resultOffset'), false);
});

test('an ArcGIS refusal is read from the body', () => {
  assert.equal(arcgisError({ error: { code: 499 } }), 'token_required');
  assert.equal(arcgisError({ error: { code: 400 } }), 'upstream_error');
  assert.equal(arcgisError({ features: [] }), null);
});

test('the page validates the proxy snapshot record by record', () => {
  const [hormuz] = normalizeReference(REFERENCE);
  const snapshot = normalizeChokepointSnapshot({
    fetchedAt: 1,
    daily: { available: true, fetchedAt: 2 },
    chokepoints: [
      {
        ...hormuz,
        series: normalizeDaily({ features: [day('2026-11-08', 3)] })
          .chokepoint6,
      },
      { ...hormuz }, // the same id twice
      {
        id: 'chokepoint7',
        name: '<b>x</b>',
        lat: 0,
        lon: 0,
        reference: { total: 1 },
      },
      { id: 'chokepoint8', name: 'No position', reference: { total: 1 } },
    ],
  });
  assert.equal(snapshot.chokepoints.length, 1);
  assert.equal(snapshot.chokepoints[0].series[0].total, 3);
  assert.deepEqual(snapshot.daily, {
    available: true,
    stale: false,
    fetchedAt: 2,
    reason: null,
  });
  assert.equal(normalizeChokepointSnapshot({ chokepoints: [] }), null);
  assert.equal(normalizeChokepointSnapshot({}), null);
});
