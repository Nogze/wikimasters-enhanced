import { apiGet, apiSend } from './api';
import { rememberCards } from './cardCache';
import type { Card } from './types';

// Quiz battles: wiki-masters' /api/battles, through the adapter (src/ext/wm.ts).

type Person = { id: string; username: string };
type Question = { id: string; prompt: string; options: { id: string; text: string }[] };
export type PlayerState = { cardIds: string[]; usedCardIds?: string[]; currentHp: number; maxHp: number };
type Turn = { turnNumber?: number; attackerUserId?: string; defenderId?: string; attackCardId?: string; allCorrect: boolean; damageDealt: number; wrong?: number; total?: number };
export type GameState = {
  phase?: 'attack' | 'quiz' | 'over' | string;
  players: Record<string, PlayerState>;
  currentTurnUserId?: string;
  turnNumber?: number;
  pendingAttack?: { attackerUserId?: string; defenderId?: string; attackCardId: string; attackCardName?: string; questions: Question[]; answered?: string[] } | null;
  turnHistory: Turn[];
  winnerId?: string | null;
};
type BattleStatus = 'pending' | 'deck_selection' | 'generating_quizzes' | 'active' | 'completed' | 'cancelled';
export type Battle = {
  id: string;
  challenger_id: string;
  opponent_id: string;
  winner_id: string | null;
  status: BattleStatus | string;
  created_at: string;
  updated_at?: string;
  challenger: Person;
  opponent: Person;
  game_state?: GameState | null;
};
export type Quota = { used: number; limit: number; resets_at: string };
export type Detail = { battle: Battle; decks: { user_id: string; card_ids: string[] }[]; cards?: Card[] };
export type AnswerResult = { correct?: boolean; correct_answer_id?: string; last_turn?: Turn; status?: string };

export const STATUS: Record<string, string> = {
  pending: 'En attente',
  deck_selection: 'Choix des decks',
  generating_quizzes: 'Préparation des quiz',
  active: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};
export const DECK_SIZE = 3;

export const list = () => apiGet<{ battles: Battle[]; challenge_quota: Quota }>('/battles', { force: true });
export async function get(id: string) {
  const d = await apiGet<Detail>(`/battles/${id}`, { force: true });
  if (d.cards?.length) void rememberCards(d.cards);
  return d;
}
export const challenge = (opponentId: string) => apiSend<{ battle?: { id: string }; id?: string }>('POST', '/battles', { opponent_id: opponentId }, { invalidates: ['/battles'] });
export const act = <T = Record<string, unknown>>(id: string, body: Record<string, unknown>) => apiSend<T>('PATCH', `/battles/${id}`, body, { invalidates: ['/battles'] });
