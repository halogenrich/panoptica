import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Seg<T extends string>({
  value,
  opts,
  on,
  small,
}: {
  value: T;
  opts: [T, ReactNode][];
  on: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className={'seg' + (small ? ' sm' : '')} role="tablist">
      {opts.map(([k, l]) => (
        <button
          key={k}
          role="tab"
          aria-selected={k === value}
          className={k === value ? 'on' : ''}
          onClick={() => on(k)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const openModals: number[] = [];
let modalSeq = 0;

/**
 * Centered sheet on desktop, full screen on phones, rendered on top of the page so sheets can open inside other sheets.
 * Escape and the backdrop close only the topmost one (the caller guards unsaved changes).
 */
export function Modal({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  const id = useRef(++modalSeq).current,
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    openModals.push(id);
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === id) {
        e.stopImmediatePropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, []);
  return createPortal(
    <div
      className="scrim modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Prints one piece of content on its own (e.g. a run sheet from inside a sheet), instead of the whole screen. */
export function usePrint() {
  const [node, setNode] = useState<ReactNode>(null);
  useEffect(() => {
    if (!node) return;
    document.body.classList.add('print-mode');
    const t = setTimeout(() => {
      window.print();
      document.body.classList.remove('print-mode');
      setNode(null);
    }, 80);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('print-mode');
    };
  }, [node]);
  return {
    print: (n: ReactNode) => setNode(n),
    portal: node ? createPortal(<div className="print-portal">{node}</div>, document.body) : null,
  };
}

export function useToast() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  return {
    show: setMsg,
    node: msg ? (
      <div className="toast" role="status">
        {msg}
      </div>
    ) : null,
  };
}

export const Badge = ({ children, tone }: { children: ReactNode; tone?: 'ac' | 'warn' | 'err' }) => (
  <span className={'badge' + (tone ? ' ' + tone : '')}>{children}</span>
);

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg
        width="56"
        height="56"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" />
        <path d="M7.5 15h9" />
      </svg>
      <h3>{title}</h3>
      <p className="mut">{text}</p>
      {action}
    </div>
  );
}

export const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
  return isNaN(+d) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
