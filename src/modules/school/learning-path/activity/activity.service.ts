import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { LearningEventsService, QuizFinalizedEvent } from '../common/learning-events.service';
import { StudentCurriculumRepository, StudentIdentity } from '../common/student-curriculum.repository';
import { ActivitySection, continuesSession, creditSeconds, DAILY_CAP_SECONDS, istDay } from './activity-credit';

export interface HeartbeatInput {
  section: ActivitySection;
  threadId?: string;
  stepId?: string;
  beats: number[];
  device?: string;
}

interface Scope {
  threadId: string | null;
  stepId: string | null;
  subjectId: string | null;
  topicId: string | null;
}

/**
 * Records how long a student is actively in each part of the learning path.
 * Topic and subject come from the student's own thread, never from the
 * client; assessment time comes from the server's start/submit timestamps.
 */
@Injectable()
export class ActivityService implements OnModuleInit {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly events: LearningEventsService,
  ) {}

  onModuleInit() {
    this.events.onQuizFinalized((e) => this.recordAssessmentTime(e));
  }

  async recordHeartbeat(user: any, input: HeartbeatInput) {
    const student = await this.requireStudent(user);
    // Assessment time is measured on the server, so the client cannot inflate or pad it.
    if (input.section === 'assessment') return { credited: 0, serverTimed: true };
    const scope = await this.resolveScope(student.studentId, input.threadId, input.stepId);
    const now = new Date();

    return this.ds.transaction(async (manager) => {
      await manager.query(`INSERT INTO learning_activity_state (student_id) VALUES ($1) ON CONFLICT (student_id) DO NOTHING`, [
        student.studentId,
      ]);
      const [state] = await manager.query(`SELECT * FROM learning_activity_state WHERE student_id = $1 FOR UPDATE`, [student.studentId]);
      const day = istDay(now);
      const today = await this.todaySeconds(manager, student.studentId, day);
      const credited = creditSeconds({
        beats: input.beats,
        now,
        lastCreditAt: state.last_credit_at ? new Date(state.last_credit_at) : null,
        creditedTodaySeconds: today,
      });
      if (credited <= 0) return { credited: 0, todaySeconds: today };

      const key = `${input.section}|${scope.threadId ?? ''}|${scope.stepId ?? ''}`;
      const sessionId = await this.extendOrStartSession(manager, student, state, key, input, scope, credited, now);
      await this.addDaily(manager, student, day, scope, input.section, credited, sessionId !== state.current_session_id ? 1 : 0);
      await manager.query(
        `UPDATE learning_activity_state SET last_credit_at = $2, current_session_id = $3, current_key = $4, updated_at = NOW()
          WHERE student_id = $1`,
        [student.studentId, now, sessionId, key],
      );
      return { credited, todaySeconds: today + credited };
    });
  }

  /** The student's own view: today, this week by day / subject / section, and their streak. */
  async getMyEngagement(user: any) {
    const student = await this.requireStudent(user);
    const today = istDay(new Date());
    const [byDay, bySubject, bySection, activeDays] = await Promise.all([
      this.ds.query(
        `SELECT day::text AS day, SUM(active_seconds)::int AS seconds FROM learning_engagement_daily
          WHERE student_id = $1 AND day > $2::date - 7 GROUP BY day ORDER BY day`,
        [student.studentId, today],
      ),
      this.ds.query(
        `SELECT d.subject_id, s.name AS subject_name, SUM(d.active_seconds)::int AS seconds
           FROM learning_engagement_daily d LEFT JOIN subjects s ON s.id = d.subject_id
          WHERE d.student_id = $1 AND d.day > $2::date - 7
          GROUP BY d.subject_id, s.name ORDER BY seconds DESC`,
        [student.studentId, today],
      ),
      this.ds.query(
        `SELECT section, SUM(active_seconds)::int AS seconds FROM learning_engagement_daily
          WHERE student_id = $1 AND day > $2::date - 7 GROUP BY section ORDER BY seconds DESC`,
        [student.studentId, today],
      ),
      this.ds.query(
        `SELECT DISTINCT day::text AS day FROM learning_engagement_daily
          WHERE student_id = $1 AND active_seconds > 0 AND day > $2::date - 400 ORDER BY day DESC`,
        [student.studentId, today],
      ),
    ]);
    return {
      todaySeconds: byDay.find((d: any) => d.day === today)?.seconds ?? 0,
      weekSeconds: byDay.reduce((sum: number, d: any) => sum + d.seconds, 0),
      byDay,
      bySubject: bySubject.map((r: any) => ({ subjectId: r.subject_id, subjectName: r.subject_name ?? 'General', seconds: r.seconds })),
      bySection,
      streakDays: streak(activeDays.map((d: any) => d.day), today),
    };
  }

  /** A graded assessment adds its real duration (start to submit, never beyond its time limit). */
  private async recordAssessmentTime(event: QuizFinalizedEvent) {
    if (event.kind !== 'assessment') return;
    try {
      const [row] = await this.ds.query(
        `SELECT i.started_at, i.submitted_at, i.expires_at, i.thread_id, i.step_id, i.subject_id, i.topic_id, s.institute_id
           FROM learning_quiz_instances i JOIN students s ON s.id = i.student_id
          WHERE i.id = $1`,
        [event.instanceId],
      );
      if (!row?.submitted_at) return;
      const started = new Date(row.started_at).getTime();
      const end = Math.min(new Date(row.submitted_at).getTime(), row.expires_at ? new Date(row.expires_at).getTime() : Infinity);
      const seconds = Math.max(0, Math.floor((end - started) / 1000));
      if (!seconds) return;
      const student = { studentId: event.studentId, instituteId: row.institute_id } as StudentIdentity;
      const scope: Scope = { threadId: row.thread_id, stepId: row.step_id, subjectId: row.subject_id, topicId: row.topic_id };
      await this.ds.transaction(async (manager) => {
        const day = istDay(new Date(row.submitted_at));
        const capped = Math.min(seconds, Math.max(0, DAILY_CAP_SECONDS - (await this.todaySeconds(manager, event.studentId, day))));
        if (!capped) return;
        await manager.query(
          `INSERT INTO learning_activity_sessions
             (institute_id, student_id, section, thread_id, step_id, subject_id, topic_id, started_at, last_heartbeat_at, active_seconds)
           VALUES ($1, $2, 'assessment', $3, $4, $5, $6, $7, $8, $9)`,
          [row.institute_id, event.studentId, scope.threadId, scope.stepId, scope.subjectId, scope.topicId, row.started_at, row.submitted_at, capped],
        );
        await this.addDaily(manager, student, day, scope, 'assessment', capped, 1);
      });
    } catch (err) {
      this.logger.warn(`Could not record assessment time for ${event.instanceId}: ${(err as Error)?.message}`);
    }
  }

  private async extendOrStartSession(
    manager: EntityManager,
    student: StudentIdentity,
    state: any,
    key: string,
    input: HeartbeatInput,
    scope: Scope,
    credited: number,
    now: Date,
  ): Promise<string> {
    if (state.current_session_id) {
      const [current] = await manager.query(`SELECT last_heartbeat_at FROM learning_activity_sessions WHERE id = $1`, [
        state.current_session_id,
      ]);
      const lastHeartbeatAt = current ? new Date(current.last_heartbeat_at) : null;
      if (continuesSession({ key: state.current_key, lastHeartbeatAt }, key, now)) {
        await manager.query(
          `UPDATE learning_activity_sessions SET active_seconds = active_seconds + $2, last_heartbeat_at = $3 WHERE id = $1`,
          [state.current_session_id, credited, now],
        );
        return state.current_session_id;
      }
    }
    const [row] = await manager.query(
      `INSERT INTO learning_activity_sessions
         (institute_id, student_id, section, thread_id, step_id, subject_id, topic_id, started_at, last_heartbeat_at, active_seconds, device)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10) RETURNING id`,
      [
        student.instituteId, student.studentId, input.section, scope.threadId, scope.stepId, scope.subjectId, scope.topicId,
        new Date(now.getTime() - credited * 1000), credited, input.device ?? null,
      ],
    );
    return row.id;
  }

  private async addDaily(
    manager: EntityManager,
    student: Pick<StudentIdentity, 'studentId' | 'instituteId'>,
    day: string,
    scope: Scope,
    section: ActivitySection,
    seconds: number,
    visits: number,
  ) {
    await manager.query(
      `INSERT INTO learning_engagement_daily (institute_id, student_id, day, subject_id, topic_id, section, active_seconds, visits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (student_id, day,
                    (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                    (COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                    section)
       DO UPDATE SET active_seconds = learning_engagement_daily.active_seconds + EXCLUDED.active_seconds,
                     visits = learning_engagement_daily.visits + EXCLUDED.visits,
                     updated_at = NOW()`,
      [student.instituteId, student.studentId, day, scope.subjectId, scope.topicId, section, seconds, visits],
    );
  }

  private async todaySeconds(manager: EntityManager, studentId: string, day: string): Promise<number> {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(active_seconds), 0)::int AS s FROM learning_engagement_daily WHERE student_id = $1 AND day = $2`,
      [studentId, day],
    );
    return Number(row?.s ?? 0);
  }

  /** Subject and topic from the student's own thread; a step id that is not in that thread is dropped. */
  private async resolveScope(studentId: string, threadId?: string, stepId?: string): Promise<Scope> {
    if (!threadId) return { threadId: null, stepId: null, subjectId: null, topicId: null };
    const [thread] = await this.ds.query(
      `SELECT id, subject_id, topic_id FROM learning_threads WHERE id::text = $1::text AND student_id::text = $2::text`,
      [threadId, studentId],
    );
    if (!thread) throw new NotFoundException('Chat not found');
    let step: string | null = null;
    if (stepId) {
      const rows = await this.ds.query(`SELECT id FROM learning_thread_steps WHERE id::text = $1::text AND thread_id = $2`, [stepId, thread.id]);
      step = rows[0]?.id ?? null;
    }
    return { threadId: thread.id, stepId: step, subjectId: thread.subject_id ?? null, topicId: thread.topic_id ?? null };
  }

  private async requireStudent(user: any): Promise<StudentIdentity> {
    const student = await this.curriculum.findStudentByUserId(user.id);
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }
}

/** Consecutive active days ending today (or yesterday, so a streak is not "lost" before today's study). */
export function streak(activeDaysDesc: string[], today: string): number {
  const days = new Set(activeDaysDesc);
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let count = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    count++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return count;
}
