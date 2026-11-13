import { fixName } from '@web/lib/names';
import LinkOptions, { linkVal, parseLink, type LinkTargets } from './LinkOptions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import { DeviceTable, type DeviceMap } from './Devices';
import {
  checkSweeps,
  ivMetrics,
  parseIvFiles,
  parseLifetime,
  type IvCurve,
  type IvFile,
  type LifetimeRun,
  shortedPixels,
} from '@psc/devices';
import { api } from '@web/api';
import { Modal } from '@web/lib/ui';
import { SYSTEM, type Link } from './model';

const dec = new TextDecoder('windows-1252'); // instrument files are plain ASCII / Latin-1 (for example "mA/cm²")
const fdate = (d: string) =>
  d
    ? new Date(d + 'T12:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'no date';

/** Every file inside dropped files, folders and .zip archives. */
async function collect(items: { name: string; file: File }[]): Promise<IvFile[]> {
  const out: IvFile[] = [];
  for (const { name, file } of items) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(name)) {
      for (const [n, data] of Object.entries(unzipSync(buf)))
        if (!n.endsWith('/') && /\.(csv|txt)$/i.test(n) && !/(^|\/)(__MACOSX\/|\._)/.test(n))
          out.push({ name: fixName(n), text: dec.decode(data) }); // skip macOS resource copies
    } else if (/\.(csv|txt)$/i.test(name) && !/(^|\/)(__MACOSX\/|\._)/.test(name))
      out.push({ name, text: dec.decode(buf) });
  }
  return out;
}
/** Files from a drag and drop, walking into folders. */
async function fromDrop(dt: DataTransfer) {
  const items: { name: string; file: File }[] = [];
  const walk = async (e: any, path: string): Promise<void> => {
    if (e.isFile) {
      const f: File = await new Promise((r, j) => e.file(r, j));
      items.push({ name: path + f.name, file: f });
    } else if (e.isDirectory) {
      const reader = e.createReader();
      let batch: any[];
      do {
        batch = await new Promise((r, j) => reader.readEntries(r, j));
        for (const c of batch) await walk(c, path + e.name + '/');
      } while (batch.length);
    }
  };
  const entries = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const f of [...dt.files]) items.push({ name: f.name, file: f });
  return items;
}

type Draft = {
  key: string;
  system: 'csv' | 'txt';
  date: string;
  name: string;
  curves: IvCurve[];
  links: Record<string, Link>;
  devices: DeviceMap;
  follow: number | null;
  at: string;
  /** a lifetime run: its files name no device, so the sample and substrate are asked for */
  life?: LifetimeRun;
  sample?: string;
  substrate?: string;
};

/** Import: drop the exported files (or a folder / zip) → check what was read → link each sample to a batch or stack → save. */
export default function ImportIv({
  onClose,
  onDone,
  presetLink,
}: {
  onClose: () => void;
  onDone: (ids: number[]) => void;
  presetLink?: Link;
}) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null),
    [info, setInfo] = useState(''),
    [busy, setBusy] = useState(false),
    [over, setOver] = useState(false),
    [err, setErr] = useState('');
  const [targets, setTargets] = useState<{
    batches: LinkTargets['batches'];
    stacks: { id: number; name: string }[];
    sets: { id: number; name: string; stabilityOf: number | null }[];
  }>({ batches: [], stacks: [], sets: [] });
  const [vis, setVis] = useState<'shared' | 'private'>('shared'),
    filesIn = useRef<HTMLInputElement>(null),
    dirIn = useRef<HTMLInputElement>(null);
  useEffect(() => {
    Promise.all([api<any[]>('/batches'), api<any[]>('/presets?segment=stk'), api<any[]>('/iv')])
      .then(([b, s, v]) =>
        setTargets({
          batches: b.map((x) => ({ id: x.id, code: x.code, name: x.name, variants: x.variants })),
          stacks: s.map((x) => ({ id: x.id, name: x.name })),
          sets: v.map((x) => ({ id: x.id, name: x.name, stabilityOf: x.stabilityOf ?? null })),
        }),
      )
      .catch(() => {});
  }, []);

  const read = async (items: { name: string; file: File }[]) => {
    setBusy(true);
    setErr('');
    try {
      const files = await collect(items),
        r = parseIvFiles(files),
        runs = parseLifetime(files);
      if (!r.curves.length && !runs.length) {
        setErr(
          `No J–V curves found in ${files.length} file${files.length === 1 ? '' : 's'}. Supported: multi-pixel "J-V Data.csv" exports and per-curve "-JV-…-Sun-….txt" files.`,
        );
        setBusy(false);
        return;
      }
      const by = new Map<string, Draft>();
      for (const c of r.curves) {
        const key = `${c.system}|${c.date}`;
        if (!by.has(key))
          by.set(key, {
            key,
            system: c.system,
            date: c.date,
            name: `${fdate(c.date)} · ${c.system === 'csv' ? 'multi-pixel' : 'per-curve'}`,
            curves: [],
            links: {},
            devices: {},
            follow: null,
            at: c.date ? `${c.date}T12:00` : new Date().toISOString().slice(0, 16),
          });
        const d = by.get(key)!;
        d.curves.push(c);
        if (!(c.sample in d.links)) d.links[c.sample] = presetLink ?? null;
      }
      const lifeDrafts: Draft[] = runs.map((run) => ({
        key: 'life|' + run.folder + '|' + run.run,
        system: 'csv',
        date: run.date,
        name: `${fdate(run.date)} · Lifetime · ${run.run.replace(/_/g, ' ')}`,
        curves: run.curves,
        links: { [run.run]: presetLink ?? null },
        devices: {},
        follow: null,
        at: run.start.slice(0, 16),
        life: run,
        sample: run.run,
        substrate: '1',
      }));
      setDrafts([...lifeDrafts, ...by.values()]);
      const n = r.curves.length + runs.reduce((a, x) => a + x.curves.length, 0),
        warn = [...r.warnings, ...runs.flatMap((x) => x.warnings)];
      setInfo(
        `${n} curves from ${files.length} files${runs.length ? ` (${runs.length} lifetime run${runs.length > 1 ? 's' : ''})` : ''}${warn.length ? ` · ${warn.join('; ')}` : ''}`,
      );
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const clean = (o?: Record<string, number | undefined>) =>
        o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number.isFinite(v as number) ? v : null]));
      const ids: number[] = [];
      for (const d of drafts!) {
        if (d.life) {
          const smp = d.sample?.trim() || d.life.run,
            sub = d.substrate?.trim() || '1';
          const r = await api<{ id: number }>('/iv', 'POST', {
            name: d.name,
            date: d.date,
            system: 'csv',
            visibility: vis,
            kind: 'lifetime',
            links: { [smp]: d.links[d.life.run] ?? null },
            devices: {},
            life: {
              run: d.life.run,
              start: d.life.start,
              settings: d.life.settings,
              times: d.life.times,
              light: d.life.light,
              sensors: d.life.sensors,
            },
            curves: d.life.curves.map(({ settings: _s, system: _y, date: _d, point: _p, inst, ...c }) => ({
              ...c,
              sample: smp,
              substrate: sub,
              inst: clean(inst),
            })),
          });
          ids.push(r.id);
          continue;
        }
        const r = await api<{ id: number }>('/iv', 'POST', {
          name: d.name,
          date: d.date,
          system: d.system,
          visibility: vis,
          links: d.links,
          devices: d.devices,
          curves: d.curves.map(({ settings: _s, system: _y, date: _d, inst, ...c }) => ({ ...c, inst: clean(inst) })),
        });
        ids.push(r.id);
      }
      onDone(ids);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const up = (key: string, p: Partial<Draft>) => setDrafts(drafts!.map((d) => (d.key === key ? { ...d, ...p } : d)));

  return (
    <Modal onClose={onClose} wide={!!drafts}>
      <header className="modal-head">
        <h2>Import J–V measurements</h2>
        <div className="grow" />
        <button className="iconbtn head-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="modal-body">
        {!drafts ? (
          <div
            className={'drop' + (over ? ' over' : '')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setOver(false);
              await read(await fromDrop(e.dataTransfer));
            }}
          >
            <b>{busy ? 'Reading…' : 'Drop the measurement folder, files or a .zip here'}</b>
            <span className="mut">or</span>
            <span className="inline" style={{ justifyContent: 'center' }}>
              <button className="btn" type="button" onClick={() => filesIn.current?.click()}>
                Choose files or .zip
              </button>
              <button className="btn secondary" type="button" onClick={() => dirIn.current?.click()}>
                Choose a folder
              </button>
            </span>
            <input
              ref={filesIn}
              type="file"
              multiple
              accept=".csv,.txt,.zip"
              hidden
              onChange={(e) => read([...(e.target.files ?? [])].map((f) => ({ name: f.name, file: f })))}
            />
            <input
              ref={dirIn}
              type="file"
              hidden
              {...({ webkitdirectory: '' } as any)}
              onChange={(e) =>
                read(
                  [...(e.target.files ?? [])].map((f) => ({ name: (f as any).webkitRelativePath || f.name, file: f })),
                )
              }
            />
            <span className="mut small">
              Multi-pixel CSV systems (such as Ossila's): the folder with "… J-V Data.csv", "… Metrics.csv" and the
              Settings folder, or a lifetime run's folder (its "J-V Data" and Settings folders). Per-curve text systems:
              the day folder with "…-JV-Backward-Sun-A1.txt" and "…-Parameters.txt".
            </span>
          </div>
        ) : (
          <div className="import">
            <p className="mut small">{info}</p>
            {drafts.map((d) =>
              d.life ? (
                <LifeCard key={d.key} d={d} targets={targets} up={(p) => up(d.key, p)} />
              ) : (
                <DraftCard key={d.key} d={d} targets={targets} up={(p) => up(d.key, p)} />
              ),
            )}
          </div>
        )}
        {err && <p className="err">{err}</p>}
      </div>
      {drafts && (
        <footer className="modal-foot">
          <button className="link" onClick={() => setDrafts(null)}>
            Choose other files
          </button>
          <div className="grow" />
          <label className="inline small">
            Visible to{' '}
            <select value={vis} onChange={(e) => setVis(e.target.value as any)}>
              <option value="shared">everyone</option>
              <option value="private">only me</option>
            </select>
          </label>
          <button className="btn" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : `Save ${drafts.length > 1 ? drafts.length + ' measurements' : 'measurement'}`}
          </button>
        </footer>
      )}
    </Modal>
  );
}

function DraftCard({
  d,
  targets,
  up,
}: {
  d: Draft;
  targets: {
    batches: LinkTargets['batches'];
    stacks: { id: number; name: string }[];
    sets: { id: number; name: string; stabilityOf: number | null }[];
  };
  up: (p: Partial<Draft>) => void;
}) {
  // check sweeps (quick scans before the real measurement) are found the same way the server does, and never give the best
  const chk = useMemo(() => checkSweeps(d.curves), [d.curves]);
  const real = (c: IvCurve) => !chk.has(`${c.sample}|${c.substrate}|${c.pixel}|${c.scan}`);
  // a pixel that shorts in one direction is shorted (as the server counts it)
  const shorted = useMemo(
    () =>
      shortedPixels(
        d.curves.map((c) => ({ ...c, kind: real(c) ? null : 'check', status: ivMetrics(c.V, c.J, c.pin).status })),
      ),
    [d.curves, chk],
  );
  const pxOk = (c: IvCurve) => !shorted.has(`${c.sample}|${c.substrate}|${c.pixel}`);
  const samples = useMemo(
    () =>
      [...new Set(d.curves.map((c) => c.sample))].map((s) => {
        const cs = d.curves.filter((c) => c.sample === s),
          ms = cs.map((c) => ({ ...ivMetrics(c.V, c.J, c.pin), real: real(c), px: pxOk(c) }));
        return {
          s,
          subs: new Set(cs.map((c) => c.substrate)).size,
          px: new Set(cs.map((c) => c.substrate + '|' + c.pixel)).size,
          ok: ms.filter((m) => m.status === 'ok' && m.real && m.px).length,
          n: ms.length,
          checks: ms.filter((m) => !m.real).length,
          best: Math.max(0, ...ms.filter((m) => m.status === 'ok' && m.real && m.px).map((m) => m.pce)),
        };
      }),
    [d.curves, chk, shorted],
  );
  const devs = useMemo(
    () =>
      [...new Set(d.curves.map((c) => c.sample + '|' + c.substrate))].map((k) => {
        const [sample, substrate] = k.split('|'),
          ms = d.curves
            .filter((c) => c.sample === sample && c.substrate === substrate && real(c) && pxOk(c))
            .map((c) => ivMetrics(c.V, c.J, c.pin));
        return { sample, substrate, best: Math.max(0, ...ms.filter((m) => m.status === 'ok').map((m) => m.pce)) };
      }),
    [d.curves, chk, shorted],
  );
  return (
    <section className="group">
      <div className="inline">
        <input
          className="title-input"
          value={d.name}
          aria-label="Name"
          onChange={(e) => up({ name: e.target.value })}
        />
        <span className="mut small">
          {SYSTEM[d.system]} · {d.date || 'no date in the file names'}
        </span>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Sample (from the file names)</th>
              <th>Substrates</th>
              <th>Curves</th>
              <th>Working</th>
              <th>Best PCE</th>
              <th>Is in the app as</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((r) => (
              <tr key={r.s}>
                <td>
                  <b>{r.s.replace(/_/g, ' ')}</b>
                </td>
                <td>{r.subs}</td>
                <td>
                  {r.n}
                  {r.checks > 0 && (
                    <span
                      className="mut small"
                      title="Quick exploratory scans before the real measurement: kept, not counted"
                    >
                      {' '}
                      ({r.checks} check sweep{r.checks > 1 ? 's' : ''})
                    </span>
                  )}
                </td>
                <td>{r.ok}</td>
                <td>{r.best ? r.best.toFixed(2) + ' %' : '—'}</td>
                <td>
                  <select
                    aria-label={`Link ${r.s}`}
                    value={linkVal(d.links[r.s] ?? null)}
                    onChange={(e) => up({ links: { ...d.links, [r.s]: parseLink(e.target.value) } })}
                  >
                    <option value="">Not linked</option>
                    <LinkOptions t={targets} />
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mut small">
        Linked samples are grouped by their batch or stack in the statistics, and drawn with the batch's mask.
      </p>
      <details className="devices-box" open>
        <summary>Devices for the plots and device groups</summary>
        <DeviceTable
          rows={devs}
          value={d.devices}
          groups={[]}
          onChange={(p) => up({ devices: { ...d.devices, ...p } })}
          fallback={(s) => {
            const l = d.links[s];
            return l
              ? ((l.kind === 'batch'
                  ? (() => {
                      const b = targets.batches.find((x) => x.id === l.id),
                        v = b?.variants?.find((x) => x.id === l.variant);
                      return b ? b.name + (v ? ` · ${v.name}` : '') : undefined;
                    })()
                  : targets.stacks.find((x) => x.id === l.id)?.name) ?? s)
              : s.replace(/_/g, ' ');
          }}
        />
      </details>
    </section>
  );
}

type Targets = {
  batches: LinkTargets['batches'];
  stacks: { id: number; name: string }[];
  sets: { id: number; name: string; stabilityOf: number | null }[];
};
/** A lifetime run: what was read, and which device it is (the files name only the run). */
function LifeCard({ d, targets, up }: { d: Draft; targets: Targets; up: (p: Partial<Draft>) => void }) {
  const run = d.life!;
  const first = useMemo(
    () =>
      run.curves
        .filter((c) => c.point === 1)
        .map((c) => ivMetrics(c.V, c.J, c.pin))
        .filter((m) => m.status === 'ok'),
    [run],
  );
  const pixels = new Set(run.curves.map((c) => c.pixel)).size,
    span = run.times.at(-1) ?? 0,
    mins = span / 60;
  return (
    <section className="group">
      <div className="inline">
        <input
          className="title-input"
          value={d.name}
          aria-label="Name"
          onChange={(e) => up({ name: e.target.value })}
        />
        <span className="mut small">Lifetime run · {SYSTEM.csv}</span>
      </div>
      <p className="small">
        <b>{run.run.replace(/_/g, ' ')}</b>: {run.points} readings of {pixels} pixel{pixels === 1 ? '' : 's'} over{' '}
        {mins < 180 ? `${mins.toFixed(1)} min` : `${(span / 3600).toFixed(1)} h`}, started{' '}
        {new Date(run.start).toLocaleString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
        ; {run.area ? `${run.area} cm² pixels, ` : ''}
        {run.pin} mW/cm². Best PCE at the first reading:{' '}
        {first.length ? `${Math.max(...first.map((m) => m.pce)).toFixed(2)} %` : '—'}.{' '}
        {!run.sensors && (
          <span className="mut">
            The light and temperature sensors were not connected; their readings are left out.
          </span>
        )}
      </p>
      <div className="life-dev">
        <label className="fld">
          <span>Sample</span>
          <input value={d.sample ?? ''} placeholder={run.run} onChange={(e) => up({ sample: e.target.value })} />
        </label>
        <label className="fld">
          <span>Substrate</span>
          <input value={d.substrate ?? ''} placeholder="1" onChange={(e) => up({ substrate: e.target.value })} />
        </label>
        <label className="fld">
          <span>Is in the app as</span>
          <select
            value={linkVal(d.links[run.run] ?? null)}
            onChange={(e) => up({ links: { [run.run]: parseLink(e.target.value) } })}
          >
            <option value="">Not linked</option>
            <LinkOptions t={targets} />
          </select>
        </label>
      </div>
      <p className="mut small">
        The lifetime files do not name the device: give the sample and substrate as in your other measurements, so the
        first reading joins the statistics of its batch. The later readings are the ageing and stay out of them.
      </p>
    </section>
  );
}
