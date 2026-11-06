import { useContext, useEffect, useMemo, useState } from 'react';
import { MeCtx } from '../ctx';
import { api } from '../api';
import { Modal, fmtDate } from './ui';
import { downloadBytes } from './xlsx';
import { useFigureSettings } from './figure';
import { LICENSES, buildPackage, packCatalog, withLinked, type Catalog, type PackMeta, type PackSel } from './datapack';

/** Opens the data package dialog from anywhere, with these items chosen. */
export const openDataPackage = (sel: Partial<PackSel> = {}) =>
  window.dispatchEvent(
    new CustomEvent('psc-datapack', { detail: { batches: [], iv: [], cmp: [], ...sel } as PackSel }),
  );

const KEEP = 'psc-datapack-meta';
const kept = (): Partial<PackMeta> => {
  try {
    return JSON.parse(localStorage.getItem(KEEP) ?? '{}');
  } catch {
    return {};
  }
};

type Kind = keyof PackSel;
type Row = { kind: Kind; id: number; label: string; sub: string; owner: string };

/**
 * Choose what goes in, describe it, download one .zip. What a chosen item depends on (a batch's measurements, a measurement's
 * batches, a comparison's measurements) comes along unless that is switched off.
 */
export default function DataPackage({ initial, onClose }: { initial: PackSel; onClose: () => void }) {
  const { me } = useContext(MeCtx),
    fig = useFigureSettings();
  const [cat, setCat] = useState<Catalog | null>(null),
    [sel, setSel] = useState<PackSel>(initial),
    [linked, setLinked] = useState(true),
    [all, setAll] = useState<PackSel | null>(null),
    [q, setQ] = useState(''),
    [busy, setBusy] = useState(''),
    [err, setErr] = useState(''),
    [ver, setVer] = useState('');
  const [meta, setMeta] = useState<PackMeta>(() => {
    const k = kept();
    return {
      title: '',
      description: '',
      authors: me.name,
      affiliation: k.affiliation ?? '',
      grant: k.grant ?? '',
      license: k.license ?? 'CC-BY-4.0',
      keywords: k.keywords ?? 'perovskite solar cells, current–voltage (J–V), device fabrication',
    };
  });
  useEffect(() => {
    packCatalog()
      .then(setCat)
      .catch((e) => setErr(e.message));
    api<{ version: string }>('/version')
      .then((v) => setVer(v.version))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!meta.affiliation && fig.group) setMeta((m) => ({ ...m, affiliation: fig.group! }));
  }, [fig.group]);

  const rows = useMemo<Row[]>(
    () =>
      cat
        ? [
            ...cat.batches.map((b) => ({
              kind: 'batches' as const,
              id: b.id,
              label: b.code + (b.name ? ` · ${b.name}` : ''),
              sub: `started ${fmtDate(b.created_at)}`,
              owner: b.owner,
            })),
            ...cat.sets
              .filter((s) => !s.stabilityOf)
              .map((s) => ({
                kind: 'iv' as const,
                id: s.id,
                label: s.name,
                sub: `measured ${fmtDate(s.date)}`,
                owner: s.owner,
              })),
            ...cat.cmps.map((c) => ({
              kind: 'cmp' as const,
              id: c.id,
              label: c.name,
              sub: `changed ${fmtDate(c.updated_at)}`,
              owner: c.owner,
            })),
          ]
        : [],
    [cat],
  );
  // what will be packed: the chosen items and, unless switched off, what they are linked to
  useEffect(() => {
    if (!cat) return;
    if (!linked) return setAll(sel);
    let live = true;
    withLinked(sel, cat).then((x) => live && setAll(x));
    return () => {
      live = false;
    };
  }, [cat, sel, linked]);
  // the title and authors follow the choice until edited
  const [touched, setTouched] = useState<{ title?: boolean; authors?: boolean }>({});
  useEffect(() => {
    if (!all || !cat) return;
    const owners = [
      ...new Set(rows.filter((r) => all[r.kind].includes(r.id)).map((r) => r.owner.replace(/ \(former\)$/, ''))),
    ];
    const one = all.batches.length === 1 && cat.batches.find((b) => b.id === all.batches[0]);
    setMeta((m) => ({
      ...m,
      title: touched.title
        ? m.title
        : one
          ? `Perovskite solar cells, batch ${one.code}${one.name ? `: ${one.name}` : ''}`
          : `Perovskite solar cells, ${fmtDate(new Date().toISOString())}`,
      authors: touched.authors ? m.authors : [...new Set([...owners, me.name])].join('; '),
    }));
  }, [all]);

  const on = (k: Kind, id: number) => sel[k].includes(id);
  const inPack = (k: Kind, id: number) => on(k, id) || !!all?.[k].includes(id);
  const toggle = (k: Kind, id: number) =>
    setSel({ ...sel, [k]: on(k, id) ? sel[k].filter((x) => x !== id) : [...sel[k], id] });
  const shown = (k: Kind) =>
    rows
      .filter((r) => r.kind === k && (r.label + ' ' + r.owner).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => +inPack(b.kind, b.id) - +inPack(a.kind, a.id));
  const n = all ? all.batches.length + all.iv.length + all.cmp.length : 0;
  const extra = (k: Kind) => (all ? all[k].length - sel[k].length : 0);
  const set = (p: Partial<PackMeta>) => setMeta({ ...meta, ...p });

  const download = async () => {
    if (!all) return;
    setErr('');
    try {
      localStorage.setItem(
        KEEP,
        JSON.stringify({
          affiliation: meta.affiliation,
          grant: meta.grant,
          license: meta.license,
          keywords: meta.keywords,
        }),
      );
    } catch {
      /* ignore */
    }
    try {
      const r = await buildPackage(all, meta, ver, setBusy);
      downloadBytes(r.name, r.zip, 'application/zip');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const section = (k: Kind, title: string) => {
    const list = shown(k);
    return (
      <div className="dp-sec">
        <div className="dp-sec-h">
          <b>{title}</b>
          <span className="mut small">
            {sel[k].length} chosen{linked && extra(k) > 0 ? `, ${extra(k)} linked` : ''}
          </span>
        </div>
        <div className="dp-list" role="group" aria-label={title}>
          {list.length === 0 && <p className="mut small">{cat ? 'Nothing here.' : 'Loading…'}</p>}
          {list.map((r) => {
            const auto = !on(k, r.id) && !!all?.[k].includes(r.id);
            return (
              <label
                key={r.id}
                className={'dp-row' + (auto ? ' auto' : '')}
                title={auto ? 'Included because a chosen item is linked to it' : undefined}
              >
                <input type="checkbox" checked={on(k, r.id) || auto} disabled={auto} onChange={() => toggle(k, r.id)} />
                <span className="dp-name">{r.label}</span>
                <span className="mut small">{auto ? 'linked to a chosen item' : `${r.owner}, ${r.sub}`}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} className="dp-modal">
      <header className="modal-head">
        <div className="title-block">
          <h2>Data package</h2>
          <div className="mut small">
            One .zip for a data repository: the items as CSV and JSON, a README that describes them, the deposit fields
            and checksums.
          </div>
        </div>
        <div className="grow" />
        <button className="iconbtn head-close" aria-label="Close" onClick={onClose} disabled={!!busy}>
          ✕
        </button>
      </header>
      <div className="dp pad-x">
        <div className="dp-pick">
          <input
            type="search"
            className="lib-search"
            placeholder="Filter by name or person"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {section('batches', 'Batches')}
          {section('iv', 'Measurements')}
          {section('cmp', 'Comparisons')}
          <label className="dp-linked small">
            <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> Also add what they
            are linked to (a batch's measurements, a measurement's batches, a comparison's measurements)
          </label>
        </div>
        <div className="dp-meta">
          <label className="fld">
            <span>Title</span>
            <input
              value={meta.title}
              onChange={(e) => {
                setTouched({ ...touched, title: true });
                set({ title: e.target.value });
              }}
            />
          </label>
          <label className="fld">
            <span>Description</span>
            <textarea
              rows={4}
              value={meta.description}
              placeholder="What the devices are, what was varied and what was measured"
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
          <label className="fld">
            <span>Authors, separated by ;</span>
            <input
              value={meta.authors}
              onChange={(e) => {
                setTouched({ ...touched, authors: true });
                set({ authors: e.target.value });
              }}
            />
          </label>
          <label className="fld">
            <span>Affiliation</span>
            <input
              value={meta.affiliation}
              placeholder="e.g. LNES, Unicamp"
              onChange={(e) => set({ affiliation: e.target.value })}
            />
          </label>
          <div className="grid2">
            <label className="fld">
              <span>FAPESP process</span>
              <input
                value={meta.grant}
                placeholder="e.g. 2024/01234-5"
                onChange={(e) => set({ grant: e.target.value })}
              />
            </label>
            <label className="fld">
              <span>Licence</span>
              <select value={meta.license} onChange={(e) => set({ license: e.target.value })}>
                {LICENSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="fld">
            <span>Keywords, separated by commas</span>
            <input value={meta.keywords} onChange={(e) => set({ keywords: e.target.value })} />
          </label>
        </div>
      </div>
      <footer className="dialog-actions pad-x dp-foot">
        <span className="mut small grow">
          {busy
            ? `Preparing: ${busy}…`
            : all
              ? n
                ? `${all.batches.length} batch${all.batches.length === 1 ? '' : 'es'}, ${all.iv.length} measurement${
                    all.iv.length === 1 ? '' : 's'
                  }, ${all.cmp.length} comparison${all.cmp.length === 1 ? '' : 's'}`
                : 'Choose what goes in.'
              : 'Loading…'}
        </span>
        {err && <span className="err small">{err}</span>}
        <button className="link" onClick={onClose} disabled={!!busy}>
          Cancel
        </button>
        <button className="btn" disabled={!n || !meta.title.trim() || !!busy} onClick={download}>
          {busy ? 'Preparing…' : 'Download package'}
        </button>
      </footer>
    </Modal>
  );
}
