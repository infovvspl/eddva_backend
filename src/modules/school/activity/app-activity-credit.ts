/**
 * Pure rules for crediting active time from app-wide activity heartbeats.
 *
 * Same shape as learning-path/activity/activity-credit.ts (kept separate, not
 * imported, so the AI Study Plan's existing tracker is never affected by
 * changes here): the server never credits more than wall-clock time since the
 * caller's last credit, across all tabs/devices, bounded by a per-beat and a
 * daily cap.
 */

export const APP_ACTIVITY_CATEGORIES = [
  'games',
  'study_materials',
  'assignments',
  'assessments_other',
  'doubts',
  'career',
  'video_lectures',
  'battle_arena',
  'chat_ai',
  'nav',
] as const;
export type AppActivityCategory = (typeof APP_ACTIVITY_CATEGORIES)[number];

export const MAX_BEAT_SECONDS = 20;
export const CLOCK_TOLERANCE_SECONDS = 2;
export const DAILY_CAP_SECONDS = 12 * 60 * 60;
/** A pause longer than this, or a change of category/ref, starts a new visit. */
export const SESSION_GAP_SECONDS = 5 * 60;

export interface CreditInput {
  beats: number[];
  now: Date;
  lastCreditAt: Date | null;
  creditedTodaySeconds: number;
}

export function creditSeconds({ beats, now, lastCreditAt, creditedTodaySeconds }: CreditInput): number {
  const claimed = beats.reduce((sum, s) => sum + Math.min(Math.max(Math.floor(Number(s) || 0), 0), MAX_BEAT_SECONDS), 0);
  const elapsed = lastCreditAt
    ? Math.max(0, Math.floor((now.getTime() - lastCreditAt.getTime()) / 1000)) + CLOCK_TOLERANCE_SECONDS
    : Number.POSITIVE_INFINITY;
  const leftToday = Math.max(0, DAILY_CAP_SECONDS - creditedTodaySeconds);
  return Math.max(0, Math.min(claimed, elapsed, leftToday));
}

export function continuesSession(
  current: { key: string | null; lastHeartbeatAt: Date | null },
  key: string,
  now: Date,
): boolean {
  if (!current.key || current.key !== key || !current.lastHeartbeatAt) return false;
  return (now.getTime() - current.lastHeartbeatAt.getTime()) / 1000 <= SESSION_GAP_SECONDS;
}

/** The IST calendar day a moment falls on (reports and caps are per Indian school day), matching every other screen-time table. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
