import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { istDay } from '../activity/activity-credit';
import { streak } from '../activity/activity.service';
import {
  averageImprovement,
  buildTrend,
  effortWithoutGain,
  engagementLevel,
  engagementScore,
  isInactive,
  PERIOD_DAYS,
  periodStart,
  ReportPeriod,
  TrendGranularity,
  trendBuckets,
} from './report-metrics';
import { canSeeSubject } from './report-scope';
import { ReportScopeService, ScopedStudent } from './report-scope.service';

export interface ReportQuery {
  period?: string;
  trend?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  instituteId?: string;
}

const PERIODS: ReportPeriod[] = ['today', 'week', 'month', 'year'];
const GRANULARITIES: TrendGranularity[] = ['day', 'week', 'month', 'year'];
const TOP_WEAK_TOPICS = 10;

interface PathRow {
  student_id: string;
  subject_id: string | null;
  topic_id: string;
  status: string;
  current_round: number;
  baseline_mastery: string | null;
  latest_mastery: string | null;
  weak_concepts: any;
  last_activity_at: string;
  topic_name: string | null;
  chapter_name: string | null;
  subject_name: string | null;
}

/**
 * Study-planner reports for administrators, teachers and parents: how much
 * each student studies, how engaged they are, what they are weak in, and how
 * much they improve, always side by side with the time they put in.
 */
@Injectable()
export class LearningReportService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly scopes: ReportScopeService,
  ) {}

  // ── Overview: a class, a section, a subject or the whole school ────────────

  async overview(user: any, q: ReportQuery) {
    const { period, granularity } = this.parse(q);
    const scope = await this.scopes.resolve(user, q.instituteId);
    if (scope.viewer === 'parent') throw new BadRequestException('Parents see their child\'s report');
    const all = scope.students;
    const students = all.filter((s) => (!q.classId || s.classId === q.classId) && (!q.sectionId || s.sectionId === q.sectionId));
    const today = istDay(new Date());
    const from = periodStart(today, period);
    const ids = students.map((s) => s.studentId);
    const byId = new Map(students.map((s) => [s.studentId, s]));
    const sees = (studentId: string, subjectId: string | null) => {
      const s = byId.get(studentId);
      return !!s && canSeeSubject(s.access, subjectId, q.subjectId || null);
    };

    const [usage, lastActive, trendRows, steps, paths, weak, subjects] = await Promise.all([
      this.usageByDay(ids, from),
      this.lastActive(ids),
      this.usageByDay(ids, trendBuckets(today, granularity)[0]),
      this.stepsDone(ids, from),
      this.paths(ids),
      this.weakTopics(ids),
      this.subjectOptions(all.map((s) => s.studentId)),
    ]);

    // Each student's own rows (only the subjects the viewer may see), grouped once rather than searched per student.
    const usageOf = groupVisible(usage, sees);
    const stepsOf = groupVisible(steps, sees);
    const lastOf = groupVisible(lastActive, sees);
    const pathsOf = groupVisible(paths, sees);
    const weakOf = groupVisible(weak, sees);

    const rows = students.map((s) => {
      const mine = usageOf.get(s.studentId) ?? [];
      const seconds = mine.reduce((sum, u) => sum + u.seconds, 0);
      const activeDays = new Set(mine.map((u) => u.day)).size;
      const stepsDone = (stepsOf.get(s.studentId) ?? []).reduce((sum, r) => sum + r.n, 0);
      const last = (lastOf.get(s.studentId) ?? []).map((r) => r.day).sort().pop() ?? null;
      const myPaths = pathsOf.get(s.studentId) ?? [];
      const improvement = averageImprovement(myPaths.map(toPathScores));
      const myWeak = weakOf.get(s.studentId) ?? [];
      const score = engagementScore({ seconds, activeDays, stepsDone }, PERIOD_DAYS[period]);
      return {
        studentId: s.studentId,
        userId: s.userId,
        name: s.name,
        rollNo: s.rollNo,
        className: s.className,
        sectionName: s.sectionName,
        seconds,
        activeDays,
        stepsDone,
        lastActiveDay: last,
        engagementScore: score,
        engagementLevel: engagementLevel(score),
        inactive: isInactive(last, today),
        weakTopics: myWeak.filter((w) => w.status === 'weak').length,
        atRiskTopics: myWeak.filter((w) => w.status === 'at_risk').length,
        topicsStarted: myPaths.length,
        topicsCompleted: myPaths.filter((p) => p.status === 'completed').length,
        improvement,
        effortWithoutGain: effortWithoutGain(seconds, improvement),
      };
    });

    const active = rows.filter((r) => r.seconds > 0);
    const allPaths = paths.filter((p) => sees(p.student_id, p.subject_id));
    return {
      viewer: scope.viewer,
      period,
      granularity,
      from,
      to: today,
      filters: this.filterOptions(all, subjects),
      totals: {
        students: rows.length,
        activeStudents: active.length,
        seconds: rows.reduce((sum, r) => sum + r.seconds, 0),
        averageSecondsPerActiveStudent: active.length ? Math.round(active.reduce((sum, r) => sum + r.seconds, 0) / active.length) : 0,
        averageEngagement: rows.length ? Math.round(rows.reduce((sum, r) => sum + r.engagementScore, 0) / rows.length) : 0,
        averageImprovement: averageImprovement(allPaths.map(toPathScores)),
        inactive: rows.filter((r) => r.inactive).length,
        lowEngagement: rows.filter((r) => !r.inactive && r.engagementLevel === 'low').length,
        effortWithoutGain: rows.filter((r) => r.effortWithoutGain).length,
      },
      trend: buildTrend(
        trendRows.filter((u) => sees(u.student_id, u.subject_id)).map((u) => ({ day: u.day, studentId: u.student_id, seconds: u.seconds })),
        today,
        granularity,
      ),
      lists: {
        inactive: rows.filter((r) => r.inactive).map(listItem),
        lowEngagement: rows.filter((r) => !r.inactive && r.engagementLevel === 'low').map(listItem),
        effortWithoutGain: rows.filter((r) => r.effortWithoutGain).map(listItem),
      },
      weakTopics: this.topWeakTopics(weak.filter((w) => sees(w.student_id, w.subject_id))),
      students: rows,
    };
  }

  // ── One student ────────────────────────────────────────────────────────────

  async student(user: any, ref: string, q: ReportQuery) {
    const { period, granularity } = this.parse(q);
    const { scope, student } = await this.scopes.resolveStudent(user, ref, q.instituteId);
    const today = istDay(new Date());
    const from = periodStart(today, period);
    const ids = [student.studentId];
    const sees = (subjectId: string | null) => canSeeSubject(student.access, subjectId, q.subjectId || null);

    const [usage, sections, allDays, trendRows, steps, paths, topicTime, topicMastery, chapterMastery] = await Promise.all([
      this.usageByDay(ids, from),
      this.ds.query(
        `SELECT subject_id::text, section, SUM(active_seconds)::int AS seconds FROM learning_engagement_daily
          WHERE student_id = $1 AND day >= $2::date GROUP BY 1, 2`,
        [student.studentId, from],
      ),
      this.ds.query(
        `SELECT DISTINCT day::text AS day, subject_id::text FROM learning_engagement_daily WHERE student_id = $1 AND active_seconds > 0`,
        [student.studentId],
      ),
      this.usageByDay(ids, trendBuckets(today, granularity)[0]),
      this.stepsDone(ids, from),
      this.paths(ids),
      this.ds.query(
        `SELECT topic_id::text, SUM(active_seconds)::int AS seconds FROM learning_engagement_daily
          WHERE student_id = $1 AND topic_id IS NOT NULL GROUP BY 1`,
        [student.studentId],
      ),
      this.ds.query(
        `SELECT m.subject_id::text, m.status, m.mastery, TRIM(COALESCE(rt.name, ct.name)) AS name, c.name AS chapter_name
           FROM student_topic_mastery m
           LEFT JOIN learning_roadmap_topics rt ON rt.id = m.topic_id
           LEFT JOIN topics ct ON ct.id = m.topic_id
           LEFT JOIN chapters c ON c.id::text = m.chapter_id::text
          WHERE m.student_id = $1 AND m.status IN ('weak', 'at_risk')
          ORDER BY m.mastery NULLS LAST`,
        [student.studentId],
      ),
      this.ds.query(
        `SELECT m.subject_id::text, m.status, m.mastery, c.name
           FROM student_chapter_mastery m JOIN chapters c ON c.id::text = m.chapter_id::text
          WHERE m.student_id = $1 AND m.status IN ('weak', 'at_risk')
          ORDER BY m.mastery NULLS LAST`,
        [student.studentId],
      ),
    ]);

    const mine = usage.filter((u) => sees(u.subject_id));
    const seconds = mine.reduce((sum, u) => sum + u.seconds, 0);
    const activeDays = new Set(mine.map((u) => u.day)).size;
    const stepsDone = steps.filter((r) => sees(r.subject_id)).reduce((sum, r) => sum + r.n, 0);
    const visibleDays: string[] = [...new Set<string>((allDays as any[]).filter((d) => sees(d.subject_id)).map((d) => String(d.day)))].sort().reverse();
    const lastActiveDay = visibleDays[0] ?? null;
    const myPaths = paths.filter((p) => sees(p.subject_id));
    const improvement = averageImprovement(myPaths.map(toPathScores));
    const score = engagementScore({ seconds, activeDays, stepsDone }, PERIOD_DAYS[period]);
    const timeOnTopic = new Map<string, number>(topicTime.map((t: any) => [t.topic_id, Number(t.seconds)]));
    const subjectNames = await this.subjectNames([
      ...new Set([...topicMastery, ...chapterMastery, ...myPaths, ...mine].map((r: any) => r.subject_id).filter(Boolean)),
    ] as string[]);

    // One block per subject the viewer may see, weakest first.
    const subjectIds = [...subjectNames.keys()].filter((id) => sees(id));
    const subjects = subjectIds
      .map((id) => {
        const tm = topicMastery.filter((m: any) => m.subject_id === id);
        const cm = chapterMastery.filter((m: any) => m.subject_id === id);
        const sp = myPaths.filter((p) => p.subject_id === id);
        const focus = [...new Set(sp.flatMap((p) => weakConceptNames(p.weak_concepts)))].slice(0, 8);
        return {
          subjectId: id,
          name: subjectNames.get(id) ?? 'Subject',
          seconds: mine.filter((u) => u.subject_id === id).reduce((sum, u) => sum + u.seconds, 0),
          weakChapters: cm.filter((m: any) => m.status === 'weak').map(named),
          atRiskChapters: cm.filter((m: any) => m.status === 'at_risk').map(named),
          weakTopics: tm.filter((m: any) => m.status === 'weak').map(namedTopic),
          atRiskTopics: tm.filter((m: any) => m.status === 'at_risk').map(namedTopic),
          focusAreas: focus,
          improvement: averageImprovement(sp.map(toPathScores)),
          paths: sp.map((p) => ({
            topicName: p.topic_name ?? 'Topic',
            chapterName: p.chapter_name,
            status: p.status,
            round: p.current_round,
            baseline: num(p.baseline_mastery),
            latest: num(p.latest_mastery),
            improvement: num(p.baseline_mastery) !== null && num(p.latest_mastery) !== null ? round1(num(p.latest_mastery)! - num(p.baseline_mastery)!) : null,
            seconds: timeOnTopic.get(p.topic_id) ?? 0,
            lastActivityAt: p.last_activity_at,
          })),
        };
      })
      .sort((a, b) => b.weakChapters.length + b.weakTopics.length - (a.weakChapters.length + a.weakTopics.length));

    const bySection = new Map<string, number>();
    for (const r of sections.filter((r: any) => sees(r.subject_id))) bySection.set(r.section, (bySection.get(r.section) ?? 0) + Number(r.seconds));

    return {
      viewer: scope.viewer,
      period,
      granularity,
      from,
      to: today,
      student: {
        studentId: student.studentId,
        userId: student.userId,
        name: student.name,
        rollNo: student.rollNo,
        className: student.className,
        sectionName: student.sectionName,
      },
      /** A subject teacher sees only their subjects. */
      allSubjects: student.access.allSubjects,
      summary: {
        seconds,
        activeDays,
        stepsDone,
        engagementScore: score,
        engagementLevel: engagementLevel(score),
        inactive: isInactive(lastActiveDay, today),
        lastActiveDay,
        streakDays: streak(visibleDays, today),
        improvement,
        effortWithoutGain: effortWithoutGain(seconds, improvement),
        topicsStarted: myPaths.length,
        topicsCompleted: myPaths.filter((p) => p.status === 'completed').length,
      },
      trend: buildTrend(trendRows.filter((u) => sees(u.subject_id)).map((u) => ({ day: u.day, studentId: u.student_id, seconds: u.seconds })), today, granularity),
      bySection: [...bySection.entries()].map(([section, s]) => ({ section, seconds: s })).sort((a, b) => b.seconds - a.seconds),
      bySubject: subjects.filter((s) => s.seconds > 0).map((s) => ({ subjectId: s.subjectId, name: s.name, seconds: s.seconds })),
      subjects,
    };
  }

  /** A parent's children, to pick whose report to open. */
  async children(user: any) {
    const scope = await this.scopes.resolve(user);
    return scope.students.map((s) => ({ studentId: s.studentId, userId: s.userId, name: s.name, className: s.className, sectionName: s.sectionName }));
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  private parse(q: ReportQuery): { period: ReportPeriod; granularity: TrendGranularity } {
    const period = (PERIODS as string[]).includes(String(q.period)) ? (q.period as ReportPeriod) : 'month';
    const granularity = (GRANULARITIES as string[]).includes(String(q.trend)) ? (q.trend as TrendGranularity) : 'day';
    return { period, granularity };
  }

  private async usageByDay(ids: string[], from: string): Promise<{ student_id: string; subject_id: string | null; day: string; seconds: number }[]> {
    if (!ids.length) return [];
    const rows = await this.ds.query(
      `SELECT student_id::text, subject_id::text, day::text, SUM(active_seconds)::int AS seconds
         FROM learning_engagement_daily
        WHERE student_id = ANY($1::uuid[]) AND day >= $2::date AND active_seconds > 0
        GROUP BY 1, 2, 3`,
      [ids, from],
    );
    return rows.map((r: any) => ({ ...r, seconds: Number(r.seconds) }));
  }

  private async lastActive(ids: string[]): Promise<{ student_id: string; subject_id: string | null; day: string }[]> {
    if (!ids.length) return [];
    return this.ds.query(
      `SELECT student_id::text, subject_id::text, MAX(day)::text AS day FROM learning_engagement_daily
        WHERE student_id = ANY($1::uuid[]) AND active_seconds > 0 GROUP BY 1, 2`,
      [ids],
    );
  }

  /** Path steps finished in the period (video watched, notes read, quiz or assessment done). */
  private async stepsDone(ids: string[], from: string): Promise<{ student_id: string; subject_id: string | null; n: number }[]> {
    if (!ids.length) return [];
    const rows = await this.ds.query(
      `SELECT th.student_id::text, th.subject_id::text, COUNT(*)::int AS n
         FROM learning_thread_steps st JOIN learning_threads th ON th.id = st.thread_id
        WHERE th.student_id = ANY($1::uuid[]) AND st.status = 'done' AND st.completed_at >= $2::date
        GROUP BY 1, 2`,
      [ids, from],
    );
    return rows.map((r: any) => ({ ...r, n: Number(r.n) }));
  }

  /**
   * Every topic path the students have opened, with the score before starting and the latest.
   *
   * Deliberately `scope = 'topic'` only, not `IN ('topic', 'subtopic')`: a topic with subtopics
   * now has one thread per subtopic instead of one shared thread, and `topicsStarted`/
   * `topicsCompleted` below count path *rows*, which would stop meaning "topics" the moment a
   * 5-subtopic topic contributed 5 rows. Reflecting per-subtopic-path activity in these reports
   * needs its own topic-level dedupe/rollup (reusing home/completion.ts's rule, not just widening
   * this filter) — out of scope for the per-subtopic-paths feature itself; left as a known gap.
   */
  private async paths(ids: string[]): Promise<PathRow[]> {
    if (!ids.length) return [];
    return this.ds.query(
      `SELECT th.student_id::text, th.subject_id::text, th.topic_id::text, th.status, th.current_round,
              th.baseline_mastery, th.latest_mastery, th.weak_concepts, th.last_activity_at,
              TRIM(rt.name) AS topic_name, c.name AS chapter_name, s.name AS subject_name
         FROM learning_threads th
         LEFT JOIN learning_roadmap_topics rt ON rt.id = th.topic_id
         LEFT JOIN chapters c ON c.id = th.chapter_id
         LEFT JOIN subjects s ON s.id = th.subject_id
        WHERE th.student_id = ANY($1::uuid[]) AND th.scope = 'topic' AND th.status <> 'suggested'
        ORDER BY th.last_activity_at DESC`,
      [ids],
    );
  }

  private async weakTopics(ids: string[]): Promise<{ student_id: string; subject_id: string | null; topic_id: string; status: string; name: string; subject_name: string | null }[]> {
    if (!ids.length) return [];
    return this.ds.query(
      `SELECT m.student_id::text, m.subject_id::text, m.topic_id::text, m.status,
              TRIM(COALESCE(rt.name, ct.name)) AS name, s.name AS subject_name
         FROM student_topic_mastery m
         LEFT JOIN learning_roadmap_topics rt ON rt.id = m.topic_id
         LEFT JOIN topics ct ON ct.id = m.topic_id
         LEFT JOIN subjects s ON s.id::text = m.subject_id::text
        WHERE m.student_id = ANY($1::uuid[]) AND m.status IN ('weak', 'at_risk')`,
      [ids],
    );
  }

  /** Subjects with any study-planner data for these students (for the subject filter). */
  private async subjectOptions(ids: string[]): Promise<{ subject_id: string; name: string; student_id: string }[]> {
    if (!ids.length) return [];
    return this.ds.query(
      `SELECT DISTINCT x.student_id, x.subject_id, s.name FROM (
         SELECT student_id::text, subject_id::text FROM student_topic_mastery WHERE student_id = ANY($1::uuid[])
         UNION SELECT student_id::text, subject_id::text FROM learning_engagement_daily WHERE student_id = ANY($1::uuid[]) AND subject_id IS NOT NULL
       ) x JOIN subjects s ON s.id::text = x.subject_id`,
      [ids],
    );
  }

  private async subjectNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.ds.query(`SELECT id::text, name FROM subjects WHERE id::text = ANY($1::text[])`, [ids]);
    return new Map(rows.map((r: any) => [r.id, r.name]));
  }

  /** Classes, sections and subjects the viewer can filter by (only what they may see). */
  private filterOptions(students: ScopedStudent[], subjectRows: { subject_id: string; name: string; student_id: string }[]) {
    const classes = new Map<string, { id: string; name: string; sections: Map<string, string> }>();
    for (const s of students) {
      if (!s.classId) continue;
      const c = classes.get(s.classId) ?? { id: s.classId, name: s.className ?? 'Class', sections: new Map() };
      if (s.sectionId) c.sections.set(s.sectionId, s.sectionName ?? 'Section');
      classes.set(s.classId, c);
    }
    const byStudent = new Map(students.map((s) => [s.studentId, s]));
    const subjects = new Map<string, string>();
    for (const r of subjectRows) {
      const s = byStudent.get(r.student_id);
      if (s && canSeeSubject(s.access, r.subject_id)) subjects.set(r.subject_id, r.name);
    }
    return {
      classes: [...classes.values()]
        .map((c) => ({ id: c.id, name: c.name, sections: [...c.sections.entries()].map(([id, name]) => ({ id, name })).sort(byName) }))
        .sort(byName),
      subjects: [...subjects.entries()].map(([id, name]) => ({ id, name })).sort(byName),
    };
  }

  private topWeakTopics(rows: { topic_id: string; status: string; name: string; subject_name: string | null; student_id: string }[]) {
    const topics = new Map<string, { name: string; subjectName: string | null; weak: Set<string>; atRisk: Set<string> }>();
    for (const r of rows) {
      const t = topics.get(r.topic_id) ?? { name: r.name ?? 'Topic', subjectName: r.subject_name, weak: new Set(), atRisk: new Set() };
      (r.status === 'weak' ? t.weak : t.atRisk).add(r.student_id);
      topics.set(r.topic_id, t);
    }
    return [...topics.values()]
      .map((t) => ({ name: t.name, subjectName: t.subjectName, weakStudents: t.weak.size, atRiskStudents: t.atRisk.size }))
      .sort((a, b) => b.weakStudents - a.weakStudents || b.atRiskStudents - a.atRiskStudents)
      .slice(0, TOP_WEAK_TOPICS);
  }
}

/** Rows grouped by student, keeping only those the viewer may see. */
function groupVisible<T extends { student_id: string; subject_id: string | null }>(rows: T[], sees: (studentId: string, subjectId: string | null) => boolean): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (!sees(r.student_id, r.subject_id)) continue;
    const list = out.get(r.student_id);
    if (list) list.push(r);
    else out.set(r.student_id, [r]);
  }
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const toPathScores = (p: PathRow) => ({ baseline: num(p.baseline_mastery), latest: num(p.latest_mastery) });
const named = (m: any) => ({ name: m.name, mastery: num(m.mastery) });
const namedTopic = (m: any) => ({ name: m.name ?? 'Topic', chapterName: m.chapter_name ?? null, mastery: num(m.mastery) });
const listItem = (r: { studentId: string; userId: string; name: string; className: string | null; sectionName: string | null; seconds: number; engagementScore: number; lastActiveDay: string | null; improvement: number | null }) => ({
  studentId: r.studentId,
  userId: r.userId,
  name: r.name,
  className: r.className,
  sectionName: r.sectionName,
  seconds: r.seconds,
  engagementScore: r.engagementScore,
  lastActiveDay: r.lastActiveDay,
  improvement: r.improvement,
});

/** Weak concepts stored on a path: strings, or { conceptTag } objects. */
function weakConceptNames(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c: any) => (typeof c === 'string' ? c : c?.conceptTag ?? c?.concept ?? c?.name))
    .filter((c): c is string => typeof c === 'string' && !!c.trim())
    .map((c) => c.trim());
}
