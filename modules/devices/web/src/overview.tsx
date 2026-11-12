import { fmtDate } from '@web/lib/ui';
import { More, Stats, plural, pct, tick } from '@web/views/overview/parts';
import { BLUE, INK, MUT, ORANGE, SW, SlideFrame } from '@web/views/overview/slides';
import { PresentationExport, SlideTrend } from './views/overview/export';
import type { OverviewPart, PersonProps, SumProps } from '@web/modules/types';
import LineChart from './LineChart';

/**
 * Electronic Devices in the Overview (0.42): batches and measured cells in the opening sentences and numbers, a new record, the
 * efficiency trend, the best cells, batches and measurements of the period; on a person's page, their progress measurement by
 * measurement and their recent batches and measurements.
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
  trend: { start: string; best: number | null; median: number | null; devices: number }[];
  top: Top[];
  record: (Top & { before: number | null }) | null;
  finished: { id: number; code: string; name: string; owner: string }[];
  started: { id: number; code: string; name: string; owner: string; status: string }[];
  measurements: { id: number; name: string; owner: string; devices: number; best: number }[];
};
type PersonM = Lab & { bestEver: number | null };
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
  batches: { id: number; code: string; name: string; status: string; created_at: string }[];
};

const STATUS: Record<string, string> = { planned: 'Planned', running: 'Running', done: 'Done' };

/** The chart starts at the first period with cells (at least the last 4), so a new lab is not a mostly empty axis. */
function trendPoints(m: Dev) {
  const first = m.trend.findIndex((t) => t.devices > 0),
    from = first < 0 ? m.trend.length - 4 : Math.min(first, m.trend.length - 4);
  return m.trend.slice(Math.max(0, from)).map((t) => ({ x: t.start, best: t.best, median: t.median, n: t.devices }));
}

const Lead = ({ m, who, open }: SumProps<Dev>) =>
  m.record && (
    <div className="ov-record">
      <span className="ov-record-k">{who.record}</span>
      <b>{m.record.pce.toFixed(2)} %</b>
      <span>
        by {m.record.owner}
        {m.record.before ? `, up from ${m.record.before.toFixed(2)} %` : ''}
      </span>
      <button className="link small" onClick={() => open('iv', m.top[0]?.setId ?? 0)}>
        {m.record.set}
      </button>
    </div>
  );

function Body({ m, d }: SumProps<Dev>) {
  return (
    <section className="group">
      <h4 className="ov-h">Efficiency over time</h4>
      <LineChart
        h={220}
        points={trendPoints(m)}
        xLabel={d.unit === 'week' ? 'Week' : 'Month'}
        unitTick={(x) => tick(x, d.unit)}
        empty={`No cells measured in the last 12 ${d.unit}s.`}
      />
      <p className="mut small ov-foot">A cell counts with its best working pixel.</p>
    </section>
  );
}

function Details({ m, open }: SumProps<Dev>) {
  return (
    <>
      <More title="Best cells" count={m.top.length}>
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
          <p className="mut">No working cells measured.</p>
        )}
      </More>
      <More title="Batches started or finished" count={new Set([...m.finished, ...m.started].map((b) => b.id)).size}>
        {m.finished.length + m.started.length ? (
          <ul className="ov-list">
            {m.finished.map((b) => (
              <li key={'f' + b.id}>
                <span className="status-pill st-done">Done</span>
                <button className="link" onClick={() => open('batches', b.id)}>
                  {b.code}
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
                    {b.code}
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
                  {x.owner}, {plural(x.devices, 'cell')}
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

/** The full 16:9 slide (efficiency over time, the best cell) and a second one with the period's highlights. */
function Export({ m, d, who, label, onClose }: SumProps<Dev> & { onClose: () => void }) {
  const L = m.lab,
    top = m.top[0],
    points = trendPoints(m);
  const lines = [
    m.record
      ? `${who.record}: ${m.record.pce.toFixed(2)} % by ${m.record.owner}${m.record.before ? ` (was ${m.record.before.toFixed(2)} %)` : ''}`
      : null,
    `${plural(m.started.length, 'batch', 'batches')} started, ${m.finished.length} finished`,
    `${plural(m.measurements.length, 'measurement')}, ${plural(L.devices, 'working cell')}`,
    d.digest.setbacks.length
      ? `${plural(d.digest.setbacks.length, 'step')} postponed or canceled`
      : 'No steps postponed or canceled',
  ].filter(Boolean) as string[];
  const highlights = (ref: React.Ref<SVGSVGElement>) => (
    <SlideFrame svgRef={ref} title={`${d.unit === 'week' ? 'Week' : 'Month'} ${who.title}`} sub={label}>
      <g transform="translate(110 330)">
        {lines.map((l, i) => (
          <g key={i} transform={`translate(0 ${i * 74})`}>
            <circle cx={12} cy={-12} r={8} fill={i === 0 && m.record ? ORANGE : BLUE} />
            <text x={40} fontSize={40} fill={INK}>
              {l}
            </text>
          </g>
        ))}
      </g>
      <g transform={`translate(110 ${330 + lines.length * 74 + 70})`}>
        <text fontSize={30} fill={MUT}>
          Best cells
        </text>
        {m.top.slice(0, 4).map((t, i) => (
          <text key={i} y={56 + i * 52} fontSize={34} fill={INK}>
            {t.pce.toFixed(2)} % {t.owner}, {t.sample.replace(/_/g, ' ')} substrate {t.substrate}
          </text>
        ))}
      </g>
    </SlideFrame>
  );
  const sub = `${label} · best cell ${pct(L.best, 2)} · typical ${pct(L.median)} · ${plural(L.devices, 'cell')} measured · ${plural(L.batchesStarted, 'batch', 'batches')} started`;
  return (
    <PresentationExport
      label={label}
      sub={sub}
      points={points}
      tickOf={(x) => tick(x, d.unit)}
      top={top}
      file={d.from.slice(0, 10)}
      extra={{ name: 'Highlights', render: highlights }}
      onClose={onClose}
    />
  );
}

const tickDay = (x: string) =>
  new Date(x + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const personPoints = (p: PersonPage) =>
  p.progress.map((x) => ({
    x: x.day,
    best: x.best,
    median: x.median,
    n: x.devices,
    title: `${x.name} (${fmtDate(x.day)})`,
  }));
const personFacts = (p: PersonPage) => {
  const counts = { planned: 0, running: 0, done: 0 } as Record<string, number>;
  p.batches.forEach((b) => {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
  });
  return {
    best: Math.max(0, ...p.progress.map((x) => x.best ?? 0)),
    devs: p.progress.reduce((a, x) => a + x.devices, 0),
    counts,
  };
};

function Person({ m: p, open }: PersonProps<PersonPage>) {
  const { best, devs, counts } = personFacts(p);
  const bestRun = p.progress.reduce<(typeof p.progress)[number] | null>(
    (a, x) => (x.best != null && (!a || x.best > (a.best ?? 0)) ? x : a),
    null,
  );
  return (
    <>
      <Stats
        items={[
          {
            label: 'Best cell so far',
            value: pct(best || null, 2),
            tone: 'best',
            note: bestRun ? `${bestRun.name}, ${fmtDate(bestRun.day)}` : 'No cells measured yet',
          },
          { label: 'Cells measured', value: String(devs), note: `in ${plural(p.progress.length, 'measurement')}` },
          {
            label: 'Batches',
            value: String(p.batches.length),
            note: `${counts.done} finished · ${counts.running} in progress`,
          },
        ]}
      />
      {p.progress.length > 0 && (
        <section className="group">
          <h4 className="ov-h">Progress, measurement by measurement</h4>
          <LineChart
            h={220}
            points={personPoints(p)}
            xLabel="Measurement"
            unitTick={tickDay}
            empty="No working cells in these measurements."
          />
        </section>
      )}
      <div className="ov-two">
        <section className="group">
          <h4 className="ov-h">Recent batches</h4>
          {p.batches.length ? (
            <ul className="ov-list">
              {p.batches.slice(0, 6).map((b) => (
                <li key={b.id}>
                  <button className="link" onClick={() => open('batches', b.id)}>
                    {b.code}
                  </button>
                  <span className="mut small ov-clip">{b.name}</span>
                  <span className="grow" />
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
                .slice(0, 6)
                .map((x) => (
                  <li key={x.id}>
                    <button className="link" onClick={() => open('iv', x.id)}>
                      {x.name}
                    </button>
                    <span className="mut small">{plural(x.devices, 'cell')}</span>
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

export const devicesOverview: OverviewPart<Dev, PersonM, PersonPage> = {
  lede: (m, who, period) => {
    const L = m.lab;
    return [
      L.batchesStarted || L.devices
        ? `${who.subj} started ${plural(L.batchesStarted, 'batch', 'batches')} and measured ${plural(L.devices, 'cell')}${m.measurements.length ? ` in ${plural(m.measurements.length, 'measurement')}` : ''}.`
        : `No batches started and no cells measured ${period}.`,
      L.running ? `${plural(L.running, 'batch is', 'batches are')} in progress.` : '',
      L.batchesDone ? `${plural(L.batchesDone, 'batch', 'batches')} finished.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  stats: (m) => {
    const L = m.lab,
      top = m.top[0];
    return [
      {
        label: 'Best cell',
        value: pct(L.best, 2),
        tone: 'best',
        note: top ? (
          <>
            {top.owner}
            {top.sample ? `, ${top.sample.replace(/_/g, ' ')}` : ''}
          </>
        ) : (
          'No cells measured'
        ),
      },
      {
        label: 'Typical cell',
        value: pct(L.median, 1),
        tone: 'median',
        note: L.devices ? `median of ${plural(L.devices, 'cell')}` : '—',
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
      p.devices ? `measured ${plural(p.devices, 'cell')} (best ${pct(p.best)})` : '',
    ].filter(Boolean),
  active: (p) => !!(p.batchesStarted || p.measurements || p.running),
  Lead,
  Body,
  Details,
  Export,
  Person,
  personSlide: (p) => {
    const { best, devs, counts } = personFacts(p);
    return {
      numbers: [
        ['Batches', String(p.batches.length)],
        ['Finished', String(counts.done)],
        ['Cells measured', String(devs)],
        ['Best cell', pct(best || null)],
      ],
      body: (y) => <SlideTrend points={personPoints(p)} x={110} y={y} w={SW - 220} h={430} tickOf={tickDay} />,
    };
  },
};
