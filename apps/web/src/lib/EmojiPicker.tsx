import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import dataSource from 'emoji-picker-element-data/en/emojibase/data.json?url';

/**
 * The emoji keyboard (search, categories, skin tones, recently used), loaded on first use. The emoji data is served by the app
 * itself, so it works without internet.
 */
export default function EmojiPicker({
  onPick,
  onClose,
  anchor,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  anchor?: HTMLElement | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  // drawn on the page itself (not inside the dialog, which would clip it): below the button, or above when there is no room
  useLayoutEffect(() => {
    if (!anchor || innerWidth <= 760) {
      setPos({});
      return;
    }
    const r = anchor.getBoundingClientRect(),
      W = 340,
      H = 350,
      below = innerHeight - r.bottom > H + 12;
    setPos({
      left: Math.max(8, Math.min(r.left, innerWidth - W - 8)),
      top: below ? r.bottom + 6 : Math.max(8, r.top - H - 6),
    });
  }, [anchor]);
  useEffect(() => {
    let el: HTMLElement | null = null,
      alive = true;
    import('emoji-picker-element').then(({ Picker }) => {
      if (!alive || !host.current) return;
      const dark =
        document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      el = new Picker({ dataSource, locale: 'en' }) as unknown as HTMLElement;
      el.className = dark ? 'dark' : 'light';
      el.addEventListener('emoji-click', (e: any) => {
        const u = e.detail?.unicode;
        if (u) onPick(u);
      });
      host.current.appendChild(el);
      (el.shadowRoot?.querySelector('input') as HTMLInputElement | null)?.focus();
    });
    const away = (e: MouseEvent) => {
      if (host.current && !host.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    const move = () => onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', move);
    return () => {
      alive = false;
      el?.remove();
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', move);
    };
  }, []);
  return createPortal(
    <div ref={host} className="emoji-pop" style={pos} role="dialog" aria-label="Choose an emoji" />,
    document.body,
  );
}
