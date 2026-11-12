import type { FC, ReactNode } from 'react';
import type { Me } from '../ctx';
import type { Booking, Eq } from '../views/Calendar';

/**
 * What a module adds to the app's screens (0.42): its pages, grouped in the side menu, and its part of the Overview. The core
 * (Shell, Overview) only knows modules through this, never by name.
 */

/** Opens a page, and an item on it; `extra` carries what a page needs besides the id (the calendar's batch to schedule). */
export type Open = (view: string, id?: number | null, extra?: Record<string, unknown>) => void;
export type PageProps = {
  me: Me;
  openId: number | null;
  onOpen: (id: number | null) => void;
  open: Open;
  extra: Record<string, unknown>;
  /** the installed modules (the Calendar looks for a tray among them) */
  modules: WebModule[];
};
export type Page = { key: string; label: string; short?: string; render: (p: PageProps) => ReactNode };
/**
 * A heading in the side menu. `pages` are the module's own, or the key of a core page to show in this group ('cal'): a core page
 * no module places keeps its own spot. `tab` makes the group a tab on phones.
 */
export type Group = { group: string; tab?: string; pages: (Page | string)[] };

/** One number on the Overview: a plain label, one big value, one line of context. */
export type Stat = { label: string; value: string; note?: ReactNode; tone?: 'best' | 'median' };
/** How the Overview names whose it is ('The lab', 'You'). */
export type Who = { subj: string; title: string; record: string };
/** The core's part of the period overview (people, equipment, steps that did not go as planned), as the server sends it. */
export type CoreDash = {
  from: string;
  to: string;
  unit: 'week' | 'month';
  lab: { hours: number; workHours: number };
  digest: {
    setbacks: {
      id: number;
      outcome: string;
      reason: string;
      equipment: string;
      subject: string;
      step: string;
      user: string;
      start: string;
    }[];
    waiting: number;
  };
};
export type SumProps<M = any> = { m: M; d: CoreDash; who: Who; label: string; open: Open };
export type PersonProps<M = any> = { m: M; open: Open };

export type OverviewPart<M = any, PM = any, P = any> = {
  /** the opening sentences of the summary */
  lede(m: M, who: Who, period: string): string;
  stats(m: M): Stat[];
  /** what one person did in the period, in a few words each (empty: nothing) */
  doing(pm: PM): string[];
  /** they did something in the period (by default: `doing` says something) */
  active?(pm: PM): boolean;
  /** above the numbers (a new record), below them (charts), and folded at the end */
  Lead?: FC<SumProps<M>>;
  Body?: FC<SumProps<M>>;
  Details?: FC<SumProps<M>>;
  /** "Export for a presentation" */
  Export?: FC<SumProps<M> & { onClose: () => void }>;
  /** one person's page: numbers, charts and lists, and what their slide shows */
  Person?: FC<PersonProps<P>>;
  personSlide?(p: P): { numbers: [string, string][]; body?: (y: number) => ReactNode };
};

/** A block a module's calendar tray hands to the Calendar to drag onto a day and time (0.43). */
export type TrayDrag = {
  eq: number;
  /** minutes */
  dur: number;
  color: string;
  label: string;
  /** where the pointer holds it, in minutes from its start */
  grab: number;
  /** books it at the time it was dropped on */
  book(start: string, end: string): Promise<{ offHours?: boolean }>;
};
export type TrayProps = {
  /** what the Calendar was opened with (the batch to schedule) */
  id: number;
  eqs: Eq[];
  trained: number[];
  isAdmin: boolean;
  /** a phone: the tray does not fit */
  narrow: boolean;
  /** changes when bookings did: read them again */
  version: number;
  onDrag(d: TrayDrag): void;
  close(): void;
  open: Open;
};

export type WebModule = {
  id: string;
  groups: Group[];
  overview?: OverviewPart;
  /** a tray under the Calendar, when the Calendar is opened with `extra[param]` (Electronic Devices: a batch to schedule) */
  calendarTray?: { param: string; Tray: FC<TrayProps> };
  /** after "Concluded" for one of its subjects ('batch'): what the module asks next (the run data); `onClose` when done */
  afterOutcome?: Record<string, FC<{ booking: Booking; onClose: () => void }>>;
  /** always mounted next to the pages (windows a module opens from anywhere, such as the data package) */
  Overlay?: FC;
};
