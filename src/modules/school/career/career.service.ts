import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { InterestQuizResult } from './entities/interest-quiz-result.entity';
import { CareerReport, CareerReportData } from './entities/career-report.entity';
import { SubmitQuizDto } from './dto/career.dto';
import { INTEREST_QUIZ_QUESTIONS, HollandLetter } from './data/quiz-questions';
import { CAREER_PATHS, CareerPath } from './data/career-mappings';

const HOLLAND_LETTERS: HollandLetter[] = ['R', 'I', 'A', 'S', 'E', 'C'];
const RETAKE_MONTHS = 6;
const REPORT_VALID_MONTHS = 3;

interface SubjectMark {
  subject: string;
  percentage: number;
  grade: string;
}

interface StudentProfile {
  studentId: string | null; // students.id (for homework)
  classId: string | null;
  className: string | null;
  sectionName: string | null;
  name: string;
}

interface CareerMatch {
  careerId: string;
  title: string;
  fitScore: number;
  stream: string;
}

@Injectable()
export class CareerService implements OnModuleInit {
  private readonly logger = new Logger(CareerService.name);
  private tablesReady = false;

  constructor(
    @InjectRepository(InterestQuizResult, 'school')
    private readonly quizRepo: Repository<InterestQuizResult>,
    @InjectRepository(CareerReport, 'school')
    private readonly reportRepo: Repository<CareerReport>,
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTables();
  }

  // The 'school' connection runs with synchronize:false, so create the career
  // tables on boot (idempotent) — mirrors how other school modules self-provision.
  private async ensureTables(): Promise<void> {
    if (this.tablesReady) return;
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_interest_quiz_results (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          institute_id UUID NOT NULL,
          answers JSONB NOT NULL DEFAULT '[]'::jsonb,
          holland_code VARCHAR NOT NULL,
          scores JSONB NOT NULL DEFAULT '{}'::jsonb,
          completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          can_retake_after TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_interest_quiz_student ON school_interest_quiz_results (student_id, completed_at);
        CREATE TABLE IF NOT EXISTS school_career_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          institute_id UUID NOT NULL,
          report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          valid_until TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_career_reports_student ON school_career_reports (student_id, generated_at);
      `);
      this.tablesReady = true;
    } catch (err) {
      this.logger.warn(`ensureTables failed: ${(err as Error)?.message}`);
    }
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────

  async getQuizQuestions(studentId: string) {
    const status = await this.getQuizStatus(studentId);
    return { success: true, data: { questions: INTEREST_QUIZ_QUESTIONS, status } };
  }

  async getQuizStatus(studentId: string) {
    const latest = await this.getLatestQuiz(studentId);
    const now = new Date();
    return {
      success: true,
      data: {
        completed: !!latest,
        completedAt: latest?.completedAt ?? null,
        canRetake: !latest || !latest.canRetakeAfter || latest.canRetakeAfter <= now,
        canRetakeAfter: latest?.canRetakeAfter ?? null,
        hollandCode: latest?.hollandCode ?? null,
      },
    };
  }

  private async getLatestQuiz(studentId: string): Promise<InterestQuizResult | null> {
    await this.ensureTables();
    return this.quizRepo.findOne({
      where: { studentId },
      order: { completedAt: 'DESC' },
    });
  }

  async submitQuiz(studentId: string, instituteId: string, dto: SubmitQuizDto) {
    const latest = await this.getLatestQuiz(studentId);
    const now = new Date();
    if (latest && latest.canRetakeAfter && latest.canRetakeAfter > now) {
      throw new BadRequestException(
        `You can retake the interest quiz after ${latest.canRetakeAfter.toISOString().slice(0, 10)}.`,
      );
    }

    // Count each Holland letter across the submitted answers.
    const scores: Record<string, number> = Object.fromEntries(HOLLAND_LETTERS.map((l) => [l, 0]));
    for (const ans of dto.answers) {
      const v = String(ans.value || '').toUpperCase() as HollandLetter;
      if (HOLLAND_LETTERS.includes(v)) scores[v] += 1;
    }

    // Top 2 letters by count → Holland code (stable tie-break by letter order).
    const hollandCode = [...HOLLAND_LETTERS]
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, 2)
      .join('');

    const canRetakeAfter = new Date(now);
    canRetakeAfter.setMonth(canRetakeAfter.getMonth() + RETAKE_MONTHS);

    const saved = await this.quizRepo.save(
      this.quizRepo.create({
        studentId,
        instituteId,
        answers: dto.answers.map((a) => ({ questionId: a.questionId, value: a.value })),
        hollandCode,
        scores,
        completedAt: now,
        canRetakeAfter,
      }),
    );

    return { success: true, data: { hollandCode: saved.hollandCode, scores: saved.scores } };
  }

  // ── Report generation ───────────────────────────────────────────────────────

  async generateCareerReport(studentId: string, instituteId: string) {
    const quiz = await this.getLatestQuiz(studentId);
    if (!quiz) {
      throw new BadRequestException('Complete the interest quiz first.');
    }

    const profile = await this.getStudentProfile(studentId);
    const grade = this.parseGrade(profile.className);

    const subjectMarks = await this.getSubjectMarks(studentId);
    const strongSubjects = subjectMarks.filter((s) => s.percentage >= 75).map((s) => s.subject);
    const weakSubjects = subjectMarks.filter((s) => s.percentage < 60).map((s) => s.subject);

    const quizTestSummary = await this.getQuizTestSummary(studentId);
    const attendancePercentage = await this.getAttendancePercentage(studentId);
    const homeworkRate = await this.getHomeworkRate(profile);

    // Local pre-scoring → top 5 careers for the AI to reason about.
    const topCareerMatches = this.scoreCareers(quiz.hollandCode, strongSubjects, grade).slice(0, 5);

    let reportData: CareerReportData;
    try {
      const aiResponse = await this.aiBridge.generateCareerGuidance(
        {
          studentName: profile.name,
          grade,
          board: 'CBSE',
          instituteId,
          subjectMarks,
          strongSubjects,
          weakSubjects,
          quizTestSummary,
          attendancePercentage,
          homeworkRate,
          hollandCode: quiz.hollandCode,
          hollandScores: quiz.scores,
          topCareerMatches,
        },
        instituteId,
      );
      const report = (aiResponse?.report ?? {}) as Partial<CareerReportData>;
      reportData = {
        topCareers: Array.isArray(report.topCareers) ? report.topCareers : [],
        overallAnalysis: report.overallAnalysis ?? '',
        streamRecommendation: report.streamRecommendation ?? null,
        immediateActions: Array.isArray(report.immediateActions) ? report.immediateActions : [],
        encouragement: report.encouragement ?? '',
        generatedForGrade: grade,
      };
    } catch (err) {
      this.logger.error(`Career AI generation failed for student ${studentId}: ${(err as Error)?.message}`);
      throw new BadRequestException('Career report generation is temporarily unavailable. Please try again shortly.');
    }

    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setMonth(validUntil.getMonth() + REPORT_VALID_MONTHS);

    await this.reportRepo.save(
      this.reportRepo.create({
        studentId,
        instituteId,
        reportData,
        generatedAt: now,
        validUntil,
      }),
    );

    return { success: true, data: { report: reportData, generatedAt: now, validUntil } };
  }

  async getCareerReport(studentId: string) {
    await this.ensureTables();
    const latest = await this.reportRepo.findOne({
      where: { studentId },
      order: { generatedAt: 'DESC' },
    });
    if (!latest) return { success: true, data: null };
    return {
      success: true,
      data: {
        report: latest.reportData,
        generatedAt: latest.generatedAt,
        validUntil: latest.validUntil,
      },
    };
  }

  // ── Explore ───────────────────────────────────────────────────────────────

  getCareerExplore() {
    return { success: true, data: CAREER_PATHS };
  }

  getCareerDetail(careerId: string) {
    const career = CAREER_PATHS.find((c) => c.id === careerId);
    if (!career) throw new BadRequestException('Career not found');
    return { success: true, data: career };
  }

  // ── Local scoring ───────────────────────────────────────────────────────────

  private scoreCareers(hollandCode: string, strongSubjects: string[], grade: number): CareerMatch[] {
    const codeLetters = hollandCode.toUpperCase().split('');
    const strongLower = strongSubjects.map((s) => s.toLowerCase());

    return CAREER_PATHS.map((career: CareerPath) => {
      // Holland fit (max 60): how many of the career's types the student shares.
      const overlap = career.hollandMatch.filter((l) => codeLetters.includes(l)).length;
      const hollandFit = (overlap / Math.max(career.hollandMatch.length, 1)) * 60;

      // Subject fit (max 30): strong subjects matching the career's required subjects.
      const required = Object.keys(career.requiredSubjects);
      let subjectFit: number;
      if (required.length === 0) {
        subjectFit = 18; // no hard requirement → moderate baseline
      } else {
        const matched = required.filter((req) =>
          strongLower.some((s) => s.includes(req) || req.includes(s)),
        ).length;
        subjectFit = (matched / required.length) * 30;
      }

      // Grade relevance (max 10).
      const gradeFit = career.gradeRelevance.includes(grade) ? 10 : 4;

      const fitScore = Math.round(Math.max(0, Math.min(100, hollandFit + subjectFit + gradeFit)));
      return { careerId: career.id, title: career.title, fitScore, stream: career.stream };
    }).sort((a, b) => b.fitScore - a.fitScore);
  }

  // ── Student data collection (each source is best-effort; never throws) ───────

  private async getStudentProfile(studentId: string): Promise<StudentProfile> {
    try {
      const rows: Array<Record<string, string | null>> = await this.ds.query(
        `SELECT s.id AS student_id, sec.class_id, c.name AS class_name,
                sec.name AS section_name, u.name AS user_name
         FROM students s
         LEFT JOIN sections sec ON sec.id::text = s.section_id::text
         LEFT JOIN classes c ON c.id::text = sec.class_id::text
         LEFT JOIN users u ON u.id::text = s.user_id::text
         WHERE s.user_id::text = $1::text
         LIMIT 1`,
        [studentId],
      );
      const r = rows[0];
      return {
        studentId: r?.student_id ?? null,
        classId: r?.class_id ?? null,
        className: r?.class_name ?? null,
        sectionName: r?.section_name ?? null,
        name: r?.user_name ?? 'Student',
      };
    } catch (err) {
      this.logger.warn(`getStudentProfile failed: ${(err as Error)?.message}`);
      return { studentId: null, classId: null, className: null, sectionName: null, name: 'Student' };
    }
  }

  private parseGrade(className: string | null): number {
    const m = String(className || '').match(/\d+/);
    const g = m ? parseInt(m[0], 10) : NaN;
    return Number.isFinite(g) && g >= 1 && g <= 12 ? g : 10;
  }

  private async getSubjectMarks(studentId: string): Promise<SubjectMark[]> {
    try {
      const rows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT sub.name AS subject_name,
                AVG(CASE WHEN r.percentage IS NOT NULL THEN r.percentage
                         WHEN r.total_marks > 0 THEN (r.marks_obtained::numeric / r.total_marks) * 100
                         ELSE 0 END) AS avg_pct
         FROM results r
         LEFT JOIN assessments a ON a.id::text = r.assessment_id::text
         LEFT JOIN subjects sub ON sub.id::text = a.subject_id::text
         WHERE r.student_id::text = $1::text AND COALESCE(r.is_absent, false) = false
         GROUP BY sub.name`,
        [studentId],
      );
      return rows
        .filter((r) => r.subject_name)
        .map((r) => {
          const pct = Math.round(Number(r.avg_pct) || 0);
          return { subject: String(r.subject_name), percentage: pct, grade: this.toLetterGrade(pct) };
        })
        .sort((a, b) => b.percentage - a.percentage);
    } catch (err) {
      this.logger.warn(`getSubjectMarks failed: ${(err as Error)?.message}`);
      return [];
    }
  }

  private toLetterGrade(pct: number): string {
    if (pct >= 90) return 'A+';
    if (pct >= 80) return 'A';
    if (pct >= 70) return 'B';
    if (pct >= 60) return 'C';
    if (pct >= 40) return 'D';
    return 'E';
  }

  private async getQuizTestSummary(studentId: string): Promise<string> {
    try {
      const rows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT COUNT(*)::int AS attempts,
                ROUND(AVG(CASE WHEN objective_total > 0
                          THEN (objective_score::numeric / objective_total) * 100 END))::int AS avg_objective
         FROM assessment_submissions
         WHERE student_user_id::text = $1::text`,
        [studentId],
      );
      const r = rows[0];
      const attempts = Number(r?.attempts) || 0;
      if (!attempts) return 'No quiz or test attempts recorded yet.';
      const avg = r?.avg_objective != null ? `${r.avg_objective}%` : 'not auto-graded';
      return `${attempts} assessment attempt(s); average objective score ${avg}.`;
    } catch (err) {
      this.logger.warn(`getQuizTestSummary failed: ${(err as Error)?.message}`);
      return 'No data available';
    }
  }

  private async getAttendancePercentage(studentId: string): Promise<number> {
    try {
      const rows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE LOWER(status) IN ('present','late'))::int AS present
         FROM attendances
         WHERE user_id::text = $1::text`,
        [studentId],
      );
      const r = rows[0];
      const total = Number(r?.total) || 0;
      const present = Number(r?.present) || 0;
      return total > 0 ? Math.round((present / total) * 100) : 0;
    } catch (err) {
      this.logger.warn(`getAttendancePercentage failed: ${(err as Error)?.message}`);
      return 0;
    }
  }

  private async getHomeworkRate(profile: StudentProfile): Promise<number> {
    if (!profile.studentId || !profile.classId) return 0;
    try {
      const totalRows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT COUNT(*)::int AS total FROM assignments WHERE class_id::text = $1::text`,
        [profile.classId],
      );
      const submittedRows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT COUNT(*)::int AS submitted FROM assignment_submissions
         WHERE student_id::text = $1::text AND status = 'submitted'`,
        [profile.studentId],
      );
      const total = Number(totalRows[0]?.total) || 0;
      const submitted = Number(submittedRows[0]?.submitted) || 0;
      return total > 0 ? Math.min(100, Math.round((submitted / total) * 100)) : 0;
    } catch (err) {
      this.logger.warn(`getHomeworkRate failed: ${(err as Error)?.message}`);
      return 0;
    }
  }
}
