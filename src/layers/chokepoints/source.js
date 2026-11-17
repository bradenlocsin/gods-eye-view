import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeChokepointSnapshot } from './records.js';

/** Same-origin source for the proxy's IMF PortWatch chokepoint snapshot. */
export function createChokepointsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/chokepoints', { signal });
      if (!response.ok)
        throw new Error(`Chokepoints unavailable (HTTP ${response.status})`);
      const payload = await readResponseJsonCapped(
        response,
        4 * 1024 * 1024,
        signal,
      );
      signal?.throwIfAborted();
      const snapshot = normalizeChokepointSnapshot(payload);
      if (!snapshot) throw new Error('Malformed chokepoints response');
      return snapshot;
    },
  };
}
