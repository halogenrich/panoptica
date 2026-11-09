import { useEffect, useRef, useState } from 'react';

const OUT = 256; // stored photo size (px, square)

/** Square crop of a chosen picture: drag to move, slider to zoom, saved as a 256 px JPEG. */
export default function Cropper({
  src,
  onSave,
  onCancel,
}: {
  src: string;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null),
    img = useRef<HTMLImageElement | null>(null);
  const [z, setZ] = useState(1),
    [off, setOff] = useState<[number, number]>([0, 0]),
    [ready, setReady] = useState(false),
    drag = useRef<[number, number] | null>(null);
  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      img.current = i;
      setReady(true);
    };
    i.src = src;
  }, [src]);
  // the picture covers the square at zoom 1; offsets are kept inside so no empty edge shows
  const geom = () => {
    const i = img.current!,
      base = OUT / Math.min(i.width, i.height),
      s = base * z,
      w = i.width * s,
      h = i.height * s;
    const cx = Math.max(-(w - OUT) / 2, Math.min((w - OUT) / 2, off[0])),
      cy = Math.max(-(h - OUT) / 2, Math.min((h - OUT) / 2, off[1]));
    return { w, h, x: (OUT - w) / 2 + cx, y: (OUT - h) / 2 + cy, cx, cy };
  };
  useEffect(() => {
    if (!ready || !cv.current) return;
    const g = cv.current.getContext('2d')!,
      { w, h, x, y } = geom();
    g.fillStyle = '#fff';
    g.fillRect(0, 0, OUT, OUT);
    g.drawImage(img.current!, x, y, w, h);
  });
  const k = () => OUT / (cv.current?.getBoundingClientRect().width || OUT);
  return (
    <div className="cropper">
      <canvas
        ref={cv}
        width={OUT}
        height={OUT}
        className="crop-canvas"
        aria-label="Photo crop: drag to move"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = [e.clientX, e.clientY];
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const [x0, y0] = drag.current,
            { cx, cy } = geom();
          drag.current = [e.clientX, e.clientY];
          setOff([cx + (e.clientX - x0) * k(), cy + (e.clientY - y0) * k()]);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      <label className="inline small">
        Zoom <input type="range" min={1} max={4} step={0.01} value={z} onChange={(e) => setZ(+e.target.value)} />
      </label>
      <div className="inline">
        <button
          type="button"
          className="btn"
          disabled={!ready}
          onClick={() => onSave(cv.current!.toDataURL('image/jpeg', 0.86))}
        >
          Use this photo
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
