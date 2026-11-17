/**
 * IMF PortWatch chokepoint records: the upstream requests, and the two shapes
 * every reader validates (the proxy reading ArcGIS, the page reading the
 * proxy). Pure functions: no network, no drawing.
 */

const SERVICES =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services';
export const PORTWATCH_PAGE_URL = 'https://portwatch.imf.org/';
/** The 28 chokepoints: position, 2019–2024 yearly vessel counts, top industries. */
export const PORTWATCH_REFERENCE_URL =
  `${SERVICES}/PortWatch_chokepoints_database/FeatureServer/0/query?` +
  new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
const DAILY_FIELDS = [
  'date',
  'portid',
  'n_total',
  'n_tanker',
  'n_container',
  'n_dry_bulk',
  'n_general_cargo',
  'n_roro',
  'capacity',
].join(',');
/** Days of daily counts kept per chokepoint: a 7-day mean and the 90 days before it. */
export const DAILY_WINDOW_DAYS = 97;
/** PortWatch publishes weekly, about a week behind: ask far enough back to fill the window. */
const DAILY_REQUEST_DAYS = DAILY_WINDOW_DAYS + 21;
const DAY_MS = 24 * 60 * 60 * 1000;
export const VESSEL_TYPES = Object.freeze([
  'tanker',
  'container',
  'dryBulk',
  'generalCargo',
  'roro',
]);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * One request for every chokepoint's daily transit counts since a date.
 * The window is chosen by date, never by `resultOffset`: the service answers
 * offset pages with "Token Required".
 * @param {number} now Epoch ms.
 * @returns {string}
 */
export function portwatchDailyUrl(now) {
  const since = isoDay(now - DAILY_REQUEST_DAYS * DAY_MS);
  return (
    `${SERVICES}/Daily_Chokepoints_Data/FeatureServer/0/query?` +
    new URLSearchParams({
      where: `date >= DATE '${since}'`,
      outFields: DAILY_FIELDS,
      orderByFields: 'date ASC',
      resultRecordCount: '5000',
      returnGeometry: 'false',
      f: 'json',
    })
  );
}

const ID = /^chokepoint\d{1,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (value, max = 100_000) =>
  Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const name = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 80 &&
  !/[\u0000-\u001f<>]/.test(value)
    ? value.trim()
    : null;

/** ArcGIS answers a refused query with HTTP 200 and an `error` object. */
export function arcgisError(payload) {
  const error = payload?.error;
  if (!error) return null;
  return error.code === 499 || error.code === 403
    ? 'token_required'
    : 'upstream_error';
}

/**
 * The reference table: one record per chokepoint with its position and its
 * 2019–2024 average transits per day by vessel type (the yearly count / 365).
 * @param {object} payload ArcGIS query answer.
 * @returns {Array<object>|null} Null when the answer is not the table.
 */
export function normalizeReference(payload) {
  if (!Array.isArray(payload?.features)) return null;
  const perDay = (yearly) => {
    const n = count(yearly, 10_000_000);
    return n === null ? null : Math.round((n / 365) * 10) / 10;
  };
  const records = [];
  const seen = new Set();
  for (const feature of payload.features) {
    const row = feature?.attributes;
    if (!row || !ID.test(row.portid) || seen.has(row.portid)) continue;
    const label = name(row.portname);
    const total = perDay(row.vessel_count_total);
    if (
      !label ||
      total === null ||
      !Number.isFinite(row.lat) ||
      Math.abs(row.lat) > 90 ||
      !Number.isFinite(row.lon) ||
      Math.abs(row.lon) > 180
    )
      continue;
    seen.add(row.portid);
    records.push({
      id: row.portid,
      name: label,
      lat: row.lat,
      lon: row.lon,
      reference: {
        total,
        tanker: perDay(row.vessel_count_tanker),
        container: perDay(row.vessel_count_container),
        dryBulk: perDay(row.vessel_count_dry_bulk),
        generalCargo: perDay(row.vessel_count_general_cargo),
        roro: perDay(row.vessel_count_RoRo),
      },
      industries: [row.industry_top1, row.industry_top2, row.industry_top3]
        .map(name)
        .filter(Boolean),
    });
  }
  return records.length ? records : null;
}

function dayOf(value) {
  if (typeof value === 'string') return DAY.test(value) ? value : null;
  // Other PortWatch tables give the date as epoch milliseconds.
  return Number.isFinite(value) && value > 0 ? isoDay(value) : null;
}

/**
 * Daily transit counts by chokepoint id, each oldest first and cut to the
 * newest `DAILY_WINDOW_DAYS` days.
 * @param {object} payload ArcGIS query answer.
 * @returns {Record<string, Array<object>>|null} Null when the answer has no usable row.
 */
export function normalizeDaily(payload) {
  if (!Array.isArray(payload?.features)) return null;
  const byId = new Map();
  for (const feature of payload.features) {
    const row = feature?.attributes;
    const date = dayOf(row?.date);
    const total = count(row?.n_total);
    if (!row || !ID.test(row.portid) || !date || total === null) continue;
    if (!byId.has(row.portid)) byId.set(row.portid, new Map());
    // One row per day: a repeated day keeps the later row.
    byId.get(row.portid).set(date, {
      date,
      total,
      tanker: count(row.n_tanker) ?? 0,
      container: count(row.n_container) ?? 0,
      dryBulk: count(row.n_dry_bulk) ?? 0,
      generalCargo: count(row.n_general_cargo) ?? 0,
      roro: count(row.n_roro) ?? 0,
      capacity: count(row.capacity, 1e12) ?? 0,
    });
  }
  if (!byId.size) return null;
  const out = {};
  for (const [id, days] of byId)
    out[id] = [...days.values()]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-DAILY_WINDOW_DAYS);
  return out;
}

function seriesRow(row) {
  if (!row || !DAY.test(row.date) || count(row.total) === null) return null;
  return {
    date: row.date,
    total: row.total,
    tanker: count(row.tanker) ?? 0,
    container: count(row.container) ?? 0,
    dryBulk: count(row.dryBulk) ?? 0,
    generalCargo: count(row.generalCargo) ?? 0,
    roro: count(row.roro) ?? 0,
    capacity: count(row.capacity, 1e12) ?? 0,
  };
}

/**
 * Validate the `/api/chokepoints` snapshot record by record.
 * @param {object} payload
 * @returns {object|null} Null when it is not a snapshot.
 */
export function normalizeChokepointSnapshot(payload) {
  if (!Array.isArray(payload?.chokepoints)) return null;
  const chokepoints = [];
  const seen = new Set();
  for (const raw of payload.chokepoints) {
    const label = name(raw?.name);
    const total = count(raw?.reference?.total);
    if (
      !raw ||
      !ID.test(raw.id) ||
      seen.has(raw.id) ||
      !label ||
      total === null ||
      !Number.isFinite(raw.lat) ||
      Math.abs(raw.lat) > 90 ||
      !Number.isFinite(raw.lon) ||
      Math.abs(raw.lon) > 180
    )
      continue;
    seen.add(raw.id);
    const reference = { total };
    for (const type of VESSEL_TYPES)
      reference[type] = count(raw.reference[type]);
    chokepoints.push({
      id: raw.id,
      name: label,
      lat: raw.lat,
      lon: raw.lon,
      reference,
      industries: (Array.isArray(raw.industries) ? raw.industries : [])
        .map(name)
        .filter(Boolean)
        .slice(0, 3),
      series: (Array.isArray(raw.series) ? raw.series : [])
        .map(seriesRow)
        .filter(Boolean)
        .slice(-DAILY_WINDOW_DAYS),
    });
  }
  if (!chokepoints.length) return null;
  const daily = payload.daily || {};
  return {
    fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : null,
    stale: payload.stale === true,
    daily: {
      available: daily.available === true,
      stale: daily.stale === true,
      fetchedAt: Number.isFinite(daily.fetchedAt) ? daily.fetchedAt : null,
      reason: typeof daily.reason === 'string' ? daily.reason : null,
    },
    chokepoints,
  };
}
