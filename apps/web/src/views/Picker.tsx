import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { search } from '@psc/core';

/**
 * One choice of a picker (0.54): what is stored (`value`), what is shown (`short` when set, else `label`), and what else finds
 * it (other names, formula, CAS). `group` puts it under a heading ("Solvents", "Other substances"); `hint` is a note on the
 * right ("Not in stock").
 */
export type PickOption = {
  value: string;
  label: string;
  short?: string;
  other?: string[];
  hint?: string;
  group?: string;
};

/**
 * A text box with a ranked list under it (0.54), in place of a select for every list that grows with the lab's data: type part
 * of a name, a short name (DMF), another name, a formula or a CAS number. Arrow keys move, Enter picks, Escape gives up. With
 * `free`, a name that is not on the list can be used (a compound borrowed or still to be bought). The box never grows wider
 * than its place: a long name ends in "…" and shows whole in the list and on hover.
 */
export function Picker({
  value,
  options,
  onChange,
  free = false,
  label,
  placeholder = 'Type to search',
  empty,
  className = '',
  disabled = false,
}: {
  value: string;
  options: PickOption[];
  onChange: (v: string) => void;
  free?: boolean;
  /** what the box is for, for screen readers */
  label: string;
  placeholder?: string;
  /** shown in the box when nothing is picked */
  empty?: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId(),
    box = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value);
  const shown = cur ? cur.short || cur.label : value;
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(''),
    [typed, setTyped] = useState(false),
    [at, setAt] = useState(0),
    [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  // the whole list while nothing is typed; ranked matches once something is
  const hits = useMemo(
    () =>
      typed && q.trim()
        ? search(q, options, (o) => ({ label: o.label, short: o.short, other: o.other }))
        : // groups stay together, in the order they come
          options,
    [q, typed, options],
  );
  const exactly = hits.find((o) =>
    [o.value, o.label, o.short].some((x) => x && x.toLowerCase() === q.trim().toLowerCase()),
  );
  const exact = !!exactly;
  const useTyped = free && typed && !!q.trim() && !exact;
  const rows: (PickOption & { typed?: boolean })[] = [
    ...hits,
    ...(useTyped ? [{ value: q.trim(), label: q.trim(), typed: true }] : []),
  ];
  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom,
      up = below < 240 && r.top > below;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 260), up });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const f = () => place();
    window.addEventListener('scroll', f, true);
    window.addEventListener('resize', f);
    return () => {
      window.removeEventListener('scroll', f, true);
      window.removeEventListener('resize', f);
    };
  }, [open]);
  // the picked one in view when the list opens; the active one as the arrows move
  useEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);
  const start = () => {
    setQ(shown);
    setTyped(false);
    setAt(Math.max(0, options.indexOf(cur!)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setTyped(false);
  };
  const pick = (o: PickOption) => {
    if (o.value !== value) onChange(o.value);
    close();
  };
  // leaving the box: a free name typed is kept; otherwise what was picked stays
  const leave = () => {
    if (!open) return;
    if (useTyped) onChange(q.trim());
    else if (typed && exactly) pick(exactly);
    close();
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      e.preventDefault();
      start();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAt((i) => (rows.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = rows[at];
      if (o) pick(o);
      else close();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the dialog around it stays open
      close();
    } else if (e.key === 'Tab') leave();
  };
  let lastGroup: string | undefined;
  return (
    <span className={'picker ' + className}>
      <input
        ref={box}
        className="picker-box"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[at] ? `${id}-${at}` : undefined}
        autoComplete="off"
        disabled={disabled}
        spellCheck={false}
        value={open ? q : shown}
        placeholder={open ? placeholder : (empty ?? placeholder)}
        title={cur && cur.short && cur.short !== cur.label ? cur.label : shown}
        onFocus={(e) => {
          start();
          requestAnimationFrame(() => e.target.select());
        }}
        onMouseDown={() => {
          if (!open && document.activeElement === box.current) start();
        }}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQ(e.target.value);
          setTyped(true);
          setAt(0);
        }}
        onKeyDown={key}
        onBlur={leave}
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={label}
            className={'picker-list' + (pos.up ? ' up' : '')}
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            // clicks inside keep the box focused
            onMouseDown={(e) => e.preventDefault()}
          >
            {rows.map((o, i) => {
              const head = !typed && o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const main = o.short || o.label;
              return (
                <div key={(o.typed ? 'typed:' : '') + o.value} className="picker-item-wrap">
                  {head && <div className="picker-head">{head}</div>}
                  <div
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={i === at}
                    className={'picker-item' + (i === at ? ' on' : '') + (o.value === value ? ' cur' : '')}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => pick(o)}
                  >
                    {o.typed ? (
                      <span className="picker-name">
                        Use “{o.label}”<span className="picker-sub">Not in the inventory</span>
                      </span>
                    ) : (
                      <span className="picker-name">
                        <b>{main}</b>
                        {o.short && o.short !== o.label && <span className="picker-sub">{o.label}</span>}
                      </span>
                    )}
                    {o.hint && !o.typed && <span className="picker-hint">{o.hint}</span>}
                  </div>
                </div>
              );
            })}
            {!rows.length && <div className="picker-none">Nothing matches “{q.trim()}”.</div>}
          </div>,
          document.body,
        )}
    </span>
  );
}
