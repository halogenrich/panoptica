import { applyVariant } from '@psc/devices';
import { JvFigure } from './iv/JvFigure';
import { fmt, infoOfSnap, type Curve, type Link } from './iv/model';

/**
 * Electronic Devices on the lab screen (0.59): the best device of the calendar week (Monday to now, Richard), with its J–V curve
 * in the house figure style. 0.60.1: smaller, Voc, Jsc and FF under the PCE and the figure to its right, so today's bookings fit
 * below it. The screen is not signed in, so the server sends the device's frozen stack with it and the figure
 * is handed its layers and the logo's address.
 */
type Best = {
  pce: number;
  set: { id: number; name: string; date: string };
  owner: string;
  sample: string;
  substrate: string;
  pixel: string;
  bestId: number;
  curves: Curve[];
  link: NonNullable<Link> | null;
  device: { snapshot: any; variant?: any } | null;
};

const dmy = (d: string) => d.split('-').reverse().join('/');

export default function ScreenBest({ m, logo }: { m: { best: Best | null }; logo: string }) {
  const b = m.best;
  return (
    <section className="ls-panel ls-best" aria-label="Best device this week">
      <h2>Best device this week</h2>
      {!b ? <p className="ls-empty">No devices measured this week yet.</p> : <Body b={b} logo={logo} />}
    </section>
  );
}

function Body({ b, logo }: { b: Best; logo: string }) {
  const best = b.curves.find((c) => c.id === b.bestId) ?? b.curves[0],
    snap = b.device ? applyVariant(b.device.snapshot, b.device.variant ?? null) : null,
    label = b.link?.label ?? b.sample.replace(/_/g, ' ');
  return (
    <div className="ls-best-body">
      <div className="ls-best-head">
        <p className="ls-pce">
          <span className="ls-pce-v">{fmt(b.pce)}</span>
          <span className="ls-pce-u">% PCE</span>
        </p>
        <dl className="ls-facts">
          <div>
            <dt>Voc</dt>
            <dd>{fmt(best.m.voc, 3)} V</dd>
          </div>
          <div>
            <dt>Jsc</dt>
            <dd>{fmt(best.m.jsc)} mA/cm²</dd>
          </div>
          <div>
            <dt>FF</dt>
            <dd>{fmt(best.m.ff)} %</dd>
          </div>
        </dl>
        <p className="ls-who">
          <b>{b.owner}</b>
          <span>
            {label} <span className="ls-mut">· measured {dmy(b.set.date)}</span>
          </span>
        </p>
      </div>
      <div className="ls-fig">
        <JvFigure
          curves={b.curves}
          best={best}
          title={`${label} · substrate ${b.substrate} · pixel ${b.pixel}`}
          link={b.link}
          given={{ wm: logo, info: infoOfSnap(snap) }}
        />
      </div>
    </div>
  );
}
