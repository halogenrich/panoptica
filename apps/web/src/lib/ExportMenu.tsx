import { useEffect, useRef, useState } from 'react';

/** One way to export across the app: an "Export" button that opens titled sections, each row with its formats. */
export type ExportRow = [label: string, formats: [format: string, run: () => void][]];
export type ExportSection = [title: string, rows: ExportRow[]];

/** PNG and SVG for a figure. */
export const pngSvg = (fn: (as: 'png' | 'svg') => void): [string, () => void][] => [
  ['PNG', () => fn('png')],
  ['SVG', () => fn('svg')],
];

export default function ExportMenu({
  sections,
  disabled = false,
  label = 'Export',
  primary = false,
}: {
  sections: ExportSection[];
  disabled?: boolean;
  label?: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', f);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', f);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div className="ov-exp" ref={ref}>
      <button
        className={'btn small-btn' + (primary ? '' : ' secondary')}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div className="ov-exp-menu cx-exp-menu" role="menu">
          {sections
            .filter(([, rows]) => rows.length)
            .map(([title, rows]) => (
              <div key={title} className="cx-exp-sec">
                <div className="cx-exp-title">{title}</div>
                {rows.map(([l, fmts]) => (
                  <div key={l} className="ov-exp-row">
                    <span>{l}</span>
                    {fmts.map(([f, run]) => (
                      <button
                        key={f}
                        className="link"
                        role="menuitem"
                        onClick={() => {
                          run();
                          setOpen(false);
                        }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
