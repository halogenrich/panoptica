import { createContext, useContext, type ReactNode } from 'react';

/** Inside a batch, write-in cells become inputs bound to the batch record; on paper they are blank lines. */
export const MeasCtx = createContext<{
  v: Record<string, string>;
  set: (k: string, v: string) => void;
  ro: boolean;
} | null>(null);

export const Bl = ({ k }: { k?: string }) => {
  const c = useContext(MeasCtx);
  return c && k ? (
    <input value={c.v[k] ?? ''} readOnly={c.ro} onChange={(e) => c.set(k, e.target.value)} />
  ) : (
    <span className="bl" />
  );
};

export const T = ({ h, rows }: { h: ReactNode[]; rows: ReactNode[][] }) => (
  <table>
    <thead>
      <tr>
        {h.map((x, i) => (
          <th key={i}>{x}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => (
            <td key={j}>{c}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** Adds a write-in column only for printed sheets. */
export const withBlank = (
  blanks: boolean | undefined,
  h: ReactNode[],
  rows: ReactNode[][],
  label: string,
  keys: (string | undefined)[],
) => (blanks ? { h: [...h, label], rows: rows.map((r, i) => [...r, <Bl k={keys[i]} />]) } : { h, rows });

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="group">
    <h3>{title}</h3>
    {children}
  </section>
);

/** Chemical formula with subscripts: Cs0.05FA0.95PbI3 -> Cs₀.₀₅FA₀.₉₅PbI₃ */
export const Formula = ({ f }: { f: string }) => (
  <>{f.split(/((?<=[A-Za-z)\]])\d+(?:\.\d+)?)/).map((p, i) => (i % 2 ? <sub key={i}>{p}</sub> : p))}</>
); // digits after a letter or ")": (4AMP) keeps its 4

export const fix = (n: number, d = 2) => (isFinite(n) ? +n.toFixed(d) : 0).toString();
