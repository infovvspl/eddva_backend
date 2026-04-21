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
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
    if (tenantId) {
      h['X-Tenant-ID'] = tenantId;
    }
    return h;
  }

  private async post<T>(path: string, body: any, tenantId?: string, timeoutMs?: number): Promise<T> {
    try {
      const res: AxiosResponse<T> = await firstValueFrom(
        this.http.post<T>(`${this.baseUrl}${path}`, body, {
          headers: this.headers(tenantId),
          timeout: timeoutMs ?? this.timeout,
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

  // ── AI #7a — Text Translation ─────────────────────────────────────────────
  async translateText(
    payload: { text: string; targetLanguage: string },
    tenantId?: string,
  ) {
    return this.post('/translate', payload, tenantId, 60_000);
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
    return this.post('/stt/notes', payload, tenantId, 300_000); // 5 min — Whisper + LLM
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

  /**
   * Strip markdown code fences and parse the inner JSON.
   * Handles: ```json ... ```, ``` ... ```, or plain JSON strings.
   */
  private stripMarkdownAndParse(text: string): any | null {
    const stripped = text.trim()
      .replace(/^```(?:json|JSON|js|javascript)?\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    if (stripped.startsWith('{') || stripped.startsWith('[')) {
      try { return JSON.parse(stripped); } catch { /* not valid JSON */ }
    }
    return null;
  }

  /**
   * Resolve ANY AI response shape into a flat question array.
   * Handles: plain array, {questions:[...]}, JSON string, markdown-fenced JSON,
   * and the degenerate case where the whole response is stuffed into a single
   * "question" field as a markdown code block.
   */
  private resolveToQuestionList(raw: any): any[] {
    // 1. Already a plain array
    if (Array.isArray(raw)) return raw;

    // 2. Object with a questions array
    if (Array.isArray(raw?.questions) && raw.questions.length > 0) {
      const first = raw.questions[0];
      // Degenerate: the AI crammed the whole JSON response into the first "question" field
      const possibleJson: string = (
        typeof first === 'string' ? first :
        (first?.question || first?.questionText || first?.content || first?.text || '')
      );
      if (typeof possibleJson === 'string' && possibleJson.trim().startsWith('`')) {
        const parsed = this.stripMarkdownAndParse(possibleJson);
        if (parsed) {
          if (Array.isArray(parsed?.questions)) return parsed.questions;
          if (Array.isArray(parsed)) return parsed;
        }
      }
      return raw.questions;
    }

    // 3. String — may be plain JSON or markdown-fenced JSON
    if (typeof raw === 'string') {
      const t = raw.trim();
      // Markdown fence
      if (t.startsWith('`')) {
        const parsed = this.stripMarkdownAndParse(t);
        if (parsed) {
          if (Array.isArray(parsed?.questions)) return parsed.questions;
          if (Array.isArray(parsed)) return parsed;
        }
      }
      // Plain JSON
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed?.questions)) return parsed.questions;
          if (Array.isArray(parsed)) return parsed;
        } catch { /* not JSON */ }
      }
    }

    return [];
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

    const questions = this.resolveToQuestionList(raw);

    if (questions.length > 0) {
      return this.normaliseStructuredQuestions(questions, payload.type);
    }

    // Last resort: free-form Q.N text parser
    const rawText: string =
      typeof raw === 'string' ? raw :
      typeof raw?.text === 'string' ? raw.text :
      typeof raw?.content === 'string' ? raw.content :
      typeof raw?.result === 'string' ? raw.result :
      typeof raw?.output === 'string' ? raw.output :
      '';

    if (rawText.trim()) {
      this.logger.warn(`[AI #13] Falling back to raw text parser (${rawText.length} chars)`);
      return this.parseRawTextQuestions(rawText, payload.type);
    }

    this.logger.warn('[AI #13] No questions in AI response');
    return [];
  }

  /** Transform any known AI question array shape into the frontend shape. */
  private normaliseStructuredQuestions(questions: any[], type: string) {
    const fallbackLabels = ['A', 'B', 'C', 'D', 'E'];
    return questions.map((q: any) => {
      // ── Question text — support multiple field names ──────────────────────
      const content: string = (
        q.questionText || q.question_text ||
        q.question || q.content || q.text || ''
      ).trim();

      // ── Correct answer — support multiple field names ─────────────────────
      const rawAnswer: string = (
        q.correctOption || q.correct_option ||
        q.correctAnswer || q.correct_answer ||
        q.answer || ''
      ).trim();

      const letterMatch = rawAnswer.match(/^([A-Ea-e])[.):\s]*/)?.[1]?.toUpperCase() ?? null;
      const numericIndex = /^\d+$/.test(rawAnswer) ? parseInt(rawAnswer, 10) - 1 : -1;

      // ── Options — support {label,text}, {label,content}, strings ─────────
      let correctLabelFound = false;
      const options = (q.options || []).map((opt: any, i: number) => {
        const text = typeof opt === 'string'
          ? opt
          : (opt.text || opt.content || opt.value || '').trim() || String(opt);
        const label = (typeof opt === 'object' && opt.label)
          ? String(opt.label).toUpperCase()
          : (fallbackLabels[i] || String.fromCharCode(65 + i));

        const isCorrect =
          (letterMatch !== null && label === letterMatch) ||
          (numericIndex >= 0 && i === numericIndex) ||
          text.trim().toLowerCase() === rawAnswer.toLowerCase();
        if (isCorrect) correctLabelFound = true;
        return { label, content: text, isCorrect };
      });

      if (!correctLabelFound) {
        this.logger.warn(
          `AI question answer not matched: raw="${rawAnswer}" q="${content.slice(0, 60)}"`,
        );
      }

      const explanation = (
        q.explanation ||
        q.solutionText ||
        q.solution_text ||
        q.solution ||
        q.rationale ||
        q.reasoning ||
        q.elaboration ||
        ''
      ).trim();

      return {
        content,
        options,
        explanation,
        integerAnswer: type === 'integer' ? (rawAnswer || null) : null,
      };
    });
  }

  /**
   * Parse a raw JEE-style question paper text (markdown or plain) into structured questions.
   * Handles formats like:
   *   Q.1 What is …?  /  **Q.1** …  /  Q.1. …
   *   A) option   B) option   C) option   D) option
   *   Ans. B  or  Answer: B
   *   Answer Key:  - Q.1 : B  - Q.2 : D …
   */
  private parseRawTextQuestions(rawText: string, type: string): any[] {
    // ── Step 1: Build answer key from "Answer Key" section ──────────────────
    const answerKey: Record<number, string> = {};
    const keyLinePattern = /[-•*]?\s*Q\.?\s*(\d+)\s*[:\-–]\s*([A-D])\b/gi;
    let m: RegExpExecArray | null;
    while ((m = keyLinePattern.exec(rawText)) !== null) {
      answerKey[parseInt(m[1])] = m[2].toUpperCase();
    }

    // ── Step 2: Isolate the question section (before any Answer Key block) ──
    const ansKeyIdx = rawText.search(/answer\s+key/i);
    const questionSection = ansKeyIdx > 0 ? rawText.slice(0, ansKeyIdx) : rawText;

    // ── Step 3: Locate question starts ──────────────────────────────────────
    const starts: { index: number; num: number }[] = [];

    // Pattern: Q.N or **Q.N** at start of line / after newline / after **Question:**
    const qRegex = /(?:^|\n)\s*(?:\*\*(?:Question:?\*\*\s*)?)?Q\.?\s*(\d+)\b/gm;
    while ((m = qRegex.exec(questionSection)) !== null) {
      starts.push({ index: m.index, num: parseInt(m[1]) });
    }
    starts.sort((a, b) => a.index - b.index);

    if (starts.length === 0) {
      this.logger.warn('[AI #13] parseRawTextQuestions: no Q.N patterns found in text');
      return [];
    }

    // ── Step 4: Parse each question block ───────────────────────────────────
    const results: any[] = [];

    for (let i = 0; i < starts.length; i++) {
      const blockStart = starts[i].index;
      const blockEnd = i + 1 < starts.length ? starts[i + 1].index : questionSection.length;
      const qNum = starts[i].num;
      const block = questionSection.slice(blockStart, blockEnd);

      // Find option positions inside the block
      const optStarts: { label: string; idx: number }[] = [];
      const optRegex = /(?:^|\n)\s*([A-D])\s*[\)\.]\s*/gm;
      while ((m = optRegex.exec(block)) !== null) {
        optStarts.push({ label: m[1].toUpperCase(), idx: m.index });
      }

      if (optStarts.length < 2) continue; // not a valid question block

      // Question text = everything before the first option, minus the Q.N header
      const rawQ = block
        .slice(0, optStarts[0].idx)
        .replace(/^[\s\S]*?(?:Q\.?\s*\d+\*?\*?[:\.\s]+|Question:?\s*Q\.?\s*\d+[:\.\s]*)/, '')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!rawQ) continue;

      // Extract option text (stop before next option; strip inline solutions)
      const options = optStarts.map((os, j) => {
        const optEnd = j + 1 < optStarts.length ? optStarts[j + 1].idx : block.length;
        let txt = block
          .slice(os.idx, optEnd)
          .replace(/^[\s\S]*?[A-D]\s*[\)\.]\s*/, '') // strip the "A) " prefix
          .replace(/\r?\n/g, ' ')
          .trim();

        // If the option text contains a multi-step solution (lots of "=" or newline math),
        // try to extract just the final numeric/unit answer
        if (/(?:=\s*[\d.]+.*?){2,}/.test(txt)) {
          const numMatch = txt.match(/=\s*([\d.,/]+\s*(?:m\/s²?|kg|N|J|W|rad|m|s|°)?)\s*(?:\s|$)/i);
          txt = numMatch ? numMatch[1].trim() : txt.split(/\s+/).slice(-1)[0];
        }

        return {
          label: os.label,
          content: txt.slice(0, 300), // guard against runaway text
          isCorrect: false,
        };
      });

      // Inline answer: "Ans. B" / "Answer: (C)" / "Ans (A)"
      const inlineAns =
        block.match(/(?:Ans(?:wer)?)\s*[.\s:]*\(?([A-D])\)?/i)?.[1]?.toUpperCase() ?? null;

      const correct = answerKey[qNum] || inlineAns;
      if (correct) {
        const opt = options.find((o) => o.label === correct);
        if (opt) opt.isCorrect = true;
      } else {
        this.logger.warn(`[AI #13] No answer found for Q.${qNum}`);
      }

      results.push({
        content: rawQ,
        options,
        explanation: '',
        integerAnswer: type === 'integer' ? (correct || null) : null,
      });
    }

    this.logger.log(`[AI #13] parseRawTextQuestions extracted ${results.length} questions from raw text`);
    return results;
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
    const raw = await this.post<any>('/quiz/generate', payload, tenantId);
    const questions = this.resolveToQuestionList(raw);
    const normalised = questions.length > 0
      ? this.normaliseStructuredQuestions(questions, 'mcq_single')
      : [];

    const checkpoints = normalised.map((q: any, i: number) => {
      const correctOption =
        q.options.find((o: any) => o.isCorrect)?.label ?? q.options[0]?.label ?? 'A';
      return {
        id: require('crypto').randomUUID(),
        questionText: q.content,
        options: q.options.map((o: any) => ({ label: o.label, text: o.content })),
        correctOption,
        triggerAtPercent: Math.round(((i + 1) / (normalised.length + 1)) * 100),
        segmentTitle: q.segmentTitle || `Segment ${i + 1}`,
        explanation: q.explanation || '',
      };
    });

    return { questions: checkpoints };
  }

  // ── AI #16 — Topic Content Generator (DPP, notes, PYQ, etc.) ─────────────
  async generateTopicContent(
    payload: {
      topicName: string;
      subjectName: string;
      chapterName: string;
      contentType: string;
      difficulty: string;
      length: string;
      extraContext?: string;
    },
    tenantId?: string,
  ): Promise<{ content: string; contentType: string; topicName: string }> {
    return this.post('/content/generate', payload, tenantId, 120_000);
  }
}
