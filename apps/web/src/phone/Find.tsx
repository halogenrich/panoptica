import { useEffect, useMemo, useRef, useState } from 'react';
import { fold, search } from '@psc/core';
import { api } from '../api';
import type { PhoneProps } from '../modules/types';
import { useChems, type Chemical } from '../views/common';
import type { Box } from '../views/Inventory';
import { showToast, useRefresh } from '../lib/trash';
import { Modal } from '../lib/ui';
import { Scan } from '../Icons';

/**
 * Inventory on the phone (0.55): find a reagent: where it is and how much is left. One box for short name, name, other
 * names, formula, CAS number or barcode; a camera scan where the browser can read barcodes (Chrome on Android, over HTTPS).
 * People who manage the inventory (admins, Inventory tag) can also correct the amount left and mark a container empty;
 * everyone else only finds (Richard, 17 Nov).
 */
type Area = { id: number; name: string; shelves: { id: number; name: string }[] };
type Inv = { areas: Area[]; containers: Box[] };

const num = (v: number | null) => (v === null || v === undefined ? '?' : String(+v.toPrecision(4)));
const canScan = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && window.isSecureContext;

export default function Find({ me }: PhoneProps) {
  const chems = useChems(),
    [inv, setInv] = useState<Inv | null>(null),
    [q, setQ] = useState(''),
    [scan, setScan] = useState(false);
  const canEdit = me.role === 'admin' || !!me.inventory;
  const load = () =>
    api<Inv>('/inventory')
      .then(setInv)
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['inventory']);
  const where = (b: Box) => {
    const a = inv?.areas.find((x) => x.id === b.area_id),
      s = a?.shelves.find((x) => x.id === b.shelf_id);
    return a ? [a.name, s?.name].filter(Boolean).join(' › ') : 'No storage place';
  };
  const hits = useMemo(() => {
    const t = q.trim();
    if (!t || !inv) return [];
    // a barcode is matched exactly first: the container it is on, at the top
    const coded = inv.containers.filter((b) => b.barcode && fold(b.barcode) === fold(t)),
      byCode = chems.filter((c) => coded.some((b) => b.chem_id === c.id));
    const found = search(t, chems, (c) => ({ label: c.name, short: c.s, other: [...c.aka, c.f, c.cas] }));
    return [...byCode, ...found.filter((c) => !byCode.includes(c))].slice(0, 30).map((c) => ({
      c,
      boxes: inv.containers
        .filter((b) => b.chem_id === c.id)
        .sort((a, b) => +coded.includes(b) - +coded.includes(a) || +(a.status === 'empty') - +(b.status === 'empty')),
      coded,
    }));
  }, [q, chems, inv]);
  return (
    <div className="ph-stack">
      <div className="ph-search">
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Find a substance"
          placeholder="Short name, name, CAS or barcode"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {canScan() && (
          <button className="btn secondary ph-scan" aria-label="Scan a barcode" onClick={() => setScan(true)}>
            <Scan size={24} />
          </button>
        )}
      </div>
      {!q.trim() ? (
        <p className="mut ph-hint">
          Type DMF, PbI2, 7758-97-6 or a barcode. Results show where each container is and how much is left.
        </p>
      ) : !inv ? (
        <p className="mut">Loading…</p>
      ) : !hits.length ? (
        <p className="mut ph-hint">Nothing matches “{q.trim()}”. Try the short name or the CAS number.</p>
      ) : (
        hits.map(({ c, boxes, coded }) => (
          <Result key={c.id} c={c} boxes={boxes} coded={coded} where={where} canEdit={canEdit} onSaved={load} />
        ))
      )}
      {scan && (
        <Scanner
          onClose={() => setScan(false)}
          onCode={(v) => {
            setQ(v);
            setScan(false);
          }}
        />
      )}
    </div>
  );
}

function Result({
  c,
  boxes,
  coded,
  where,
  canEdit,
  onSaved,
}: {
  c: Chemical;
  boxes: Box[];
  coded: Box[];
  where: (b: Box) => string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [allEmpty, setAllEmpty] = useState(false);
  const full = boxes.filter((b) => b.status !== 'empty'),
    empty = boxes.filter((b) => b.status === 'empty');
  const shown = allEmpty ? boxes : full;
  return (
    <section className="group ph-chem">
      <div className="ph-chem-h">
        <b>{c.s || c.name}</b>
        {c.s && <span className="mut">{c.name}</span>}
        {(c.f || c.cas) && <span className="mut small">{[c.f, c.cas].filter(Boolean).join(', ')}</span>}
      </div>
      {!boxes.length ? (
        <p className="mut small">No container in the inventory.</p>
      ) : (
        <div className="ph-list">
          {shown.map((b) => (
            <BoxRow key={b.id} b={b} where={where(b)} hit={coded.includes(b)} canEdit={canEdit} onSaved={onSaved} />
          ))}
          {!full.length && !allEmpty && <p className="mut small">Every container is empty.</p>}
        </div>
      )}
      {empty.length > 0 && (
        <button className="link ph-more" onClick={() => setAllEmpty(!allEmpty)}>
          {allEmpty
            ? 'Hide empty containers'
            : `Show ${empty.length} empty ${empty.length === 1 ? 'container' : 'containers'}`}
        </button>
      )}
    </section>
  );
}

/** The fields a container is saved with (the server takes the whole container). */
const body = (b: Box, p: Partial<Box>) => {
  const x = { ...b, ...p };
  return {
    name: x.name,
    chem_id: x.chem_id,
    cas: x.cas,
    amount: x.amount,
    size: x.size,
    unit: x.unit,
    status: x.status,
    area_id: x.area_id,
    shelf_id: x.shelf_id,
    supplier: x.supplier,
    lot: x.lot,
    purity: x.purity,
    expires: x.expires,
    opened: x.opened,
    notes: x.notes,
    barcode: x.barcode,
  };
};

function BoxRow({
  b,
  where,
  hit,
  canEdit,
  onSaved,
}: {
  b: Box;
  where: string;
  hit: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState(false),
    [amt, setAmt] = useState(''),
    [err, setErr] = useState('');
  const put = (p: Partial<Box>) => api(`/inventory/containers/${b.id}`, 'PUT', body(b, p));
  const save = () => {
    const v = Number(amt.replace(',', '.'));
    if (amt.trim() === '' || !Number.isFinite(v) || v < 0) return setErr('Type the amount left, 0 or more.');
    put({ amount: v, status: v === 0 ? 'empty' : b.status === 'empty' ? 'in use' : b.status })
      .then(() => {
        setEdit(false);
        showToast(`${b.name}: ${num(v)} ${b.unit} left`);
        onSaved();
      })
      .catch((e) => setErr(e.message));
  };
  const markEmpty = () =>
    put({ status: 'empty' })
      .then(() => {
        showToast(`${b.name} marked empty`, () => put({}).then(onSaved));
        onSaved();
      })
      .catch((e) => setErr(e.message));
  return (
    <div className={'ph-box' + (hit ? ' hit' : '') + (b.status === 'empty' ? ' gone' : '')}>
      <div className="ph-box-main">
        <div>
          <div className="ph-where">{where}</div>
          <div className="mut small">
            {[b.supplier, b.lot && `lot ${b.lot}`, b.purity ? `${b.purity}%` : '', b.use ? 'used by recipes' : '']
              .filter(Boolean)
              .join(', ')}
          </div>
        </div>
        <div className="ph-amt">
          {b.status === 'empty' ? (
            'Empty'
          ) : (
            <>
              {num(b.amount)} {b.unit}
              {b.size ? <span className="mut small"> of {num(b.size)}</span> : null}
            </>
          )}
        </div>
      </div>
      {canEdit &&
        (edit ? (
          <div className="ph-edit">
            <label className="ph-field">
              <span>Amount left ({b.unit})</span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
            <div className="ph-actions">
              <button className="btn secondary" onClick={() => setEdit(false)}>
                Cancel
              </button>
              <button className="btn" onClick={save}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="ph-actions">
            <button
              className="btn secondary"
              onClick={() => {
                setAmt(b.amount === null ? '' : String(b.amount));
                setErr('');
                setEdit(true);
              }}
            >
              Correct amount
            </button>
            {b.status !== 'empty' && (
              <button className="btn secondary" onClick={markEmpty}>
                Mark empty
              </button>
            )}
          </div>
        ))}
      {err && <p className="err small">{err}</p>}
    </div>
  );
}

/** The camera, reading barcodes with the browser's own detector until one is found. */
function Scanner({ onCode, onClose }: { onCode: (v: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null),
    [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null,
      t = 0,
      stop = false;
    const Det = (window as any).BarcodeDetector;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        stream = s;
        if (stop) return s.getTracks().forEach((x) => x.stop());
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        const det = new Det();
        const look = async () => {
          if (stop) return;
          try {
            const r = await det.detect(v);
            if (r[0]?.rawValue) return onCode(r[0].rawValue);
          } catch {
            /* a frame not ready yet */
          }
          t = window.setTimeout(look, 250);
        };
        look();
      })
      .catch(() => setErr('The camera could not be opened. Allow the camera for this site, or type the code.'));
    return () => {
      stop = true;
      window.clearTimeout(t);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, []);
  return (
    <Modal onClose={onClose} className="ph-scanner">
      <div className="modal-head">
        <h2>Scan a barcode</h2>
        <button className="iconbtn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body">
        {err ? <p className="err">{err}</p> : <video ref={video} playsInline muted />}
        <p className="mut small">Hold the label inside the frame. The search fills in when the code is read.</p>
      </div>
    </Modal>
  );
}
