import { useId } from 'react';
import { pixelOrder } from './model';

export type DeviceMap = Record<string, { g?: string; off?: boolean }>;
export const devKey = (sample: string, substrate: string) => `${sample}|${substrate}`;

/**
 * Which devices (substrates) go into the plots, and their device group: a name for a modification ("control", "+ 5 % PEAI"…)
 * to compare in the statistics. Devices without a group are grouped by their batch or stack (or sample).
 */
export function DeviceTable({
  rows,
  value,
  onChange,
  groups,
  disabled,
  fallback,
}: {
  rows: { sample: string; substrate: string; best?: number }[];
  value: DeviceMap;
  onChange: (patch: DeviceMap) => void;
  groups: string[];
  disabled?: boolean;
  fallback: (sample: string) => string;
}) {
  const list = useId().replace(/:/g, '');
  const sorted = [...rows].sort((a, b) => a.sample.localeCompare(b.sample) || pixelOrder(a.substrate, b.substrate));
  const all = [
    ...new Set([
      ...groups,
      ...Object.values(value)
        .map((v) => v.g ?? '')
        .filter(Boolean),
    ]),
  ].sort();
  const set = (k: string, p: { g?: string; off?: boolean }) => onChange({ [k]: { ...value[k], ...p } });
  const samples = [...new Set(sorted.map((r) => r.sample))];
  return (
    <div className="scroll">
      <table className="tight devices">
        <thead>
          <tr>
            <th>Device</th>
            <th>In plots</th>
            <th>Device group</th>
            {rows.some((r) => r.best !== undefined) && <th>Best PCE</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const k = devKey(r.sample, r.substrate),
              v = value[k] ?? {};
            return (
              <tr key={k} className={v.off ? 'off' : ''}>
                <td>
                  {samples.length > 1 ? `${r.sample.replace(/_/g, ' ')} · ` : ''}substrate {r.substrate}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Substrate ${r.substrate} in the plots`}
                    checked={!v.off}
                    disabled={disabled}
                    onChange={(e) => set(k, { off: !e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    list={list}
                    aria-label={`Device group of substrate ${r.substrate}`}
                    placeholder={fallback(r.sample)}
                    value={v.g ?? ''}
                    disabled={disabled}
                    onChange={(e) => set(k, { g: e.target.value || undefined })}
                    style={{ width: 200 }}
                  />
                </td>
                {r.best !== undefined && <td>{r.best ? r.best.toFixed(2) + ' %' : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <datalist id={list}>
        {all.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <p className="mut small">
        Untick a device to leave it out of the box plots and statistics. Give devices the same group name to compare
        modifications (for example "control" and "+ PEAI"); empty uses the batch or stack.
      </p>
    </div>
  );
}
