import { createContext } from 'react';

export type Tag = {
  id: number;
  name: string;
  color: string;
  kind: 'label' | 'professor' | 'manager' | 'inventory';
  n?: number;
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
