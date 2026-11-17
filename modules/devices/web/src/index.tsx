import Batches from './views/Batches';
import Library from './lib/Library';
import { KINDS } from './recipes';
import IvPage from './iv/IvPage';
import Comparisons from './compare/Comparisons';
import type { Page, WebModule } from '@web/modules/types';
import { devicesOverview } from './overview';
import Tray from './Tray';
import RunCapture from './RunCapture';
import PackageOverlay from './PackageOverlay';
import RunSheetTab, { RunToday } from './phone/RunSheet';
import { Clipboard } from '@web/Icons';

/**
 * Electronic Devices on screen (0.42): its pages in the side menu, in the order work happens: make devices (Fabrication, with the
 * core's Calendar), measure them (Measurements), the procedures they use (Recipes, Designs). Its part of the Overview.
 */
const Soon = ({ title, text }: { title: string; text: string }) => (
  <>
    <h2>{title}</h2>
    <section className="group">
      <p className="mut">{text}</p>
    </section>
  </>
);
const recipe = (key: 's0' | 's1' | 's2' | 's3' | 's4' | 'sub' | 'mask', label: string): Page => ({
  key,
  label,
  render: (p) => <Library kind={KINDS[key]} openId={p.openId} />,
});

const devices: WebModule = {
  id: 'devices',
  groups: [
    {
      group: 'Fabrication',
      tab: 'Fabrication',
      pages: [
        {
          key: 'stk',
          label: 'Stacks',
          render: (p) => <Library kind={KINDS.stk} openId={p.openId} onOpenBatch={(id) => p.open('batches', id)} />,
        },
        {
          key: 'batches',
          label: 'Batches',
          render: (p) => (
            <Batches
              openId={p.openId}
              onOpen={p.onOpen}
              onOpenIv={(id) => p.open('iv', id)}
              onSchedule={(id) => p.open('cal', null, { schedule: id })}
            />
          ),
        },
        'cal',
      ],
    },
    {
      group: 'Measurements',
      tab: 'Measurements',
      pages: [
        { key: 'iv', label: 'J–V curves', render: (p) => <IvPage openId={p.openId} onOpen={p.onOpen} /> },
        { key: 'life', label: 'Lifetime', render: (p) => <IvPage mode="life" openId={p.openId} onOpen={p.onOpen} /> },
        { key: 'cmp', label: 'Comparisons', render: (p) => <Comparisons openId={p.openId} onOpen={p.onOpen} /> },
      ],
    },
    {
      group: 'Recipes',
      tab: 'Recipes',
      pages: [
        recipe('s0', 'Substrate preparation'),
        recipe('s1', 'Solutions'),
        recipe('s2', 'Spin coating'),
        recipe('s3', 'Organic evaporation'),
        recipe('s4', 'Metal evaporation'),
        {
          key: 's5',
          label: 'Evaporated perovskite',
          render: () => (
            <Soon
              title="Evaporated perovskite"
              text="Soon to be added: recipes for perovskite films made by (co-)evaporation of the precursors, with sources, rates and substrate temperature."
            />
          ),
        },
      ],
    },
    { group: 'Designs', pages: [recipe('sub', 'Substrates'), recipe('mask', 'Metal masks')] },
  ],
  overview: devicesOverview,
  calendarTray: { param: 'schedule', Tray },
  afterOutcome: { batch: RunCapture },
  Overlay: PackageOverlay,
  // the phone layout (0.55): Run sheet in the bottom bar, the person's batches on Today; links to batches open there
  phone: {
    tab: { key: 'run', label: 'Run sheet', Icon: Clipboard, render: RunSheetTab },
    Today: RunToday,
    views: { batches: 'run' },
  },
};
export default devices;
