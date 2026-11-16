import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chokepointsProxy } from '../../server/providers/chokepoints.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 16);

const REFERENCE = {
  features: [
    {
      attributes: {
        portid: 'chokepoint6',
        portname: 'Strait of Hormuz',
        lat: 26.3,
        lon: 56.86,
        vessel_count_total: 32496,
        vessel_count_tanker: 19540,
      },
    },
    {
      attributes: {
        portid: 'chokepoint5',
        portname: 'Malacca Strait',
        lat: 1.52,
        lon: 102.67,
        vessel_count_total: 71451,
        vessel_count_tanker: 27469,
      },
    },
  ],
};
const DAILY = {
  features: ['2026-11-06', '2026-11-07', '2026-11-08'].map((date, i) => ({
    attributes: { date, portid: 'chokepoint6', n_total: 6 - i, n_tanker: 1 },
  })),
};
// What PortWatch answered when its daily table stopped being public.
const TOKEN_REQUIRED = { error: { code: 499, message: 'Token Required' } };

/** Upstream fake: each read answers 'ok', 'down' (HTTP 503) or 'refused' (ArcGIS error body). */
function fakeFetch(initial = {}) {
  const calls = [];
  const state = { reference: 'ok', daily: 'ok', ...initial };
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    const name = href.includes('/Daily_Chokepoints_Data/')
      ? 'daily'
      : href.includes('/PortWatch_chokepoints_database/')
        ? 'reference'
        : null;
    if (!name) return new Response('', { status: 404 });
    if (state[name] === 'down') return new Response('', { status: 503 });
    if (state[name] === 'refused') return Response.json(TOKEN_REQUIRED);
    return Response.json(name === 'daily' ? DAILY : REFERENCE);
  };
  const callsTo = (name) =>
    calls.filter((url) =>
      url.includes(
        name === 'daily'
          ? '/Daily_Chokepoints_Data/'
          : '/PortWatch_chokepoints_database/',
      ),
    ).length;
  return { fetchImpl, calls, state, callsTo };
}

function handlerOf(plugin) {
  let handler;
  plugin.configureServer({
    middlewares: { use: (_path, fn) => (handler = fn) },
  });
  return handler;
}

function request(handler, { method = 'GET', url = '/' } = {}) {
  return new Promise((resolve) => {
    const res = {
      destroyed: false,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({
          status: this.status,
          headers: this.headers,
          body: JSON.parse(body),
        });
      },
    };
    handler(
      { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      res,
    );
  });
}

/** A proxy on a settable clock, with no disk cache unless `cacheDir` is given. */
function proxy(upstream, { cacheDir = null } = {}) {
  const clock = { at: NOW };
  const handler = handlerOf(
    chokepointsProxy({
      fetchImpl: upstream.fetchImpl,
      now: () => clock.at,
      cacheDir,
    }),
  );
  return { handler, clock };
}

test('serves one cached snapshot joined from both PortWatch reads', async () => {
  const upstream = fakeFetch();
  const { handler } = proxy(upstream);
  const first = await request(handler);
  assert.equal(first.status, 200);
  assert.equal(first.body.daily.available, true);
  const [hormuz, malacca] = first.body.chokepoints;
  assert.equal(hormuz.reference.total, 89);
  assert.deepEqual(
    hormuz.series.map((row) => row.total),
    [6, 5, 4],
  );
  assert.deepEqual(malacca.series, [], 'no daily rows is an empty series');
  for (const url of upstream.calls)
    assert.match(
      url,
      /^https:\/\/services9\.arcgis\.com\/weJ1QsnbMYJlCHdG\/arcgis\/rest\/services\//,
    );
  await request(handler);
  assert.equal(upstream.calls.length, 2, 'second request is served from cache');
});

test('without daily counts the chokepoints still answer, and say why', async () => {
  const upstream = fakeFetch({ daily: 'refused' });
  const { handler, clock } = proxy(upstream);
  const { status, body } = await request(handler);
  assert.equal(status, 200);
  assert.equal(body.chokepoints.length, 2);
  assert.deepEqual(body.chokepoints[0].series, []);
  assert.deepEqual(body.daily, {
    available: false,
    stale: false,
    fetchedAt: null,
    reason: 'token_required',
  });
  // A failed read is not asked again for 15 minutes, then is.
  await request(handler);
  assert.equal(upstream.callsTo('daily'), 1);
  upstream.state.daily = 'ok';
  clock.at += 16 * 60 * 1000;
  const recovered = await request(handler);
  assert.equal(upstream.callsTo('daily'), 2);
  assert.equal(recovered.body.daily.available, true);
});

test('without the reference table there is nothing to place: 502', async () => {
  const { handler } = proxy(fakeFetch({ reference: 'down' }));
  const { status, body } = await request(handler);
  assert.equal(status, 502);
  assert.deepEqual(body, { error: 'chokepoints_unavailable' });
});

test('an outage serves the last daily counts as stale, for three weeks', async () => {
  const upstream = fakeFetch();
  const { handler, clock } = proxy(upstream);
  await request(handler);
  upstream.state.daily = 'refused';
  clock.at += 7 * HOUR;
  const stale = await request(handler);
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.equal(stale.body.daily.available, true);
  assert.equal(stale.body.daily.stale, true);
  assert.equal(stale.body.daily.reason, 'token_required');
  assert.equal(stale.body.chokepoints[0].series.length, 3);
  clock.at += 22 * DAY;
  const expired = await request(handler);
  assert.equal(expired.body.daily.available, false);
  assert.deepEqual(expired.body.chokepoints[0].series, []);
});

test('a restart serves the disk cache when PortWatch is unreachable', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'gev-chokepoints-'));
  try {
    await request(proxy(fakeFetch(), { cacheDir }).handler);
    const saved = JSON.parse(
      await readFile(path.join(cacheDir, 'chokepoints.json'), 'utf8'),
    );
    assert.equal(saved.version, 1);
    // A new process, a day later, with both reads failing.
    const down = fakeFetch({ reference: 'down', daily: 'down' });
    const restarted = proxy(down, { cacheDir });
    restarted.clock.at = NOW + 25 * HOUR;
    const { status, body } = await request(restarted.handler);
    assert.equal(status, 200);
    assert.equal(body.stale, true);
    assert.equal(body.chokepoints[0].series.length, 3);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('refuses other methods and paths', async () => {
  const { handler } = proxy(fakeFetch());
  assert.equal((await request(handler, { method: 'POST' })).status, 405);
  assert.equal((await request(handler, { url: '/other' })).status, 404);
});
