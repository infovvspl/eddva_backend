/**
 * P0-4.4 — AI admission control constants and workload classification.
 *
 * WHY THIS EXISTS
 * The Django AI service runs SYNC gunicorn workers (PROD 2, DEV 3), so the number
 * of workers IS the hard concurrency ceiling — a sync worker does not yield while
 * blocked on a provider call. Nothing between NestJS and Django bounded that
 * competition, so background lecture/PPT work could occupy every worker and stall
 * interactive doubts behind it.
 *
 * This does NOT add capacity. It converts uncontrolled contention into bounded
 * admission plus fast, fair rejection.
 */

export enum AdmissionPool {
  INTERACTIVE = 'interactive',
  BACKGROUND = 'background',
}

/** Paths that are never admission-controlled (cheap, no provider work). */
export const ADMISSION_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/health']);

/**
 * Explicit path -> pool classification, from the P0-4.4 Phase 1 audit.
 * A single map rather than scattered string comparisons, so the policy is
 * reviewable in one place.
 *
 * INTERACTIVE = a human is waiting on the response right now.
 * BACKGROUND  = queued or long-running teacher/system work.
 *
 * Note that PPT and test generation are synchronous HTTP but are classified
 * BACKGROUND: PPT p99 was 116 s in the DEV baseline. Classification follows the
 * workload, not the transport.
 */
export const ADMISSION_POOL_BY_PATH: Readonly<Record<string, AdmissionPool>> = {
  // ── Interactive ───────────────────────────────────────────────────────────
  '/doubt/resolve': AdmissionPool.INTERACTIVE,
  '/doubt/ocr-image': AdmissionPool.INTERACTIVE,
  '/tutor/session': AdmissionPool.INTERACTIVE,
  '/tutor/continue': AdmissionPool.INTERACTIVE,
  '/quiz/generate': AdmissionPool.INTERACTIVE,
  '/translate': AdmissionPool.INTERACTIVE,
  '/grading/subjective-answer': AdmissionPool.INTERACTIVE,

  // ── Background ────────────────────────────────────────────────────────────
  '/stt/transcribe': AdmissionPool.BACKGROUND,
  '/stt/notes': AdmissionPool.BACKGROUND,
  '/stt/notes-from-text': AdmissionPool.BACKGROUND,
  '/stt/notes-from-youtube': AdmissionPool.BACKGROUND,
  '/ppt/generate': AdmissionPool.BACKGROUND,
  '/ppt/regenerate-slide': AdmissionPool.BACKGROUND,
  '/ppt/search-image': AdmissionPool.BACKGROUND,
  '/test/generate/': AdmissionPool.BACKGROUND,
  '/career/guidance': AdmissionPool.BACKGROUND,
  '/grading/subjective-rubric-batch': AdmissionPool.BACKGROUND,
  '/content/generate': AdmissionPool.BACKGROUND,
  '/plan/generate': AdmissionPool.BACKGROUND,
  '/recommend/content': AdmissionPool.BACKGROUND,
  '/feedback/generate': AdmissionPool.BACKGROUND,
  '/notes/analyze': AdmissionPool.BACKGROUND,
  '/resume/analyze': AdmissionPool.BACKGROUND,
  '/interview/start': AdmissionPool.BACKGROUND,
  '/memorization/generate': AdmissionPool.BACKGROUND,
};

/**
 * Unclassified paths default to BACKGROUND on purpose.
 *
 * The invariant we must never break is "at least one Django worker stays free for
 * interactive traffic". Sending an unknown path to BACKGROUND preserves that;
 * defaulting it to INTERACTIVE would let unaudited work erode the guarantee.
 * The Phase 1 audit deliberately left some paths unclassified rather than guess —
 * this is the safe landing place for them.
 */
export const DEFAULT_ADMISSION_POOL = AdmissionPool.BACKGROUND;

export function classifyPath(path: string): AdmissionPool {
  return ADMISSION_POOL_BY_PATH[path] ?? DEFAULT_ADMISSION_POOL;
}

/** Machine-readable error codes. Distinct from provider 429s and from quota 429s. */
export const ADMISSION_REJECTED_CODE = 'ai_admission_rejected';
export const ADMISSION_UNAVAILABLE_CODE = 'ai_admission_unavailable';
export const ADMISSION_NO_TENANT_CODE = 'ai_admission_no_tenant_identity';

/**
 * Margin added to a call's own HTTP timeout to derive the Redis lease.
 *
 * The lease is the ONLY thing that reclaims a slot when the process is SIGKILLed
 * (no `finally` runs). It must therefore exceed the longest a slot can legitimately
 * be held. Per-call timeouts here run to 900 s (/stt/notes), and gunicorn allows up
 * to 600 s on PROD, so a fixed 30–60 s TTL would reclaim slots from live requests
 * and over-admit. Deriving lease = callTimeout + margin keeps it correct for every
 * call without a magic constant.
 */
export const ADMISSION_LEASE_MARGIN_MS = 60_000;

/** Poll interval while waiting for a slot. Bounded, jittered — never a tight spin. */
export const ADMISSION_POLL_BASE_MS = 120;
export const ADMISSION_POLL_JITTER_MS = 80;
