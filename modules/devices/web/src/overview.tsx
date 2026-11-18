import { fmtDate } from '@web/lib/ui';
import { More, Stats, plural, pct } from '@web/views/overview/parts';
import { PresentationExport, useBestCell } from './views/overview/export';
import type { OverviewPart, PersonHead, PersonProps, SumProps } from '@web/modules/types';
import { JvFigure } from './iv/JvFigure';
import { fmt } from './iv/model';
import LineChart from './LineChart';

/**
 * Electronic Devices in the Overview (0.42; reworked in 0.60). Lab: the period's numbers, its best device with its J–V curve, the
 * best devices, batches and measurements. Students: what each person did. My progress: the best device of each batch over time,
 * their batches and measurements, and the slide (devices over time, the best device's J–V curve, the box plot of its batch).
 */
type Lab = {
  batchesStarted: number;
  batchesDone: number;
  running: number;
  measurements: number;
  devices: number;
  best: number | null;
  median: number | null;
};
type Top = {
  pce: number;
  set: string;
  setId: number;
  sample: string;
  substrate: string;
  owner: string;
  system: string;
};
type Dev = {
  lab: Lab;
  top: Top[];
  record: (Top & { before: number | null }) | null;
  finished: { id: number; code: string; name: string; owner: string }[];
  started: { id: number; code: string; name: string; owner: string; status: string }[];
  measurements: { id: number; name: string; owner: string; devices: number; best: number }[];
};
type PersonM = Lab & { bestEver: number | null };
type Point = {
  kind: 'batch' | 'set';
  id: number;
  name: string;
  day: string;
  devices: number;
  best: number;
  median: number | null;
};
type PersonPage = {
  progress: {
    id: number;
    name: string;
    day: string;
    system: string;
    devices: number;
    best: number | null;
    median: number | null;
  }[];
  batches: { id: number; code: string; name: string; status: string; created_at: string; best: number | null }[];
  points: Point[];
  best: {
    pce: number;
    setId: number;
    set: string;
    sample: string;
    substrate: string;
    day: string;
    batchId: number | null;
  } | null;
};

const STATUS: Record<string, string> = { planned: 'Planned', running: 'Running', done: 'Done' };

/** The Lab page: the period's best device with its J–V curve, then the period's lists. */
function LabPart({ m, d, open }: SumProps<Dev>) {
  const top = m.top[0],
    cell = useBestCell(top ?? null),
    ok = cell && typeof cell === 'object' ? cell : null,
    period = d.unit === 'week' ? 'this week' : 'this month';
  return (
    <>
      <section className="group ov-best">
        <h4 className="ov-h">Best device {period}</h4>
        {!top ? (
          <p className="mut">No working devices measured {period}.</p>
        ) : (
          <div className="ov-best-b">
            <div className="ov-best-t">
              <b className="ov-best-v">{pct(top.pce, 2)}</b>
              {ok && (
                <span className="ov-best-m">
                  V<sub>oc</sub> {fmt(ok.best.m.voc, 3)} V · J<sub>sc</sub> {fmt(ok.best.m.jsc)} mA/cm² · FF{' '}
                  {fmt(ok.best.m.ff, 1)} %
                </span>
              )}
              <span>{top.owner}</span>
              <span className="mut small">
                {top.sample.replace(/_/g, ' ')}, substrate {top.substrate}
                {ok ? `, pixel ${ok.best.pixel}` : ''}
              </span>
              {m.record && (
                <span className="small">
                  New lab record{m.record.before ? `, up from ${m.record.before.toFixed(2)} %` : ''}
                </span>
              )}
              <button className="link small" onClick={() => open('iv', top.setId)}>
                Open {top.set}
              </button>
            </div>
            <div className="ov-best-fig">
              {ok ? (
                <JvFigure
                  curves={ok.curves}
                  best={ok.best}
                  title={`${top.owner} · ${top.sample.replace(/_/g, ' ')}, pixel ${ok.best.pixel}`}
                  link={ok.set.links[ok.best.sample] ?? null}
                />
              ) : (
                <p className="mut">{typeof cell === 'string' && cell !== 'none' ? cell : 'Loading…'}</p>
              )}
            </div>
          </div>
        )}
      </section>
      <More title="Best devices" count={m.top.length}>
        {m.top.length ? (
          <ol className="ov-list num">
            {m.top.map((t, i) => (
              <li key={i}>
                <b>{t.pce.toFixed(2)} %</b>
                <span>{t.owner}</span>
                <span className="mut small">
                  {t.sample.replace(/_/g, ' ')}, substrate {t.substrate}
                </span>
                <span className="grow" />
                <button className="link small" onClick={() => open('iv', t.setId)}>
                  {t.set}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mut">No working devices measured.</p>
        )}
      </More>
      <More title="Batches started or finished" count={new Set([...m.finished, ...m.started].map((b) => b.id)).size}>
        {m.finished.length + m.started.length ? (
          <ul className="ov-list">
            {m.finished.map((b) => (
              <li key={'f' + b.id}>
                <span className="status-pill st-done">Done</span>
                <button className="link" onClick={() => open('batches', b.id)}>
                  {b.name}
                </button>
                <span className="mut small">{b.owner}</span>
              </li>
            ))}
            {m.started
              .filter((b) => !m.finished.some((f) => f.id === b.id))
              .map((b) => (
                <li key={'s' + b.id}>
                  <span className={'status-pill st-' + b.status}>{STATUS[b.status]}</span>
                  <button className="link" onClick={() => open('batches', b.id)}>
                    {b.name}
                  </button>
                  <span className="mut small">{b.owner}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mut">No batches started or finished.</p>
        )}
      </More>
      <More title="Measurements" count={m.measurements.length}>
        {m.measurements.length ? (
          <ul className="ov-list">
            {m.measurements.map((x) => (
              <li key={x.id}>
                <button className="link" onClick={() => open('iv', x.id)}>
                  {x.name}
                </button>
                <span className="mut small">
                  {x.owner}, {plural(x.devices, 'device')}
                </span>
                <span className="grow" />
                <span>{x.best ? pct(x.best, 2) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mut">No measurements imported.</p>
        )}
      </More>
    </>
  );
}

const tickDay = (x: string) =>
  new Date(x + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const batchPoints = (p: PersonPage) =>
  p.points.map((x) => ({
    x: x.day,
    best: x.best,
    median: x.median,
    n: x.devices,
    title: `${x.name}${x.kind === 'set' ? ' (measurement)' : ''}, ${fmtDate(x.day)}`,
  }));
const facts = (p: PersonPage) => ({
  devs: p.points.reduce((a, x) => a + x.devices, 0),
  done: p.batches.filter((b) => b.status === 'done').length,
  running: p.batches.filter((b) => b.status === 'running').length,
  bestPoint: p.best ? p.points.find((x) => x.best === p.best!.pce) : undefined,
});

/** My progress: numbers, the best device of each batch over time, their batches and measurements. */
function Person({ m: p, open }: PersonProps<PersonPage>) {
  const { devs, done, running, bestPoint } = facts(p);
  return (
    <>
      <Stats
        items={[
          {
            label: 'Best device so far',
            value: pct(p.best?.pce ?? null, 2),
            tone: 'best',
            note: bestPoint
              ? bestPoint.kind === 'batch'
                ? `${bestPoint.name}, ${fmtDate(bestPoint.day)}`
                : bestPoint.name
              : 'No working devices measured yet',
          },
          { label: 'Devices measured', value: String(devs), note: `in ${plural(p.progress.length, 'measurement')}` },
          { label: 'Batches', value: String(p.batches.length), note: `${done} finished · ${running} in progress` },
        ]}
      />
      <section className="group">
        <h4 className="ov-h">Best device of each batch</h4>
        <LineChart
          h={220}
          points={batchPoints(p)}
          xLabel="Batch"
          unitTick={tickDay}
          empty="No working devices measured yet."
        />
        <p className="mut small ov-foot">
          Each point is a batch at its first measurement. Devices linked to no batch count with their measurement.
        </p>
      </section>
      <div className="ov-two">
        <section className="group">
          <h4 className="ov-h">Batches</h4>
          {p.batches.length ? (
            <ul className="ov-list">
              {p.batches.slice(0, 10).map((b) => (
                <li key={b.id}>
                  <button className="link ov-clip" onClick={() => open('batches', b.id)}>
                    {b.name}
                  </button>
                  <span className="grow" />
                  {b.best != null && <b>{pct(b.best, 2)}</b>}
                  <span className={'status-pill st-' + b.status}>{STATUS[b.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mut">No batches yet.</p>
          )}
        </section>
        <section className="group">
          <h4 className="ov-h">Recent measurements</h4>
          {p.progress.length ? (
            <ul className="ov-list">
              {[...p.progress]
                .reverse()
                .slice(0, 10)
                .map((x) => (
                  <li key={x.id}>
                    <button className="link ov-clip" onClick={() => open('iv', x.id)}>
                      {x.name}
                    </button>
                    <span className="mut small">{plural(x.devices, 'device')}</span>
                    <span className="grow" />
                    <b>{pct(x.best, 2)}</b>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mut">No measurements yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

/** My progress › Export for a presentation: the person's slide (Richard, 17 Nov). */
function PersonExport({ m: p, who, onClose }: { m: PersonPage; who: PersonHead; onClose: () => void }) {
  const { devs } = facts(p),
    b = p.best,
    batches = p.points.filter((x) => x.kind === 'batch').length;
  const top = b
    ? {
        pce: b.pce,
        set: b.set,
        setId: b.setId,
        sample: b.sample,
        substrate: b.substrate,
        owner: who.name,
        batchId: b.batchId,
        batch: p.points.find((x) => x.kind === 'batch' && x.id === b.batchId)?.name,
      }
    : null;
  const sub = [
    who.tags.map((t) => t.name).join(', '),
    `progress up to ${fmtDate(new Date().toISOString())}`,
    b ? `best device ${pct(b.pce, 2)}` : '',
    `${plural(devs, 'device')}${batches ? ` in ${plural(batches, 'batch', 'batches')}` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <PresentationExport
      title={who.name}
      sub={sub}
      points={p.points.map((x) => ({ x: x.day, best: x.best, median: x.median }))}
      tickOf={tickDay}
      trendTitle="Best device of each batch"
      trendNote="Best and typical (median) device of each batch, at its first measurement"
      top={top}
      file={who.username}
      onClose={onClose}
    />
  );
}

export const devicesOverview: OverviewPart<Dev, PersonM, PersonPage> = {
  // the best device has its own section under the numbers, with its J–V curve (design critique, 0.60: not twice)
  stats: (m) => {
    const L = m.lab;
    return [
      {
        label: 'Typical device',
        value: pct(L.median, 1),
        tone: 'median',
        note: L.devices ? `median of ${plural(L.devices, 'device')}` : 'No devices measured',
      },
      {
        label: 'Batches',
        value: String(L.batchesStarted),
        note: `started · ${L.batchesDone} finished · ${L.running} in progress`,
      },
    ];
  },
  doing: (p) =>
    [
      p.batchesStarted ? `started ${plural(p.batchesStarted, 'batch', 'batches')}` : '',
      p.running ? `${p.running} running` : '',
      p.devices ? `measured ${plural(p.devices, 'device')} (best ${pct(p.best)})` : '',
    ].filter(Boolean),
  active: (p) => !!(p.batchesStarted || p.measurements || p.running),
  Lab: LabPart,
  Person,
  PersonExport,
};
