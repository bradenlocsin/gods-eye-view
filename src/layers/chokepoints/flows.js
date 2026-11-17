/**
 * What flows through the major chokepoints, and so what a disruption there
 * touches. Hand-written from public summaries; every figure is approximate
 * and dated, and the card says so. Keyed by PortWatch chokepoint id.
 *
 * Sources:
 * - U.S. EIA, "World Oil Transit Chokepoints" (2023 volumes; updated 2024)
 *   https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints
 * - Bloomberg ship-tracking analysis, 2022 (Taiwan Strait container fleet share)
 * - UNCTAD, Review of Maritime Transport 2024 (Suez, Panama, Red Sea rerouting)
 *   https://unctad.org/publication/review-maritime-transport-2024
 *
 * This is reference data, like a feed's own text: it is shown as written, in
 * English, in every language (as PortWatch's industry names are). Marking
 * these sentences for translation would add 16 entries to all 13 catalogs.
 */

export const CHOKEPOINT_FLOWS = Object.freeze({
  // Strait of Hormuz
  chokepoint6: {
    major: true,
    carries: 'About 20% of world oil and 20% of LNG trade',
    commodities: ['crude oil', 'LNG', 'refined products', 'fertilizer'],
    exposed: 'Gulf exporters; importers China, India, Japan, South Korea',
  },
  // Bab el-Mandeb Strait
  chokepoint4: {
    major: true,
    carries:
      'Red Sea gate to Suez: about 12% of seaborne oil before the 2023 attacks',
    commodities: ['crude oil', 'refined products', 'LNG', 'containers'],
    exposed: 'Europe–Asia trade; Egypt (Suez revenue); container lines',
  },
  // Suez Canal
  chokepoint1: {
    major: true,
    carries: 'About 12% of world trade and 30% of container traffic',
    commodities: ['containers', 'crude oil', 'refined products', 'grain'],
    exposed: 'Europe–Asia trade; Egypt; freight rates and insurers',
  },
  // Malacca Strait
  chokepoint5: {
    major: true,
    carries: 'Busiest oil chokepoint: about 23 million barrels a day',
    commodities: ['crude oil', 'LNG', 'containers', 'coal', 'palm oil'],
    exposed: 'China, Japan, South Korea energy imports; Singapore',
  },
  // Panama Canal
  chokepoint2: {
    major: true,
    carries: 'About 5% of world trade; most US Gulf–Asia LPG and grain',
    commodities: ['containers', 'LPG', 'LNG', 'grain', 'refined products'],
    exposed: 'US exporters; Asia buyers; Chile, Peru, Ecuador',
  },
  // Bosporus Strait
  chokepoint3: {
    major: true,
    carries: 'Black Sea outlet: about 3 million barrels of oil a day',
    commodities: ['crude oil', 'wheat', 'corn', 'sunflower oil', 'steel'],
    exposed: 'Russia, Kazakhstan, Ukraine exports; grain importers',
  },
  // Taiwan Strait
  chokepoint11: {
    major: true,
    carries: 'Close to half of the world container fleet passed here in 2022',
    commodities: ['containers', 'semiconductors', 'crude oil', 'LNG'],
    exposed: 'China, Taiwan, Japan, South Korea; global electronics',
  },
  // Cape of Good Hope
  chokepoint7: {
    major: true,
    carries: 'The detour when the Red Sea or Suez is unsafe',
    commodities: ['crude oil', 'containers', 'coal', 'iron ore'],
    exposed: 'Longer Europe–Asia voyages: freight rates, fuel demand',
  },
});

/** The flow record for a chokepoint id, or null for the minor straits. */
export function flowsFor(id) {
  return CHOKEPOINT_FLOWS[id] ?? null;
}
