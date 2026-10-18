import { ACTOR_IDS, type ActorId } from '@escape/contracts';

import { KENJI_PALETTE, ROSA_PALETTE } from './sprites/characters';

/** Presentation metadata for the characters (colours shared by canvas labels and the trace). */
export const ACTOR_VIEW: Record<ActorId, { name: string; short: string; color: string; palette: number; hueShift: number; numId: number }> = {
  alex: { name: 'Alex', short: 'Warden', color: '#f5a524', palette: 0, hueShift: 0, numId: 1 },
  maya: { name: 'Maya', short: 'Employee', color: '#c27bff', palette: 5, hueShift: 0, numId: 2 },
  daniel: { name: 'Daniel', short: 'Visitor', color: '#3fd0c4', palette: 0, hueShift: 0, numId: 3 },
  rosa: { name: 'Rosa', short: 'Reception', color: '#ff7aa2', palette: ROSA_PALETTE, hueShift: 0, numId: 4 },
  kenji: { name: 'Kenji', short: 'IT', color: '#8ed100', palette: KENJI_PALETTE, hueShift: 0, numId: 5 },
};

export const ACTOR_ORDER: ActorId[] = [...ACTOR_IDS];
