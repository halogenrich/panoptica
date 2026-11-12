import { Suspense, lazy, useEffect, useState } from 'react';
import type { PackSel } from './lib/datapack';
const DataPackage = lazy(() => import('./lib/DataPackage'));

/** The data package window: opened from anywhere in the module (batches, measurements) with a `psc-datapack` event. */
export default function PackageOverlay() {
  const [pack, setPack] = useState<PackSel | null>(null);
  useEffect(() => {
    const f = (e: Event) => setPack((e as CustomEvent<PackSel>).detail);
    window.addEventListener('psc-datapack', f);
    return () => window.removeEventListener('psc-datapack', f);
  }, []);
  return pack ? (
    <Suspense fallback={null}>
      <DataPackage initial={pack} onClose={() => setPack(null)} />
    </Suspense>
  ) : null;
}
