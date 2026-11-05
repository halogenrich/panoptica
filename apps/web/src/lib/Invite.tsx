import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api } from '../api';

type Net = { lan: boolean; port: number; host: string; addresses: { name: string; address: string }[] };

/** QR code as an SVG (dark modules as one path), with a quiet zone of 4 modules. */
function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${n + 8} ${n + 8}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${text}`}
    >
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/**
 * Invite a phone or another computer: the address of this app on the local network as a QR code. Works only when the app
 * was started for the network; otherwise explains how.
 */
export default function Invite({ onClose }: { onClose: () => void }) {
  const [net, setNet] = useState<Net | null>(null),
    [err, setErr] = useState(''),
    [pick, setPick] = useState(0),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    api<Net>('/network')
      .then(setNet)
      .catch((e) => setErr(e.message));
  }, []);
  // opened from another device already: that address works, offer it first
  const here = location.hostname,
    remote = here !== 'localhost' && here !== '127.0.0.1' && here !== '::1';
  const urls = net
    ? [
        ...new Set([
          ...(remote ? [location.origin] : []),
          ...net.addresses.map((a) => `http://${a.address}:${location.port || net.port}`),
        ]),
      ]
    : [];
  const url = urls[Math.min(pick, urls.length - 1)];
  const copy = () =>
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal invite" role="dialog" aria-label="Invite to Perovskite Lab">
        <div className="modal-head">
          <b>Open on a phone or another computer</b>
          <div className="grow" />
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="invite-body">
          {err && <p className="err">{err}</p>}
          {!net && !err && <p className="mut">Looking up the network address…</p>}
          {net && !net.lan && !remote && (
            <div className="notice">
              <p>
                <b>Only this computer can open the app right now.</b>
              </p>
              <p>
                Close the app window and start it with <b>start-network</b> (start-network.bat on Windows,
                start-network.command on Mac, start-network.sh on Linux). Then open this again: it shows a QR code to
                scan.
              </p>
            </div>
          )}
          {net &&
            (net.lan || remote) &&
            (urls.length ? (
              <>
                <Qr text={url} />
                <a className="invite-url" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
                <div className="inline">
                  <button className="link" onClick={copy}>
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                {urls.length > 1 && (
                  <label className="inline small">
                    Network{' '}
                    <select value={pick} onChange={(e) => setPick(+e.target.value)}>
                      {urls.map((u, i) => (
                        <option key={u} value={i}>
                          {u.replace(/^http:\/\//, '')}
                          {net.addresses.find((a) => u.includes(a.address))
                            ? ` (${net.addresses.find((a) => u.includes(a.address))!.name})`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <ul className="small mut invite-steps">
                  <li>Scan with the phone camera; it opens the app in the browser.</li>
                  <li>
                    The phone must be on the same Wi-Fi or network as this computer. Networks like eduroam may block it;
                    a lab router or a phone hotspot works.
                  </li>
                  <li>Each person signs in with their own account (Admin settings › Users).</li>
                </ul>
              </>
            ) : (
              <p className="err">This computer has no network address. Connect it to Wi-Fi or a cable and try again.</p>
            ))}
        </div>
      </div>
    </div>
  );
}
