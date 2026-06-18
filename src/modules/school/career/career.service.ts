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
const RETAKE_MONTHS = 3;
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
      // ── Quiz results table ──────────────────────────────────────────────────
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

        -- ── Career reports table ────────────────────────────────────────────
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

        -- ── Single unified career paths table (static + AI-generated) ───────
        CREATE TABLE IF NOT EXISTS school_career_paths (
          id VARCHAR PRIMARY KEY,
          title VARCHAR NOT NULL,
          stream VARCHAR NOT NULL DEFAULT 'any',
          description TEXT NOT NULL DEFAULT '',
          exams JSONB NOT NULL DEFAULT '[]'::jsonb,
          top_colleges JSONB NOT NULL DEFAULT '[]'::jsonb,
          salary_range VARCHAR NOT NULL DEFAULT '',
          required_subjects JSONB NOT NULL DEFAULT '{}'::jsonb,
          holland_match JSONB NOT NULL DEFAULT '[]'::jsonb,
          grade_relevance JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_custom BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Ensure columns exist (for backward compatibility if table already exists)
        ALTER TABLE school_career_paths ADD COLUMN IF NOT EXISTS duration VARCHAR NOT NULL DEFAULT '';
        ALTER TABLE school_career_paths ADD COLUMN IF NOT EXISTS education_path JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE school_career_paths ADD COLUMN IF NOT EXISTS key_skills JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE school_career_paths ADD COLUMN IF NOT EXISTS job_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE school_career_paths ADD COLUMN IF NOT EXISTS pros_cons JSONB NOT NULL DEFAULT '{"pros": [], "cons": []}'::jsonb;
        ALTER TABLE school_career_paths ADD COLUMN IF NOT EXISTS focus_areas JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);

      // ── Seed static careers (idempotent — updates existing rows) ─────────────
      for (const c of CAREER_PATHS) {
        await this.ds.query(
          `INSERT INTO school_career_paths
             (id, title, stream, description, exams, top_colleges, salary_range,
              required_subjects, holland_match, grade_relevance, is_custom,
              duration, education_path, key_skills, job_roles, pros_cons)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,$15)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             stream = EXCLUDED.stream,
             description = EXCLUDED.description,
             exams = EXCLUDED.exams,
             top_colleges = EXCLUDED.top_colleges,
             salary_range = EXCLUDED.salary_range,
             required_subjects = EXCLUDED.required_subjects,
             holland_match = EXCLUDED.holland_match,
             grade_relevance = EXCLUDED.grade_relevance,
             duration = EXCLUDED.duration,
             education_path = EXCLUDED.education_path,
             key_skills = EXCLUDED.key_skills,
             job_roles = EXCLUDED.job_roles,
             pros_cons = EXCLUDED.pros_cons`,
          [
            c.id, c.title, c.stream, c.description,
            JSON.stringify(c.exams),
            JSON.stringify(c.topColleges),
            c.salaryRange,
            JSON.stringify(c.requiredSubjects),
            JSON.stringify(c.hollandMatch),
            JSON.stringify(c.gradeRelevance),
            c.duration,
            JSON.stringify(c.educationPath),
            JSON.stringify(c.keySkills),
            JSON.stringify(c.jobRoles),
            JSON.stringify(c.prosCons),
          ],
        );
      }

      this.tablesReady = true;
    } catch (err) {
      this.logger.warn(`ensureTables failed: ${(err as Error)?.message}`);
    }
  }

  // ── Career helpers ───────────────────────────────────────────────────────────

  /** Derives a URL-safe slug from any string. */
  private slugify(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  /** Infers a stream from career title + focus area keywords. */
  private inferStream(title: string, focusAreas: string[]): 'science' | 'commerce' | 'arts' | 'any' {
    const src = [title, ...focusAreas].join(' ').toLowerCase();
    if (/physic|chemist|biolog|math|neet|jee|engineer|medic|pharma|nurs|vet/.test(src)) return 'science';
    if (/account|finance|commerce|econom|business|ca\b|tax|bank/.test(src)) return 'commerce';
    if (/histor|geograph|english|political|humanit|journal|psych|law|social|art|film|music/.test(src)) return 'arts';
    return 'any';
  }

  /**
   * Fuzzy-maps an id/title string to an existing school_career_paths id.
   * Returns the canonical id if a static match is found, otherwise null.
   */
  private fuzzyMatchId(src: string): string | null {
    // Specific patterns BEFORE broad ones — order is critical
    if (/psych|counsel|therap|mental_health|behavioural/.test(src)) return 'psychology';
    if (/data_sci|machine_learn|artificial_intel|big_data|data_anal/.test(src)) return 'data_science';
    if (/biotech|biotechnolog/.test(src)) return 'biotechnology';
    if (/environ/.test(src)) return 'environmental_science';
    if (/architect/.test(src)) return 'architecture';
    if (/mbbs|medic|doctor|dental|surgery|physician|neet|health_care/.test(src)) return 'medicine';
    if (/nurs/.test(src)) return 'nursing';
    if (/pharma/.test(src)) return 'pharmacy';
    if (/veterinar|bvsc/.test(src)) return 'veterinary_science';
    if (/civil_serv|ias|ips|ifs|upsc/.test(src)) return 'civil_services';
    if (/teach|educat|ctet|b_ed/.test(src)) return 'teaching';
    if (/defens|army|navy|air_force|nda|cds|military/.test(src)) return 'defense';
    if (/hotel|hospitality|tourism/.test(src)) return 'hospitality';
    if (/sport|physical_edu|fitness|athlet/.test(src)) return 'sports';
    if (/aviation|pilot|airline|aircraft/.test(src)) return 'aviation';
    if (/social_work|ngo|welfare/.test(src)) return 'social_work';
    if (/film|music|perform|theater|danc|actor|drama/.test(src)) return 'performing_arts';
    if (/journal|broadcast|news/.test(src)) return 'journalism';
    if (/fashion|graphic|interior_design|ux_design|product_design/.test(src)) return 'design';
    if (/software|engineer|coding|program|tech/.test(src)) return 'engineering';
    if (/law|legal|advocate|judiciary|clat/.test(src)) return 'law';
    if (/account|chartered|audit|finance|ca\b|tax|bank/.test(src)) return 'chartered_accountancy';
    if (/entrepreneur|startup|venture|business|mba/.test(src)) return 'entrepreneurship';
    return null;
  }

  /**
   * Saves AI-generated careers that don't already exist in school_career_paths.
   * All careers — static and AI-generated — live in the same table.
   */
  private async saveAiCareers(
    topCareers: Array<{ careerId?: string; title?: string; reasoning?: string; focusAreas?: string[] }>,
  ): Promise<void> {
    for (const item of topCareers) {
      const title = (item.title || '').trim();
      if (!title) continue;
      // Try to fuzzy-match to an existing id — if it matches, the career is already in the table
      const slug = this.slugify(title);
      const combined = `${title} ${item.careerId || ''}`.toLowerCase();
      if (this.fuzzyMatchId(combined) || this.fuzzyMatchId(slug)) continue;
      const focusAreas: string[] = Array.isArray(item.focusAreas) ? item.focusAreas : [];
      const stream = this.inferStream(title, focusAreas);
      const description = (item.reasoning || '').trim() || `Explore a career in ${title}.`;
      try {
        await this.ds.query(
          `INSERT INTO school_career_paths
             (id, title, stream, description, exams, top_colleges, salary_range,
              required_subjects, holland_match, grade_relevance, is_custom,
              duration, education_path, key_skills, job_roles, pros_cons, focus_areas)
           VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '', '{}'::jsonb, '[]'::jsonb, '[9,10,11,12]'::jsonb, true,
                   '', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"pros":[], "cons":[]}'::jsonb, $5::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [slug, title, stream, description, JSON.stringify(focusAreas)],
        );
        this.logger.log(`Saved new AI career to school_career_paths: ${title} (${slug})`);
      } catch (err) {
        this.logger.warn(`saveAiCareers failed for "${title}": ${(err as Error)?.message}`);
      }
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

    let canRetakeAfter = latest?.canRetakeAfter ?? null;
    if (latest && latest.completedAt) {
      const computedDate = new Date(latest.completedAt);
      computedDate.setMonth(computedDate.getMonth() + RETAKE_MONTHS);
      canRetakeAfter = computedDate;
    }

    const canRetake = !latest || !canRetakeAfter || canRetakeAfter <= now;

    return {
      success: true,
      data: {
        completed: !!latest,
        completedAt: latest?.completedAt ?? null,
        canRetake,
        canRetakeAfter,
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

    // Save any AI-generated careers not yet in school_career_paths so they
    // appear for everyone in the unified Explore Careers list.
    void this.saveAiCareers(reportData.topCareers).catch((e) =>
      this.logger.warn(`saveAiCareers error: ${(e as Error)?.message}`),
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

  /**
   * Returns all career paths from the single school_career_paths table.
   * Static careers are seeded on boot; AI-generated ones are added dynamically.
   */
  async getCareerExplore() {
    await this.ensureTables();
    try {
      const rows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT id, title, stream, description, exams,
                top_colleges AS "topColleges",
                salary_range AS "salaryRange",
                required_subjects AS "requiredSubjects",
                holland_match AS "hollandMatch",
                grade_relevance AS "gradeRelevance",
                is_custom AS "isCustom",
                duration,
                education_path AS "educationPath",
                key_skills AS "keySkills",
                job_roles AS "jobRoles",
                pros_cons AS "prosCons",
                focus_areas AS "focusAreas"
         FROM school_career_paths
         ORDER BY is_custom ASC, created_at ASC`,
      );
      const careers: CareerPath[] = rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        stream: String(r.stream) as CareerPath['stream'],
        description: String(r.description),
        exams: Array.isArray(r.exams) ? (r.exams as string[]) : [],
        topColleges: Array.isArray(r.topColleges) ? (r.topColleges as string[]) : [],
        salaryRange: String(r.salaryRange || ''),
        requiredSubjects: (r.requiredSubjects && typeof r.requiredSubjects === 'object' ? r.requiredSubjects : {}) as Record<string, number>,
        hollandMatch: Array.isArray(r.hollandMatch) ? (r.hollandMatch as HollandLetter[]) : [],
        gradeRelevance: Array.isArray(r.gradeRelevance) ? (r.gradeRelevance as number[]) : [],
        duration: String(r.duration || ''),
        educationPath: Array.isArray(r.educationPath) ? (r.educationPath as string[]) : [],
        keySkills: Array.isArray(r.keySkills) ? (r.keySkills as string[]) : [],
        jobRoles: Array.isArray(r.jobRoles) ? (r.jobRoles as string[]) : [],
        prosCons: (r.prosCons && typeof r.prosCons === 'object' ? r.prosCons : { pros: [], cons: [] }) as CareerPath['prosCons'],
        focusAreas: Array.isArray(r.focusAreas) ? (r.focusAreas as string[]) : [],
      }));
      return { success: true, data: careers };
    } catch (err) {
      this.logger.warn(`getCareerExplore failed: ${(err as Error)?.message}`);
      // Fallback to static array if DB is unavailable
      return { success: true, data: CAREER_PATHS };
    }
  }

  /**
   * Returns a single career from school_career_paths, with fuzzy matching
   * so AI-generated IDs (e.g. "3", "psych_counseling") resolve correctly.
   */
  async getCareerDetail(careerId: string) {
    await this.ensureTables();
    const rawId = (careerId || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    // Fuzzy-match the id to a canonical one, then fall back to the raw id
    const resolvedId = this.fuzzyMatchId(rawId) ?? rawId;

    try {
      const rows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT id, title, stream, description, exams,
                top_colleges AS "topColleges",
                salary_range AS "salaryRange",
                required_subjects AS "requiredSubjects",
                holland_match AS "hollandMatch",
                grade_relevance AS "gradeRelevance",
                duration,
                education_path AS "educationPath",
                key_skills AS "keySkills",
                job_roles AS "jobRoles",
                pros_cons AS "prosCons",
                focus_areas AS "focusAreas"
         FROM school_career_paths WHERE id = $1 LIMIT 1`,
        [resolvedId],
      );
      if (rows.length > 0) {
        const r = rows[0];
        const career: CareerPath = {
          id: String(r.id),
          title: String(r.title),
          stream: String(r.stream) as CareerPath['stream'],
          description: String(r.description),
          exams: Array.isArray(r.exams) ? (r.exams as string[]) : [],
          topColleges: Array.isArray(r.topColleges) ? (r.topColleges as string[]) : [],
          salaryRange: String(r.salaryRange || ''),
          requiredSubjects: (r.requiredSubjects && typeof r.requiredSubjects === 'object' ? r.requiredSubjects : {}) as Record<string, number>,
          hollandMatch: Array.isArray(r.hollandMatch) ? (r.hollandMatch as HollandLetter[]) : [],
          gradeRelevance: Array.isArray(r.gradeRelevance) ? (r.gradeRelevance as number[]) : [],
          duration: String(r.duration || ''),
          educationPath: Array.isArray(r.educationPath) ? (r.educationPath as string[]) : [],
          keySkills: Array.isArray(r.keySkills) ? (r.keySkills as string[]) : [],
          jobRoles: Array.isArray(r.jobRoles) ? (r.jobRoles as string[]) : [],
          prosCons: (r.prosCons && typeof r.prosCons === 'object' ? r.prosCons : { pros: [], cons: [] }) as CareerPath['prosCons'],
          focusAreas: Array.isArray(r.focusAreas) ? (r.focusAreas as string[]) : [],
        };
        return { success: true, data: career };
      }
    } catch (err) {
      this.logger.warn(`getCareerDetail failed: ${(err as Error)?.message}`);
    }

    throw new BadRequestException('Career not found');
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
