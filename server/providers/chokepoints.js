import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PORTWATCH_REFERENCE_URL,
  arcgisError,
  normalizeDaily,
  normalizeReference,
  portwatchDailyUrl,
} from '../../src/layers/chokepoints/records.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';

const MIB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** After a source fails, it is not asked again for this long. */
const RETRY_MS = 15 * 60 * 1000;
const USER_AGENT =
  "God's Eye View chokepoints layer (https://github.com/bilawalsidhu/gods-eye-view)";
const CACHE_FILE = 'chokepoints.json';
const CACHE_VERSION = 1;

/**
 * The two PortWatch reads, each on its own clock. Daily counts are published
 * weekly, so they stay worth showing (marked stale) for three weeks; the
 * reference table changes about once a year.
 */
const SOURCE_POLICY = Object.freeze({
  reference: { refreshMs: DAY, staleMaxMs: 60 * DAY },
  daily: { refreshMs: 6 * HOUR, staleMaxMs: 21 * DAY },
});

/**
 * IMF PortWatch chokepoint snapshot for dev and preview, keyless.
 *
 *   GET /api/chokepoints → { fetchedAt, stale, daily, chokepoints: [...] }
 *
 * Each chokepoint carries its position, its 2019–2024 average transits a day
 * (`reference`) and up to 97 days of daily counts (`series`). The two reads
 * fail apart: without the daily counts the snapshot still answers, with
 * `daily.available: false` and empty series; without the reference table
 * there is nothing to place, and the route answers 502.
 *
 * The last good answer of each read is kept in memory and in
 * `.gev-cache/chokepoints.json`, so a restart or a PortWatch outage serves
 * it, marked stale, instead of an empty map.
 *
 * `loaders` replaces a read (`{ reference(), daily() }`, each resolving to
 * normalized records): the seam for another transit-count provider.
 */
export function chokepointsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
  loaders = {},
} = {}) {
  const sources = {
    reference: {
      load: loaders.reference ?? fetchReference,
      good: null,
      retryAt: 0,
      reason: null,
    },
    daily: {
      load: loaders.daily ?? fetchDaily,
      good: null,
      retryAt: 0,
      reason: null,
    },
  };
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 600 });
  let restored = null;

  async function upstreamJson(url) {
    const signal = AbortSignal.timeout(45_000);
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('upstream_unavailable');
    }
    const payload = await readResponseJsonCapped(response, 8 * MIB, signal);
    // ArcGIS refuses a query with HTTP 200 and an error body.
    const refused = arcgisError(payload);
    if (refused) throw new Error(refused);
    return payload;
  }

  async function fetchReference() {
    const records = normalizeReference(
      await upstreamJson(PORTWATCH_REFERENCE_URL),
    );
    if (!records) throw new Error('invalid_reference');
    return records;
  }

  async function fetchDaily() {
    const payload = await upstreamJson(portwatchDailyUrl(now()));
    // A cut-off answer would drop the newest days, the ones that matter.
    if (payload.exceededTransferLimit) throw new Error('truncated_daily');
    const series = normalizeDaily(payload);
    if (!series) throw new Error('invalid_daily');
    return series;
  }

  const fresh = (name, at) =>
    sources[name].good !== null &&
    at - sources[name].good.fetchedAt < SOURCE_POLICY[name].refreshMs;
  const usable = (name, at) =>
    sources[name].good !== null &&
    at - sources[name].good.fetchedAt <= SOURCE_POLICY[name].staleMaxMs;
  const due = (name, at) => !fresh(name, at) && at >= sources[name].retryAt;

  /** Read the disk cache once, before the first refresh. */
  function restore() {
    if (!cacheDir) return Promise.resolve();
    restored ??= readFile(path.join(cacheDir, CACHE_FILE), 'utf8')
      .then((text) => {
        const saved = JSON.parse(text);
        if (saved?.version !== CACHE_VERSION) return;
        for (const name of Object.keys(sources)) {
          const good = saved[name];
          if (good && Number.isFinite(good.fetchedAt) && good.value)
            sources[name].good = good;
        }
      })
      // No file yet, or an unreadable one: start empty.
      .catch(() => {});
    return restored;
  }

  async function persist() {
    if (!cacheDir) return;
    try {
      await mkdir(cacheDir, { recursive: true });
      const file = path.join(cacheDir, CACHE_FILE);
      const body = JSON.stringify({
        version: CACHE_VERSION,
        reference: sources.reference.good,
        daily: sources.daily.good,
      });
      // Written beside and renamed, so a crash never leaves half a file.
      await writeFile(`${file}.tmp`, body);
      await rename(`${file}.tmp`, file);
    } catch (error) {
      console.warn('[chokepoints] cache not written:', error?.message);
    }
  }

  /** Refresh the reads that are due; a failure keeps the last good answer. */
  async function refresh() {
    const at = now();
    const names = Object.keys(sources).filter((name) => due(name, at));
    const results = await Promise.allSettled(
      names.map((name) => sources[name].load()),
    );
    const done = now();
    let changed = false;
    results.forEach((result, i) => {
      const state = sources[names[i]];
      if (result.status === 'fulfilled') {
        state.good = { value: result.value, fetchedAt: done };
        state.reason = null;
        changed = true;
      } else {
        state.retryAt = done + RETRY_MS;
        state.reason = result.reason?.message || 'upstream_unavailable';
        console.warn(`[chokepoints] ${names[i]} read failed: ${state.reason}`);
      }
    });
    if (changed) await persist();
  }

  function compose(at) {
    if (!usable('reference', at)) return null;
    const dailyUsable = usable('daily', at);
    const series = dailyUsable ? sources.daily.good.value : {};
    const dailyStale = dailyUsable && !fresh('daily', at);
    const stale = !fresh('reference', at) || dailyStale;
    return {
      stale,
      value: {
        schemaVersion: 1,
        source: 'IMF PortWatch',
        fetchedAt: sources.reference.good.fetchedAt,
        daily: {
          available: dailyUsable,
          stale: dailyStale,
          fetchedAt: dailyUsable ? sources.daily.good.fetchedAt : null,
          reason: dailyUsable && !dailyStale ? null : sources.daily.reason,
        },
        chokepoints: sources.reference.good.value.map((record) => ({
          ...record,
          series: series[record.id] ?? [],
        })),
      },
    };
  }

  async function acquire() {
    await restore();
    const at = now();
    if (Object.keys(sources).some((name) => due(name, at)))
      await coalesceProxyRequest(inFlight, 'refresh', refresh).promise;
    const composed = compose(now());
    if (!composed) throw new Error('chokepoints_unavailable');
    return composed;
  }

  async function handler(req, res) {
    const json = (status, value, stale = false) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...(stale ? { 'X-Data-Stale': 'true' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const route = (req.url || '/').split('?')[0];
    if (route !== '/' && route !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const { value, stale } = await acquire();
      json(200, stale ? { ...value, stale: true } : value, stale);
    } catch {
      json(502, { error: 'chokepoints_unavailable' });
    }
  }

  return {
    name: 'chokepoints',
    configureServer({ middlewares }) {
      middlewares.use('/api/chokepoints', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/chokepoints', handler);
    },
  };
}
