import { useEffect, useState } from 'react';

/**
 * The phone layout (0.55) opens by itself on a screen narrower than 760 px, the width where the desktop layout already
 * folded its side menu. "Full app" switches to the desktop layout on that phone (remembered in its browser), and the full
 * app's menu has "Phone layout" to come back.
 */
const QUERY = '(max-width: 760px)',
  KEY = 'psc-full-app';
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // private window
  }
};

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(QUERY).matches);
  useEffect(() => {
    const m = matchMedia(QUERY),
      f = () => setNarrow(m.matches);
    // Safari before 14 has only addListener
    if (m.addEventListener) m.addEventListener('change', f);
    else m.addListener(f);
    return () => (m.removeEventListener ? m.removeEventListener('change', f) : m.removeListener(f));
  }, []);
  return narrow;
}

/** [the phone layout is shown, switch to the full app (true) or back to the phone layout (false)] */
export function usePhone(): [boolean, (full: boolean) => void] {
  const narrow = useNarrow(),
    [full, setFull] = useState(read);
  const set = (v: boolean) => {
    try {
      if (v) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* private window: for this visit only */
    }
    setFull(v);
  };
  return [narrow && !full, set];
}
