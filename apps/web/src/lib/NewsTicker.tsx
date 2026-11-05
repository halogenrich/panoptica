import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { HEADLINES, PROF_HEADLINES } from './news';
import type { Prof } from './Presence';

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);
type Phase = 'closed' | 'opening' | 'running' | 'closing';

/**
 * Breaking news in the header (a funny setting). One headline at a time: the strip opens from the middle out, the headline
 * crosses it once, then the strip folds from the sides to the middle and disappears. The next one comes after the pause an
 * admin sets for everyone (30 s by default). With the eye on too, about one headline in three is about the Professor while
 * she is online, and her arrival opens the strip at once with a red, shaking border. Reduced motion: no sliding or shaking.
 */
export default function NewsTicker({ name, profs }: { name: string; profs: Prof[] }) {
  const lab = useMemo(() => shuffle(HEADLINES), []), prof = useMemo(() => shuffle(PROF_HEADLINES), []);
  const [phase, setPhase] = useState<Phase>('closed'), [text, setText] = useState(''), [alarm, setAlarm] = useState(false), [n, setN] = useState(0);
  const [run, setRun] = useState<{ from: number; to: number; s: number } | null>(null), box = useRef<HTMLDivElement>(null), txt = useRef<HTMLSpanElement>(null);
  const gap = useRef(30), timer = useRef<number>(0), li = useRef(0), pi = useRef(0), seen = useRef<Set<number> | null>(null), profsRef = useRef(profs); profsRef.current = profs;
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fill = (s: string, p?: Prof) => s.replace(/\{name\}/g, name).replace(/\{prof\}/g, p?.name ?? 'The Professor');
  const open = (t: string, loud = false) => { clearTimeout(timer.current); setText(t); setAlarm(loud); setRun(null); setN((x) => x + 1); setPhase(still ? 'running' : 'opening'); };
  const next = () => {
    const ps = profsRef.current;
    open(ps.length && Math.random() < 0.35 ? fill(prof[pi.current++ % prof.length], ps[Math.floor(Math.random() * ps.length)]) : fill(lab[li.current++ % lab.length]));
  };
  const close = () => { setPhase(still ? 'closed' : 'closing'); if (still) wait(); };
  const wait = () => { clearTimeout(timer.current); timer.current = window.setTimeout(next, gap.current * 1000); };
  useEffect(() => {
    api<{ newsGap: number }>('/fun').then((f) => { gap.current = f.newsGap; }).catch(() => {});
    timer.current = window.setTimeout(next, 1500);
    return () => clearTimeout(timer.current);
  }, []);
  // her arrival opens the strip straight away
  useEffect(() => {
    const ids = new Set(profs.map((p) => p.id));
    if (seen.current) { const came = profs.find((p) => !seen.current!.has(p.id)); if (came) open(`BREAKING NEWS!! ${came.name} is here!!`, true); }
    seen.current = ids;
  }, [profs.map((p) => p.id).join()]);
  // once open: measure the headline and send it across once
  useLayoutEffect(() => {
    if (phase !== 'running') return;
    if (still) { timer.current = window.setTimeout(close, 9000); return; }
    const cw = box.current?.offsetWidth ?? 400, tw = txt.current?.offsetWidth ?? 400;
    setRun({ from: cw, to: -tw, s: (cw + tw) / 70 }); // 70 px per second
  }, [phase, n]);
  if (phase === 'closed') return <div className="news-slot" />;
  return (
    <div className="news-slot" aria-hidden>
      <div className={`news ${phase}${alarm ? ' alarm' : ''}`} onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.animationName === 'news-open') setPhase('running');
        else if (e.animationName === 'news-close') { setPhase('closed'); wait(); }
      }}>
        <span className="news-tag">Breaking news:</span>
        <div className="news-box" ref={box}>
          {phase !== 'opening' && <span key={n} ref={txt} className={'news-text' + (still ? ' still' : '') + (alarm ? ' loud' : '') + (run ? '' : ' wait')}
            style={run && !still ? ({ '--from': `${run.from}px`, '--to': `${run.to}px`, animationDuration: `${run.s}s` } as React.CSSProperties) : undefined}
            onAnimationEnd={(e) => { e.stopPropagation(); if (e.animationName === 'news-run') close(); }}>{text}</span>}
        </div>
      </div>
    </div>
  );
}
