import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

/**
 * AiBridgeService
 *
 * Single adapter layer for all 12 AI services.
 * Each method maps to one AI service endpoint on the Django backend.
 *
 * Tenant flow:
 *   - tenantId is forwarded via X-Tenant-ID header
 *   - API key is sent via Authorization: Bearer (validated by Django middleware)
 *   - Django middleware resolves the tenant and applies per-tenant rate limits + caching
 */
@Injectable()
export class AiBridgeService {
  private readonly logger = new Logger(AiBridgeService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('ai.baseUrl');
    this.apiKey = config.get<string>('ai.apiKey');
    this.timeout = config.get<number>('ai.timeoutMs');
  }

  private headers(tenantId?: string) {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (tenantId) {
      h['X-Tenant-ID'] = tenantId;
    }
    return h;
  }

  private async post<T>(path: string, body: any, tenantId?: string): Promise<T> {
    try {
      const res: AxiosResponse<T> = await firstValueFrom(
        this.http.post<T>(`${this.baseUrl}${path}`, body, {
          headers: this.headers(tenantId),
          timeout: this.timeout,
        }),
      );
      return res.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`AI Bridge error [${path}] tenant=${tenantId || 'none'}: ${message}`);
      throw err;
    }
  }

  // ── AI #1 — Doubt Clearing ────────────────────────────────────────────────
  async resolveDoubt(
    payload: {
      questionText: string;
      topicId?: string;
      mode: 'short' | 'detailed';
      studentContext?: any;
    },
    tenantId?: string,
  ) {
    return this.post('/doubt/resolve', payload, tenantId);
  }

  // ── AI #2 — AI Tutor ──────────────────────────────────────────────────────
  async startTutorSession(
    payload: { studentId: string; topicId: string; context: string },
    tenantId?: string,
  ) {
    return this.post('/tutor/session', payload, tenantId);
  }

  async continueTutorSession(
    payload: { sessionId: string; studentMessage: string },
    tenantId?: string,
  ) {
    return this.post('/tutor/continue', payload, tenantId);
  }

  // ── AI #3 — Performance Analysis ─────────────────────────────────────────
  async analyzePerformance(
    payload: {
      studentId: string;
      testSessionId: string;
      attempts: any[];
      examTarget: string;
    },
    tenantId?: string,
  ) {
    return this.post('/performance/analyze', payload, tenantId);
  }

  // ── AI #4 — Assessment Grading ────────────────────────────────────────────
  async gradeSubjective(
    payload: {
      questionText: string;
      studentAnswer: string;
      expectedAnswer: string;
      maxMarks: number;
    },
    tenantId?: string,
  ) {
    return this.post('/grade/subjective', payload, tenantId);
  }

  // ── AI #5 — Engagement Monitoring ────────────────────────────────────────
  async detectEngagement(
    payload: {
      studentId: string;
      context: string;
      signals: {
        rewindCount?: number;
        pauseCount?: number;
        answersPerMinute?: number;
        accuracy?: number;
        idleSeconds?: number;
      };
    },
    tenantId?: string,
  ) {
    return this.post('/engage/detect', payload, tenantId);
  }

  // ── AI #6 — Content Recommendation ───────────────────────────────────────
  async getContentRecommendations(
    payload: {
      studentId: string;
      context: 'post_test' | 'post_wrong_answer' | 'dashboard';
      weakTopics?: string[];
      recentPerformance?: any;
    },
    tenantId?: string,
  ) {
    return this.post('/recommend/content', payload, tenantId);
  }

  // ── AI #7 — Speech-to-Text Notes ─────────────────────────────────────────
  async generateLectureNotes(
    payload: {
      audioUrl: string;
      topicId: string;
      language: 'en' | 'hi';
    },
    tenantId?: string,
  ) {
    return this.post('/stt/notes', payload, tenantId);
  }

  // ── AI #8 — Student Feedback Engine ──────────────────────────────────────
  async generateFeedback(
    payload: {
      studentId: string;
      context: 'post_test' | 'weekly_summary' | 'battle_result';
      data: any;
    },
    tenantId?: string,
  ) {
    return this.post('/feedback/generate', payload, tenantId);
  }

  // ── AI #9 — Notes Weak Topic Identifier ──────────────────────────────────
  async analyzeNotes(
    payload: {
      studentId: string;
      notesContent: string;
      topicId: string;
    },
    tenantId?: string,
  ) {
    return this.post('/notes/analyze', payload, tenantId);
  }

  // ── AI #10 — Resume Analyzer ──────────────────────────────────────────────
  async analyzeResume(
    payload: { resumeText: string; targetRole: string },
    tenantId?: string,
  ) {
    return this.post('/resume/analyze', payload, tenantId);
  }

  // ── AI #11 — Interview Prep ────────────────────────────────────────────────
  async startInterviewPrep(
    payload: { studentId: string; targetCollege: string },
    tenantId?: string,
  ) {
    return this.post('/interview/start', payload, tenantId);
  }

  // ── AI #12 — Personalised Learning Plan ──────────────────────────────────
  async generateStudyPlan(
    payload: {
      studentId: string;
      examTarget: string;
      examYear: string;
      dailyHours: number;
      weakTopics: string[];
      targetCollege?: string;
      academicCalendar?: any;
    },
    tenantId?: string,
  ) {
    return this.post('/plan/generate', payload, tenantId);
  }

  // ── AI #13 — Quiz Question Generator from Topic ───────────────────────────
  async generateQuestionsFromTopic(
    payload: {
      topicId: string;
      topicName: string;
      count: number;
      difficulty: string;
      type: string;
    },
    tenantId?: string,
  ) {
    // Map frontend question type to Django question_types string
    const typeMap: Record<string, string> = {
      mcq_single: 'mcq',
      mcq_multi: 'mcq',
      integer: 'short_answer',
    };
    const questionTypes = typeMap[payload.type] || 'mcq';

    const raw = await this.post<any>('/test/generate/', {
      topic: payload.topicName,
      num_questions: payload.count,
      difficulty: payload.difficulty,
      question_types: questionTypes,
    }, tenantId);

    // Django returns { topic, difficulty, questions: [{ id, question, type, options, answer, explanation }] }
    // Transform to frontend-expected array: [{ content, options: [{label, content, isCorrect}], explanation }]
    const questions: any[] = Array.isArray(raw?.questions) ? raw.questions : [];

    return questions.map((q: any) => {
      const labels = ['A', 'B', 'C', 'D', 'E'];
      const correctAnswer: string = (q.answer || '').trim().toLowerCase();

      // Extract leading label from answers like "A. text", "A) text" → "a", "b", etc.
      const answerLeadingLabel = correctAnswer.match(/^([a-e])[.)]\s*/)?.[1] ?? null;
      // Django sometimes returns 1-based numeric index ("1"=A, "2"=B, ...)
      const answerNumericIndex = /^\d+$/.test(correctAnswer) ? parseInt(correctAnswer, 10) - 1 : -1;
      this.logger.debug(`AI quiz answer raw="${q.answer}" normalized="${correctAnswer}" leadingLabel="${answerLeadingLabel}" numericIdx=${answerNumericIndex}`);

      const options = (q.options || []).map((opt: any, i: number) => {
        const text = typeof opt === 'string' ? opt : String(opt);
        const label = labels[i] || String.fromCharCode(65 + i);
        const labelLower = label.toLowerCase();
        const textLower = text.trim().toLowerCase();
        // Handle: numeric index "1"/"2"/"3"/"4", letter "A"/"a", "A.", "A. text", "A) text", full text
        const isCorrect =
          (answerNumericIndex >= 0 && i === answerNumericIndex) ||
          correctAnswer === labelLower ||
          correctAnswer === labelLower + '.' ||
          (answerLeadingLabel !== null && answerLeadingLabel === labelLower) ||
          correctAnswer === textLower;
        return { label, content: text, isCorrect };
      });

      return {
        content: q.question || q.content || '',
        options,
        explanation: q.explanation || '',
        integerAnswer: payload.type === 'integer' ? (q.answer || null) : null,
      };
    });
  }

  // ── AI #14 — In-Video Quiz Generator ──────────────────────────────────────
  async generateQuizForLecture(
    payload: {
      transcript: string;
      lectureTitle: string;
      topicId?: string;
    },
    tenantId?: string,
  ) {
    return this.post('/quiz/generate', payload, tenantId);
  }
}
