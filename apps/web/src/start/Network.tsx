import { useEffect, useState } from 'react';
import { addressProblem, cleanAddress, defaultPort, labUrl, type NetOpen } from '@psc/core';
import { api } from '../api';
import { Seg } from '../lib/ui';

/**
 * Network settings (0.51): who can open PANOPTICA, the lab's address, HTTPS with a certificate from IT, and the port. The same
 * fields in the first setup's Network step and in Admin settings › Network. They are changed on the computer that runs
 * PANOPTICA: elsewhere the tab shows them.
 */
export type CertPick =
  | { kind: 'pem'; pem: string; key: string; pemName: string; keyName: string }
  | { kind: 'pfx'; pfx: string; pass: string; pfxName: string };
export type NetDraft = {
  open: NetOpen;
  address: string;
  https: boolean;
  /** as typed; '' is the port nobody types (80, or 443 with HTTPS) */
  port: string;
  /** a certificate chosen now; none keeps the one on this computer */
  cert: CertPick | null;
  /** PEM files (a certificate and its key) or one PFX file with its password */
  format: 'pem' | 'pfx';
};
export type NetView = {
  open: NetOpen;
  address: string;
  https: boolean;
  port: number;
  url: string;
  local: string;
  note: string;
  redirect: boolean;
  hasCert: boolean;
  here: boolean;
  firewall: boolean;
  wanted: { port: number; https: boolean };
  certificate: { subject: string; names: string[]; to: string; days: number } | null;
};

export const draftOf = (v: Pick<NetView, 'open' | 'address' | 'wanted'>): NetDraft => ({
  open: v.open,
  address: v.address,
  https: v.wanted.https,
  port: v.wanted.port === defaultPort(v.wanted.https) ? '' : String(v.wanted.port),
  cert: null,
  format: 'pem',
});
/** What the server takes (PUT /api/network, the setup's `network`). */
export const netBody = (d: NetDraft) => ({
  open: d.open,
  address: d.address,
  https: d.https,
  ...(d.port.trim() ? { port: +d.port } : {}),
  ...(d.https && d.cert
    ? {
        cert: d.cert.kind === 'pem' ? { pem: d.cert.pem, key: d.cert.key } : { pfx: d.cert.pfx, pass: d.cert.pass },
      }
    : {}),
});
/**
 * Where this browser should go after PANOPTICA moved, or '' when it did not move for it. A new port keeps the name this browser
 * uses (127.0.0.1, localhost or the lab's address: the session belongs to that name); a change to or from HTTPS takes
 * PANOPTICA's own address, the one its certificate is for.
 */
export function movedTo(local: string): string {
  const n = new URL(local),
    here = new URL(location.href);
  if (n.protocol !== here.protocol) return n.origin;
  if (n.port !== here.port) return `${here.protocol}//${here.hostname}${n.port ? ':' + n.port : ''}`;
  return '';
}

/** What is wrong before asking the server, or ''. */
export function draftProblem(d: NetDraft, hasCert: boolean): string {
  const a = cleanAddress(d.address),
    bad = addressProblem(a);
  if (bad) return bad.replace(/^./, (c) => c.toUpperCase()) + '.';
  if (d.port.trim() && !/^\d{1,5}$/.test(d.port.trim())) return 'A port is a number from 1 to 65535.';
  if (d.port.trim() && (+d.port < 1 || +d.port > 65535)) return 'A port is a number from 1 to 65535.';
  if (d.https && !a) return 'HTTPS needs the lab’s address: the certificate is made for that name.';
  if (d.https && !hasCert && !d.cert) return 'Choose the certificate from IT.';
  if (d.https && d.cert?.kind === 'pem' && (!d.cert.pem || !d.cert.key)) return 'Choose the certificate and its key.';
  return '';
}
const portOf = (d: NetDraft) => (d.port.trim() ? +d.port : defaultPort(d.https));
const dmy = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC' });

const readText = (f: File) => f.text();
const readBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error('The file could not be read.'));
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
    r.readAsDataURL(f);
  });

/** A file button that shows the chosen file's name. */
function FilePick({ label, name, accept, on }: { label: string; name: string; accept: string; on: (f: File) => void }) {
  return (
    <div className="inline net-file">
      <label className="btn secondary">
        {name ? 'Replace…' : label}
        <input
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) on(f);
            e.target.value = '';
          }}
        />
      </label>
      {name && <span className="small">{name}</span>}
    </div>
  );
}

/**
 * The fields. `only: 'address'` (the first setup from another computer) shows the lab's address alone: the rest is changed on
 * the computer that runs PANOPTICA.
 */
export function NetworkFields({
  d,
  set,
  hasCert = false,
  only,
}: {
  d: NetDraft;
  set: (p: Partial<NetDraft>) => void;
  hasCert?: boolean;
  only?: 'address';
}) {
  const [err, setErr] = useState('');
  const address = cleanAddress(d.address),
    url = labUrl({ address, port: portOf(d), https: d.https }),
    PEM = '.pem,.crt,.cer,.key,.txt',
    PFX = '.pfx,.p12';
  const pickPem = (which: 'pem' | 'key', f: File) =>
    readText(f)
      .then((t) => {
        if (!/-----BEGIN /.test(t)) throw new Error(`${f.name} is not a PEM file (it starts with -----BEGIN).`);
        const c =
          d.cert?.kind === 'pem' ? d.cert : { kind: 'pem' as const, pem: '', key: '', pemName: '', keyName: '' };
        setErr('');
        set({ cert: which === 'pem' ? { ...c, pem: t, pemName: f.name } : { ...c, key: t, keyName: f.name } });
      })
      .catch((e) => setErr(e.message));
  const pickPfx = (f: File) =>
    readBase64(f)
      .then((b) => {
        setErr('');
        set({ cert: { kind: 'pfx', pfx: b, pass: d.cert?.kind === 'pfx' ? d.cert.pass : '', pfxName: f.name } });
      })
      .catch((e) => setErr(e.message));
  const addressField = (
    <label className="fld">
      <span>The lab’s address</span>
      <input
        value={d.address}
        spellCheck={false}
        autoCapitalize="off"
        placeholder="For example, panoptica.example.edu"
        onChange={(e) => set({ address: e.target.value })}
        onBlur={() => set({ address: cleanAddress(d.address) })}
      />
      <span className="mut small">
        The name IT gave this computer. The sign-in screen shows it, and copied links use it.
        {url && (
          <>
            {' '}
            People open <b className="net-url">{url}</b>
          </>
        )}
      </span>
    </label>
  );
  if (only === 'address') return addressField;
  return (
    <>
      <div className="fld seg-fld">
        <span>Who can open PANOPTICA</span>
        <Seg
          small
          value={d.open}
          on={(open) => set({ open })}
          opts={[
            ['computer', 'This computer'],
            ['network', 'The network'],
          ]}
        />
        <span className="mut small">
          {d.open === 'network'
            ? 'Every computer and phone on the lab’s network. The firewall lets them in.'
            : 'Only a browser on this computer. Nobody on the network can reach it.'}
        </span>
      </div>
      {addressField}
      <div className="net-https">
        <label className="inline">
          <input type="checkbox" checked={d.https} onChange={(e) => set({ https: e.target.checked })} />
          HTTPS, with a certificate from IT
        </label>
        <span className="mut small">
          Passwords and lab data cross the network encrypted. IT makes the certificate for the lab’s address.
        </span>
      </div>
      {d.https && (
        <div className="net-cert">
          <Seg
            small
            value={d.format}
            on={(format) => set({ format, cert: null })}
            opts={[
              ['pem', 'Certificate and key files'],
              ['pfx', 'One PFX file'],
            ]}
          />
          {d.format === 'pem' ? (
            <div className="net-files pem">
              <FilePick
                label="Certificate…"
                name={d.cert?.kind === 'pem' ? d.cert.pemName : ''}
                accept={PEM}
                on={(f) => pickPem('pem', f)}
              />
              <FilePick
                label="Key…"
                name={d.cert?.kind === 'pem' ? d.cert.keyName : ''}
                accept={PEM}
                on={(f) => pickPem('key', f)}
              />
            </div>
          ) : (
            <div className="net-files">
              <FilePick
                label="PFX file…"
                name={d.cert?.kind === 'pfx' ? d.cert.pfxName : ''}
                accept={PFX}
                on={pickPfx}
              />
              {d.cert?.kind === 'pfx' && (
                <label className="fld">
                  <span>Its password</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={d.cert.pass}
                    onChange={(e) => d.cert?.kind === 'pfx' && set({ cert: { ...d.cert, pass: e.target.value } })}
                  />
                </label>
              )}
            </div>
          )}
          {hasCert && !d.cert && (
            <span className="mut small">
              The certificate already on this computer is used. Choose another to replace it.
            </span>
          )}
        </div>
      )}
      <label className="fld net-port">
        <span>Port</span>
        <input
          inputMode="numeric"
          value={d.port}
          placeholder={String(defaultPort(d.https))}
          onChange={(e) => set({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
        />
        <span className="mut small">
          Empty: {defaultPort(d.https)}, the port browsers use by themselves{d.https ? ' for HTTPS' : ''}, so nobody
          types one.
          {d.https && ' Port 80 then sends people on to HTTPS.'}
        </span>
      </label>
      {err && <p className="err small">{err}</p>}
    </>
  );
}

/** Admin settings › Network: what PANOPTICA does now, and the settings (on the computer that runs it). */
export function NetworkTab() {
  const [v, setV] = useState<NetView | null>(null),
    [d, setD] = useState<NetDraft | null>(null),
    [err, setErr] = useState(''),
    [msg, setMsg] = useState(''),
    [busy, setBusy] = useState(false);
  const take = (n: NetView) => {
    setV(n);
    setD(draftOf(n));
  };
  useEffect(() => {
    api<NetView>('/network')
      .then(take)
      .catch((e) => setErr(e.message));
  }, []);
  if (!v || !d) return err ? <p className="err">{err}</p> : <p className="mut">Loading…</p>;
  const problem = draftProblem(d, v.hasCert),
    same = JSON.stringify(netBody(d)) === JSON.stringify(netBody(draftOf(v)));
  const save = () => {
    setBusy(true);
    setErr('');
    setMsg('');
    api<NetView>('/network', 'PUT', netBody(d))
      .then((n) => {
        // the address this browser uses may have changed (port, HTTPS): it follows PANOPTICA there
        const to = movedTo(n.local);
        if (to) {
          setMsg(`Saved. Opening ${to}…`);
          setTimeout(() => location.assign(to + '/' + location.hash), 1200);
          return;
        }
        take(n);
        setMsg('Saved');
      })
      .catch((e) => setErr(e.message.replace(/^./, (c: string) => c.toUpperCase()) + '.'))
      .finally(() => setBusy(false));
  };
  const c = v.certificate;
  return (
    <div className="net">
      <section className="group">
        <dl className="lic-list">
          <dt>Who can open it</dt>
          <dd>
            {v.open === 'network' ? 'The network' : 'This computer only'}
            {v.open === 'network' && v.firewall && <div className="mut small">The firewall lets the network in.</div>}
          </dd>
          <dt>Address</dt>
          <dd>
            {v.url ? <b className="net-url">{v.url}</b> : <span className="mut">None given</span>}
            <div className="mut small">On this computer: {v.local}</div>
          </dd>
          <dt>Connection</dt>
          <dd>
            {v.https ? 'HTTPS' : 'HTTP, not encrypted'}, port {v.port}
            {v.redirect && <div className="mut small">Port 80 sends people on to HTTPS.</div>}
          </dd>
          {c && (
            <>
              <dt>Certificate</dt>
              <dd>
                {c.names.join(', ') || c.subject}
                <div className={'small ' + (c.days <= 30 ? 'warn-text' : 'mut')}>
                  {c.days <= 0
                    ? `Expired on ${dmy(c.to)}: browsers warn everyone. Ask IT for a new one.`
                    : `Valid until ${dmy(c.to)}${c.days <= 30 ? ` (${c.days} ${c.days === 1 ? 'day' : 'days'} left): ask IT for a new one` : ''}.`}
                </div>
              </dd>
            </>
          )}
        </dl>
        {v.note && <p className="warn-text small">{v.note}.</p>}
      </section>
      {v.here ? (
        <>
          <h3 className="sub">Change</h3>
          <section className="group net-form">
            <NetworkFields d={d} set={(p) => setD({ ...d, ...p })} hasCert={v.hasCert} />
            {err && <p className="err small">{err}</p>}
            <div className="inline">
              <button className="btn" disabled={busy || same || !!problem} onClick={save}>
                {busy ? 'Checking and saving…' : 'Save'}
              </button>
              {!same && problem && <span className="err small">{problem}</span>}
              {msg && <span className="mut small">{msg}</span>}
            </div>
            <p className="mut small">If the address, port or certificate is wrong, nothing changes.</p>
          </section>
        </>
      ) : (
        <p className="mut small">To change these, open PANOPTICA on the computer that runs it.</p>
      )}
    </div>
  );
}
