import { formatDate, formatNumber, msg, t, tn } from '../../i18n/index.js';
import { spriteDrawOrder } from '../../data/spriteOrder.js';
import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf, findFrame } from '../../render/rendererOf.js';
import { inputFor } from '../../input/dispatcher.js';
import { createHorizonCull } from '../streetLevel/view.js';
import { STATUS_LABELS, describeChokepoint, labelLine } from './cards.js';
import { flowsFor } from './flows.js';
import {
  CHOKEPOINT_STATUSES,
  STATUS_COLORS,
  compareByDisruption,
  latestDataDate,
  markerPixelSize,
  summarizeChokepoint,
} from './model.js';
import { PORTWATCH_PAGE_URL } from './records.js';
export * from './records.js';
export * from './model.js';
export * from './flows.js';
export * from './cards.js';
export { createChokepointsSource } from './source.js';

export const CHOKEPOINTS_LAYER_ID = 'chokepoints';
export const CHOKEPOINTS_OVERLAY_SOURCE_ID = 'chokepoints';
const PICK_PREFIX = 'chokepoint:';
const MAX_CARD_LINES = 12;
// The eight major straits' names, plus the open card.
const HOST_OPTIONS = Object.freeze({
  cohortLimit: 12,
  collisionCapacity: 12,
  moving: false,
});

/**
 * A round marker in the status colour with a strait in the middle (two
 * shores and the channel between them), as an SVG data URL. Rasterized at
 * 136 px, four times the largest marker, so it stays sharp when large.
 * @param {string} color CSS colour.
 * @returns {string}
 */
export function chokepointMarkerImage(color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="136" height="136" viewBox="0 0 34 34">` +
    `<circle cx="17" cy="17" r="15" fill="#0b1420" stroke="${color}" stroke-width="3"/>` +
    `<path d="M9 8c4 3 4 6 4 9s0 6-4 9M25 8c-4 3-4 6-4 9s0 6 4 9" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<circle cx="17" cy="17" r="2.6" fill="${color}"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function formatDay(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!match) return '';
  return formatDate(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    { day: 'numeric', month: 'short', timeZone: 'UTC' },
  );
}

/**
 * Chokepoints: the world's maritime straits and canals from IMF PortWatch,
 * one marker each, coloured by how far ship transits are from normal, with a
 * card per strait.
 */
export function createChokepointsLayer({
  source,
  overlayHost = null,
  picking = null,
  pointer = null,
  openExternal = null,
  // The clicks on the globe: the application's input dispatcher.
  input = (viewer) => inputFor(viewer),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Chokepoints require a snapshot source');
  let _viewer = null;
  let _enabled = false;
  let _markers = null;
  let _request = null;
  /** id → `{ record, summary, position }`. */
  let _entries = new Map();
  let _pins = [];
  let _snapshot = null;
  let _lastError = null;
  let _clickHandler = null;
  let _rowListener = null;
  let _selectedId = null;
  let _selectedCardId = null;
  const _images = Object.fromEntries(
    CHOKEPOINT_STATUSES.map((status) => [
      status,
      chokepointMarkerImage(STATUS_COLORS[status]),
    ]),
  );

  const render = () => {
    if (_viewer) findFrame(_viewer)?.requestRender('chokepoints');
  };
  const notifyRow = () => _rowListener?.();
  const canSelect = () => overlayHost && picking;
  // Markers skip the depth test so terrain does not swallow them; the
  // horizon cull hides the far side of the planet instead.
  const _horizon = createHorizonCull({
    getViewer: () => _viewer,
    items: () => _pins,
    onChange: () => {
      _markers?.upsert(_pins.map((pin) => pin.item));
      render();
    },
  });

  function rebuild(records) {
    _entries = new Map(
      records.map((record) => [
        record.id,
        {
          record,
          summary: summarizeChokepoint(record),
          position: fromDegrees(record.lon, record.lat),
        },
      ]),
    );
    _pins = [];
    if (!_markers) return;
    // Within one set later markers draw on top: the most disrupted go last.
    const ordered = [..._entries.values()].sort(compareByDisruption).reverse();
    for (const entry of ordered) {
      const size = markerPixelSize(entry.record.reference.total);
      const pin = {
        item: {
          id: `${PICK_PREFIX}${entry.record.id}`,
          pos: entry.position,
          image: _images[entry.summary.status],
          size: [size, size],
          height: 'clampGround',
          disableDepthTest: Number.POSITIVE_INFINITY,
          show: true,
        },
        position: entry.position,
        get show() {
          return this.item.show;
        },
        set show(value) {
          if (this.item.show !== value)
            this.item = { ...this.item, show: value };
        },
      };
      _pins.push(pin);
    }
    _markers.set(_pins.map((pin) => pin.item));
    _horizon.update();
    if (_selectedId && !_entries.has(_selectedId)) _selectedId = null;
    publishOverlay();
    render();
  }

  // ---- labels and the selection card -------------------------------------
  /** A major strait's name and number, shown while its card is closed. */
  function labelEntry({ record, summary, position }) {
    const line = labelLine(summary);
    return {
      id: `chokepoint-label:${record.id}`,
      position,
      variant: 'label',
      title: line ? `${record.name} · ${line}` : record.name,
      accent: STATUS_COLORS[summary.status],
      priority: Math.round(record.reference.total),
      collisionGroup: 'ambient-label',
      paintLane: 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    };
  }

  function cardEntry({ record, summary, position }) {
    const { title, details } = describeChokepoint(record, summary);
    const card = {
      id: `chokepoint-card:${record.id}`,
      selected: true,
      interactive: Boolean(openExternal),
      title,
      details: details.slice(0, MAX_CARD_LINES),
      accent: STATUS_COLORS[summary.status],
      priority: Number.MAX_SAFE_INTEGER,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
      stateless: true,
      horizonCull: true,
      position,
    };
    if (card.interactive) {
      card.accessibilityLabel = t('Open PortWatch for {title}', {
        title: record.name,
      });
      card.activate = () => {
        openExternal(PORTWATCH_PAGE_URL);
        return true;
      };
    }
    return card;
  }

  function publishOverlay() {
    if (!overlayHost) return;
    const entries = [];
    for (const entry of _entries.values())
      if (flowsFor(entry.record.id)?.major && entry.record.id !== _selectedId)
        entries.push(labelEntry(entry));
    const selected = canSelect() ? _entries.get(_selectedId) : null;
    _selectedCardId = null;
    if (selected) {
      const card = cardEntry(selected);
      _selectedCardId = card.id;
      entries.push(card);
    }
    overlayHost.setEntries(
      CHOKEPOINTS_OVERLAY_SOURCE_ID,
      _enabled ? entries : [],
      HOST_OPTIONS,
    );
    overlayHost.setVisible?.(CHOKEPOINTS_OVERLAY_SOURCE_ID, _enabled);
  }

  function select(id) {
    _selectedId = id && _entries.has(id) ? id : null;
    publishOverlay();
    render();
  }

  function pickedId(pickId) {
    if (typeof pickId !== 'string' || !pickId.startsWith(PICK_PREFIX))
      return null;
    const id = pickId.slice(PICK_PREFIX.length);
    return _entries.has(id) ? id : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickHandler || !_viewer) return;
    picking.registerPickOwner?.(
      CHOKEPOINTS_LAYER_ID,
      (picked) => typeof picked === 'string' && picked.startsWith(PICK_PREFIX),
    );
    // A viewer with no renderer input bound takes no clicks.
    let clicks = null;
    try {
      clicks = input(_viewer) ?? null;
    } catch {
      clicks = null;
    }
    if (!clicks) return;
    _clickHandler = clicks.onClick((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const at = click.screenPosition;
      const cardHit = overlayHost.hitTest?.(at?.x, at?.y, {
        sourceId: CHOKEPOINTS_OVERLAY_SOURCE_ID,
      });
      if (cardHit && cardHit.entryId === _selectedCardId) {
        openExternal?.(PORTWATCH_PAGE_URL);
        return;
      }
      const picked = click.topHit;
      const pickId = picked ? (picking.resolvePickId(picked) ?? null) : null;
      const id = pickedId(pickId);
      if (id) return select(id);
      if (pickId && picking.isOwnedByOtherLayer(CHOKEPOINTS_LAYER_ID, pickId))
        return;
      if (_selectedId) select(null);
    });
  }

  function removeClickHandler() {
    _clickHandler?.();
    _clickHandler = null;
    picking?.unregisterPickOwner?.(CHOKEPOINTS_LAYER_ID);
  }

  function statusCounts() {
    const counts = Object.fromEntries(
      CHOKEPOINT_STATUSES.map((status) => [status, 0]),
    );
    for (const { summary } of _entries.values()) counts[summary.status]++;
    return counts;
  }

  const layer = {
    id: CHOKEPOINTS_LAYER_ID,
    name: 'Chokepoints',
    icon: '⚓',
    source: 'IMF PortWatch',
    // PortWatch publishes weekly; the proxy re-reads every 6 h. This only
    // notices a new snapshot.
    updateInterval: 60 * 60 * 1000,

    init(viewer) {
      if (_viewer) throw new Error('Chokepoints layer is already initialized');
      _viewer = viewer;
      _markers = drawOf(viewer).icons({
        id: 'chokepoints:markers',
        blend: 'translucent',
        drawOrder: spriteDrawOrder(CHOKEPOINTS_LAYER_ID),
        show: false,
      });
    },

    enable() {
      _enabled = true;
      if (_markers) _markers.show = true;
      installClickHandler();
      if (_pins.length) _horizon.update();
      publishOverlay();
      render();
    },

    disable() {
      _enabled = false;
      _request?.abort();
      _request = null;
      if (_markers) _markers.show = false;
      removeClickHandler();
      _selectedId = null;
      publishOverlay();
      _horizon.stop();
      render();
    },

    async update() {
      if (!_enabled || !_markers) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _snapshot = snapshot;
        // The positions and averages arrived, so the layer works; say what
        // is missing or old rather than failing.
        _lastError = !snapshot.daily.available
          ? msg('Daily counts unavailable; showing 2019–2024 averages')
          : snapshot.daily.stale
            ? msg('PortWatch unreachable; showing the last counts received')
            : null;
        rebuild(snapshot.chokepoints);
        notifyRow();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Chokepoints] Fetch error:', error);
        // What is on the map stays: the proxy already serves its last good
        // snapshot for as long as it is worth showing.
        _lastError = msg('Chokepoint data unavailable');
        notifyRow();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      layer.disable();
      if (_markers) {
        _markers.dispose();
        _markers = null;
      }
      _entries = new Map();
      _pins = [];
      _snapshot = null;
      _viewer = null;
      _rowListener = null;
    },

    /** `{ selected }`: the open card's chokepoint id, or null. */
    getParams() {
      return { selected: _selectedId };
    },

    setParams(params = {}) {
      if ('selected' in params) select(params.selected);
      return true;
    },

    setRowControlsListener(listener) {
      _rowListener = listener;
    },

    getRowControls() {
      const counts = statusCounts();
      const date = formatDay(latestDataDate(_snapshot?.chokepoints));
      return {
        chips: [],
        // The colours are a legend: traffic against the 2019–2024 average.
        legend: CHOKEPOINT_STATUSES.filter((status) => counts[status] > 0).map(
          (status) => ({
            label: t(STATUS_LABELS[status]),
            count: counts[status],
            color: STATUS_COLORS[status],
            blurb: tn(
              counts[status],
              '{count} chokepoint',
              '{count} chokepoints',
              { count: formatNumber(counts[status]) },
            ),
          }),
        ),
        info: date
          ? t('IMF PortWatch · counts to {date}', { date })
          : t('IMF PortWatch · 2019–2024 averages'),
        infoTitle: t(
          'Ship transits through each strait, estimated by IMF PortWatch from AIS signals and published weekly, about a week behind. Colour compares the latest 7-day average with the 2019–2024 average. Click a marker for its card.',
        ),
      };
    },

    getStats() {
      return {
        count: _entries.size,
        lastUpdate: _snapshot?.daily.fetchedAt ?? _snapshot?.fetchedAt ?? null,
        stale: _snapshot?.stale === true || _snapshot?.daily.stale === true,
        error: _lastError,
      };
    },

    /** Loaded chokepoints as plain JSON-safe objects, for tools and QA. */
    getAnalystRecords(maxCount = 100) {
      if (!_enabled) return [];
      return [..._entries.values()]
        .sort(compareByDisruption)
        .slice(0, maxCount)
        .map(({ record, summary }) => ({
          id: record.id,
          name: record.name,
          lat: record.lat,
          lon: record.lon,
          status: summary.status,
          shipsPerDay: summary.recent,
          normalPerDay: record.reference.total,
          vsNormal: summary.vsNormal,
          vsTrend: summary.vsTrend,
          dataDate: summary.latestDate,
        }));
    },
  };
  return layer;
}
