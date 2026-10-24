/**
 * Study-planner defaulters and the alerts about them. Pure, so the rules and
 * the wording are unit-tested.
 *
 * A defaulter is a student who has started the planner and:
 * - stopped: no study in the last 7 days;
 * - low engagement: still studying, with an engagement score under 40;
 * - no gain: an hour or more of study with 2 points or less of improvement.
 * Students who never opened the planner are not defaulters (that is adoption,
 * shown on the admin dashboard); alerting every week about all of them would
 * drown the real problems.
 */
import { bucketOf } from './report-metrics';

export type DefaultReason = 'stopped' | 'low_engagement' | 'no_gain';

export interface StudentFlags {
  studentId: string;
  userId: string;
  name: string;
  reasons: DefaultReason[];
  lastActiveDay: string | null;
  engagementScore: number;
  seconds: number;
  improvement: number | null;
}

/** The report's student rows that need attention, with why. */
export function findDefaulters(
  rows: {
    studentId: string;
    userId: string;
    name: string;
    lastActiveDay: string | null;
    topicsStarted: number;
    inactive: boolean;
    engagementLevel: string;
    engagementScore: number;
    effortWithoutGain: boolean;
    seconds: number;
    improvement: number | null;
  }[],
): StudentFlags[] {
  const out: StudentFlags[] = [];
  for (const r of rows) {
    const started = r.lastActiveDay !== null || r.topicsStarted > 0;
    if (!started) continue;
    const reasons: DefaultReason[] = [];
    if (r.inactive) reasons.push('stopped');
    else if (r.engagementLevel === 'low') reasons.push('low_engagement');
    if (r.effortWithoutGain) reasons.push('no_gain');
    if (reasons.length) {
      out.push({ studentId: r.studentId, userId: r.userId, name: r.name, reasons, lastActiveDay: r.lastActiveDay, engagementScore: r.engagementScore, seconds: r.seconds, improvement: r.improvement });
    }
  }
  return out;
}

export interface DigestCounts {
  total: number;
  stopped: number;
  lowEngagement: number;
  noGain: number;
}

export function countReasons(flags: StudentFlags[]): DigestCounts {
  return {
    total: flags.length,
    stopped: flags.filter((f) => f.reasons.includes('stopped')).length,
    lowEngagement: flags.filter((f) => f.reasons.includes('low_engagement')).length,
    noGain: flags.filter((f) => f.reasons.includes('no_gain')).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The weekly summary for an admin (the school) or a teacher (their students). */
export function digestMessage(counts: DigestCounts, audience: 'school' | 'teacher'): { title: string; message: string } {
  const who = audience === 'teacher' ? `${plural(counts.total, 'of your students needs', 'of your students need')}` : `${plural(counts.total, 'student needs', 'students need')}`;
  const parts = [
    counts.stopped && `${counts.stopped} stopped studying`,
    counts.lowEngagement && `${counts.lowEngagement} with low engagement`,
    counts.noGain && `${counts.noGain} studying without improving`,
  ].filter(Boolean);
  return {
    title: 'AI Study Planner: students need attention',
    message: `${who} attention in the AI Study Planner this week: ${parts.join(', ')}.`,
  };
}

const MINUTE = 60;

function duration(seconds: number): string {
  const minutes = Math.round(seconds / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The note to a parent about one child: the most pressing reason, in plain words. */
export function parentMessage(f: StudentFlags, today: string): { title: string; message: string } {
  const first = f.name.split(/\s+/)[0] || f.name;
  if (f.reasons.includes('stopped')) {
    const days = f.lastActiveDay ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${f.lastActiveDay}T00:00:00Z`)) / 86_400_000) : null;
    return {
      title: `${first} has stopped using the AI Study Planner`,
      message: `${f.name} has not studied in the AI Study Planner${days ? ` for ${days} days` : ' recently'}. A few minutes a day on the weak topics it suggests can make a big difference.`,
    };
  }
  if (f.reasons.includes('no_gain')) {
    return {
      title: `${first} is working hard but not improving yet`,
      message: `${f.name} has studied ${duration(f.seconds)} in the AI Study Planner this month, but the scores on those topics have not improved yet. The teachers can help with how to study them.`,
    };
  }
  return {
    title: `${first}'s AI Study Planner engagement is low`,
    message: `${f.name} is using the AI Study Planner only a little (engagement ${f.engagementScore}/100 this month). Regular short sessions on the suggested topics help most.`,
  };
}

/** One alert per person per week: the week's Monday, as a key. */
export function alertWeek(today: string): string {
  return `week:${bucketOf(today, 'week')}`;
}
