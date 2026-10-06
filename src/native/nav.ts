import { ICON } from './kit';

// The map of the game: dock groups, the screens in each (a sub-navigation when there are several),
// and which screen a path belongs to (detail paths like /profile/<name> or /market/<id>).

export type ScreenId = 'booster' | 'battles' | 'battle' | 'home' | 'collection' | 'catalog' | 'profile' | 'player' | 'market' | 'trades' | 'friends' | 'dms' | 'guild' | 'achievements' | 'leaderboard' | 'settings';
export type Group = { id: string; label: string; icon: string; items: { id: ScreenId; path: string; label: string }[] };

export const GROUPS: Group[] = [
  {
    id: 'play',
    label: 'JOUER',
    icon: ICON.booster,
    items: [
      { id: 'booster', path: '/', label: 'Paquets' },
      { id: 'battles', path: '/battle', label: 'Batailles' },
    ],
  },
  {
    id: 'collection',
    label: 'COLLECTION',
    icon: ICON.collection,
    items: [
      { id: 'collection', path: '/collection', label: 'Mes cartes' },
      { id: 'catalog', path: '/global-collection', label: 'Catalogue' },
      { id: 'profile', path: '/profile', label: 'Mon profil' },
    ],
  },
  { id: 'market', label: 'MARCHÉ', icon: ICON.market, items: [{ id: 'market', path: '/market', label: 'Marché' }] },
  { id: 'trades', label: 'ÉCHANGES', icon: ICON.trades, items: [{ id: 'trades', path: '/trades', label: 'Échanges' }] },
  {
    id: 'social',
    label: 'SOCIAL',
    icon: ICON.people,
    items: [
      { id: 'friends', path: '/friends', label: 'Amis' },
      { id: 'dms', path: '/dms', label: 'Messages' },
      { id: 'guild', path: '/guild', label: 'Guilde' },
    ],
  },
  {
    id: 'progress',
    label: 'PROGRÈS',
    icon: ICON.trophy,
    items: [
      { id: 'home', path: '/home', label: 'Aujourd’hui' },
      { id: 'achievements', path: '/achievements', label: 'Succès' },
      { id: 'leaderboard', path: '/leaderboard', label: 'Classement' },
    ],
  },
];

export const TITLES: Record<ScreenId, string> = {
  booster: 'Booster',
  battles: 'Batailles',
  battle: 'Bataille',
  home: 'Aujourd’hui',
  collection: 'Collection',
  catalog: 'Catalogue',
  profile: 'Profil',
  player: 'Joueur',
  market: 'Marché',
  trades: 'Échanges',
  friends: 'Amis',
  dms: 'Messages',
  guild: 'Guilde',
  achievements: 'Succès',
  leaderboard: 'Classement',
  settings: 'Réglages',
};

/** The screen for a path, or null (unknown path). */
export function screenOf(path: string): ScreenId | null {
  if (path === '/' || path === '/pulls') return 'booster';
  if (/^\/profile\/[^/]+$/.test(path)) return 'player';
  if (/^\/battle\/[0-9a-f-]{36}$/.test(path)) return 'battle';
  if (/^\/market(\/[0-9a-f-]{36})?$/.test(path) || path === '/marketplace') return 'market';
  if (path === '/settings') return 'settings';
  for (const g of GROUPS) for (const i of g.items) if (i.path === path) return i.id;
  return null;
}

export function groupOf(screen: ScreenId): Group | undefined {
  const id = screen === 'player' ? 'social' : screen === 'battle' ? 'play' : screen === 'settings' ? null : undefined;
  if (id === null) return undefined;
  return GROUPS.find((g) => (id ? g.id === id : g.items.some((i) => i.id === screen)));
}
