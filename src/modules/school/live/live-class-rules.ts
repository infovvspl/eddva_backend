/**
 * Rules for school live classes that the teacher and student views, the API
 * and the streaming hooks must agree on. Kept free of Nest/DB so they can be
 * tested directly. See the Live Class QA report of 16 Oct 2026 (B-01, B-02,
 * B-03, B-12, B-21).
 */
import { BadRequestException } from '@nestjs/common';
import { hasSchoolRole } from '../common/role-helper';

/** Schools are in India: a time sent without a timezone is India time. */
export const DEFAULT_UTC_OFFSET = '+05:30';
/** A start time this far in the past is still accepted (form submit lag, clock skew). */
export const PAST_GRACE_MS = 5 * 60_000;
/** A scheduled class that has not gone live this long after its start is "missed". */
export const MISSED_AFTER_MINUTES = 60;

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The scheduled start as a Date, or null when none was given.
 *
 * B-01: the schedule form sent the browser's `datetime-local` value
 * ("2026-10-16T22:00", no zone) and Postgres read it as UTC, so every class
 * was stored 5 h 30 min late (10:00 PM IST -> 22:00Z -> shown as 3:30 AM).
 * A value with a zone (what the fixed form sends) is taken as is; one
 * without is India time.
 *
 * B-03: a start more than PAST_GRACE_MS in the past is rejected.
 */
export function parseScheduledFor(value: string | null | undefined, now = new Date()): Date | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const withZone = HAS_ZONE.test(raw) ? raw : `${raw.length === 16 ? `${raw}:00` : raw}${DEFAULT_UTC_OFFSET}`;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Enter a valid date and time for the class');
  if (date.getTime() < now.getTime() - PAST_GRACE_MS) {
    throw new BadRequestException('The class time is in the past. Pick a time from now on.');
  }
  return date;
}

/**
 * True when a class was scheduled, never went live, and its start is more
 * than MISSED_AFTER_MINUTES ago. The server decides this (B-21): the teacher
 * page used "before today's midnight" and the student page used nothing, so
 * the same class was "Missed" for the teacher and "Starting soon" for students.
 */
export function isMissed(
  lecture: { status?: string | null; scheduledFor?: string | Date | null; createdAt?: string | Date | null },
  now = new Date(),
): boolean {
  if (lecture.status !== 'SCHEDULED') return false;
  const ref = lecture.scheduledFor || lecture.createdAt;
  if (!ref) return false;
  return new Date(ref).getTime() < now.getTime() - MISSED_AFTER_MINUTES * 60_000;
}

/** Roles that run a class and may hold its stream key. */
export function canSeeStreamKey(role: string | null | undefined): boolean {
  return ['TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN'].some((r) => hasSchoolRole(role, r));
}

/** Statuses after which a class can no longer be streamed to. */
export const CLOSED_STATUSES = ['ENDED', 'PROCESSED', 'PROCESSING_FAILED', 'CANCELLED'];

/**
 * A lecture row as the caller may see it.
 *
 * B-02: the stream key (and the CDN playback URL, which contains it) went to
 * every caller, students included, and anyone holding it can publish into
 * the class. Students get the playback ID only. B-12: once a class is closed
 * nobody needs its credentials, so the teacher stops getting them too.
 */
export function forViewer<T extends Record<string, any>>(lecture: T, role: string | null | undefined, now = new Date()) {
  const closed = CLOSED_STATUSES.includes(String(lecture.status));
  const { streamKey, playbackUrl, rtmpUrl, ...rest } = lecture as any;
  const out: Record<string, any> = { ...rest, isMissed: isMissed(lecture, now) };
  if (canSeeStreamKey(role) && !closed) {
    if (streamKey !== undefined) out.streamKey = streamKey;
    if (playbackUrl !== undefined) out.playbackUrl = playbackUrl;
    if (rtmpUrl !== undefined) out.rtmpUrl = rtmpUrl;
  }
  return out as Omit<T, 'streamKey' | 'playbackUrl' | 'rtmpUrl'> & { isMissed: boolean; streamKey?: string; playbackUrl?: string; rtmpUrl?: string };
}
