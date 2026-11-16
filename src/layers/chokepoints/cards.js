import { formatDate, formatNumber, msg, t } from '../../i18n/index.js';
import { flowsFor } from './flows.js';
import { sparkline } from './model.js';

export const STATUS_LABELS = Object.freeze({
  disrupted: msg('Disrupted'),
  reduced: msg('Below normal'),
  normal: msg('Normal traffic'),
  elevated: msg('Above normal'),
  unknown: msg('No status'),
});

/** `−96%`, `+30%` or `0%`, with a real minus sign; empty for no value. */
export function formatShare(value) {
  if (!Number.isFinite(value)) return '';
  const percent = Math.round(value * 100);
  const digits = formatNumber(Math.abs(percent));
  // Zero carries no sign: "+0%" reads as a rise.
  return `${percent < 0 ? '−' : percent > 0 ? '+' : ''}${digits}%`;
}

function ships(value) {
  return formatNumber(value, { maximumFractionDigits: value < 10 ? 1 : 0 });
}

function formatDay(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!match) return '';
  return formatDate(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
  );
}

/** The short line under a major strait's name: `3 a day · −96%`. */
export function labelLine(summary) {
  if (summary.recent === null) return '';
  return [
    t('{count} a day', { count: ships(summary.recent) }),
    formatShare(summary.vsNormal),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Title and detail lines for one chokepoint card: the level first (the
 * number and how far it is from normal), then the trend, the vessel mix,
 * what the strait carries and who is exposed, and last where the number
 * comes from and how old it is.
 * @param {object} record A normalized chokepoint.
 * @param {object} summary Its `summarizeChokepoint` result.
 * @returns {{title: string, details: string[]}}
 */
export function describeChokepoint(record, summary) {
  const details = [];
  const reference = record.reference.total;
  if (summary.recent === null) {
    details.push(
      t(
        'Daily counts unavailable; the 2019–2024 average is {count} ships a day',
        { count: ships(reference) },
      ),
    );
  } else {
    details.push(
      t('{count} ships a day (7-day average to {date})', {
        count: ships(summary.recent),
        date: formatDay(summary.latestDate),
      }),
    );
    details.push(
      summary.status === 'unknown'
        ? t('Too few ships in a normal year to judge')
        : t('{share} against the 2019–2024 average of {count} a day', {
            share: formatShare(summary.vsNormal),
            count: ships(reference),
          }),
    );
    if (summary.vsTrend !== null)
      details.push(
        t('{share} against the 90 days before', {
          share: formatShare(summary.vsTrend),
        }),
      );
    const { mix } = summary;
    details.push(
      t(
        'Tankers {tanker} · Containers {container} · Bulk {bulk} · Other {other}',
        {
          tanker: ships(mix.tanker),
          container: ships(mix.container),
          bulk: ships(mix.dryBulk),
          other: ships(mix.generalCargo + mix.roro),
        },
      ),
    );
    const bars = sparkline(record.series, reference);
    if (bars) details.push(t('Last 30 days: {bars}', { bars }));
  }
  const flows = flowsFor(record.id);
  if (flows) {
    details.push(t('Carries: {value}', { value: flows.carries }));
    details.push(t('Exposed: {value}', { value: flows.exposed }));
  } else if (record.industries.length) {
    details.push(
      t('Top cargo: {value}', { value: record.industries.join(', ') }),
    );
  }
  details.push(t('Source: IMF PortWatch, estimated from ship AIS signals'));
  details.push(t('Click the card to open PortWatch ↗'));
  const status = t(STATUS_LABELS[summary.status]);
  return {
    title:
      summary.status === 'unknown' ? record.name : `${record.name} · ${status}`,
    details,
  };
}
