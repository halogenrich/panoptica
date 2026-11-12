/** Downloads a figure as SVG, or as PNG at `scale` times its size (3 for figures, about 2 for full slides). */
export async function exportSvg(svg: SVGSVGElement, name: string, as: 'svg' | 'png', scale = 3) {
  const xml = new XMLSerializer().serializeToString(svg),
    blob = new Blob([xml], { type: 'image/svg+xml' });
  const save = (b: Blob, ext: string) => {
    const a = document.createElement('a'),
      u = URL.createObjectURL(b);
    a.href = u;
    a.download = `${name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  if (as === 'svg') return save(blob, 'svg');
  const img = new Image(),
    url = URL.createObjectURL(blob);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('could not render the figure'));
    img.src = url;
  });
  const vb = svg.viewBox.baseVal,
    k = scale,
    c = document.createElement('canvas');
  c.width = (vb?.width || 700) * k;
  c.height = (vb?.height || 500) * k;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => b && save(b, 'png'), 'image/png');
}
