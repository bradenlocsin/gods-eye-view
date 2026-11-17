import test from 'node:test';
import assert from 'node:assert/strict';
import { describeChokepoint, formatShare, labelLine } from './cards.js';
import { summarizeChokepoint } from './model.js';

const row = (date, total) => ({
  date,
  total,
  tanker: 1,
  container: 1,
  dryBulk: 1,
  generalCargo: 0,
  roro: 0,
  capacity: 0,
});
const hormuz = (series) => ({
  id: 'chokepoint6',
  name: 'Strait of Hormuz',
  reference: { total: 89 },
  industries: ['Mineral Products'],
  series,
});
const week = Array.from({ length: 7 }, (_, i) => row(`2026-11-0${i + 2}`, 3));

test('shares carry a sign except at zero', () => {
  assert.equal(formatShare(-0.966), '−97%');
  assert.equal(formatShare(0.3), '+30%');
  assert.equal(formatShare(0.001), '0%');
  assert.equal(formatShare(null), '');
});

test('the card leads with the level and names what the strait carries', () => {
  const record = hormuz(week);
  const summary = summarizeChokepoint(record);
  const { title, details } = describeChokepoint(record, summary);
  assert.equal(title, 'Strait of Hormuz · Disrupted');
  assert.match(details[0], /^3 ships a day \(7-day average to .*2026\)$/);
  assert.equal(details[1], '−97% against the 2019–2024 average of 89 a day');
  assert.ok(details.some((line) => line.startsWith('Carries: About 20%')));
  assert.ok(details.some((line) => line.startsWith('Exposed: ')));
  assert.equal(labelLine(summary), '3 a day · −97%');
});

test('without daily counts the card gives the average and no status', () => {
  const record = hormuz([]);
  const summary = summarizeChokepoint(record);
  const { title, details } = describeChokepoint(record, summary);
  assert.equal(title, 'Strait of Hormuz');
  assert.equal(
    details[0],
    'Daily counts unavailable; the 2019–2024 average is 89 ships a day',
  );
  assert.equal(labelLine(summary), '');
});

test('a minor strait lists PortWatch top cargo instead of flows', () => {
  const record = {
    ...hormuz(week),
    id: 'chokepoint20',
    name: 'Makassar Strait',
  };
  const { details } = describeChokepoint(record, summarizeChokepoint(record));
  assert.ok(details.includes('Top cargo: Mineral Products'));
});
