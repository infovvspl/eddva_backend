import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LearningPathSettingsService } from '../common/learning-path-settings.service';
import { StudentCurriculumRepository } from '../common/student-curriculum.repository';
import { MasteryQueryService } from '../mastery/mastery-query.service';
import { RoadmapService } from '../roadmap/roadmap.service';
import { buildMindMap, MasteryRow, SubjectNode, SubtopicScores } from './mind-map';

/** Subtopic status uses each topic's latest few graded quizzes/assessments. */
const RECENT_ATTEMPTS = 3;

/**
 * The summary cards count exactly what the mind map shows: chapters shown as
 * a chapter roadmap, plus weak or at-risk topics shown on their own. (Counting
 * every weak topic and every weak chapter counted a weak topic twice, inside
 * its weak chapter, and left at-risk chapters out.) Study time is the time for
 * those same items.
 */
export function summarizeMap(subjects: SubjectNode[]) {
  const out = { weakChapters: 0, atRiskChapters: 0, weakTopics: 0, atRiskTopics: 0, studyMinutes: 0 };
  for (const s of subjects)
    for (const c of s.chapters) {
      if (c.expanded) {
        if (c.status === 'weak') out.weakChapters++;
        if (c.status === 'at_risk') out.atRiskChapters++;
        out.studyMinutes += c.estMinutes;
        continue;
      }
      for (const t of c.topics) {
        if (t.status === 'weak') out.weakTopics++;
        else if (t.status === 'at_risk') out.atRiskTopics++;
        else continue; // a topic kept on the map only for its chat
        out.studyMinutes += t.estMinutes;
      }
    }
  return out;
}

/** The planner home screen: weak-topic summary with study time, and roadmaps of what the student is weak in. */
@Injectable()
export class LearningHomeService {
  private readonly logger = new Logger(LearningHomeService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly mastery: MasteryQueryService,
    private readonly roadmaps: RoadmapService,
    private readonly settings: LearningPathSettingsService,
  ) {}

  async getHome(user: any) {
    const student = await this.curriculum.findStudentByUserId(user.id);
    if (!student) throw new NotFoundException('Student profile not found');

    const [mine, chapters, topicRows, chapterRows, threadRows, scoreRows, cfg] = await Promise.all([
      this.mastery.getMyMastery(user),
      this.curriculum.loadChapters(student),
      this.ds.query(
        `SELECT topic_id::text AS id, status, mastery, est_minutes FROM student_topic_mastery WHERE student_id = $1`,
        [student.studentId],
      ),
      this.ds.query(
        `SELECT chapter_id::text AS id, status, mastery, est_minutes, chapter_level_status FROM student_chapter_mastery WHERE student_id = $1`,
        [student.studentId],
      ),
      this.ds.query(
        `SELECT th.id::text, th.topic_id::text, th.status, th.current_round, th.parent_thread_id::text,
                (SELECT COUNT(*)::int FROM learning_thread_steps st WHERE st.thread_id = th.id AND st.status = 'done') AS steps_done,
                th.opened_subtopics
           FROM learning_threads th WHERE th.student_id = $1 AND th.scope = 'topic'`,
        [student.studentId],
      ),
      this.ds.query(
        `WITH recent AS (
           SELECT id, topic_id, ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY submitted_at DESC) AS rn
             FROM learning_quiz_instances
            WHERE student_id = $1 AND status <> 'in_progress'
         )
         SELECT r.topic_id::text AS topic_id, LOWER(REGEXP_REPLACE(TRIM(x.concept_tag), '\\s+', ' ', 'g')) AS concept,
                COUNT(*)::int AS total, SUM(CASE WHEN x.is_correct THEN 1 ELSE 0 END)::int AS correct
           FROM recent r JOIN learning_quiz_responses x ON x.instance_id = r.id
          WHERE r.rn <= ${RECENT_ATTEMPTS} AND x.concept_tag IS NOT NULL
          GROUP BY 1, 2`,
        [student.studentId],
      ),
      this.settings.getMasteryConfig(student.instituteId),
    ]);

    const chapterIds = chapters.map((c) => c.chapterId);
    const [chapterRoadmaps, units] = await Promise.all([
      this.roadmaps.chapterRoadmaps(chapterIds),
      this.curriculum.loadTopicUnits(chapterIds),
    ]);
    const toMap = (list: any[]) =>
      new Map<string, MasteryRow>(
        list.map((r) => [
          r.id,
          {
            status: r.status,
            mastery: r.mastery === null ? null : Number(r.mastery),
            estMinutes: Number(r.est_minutes),
            chapterLevelStatus: r.chapter_level_status ?? undefined,
          },
        ]),
      );
    const scores = new Map<string, SubtopicScores>();
    for (const s of scoreRows) {
      const byConcept = scores.get(s.topic_id) ?? new Map();
      byConcept.set(s.concept, { correct: Number(s.correct), total: Number(s.total) });
      scores.set(s.topic_id, byConcept);
    }

    const result = buildMindMap({
      chapters,
      chapterRoadmaps,
      units,
      topicMastery: toMap(topicRows),
      chapterMastery: toMap(chapterRows),
      threads: threadRows.map((t: any) => ({
        id: t.id,
        topicId: t.topic_id,
        status: t.status,
        round: t.current_round,
        parentThreadId: t.parent_thread_id,
        stepsDone: Number(t.steps_done ?? 0),
        openedSubtopics: Array.isArray(t.opened_subtopics) ? t.opened_subtopics : [],
      })),
      scores,
      thresholds: {
        minQuestions: cfg.concepts.minQuestions,
        weakBelow: cfg.concepts.weakBelow,
        atRisk: cfg.thresholds.atRisk,
        mastered: cfg.thresholds.mastered,
      },
    });

    // Only roadmaps the map is showing as "preparing" are generated, in the background.
    const pending = result.chapterRoadmapsNeeded.length + result.topicRoadmapsNeeded.length;
    // Fallback roadmaps (stored while the AI was failing) are retried in the background when due;
    // the student keeps using the fallback meanwhile, so these do not count as pending.
    const retries = await this.roadmaps.fallbacksDue(chapterIds).catch(() => []);
    const chapterJobs = [...result.chapterRoadmapsNeeded, ...retries.filter((r) => r.kind === 'chapter').map((r) => r.chapterId)];
    const topicJobs = [
      ...result.topicRoadmapsNeeded,
      ...retries.filter((r) => r.kind === 'topic' && r.topicId).map((r) => ({ chapterId: r.chapterId, topicId: r.topicId! })),
    ];
    if (chapterJobs.length || topicJobs.length) {
      await Promise.all([
        this.roadmaps.requestChapterRoadmaps(chapterJobs, student.instituteId, student.className),
        this.roadmaps.requestTopicRoadmaps(topicJobs, student.instituteId, student.className),
      ]).catch((err) => this.logger.warn(`Could not queue roadmaps: ${(err as Error)?.message}`));
    }
    return { summary: { ...mine.summary, ...summarizeMap(result.subjects) }, mindMap: result.subjects, roadmapsPending: pending > 0 };
  }
}
