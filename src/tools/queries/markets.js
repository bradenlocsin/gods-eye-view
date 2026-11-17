/** Market-facing queries: maritime chokepoints. */

import { suggestView } from '../views.js';
import { defineTool, ToolError } from '../catalog.js';
import { AREA_SCHEMA, areaContains, resolveArea } from '../area.js';
import { countNoun } from '../results.js';
import { flowsFor } from '../../layers/chokepoints/flows.js';
import {
  CHOKEPOINT_STATUSES,
  compareByDisruption,
  latestDataDate,
  summarizeChokepoint,
} from '../../layers/chokepoints/model.js';

const percent = (share) =>
  share === null ? null : Math.round(share * 1000) / 10;

export const getChokepoints = defineTool({
  name: 'get_chokepoints',
  title: 'Maritime chokepoints',
  description:
    'Ship traffic through the 28 maritime chokepoints IMF PortWatch tracks ' +
    '(Hormuz, Suez, Bab el-Mandeb, Malacca, Panama, Bosporus, Taiwan Strait ' +
    'and others), most disrupted first: the latest 7-day average of cargo ' +
    'ships and tankers a day, how far that is from the 2019–2024 average and ' +
    'from the previous 90 days, the vessel mix, and for the major straits ' +
    'what they carry and who is exposed. Counts are PortWatch estimates from ' +
    'AIS signals, published weekly and about a week behind (see data_date); ' +
    'when the daily counts are unavailable only the long-run averages are ' +
    'returned. Optionally limited to an area or a status.',
  inputSchema: {
    type: 'object',
    properties: {
      area: AREA_SCHEMA,
      status: {
        type: 'string',
        enum: [...CHOKEPOINT_STATUSES],
        description:
          'Keep one status: disrupted (50% or more below the 2019–2024 ' +
          'average), reduced (20–50% below), normal, elevated (20% or more ' +
          'above) or unknown.',
      },
    },
    additionalProperties: false,
  },
  requires: ['chokepoints'],
  async run(args, { services, signal }) {
    const area = args.area
      ? await resolveArea(args.area, { services, signal })
      : null;
    let snapshot;
    try {
      snapshot = await services.chokepoints.getSnapshot({ signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ToolError(
        'unavailable',
        'Chokepoint data is unavailable right now',
      );
    }
    const entries = snapshot.chokepoints
      .filter((record) => !area || areaContains(area, record))
      .map((record) => ({ record, summary: summarizeChokepoint(record) }))
      .filter(({ summary }) => !args.status || summary.status === args.status)
      .sort(compareByDisruption);
    const dataDate = latestDataDate(snapshot.chokepoints);
    const disrupted = entries.filter(
      ({ summary }) => summary.status === 'disrupted',
    );
    const where = area ? ` in ${area.label}` : '';
    const worst = disrupted
      .slice(0, 3)
      .map(
        ({ record, summary }) =>
          `${record.name} ${Math.round(summary.vsNormal * 100)}%`,
      )
      .join(', ');
    const summary = !snapshot.daily.available
      ? `${countNoun(entries.length, 'chokepoint')}${where}; daily transit counts are unavailable from IMF PortWatch right now, so only 2019–2024 averages are given.`
      : `${countNoun(entries.length, 'chokepoint')}${where}, counts to ${dataDate}${snapshot.daily.stale ? ' (PortWatch unreachable; last counts received)' : ''}: ${disrupted.length} disrupted${worst ? ` (${worst} against the 2019–2024 average)` : ''}.`;
    return {
      summary,
      data: {
        view: suggestView(
          services,
          area
            ? { area, layers: ['chokepoints'] }
            : {
                point: { lat: 20, lon: 60 },
                altitudeM: 15_000_000,
                layers: ['chokepoints'],
              },
        ),
        source: 'IMF PortWatch (estimates from ship AIS signals)',
        data_date: dataDate,
        daily_counts_available: snapshot.daily.available,
        stale: snapshot.stale || snapshot.daily.stale,
        count: entries.length,
        rows: entries.map(({ record, summary: s }) => {
          const flows = flowsFor(record.id);
          return {
            id: record.id,
            name: record.name,
            lat: record.lat,
            lon: record.lon,
            status: s.status,
            ships_per_day_7d: s.recent,
            normal_ships_per_day: record.reference.total,
            vs_normal_percent: percent(s.vsNormal),
            vs_previous_90d_percent: percent(s.vsTrend),
            latest_day: s.latestDate,
            latest_day_ships: s.latest,
            mix_per_day: s.recent === null ? null : s.mix,
            carries: flows?.carries ?? null,
            commodities: flows?.commodities ?? null,
            exposed: flows?.exposed ?? null,
            top_industries: record.industries,
          };
        }),
      },
    };
  },
});
