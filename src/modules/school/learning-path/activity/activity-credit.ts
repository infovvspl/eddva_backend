/**
 * Pure rules for crediting active time from heartbeats.
 *
 * The client counts active seconds (tab visible, recent interaction, video
 * playing) and reports deltas. The server credits at most:
 *   - MAX_BEAT_SECONDS per heartbeat,
 *   - the wall-clock time since the student's last credited heartbeat
 *     (plus a little clock tolerance), across all their tabs and devices,
 *   - whatever is left of DAILY_CAP_SECONDS today.
 */

export const ACTIVITY_SECTIONS = ['home', 'videos', 'notes', 'quiz', 'assessment', 'chat'] as const;
export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];

export const MAX_BEAT_SECONDS = 20;
export const CLOCK_TOLERANCE_SECONDS = 2;
export const DAILY_CAP_SECONDS = 12 * 60 * 60;
/** A pause longer than this, or a change of section, starts a new visit. */
export const SESSION_GAP_SECONDS = 5 * 60;

export interface CreditInput {
  /** Seconds the client reports for each beat in this request. */
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

/** Whether this heartbeat continues the current visit or starts a new one. */
export function continuesSession(
  current: { key: string | null; lastHeartbeatAt: Date | null },
  key: string,
  now: Date,
): boolean {
  if (!current.key || current.key !== key || !current.lastHeartbeatAt) return false;
  return (now.getTime() - current.lastHeartbeatAt.getTime()) / 1000 <= SESSION_GAP_SECONDS;
}

/** The IST calendar day a moment falls on (reports and caps are per Indian school day). */
export function istDay(at: Date): string {
  return new Date(at.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
