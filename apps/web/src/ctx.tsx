import { createContext } from 'react';

export type Tag = {
  id: number;
  name: string;
  color: string;
  kind: 'label' | 'professor' | 'manager' | 'inventory';
  /** what it gives (0.38): comments, overview, inventory, equipment, training */
  perms?: string[];
  n?: number;
  people?: { id: number; name: string; photoV?: number }[];
};
export type Me = {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'member';
  mustChange?: number | boolean;
  photoV?: number;
  tags?: Tag[];
  professor?: boolean;
  manager?: boolean;
  inventory?: boolean;
  /** manages all equipment */
  equipment?: boolean;
  /** trains people on any equipment */
  training?: boolean;
  email?: string;
  birthDate?: string;
  department?: string;
  supervisor?: string;
  cosupervisor?: string;
  showBirthday?: boolean;
  visitorUntil?: string | null;
  firstNames?: string;
  surnames?: string;
};
export type Prefs = {
  theme: 'system' | 'light' | 'dark';
  vis: 'private' | 'shared';
  logo?: boolean;
  eye?: boolean;
  news?: boolean;
};
export const PrefCtx = createContext<{ prefs: Prefs; set: (p: Partial<Prefs>) => void }>({
  prefs: { theme: 'system', vis: 'shared' },
  set: () => {},
});
/** The signed-in user, and a way to reload it after editing the profile. */
export const MeCtx = createContext<{ me: Me; reload: () => void }>({
  me: { id: 0, username: '', name: '', role: 'member' },
  reload: () => {},
});

/** What the sign-in screen knows about the lab, before anyone signs in. */
export type LabPublic = {
  /** the name the lab shows: its acronym or its full name, as it chose (0.49) */
  name: string;
  fullName?: string;
  acronym?: string;
  institution: string;
  departments: string[];
  domains: string[];
  hasLogo: boolean;
  hasBackground: boolean;
  bgV: number;
  /** where the logo sits on the picture: t/m/b + l/c/r */
  logoPos?: string;
  logoPlate?: boolean;
  hasInstLogo?: boolean;
  /** the foot of the sign-in panel: the institution's name, its logo, or both */
  foot?: 'name' | 'logo' | 'both';
  /** the lab's address as people open it (0.51), '' when it has none */
  url?: string;
  /** while there is no admin: 'here' on the computer that runs the app, 'elsewhere' on others */
  /** 'code' (0.46): from another computer, with the one-time setup code on the install sheet */
  setup: 'here' | 'code' | 'elsewhere' | null;
  professors: string[];
};
export const LabCtx = createContext<{ lab: LabPublic | null; reload: () => void }>({ lab: null, reload: () => {} });
/** "PANOPTICA · lab name" as text (titles, exports). */
export const brandText = (lab?: { name?: string } | null) => (lab?.name ? `PANOPTICA · ${lab.name}` : 'PANOPTICA');
