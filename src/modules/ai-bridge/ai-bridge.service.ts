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
      questionImageUrl?: string;
      topicId?: string;
      mode: 'short' | 'detailed';
      studentContext?: any;
    },
    tenantId?: string,
  ) {
    return this.post('/doubt/resolve', {
      ...payload,
      questionText: this.withMathDerivationStyleHint(payload.questionText),
    }, tenantId);
  }

  async extractImageText(
    payload: { imageUrl: string },
    tenantId?: string,
  ): Promise<{ text: string }> {
    return this.post('/doubt/ocr-image', payload, tenantId, 120_000);
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
    return this.post('/tutor/continue', {
      ...payload,
      studentMessage: this.withMathDerivationStyleHint(payload.studentMessage),
    }, tenantId);
  }

  private withMathDerivationStyleHint(text: string): string {
    const base = String(text || '').trim();
    if (!base) return base;
    const hint =
      'Formatting preference: For mathematical/derivation questions, respond in equation-first style with minimal prose, clear symbolic steps, and a final result line.';
    if (base.includes(hint)) return base;
    return `${base}\n\n${hint}`;
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
      language: 'en' | 'hi' | 'hinglish' | 'hi-in';
    },
    tenantId?: string,
  ) {
    return this.post('/stt/notes', payload, tenantId, 900_000); // 15 min — Whisper (multi-chunk) + LLM
  }

  // ── AI #7b — Notes from pre-existing Transcript (YouTube / manual) ────────
  /**
   * Skips Whisper entirely.  Sends a plain-text transcript to the Django AI
   * backend which feeds it directly into the LLM summarisation step.
   */
  async generateNotesFromTranscript(
    payload: {
      transcript: string;
      topicId: string;
      language: 'en' | 'hi' | 'hinglish' | 'hi-in';
    },
    tenantId?: string,
  ) {
    return this.post('/stt/notes-from-text', payload, tenantId, 900_000);
  }

  // ── AI #7c — YouTube video ID → captions fetched server-side → notes ────────
  /**
   * Production-safe YouTube notes pipeline.  Sends just the videoId to Django
   * which fetches captions using the Python youtube-transcript-api library
   * (more reliable on VPS/cloud IPs than the npm youtube-transcript package).
   *
   * Django endpoint: POST /stt/notes-from-youtube
   * Expected body:   { videoId, topicId, language }
   * Expected shape:  same as /stt/notes → { notes, rawTranscript, ... }
   */
  async generateNotesFromYouTube(
    payload: {
      videoId: string;
      topicId: string;
      language: 'en' | 'hi' | 'hinglish' | 'hi-in';
    },
    tenantId?: string,
  ) {
    return this.post('/stt/notes-from-youtube', payload, tenantId, 900_000);
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

  async generateSyllabus(
    payload: {
      examTarget: string;
      examYear: string;
      subjects: string[];
    },
    tenantId?: string,
  ) {
    return this.post('/syllabus/generate', payload, tenantId);
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

    // 2. Object with a questions array (handle common envelopes)
    const questionsArray = 
      Array.isArray(raw?.questions) ? raw.questions :
      Array.isArray(raw?.data?.questions) ? raw.data.questions :
      Array.isArray(raw?.data) ? raw.data :
      null;

    if (questionsArray && questionsArray.length > 0) {
      const first = questionsArray[0];
      // Degenerate: the AI crammed the whole JSON response into the first "question" field
      const possibleJson: string = (
        typeof first === 'string' ? first :
        (first?.question || first?.questionText || first?.content || first?.text || '')
      );
      if (typeof possibleJson === 'string' && possibleJson.includes('`')) {
        const parsed = this.stripMarkdownAndParse(possibleJson);
        if (parsed) {
          if (Array.isArray(parsed?.questions)) return parsed.questions;
          if (Array.isArray(parsed)) return parsed;
        }
      }
      return questionsArray;
    }

    // 3. String — may be plain JSON or have conversational preamble
    if (typeof raw === 'string') {
      const t = raw.trim();
      
      // Try parsing the whole thing first
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed?.questions)) return parsed.questions;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not a direct JSON string, try to find JSON block using regex
        const jsonBlockMatch = t.match(/\[\s*{[\s\S]*}\]/); // Slightly more restrictive to find actual arrays
        if (jsonBlockMatch) {
          try {
            const parsed = JSON.parse(jsonBlockMatch[0]);
            return parsed;
          } catch { /* skip */ }
        }

        const jsonObjectMatch = t.match(/{\s*"(?:questions|data)"\s*:\s*\[[\s\S]*?\]\s*}/);
        if (jsonObjectMatch) {
          try {
            const parsed = JSON.parse(jsonObjectMatch[0]);
            if (Array.isArray(parsed.questions)) return parsed.questions;
            if (Array.isArray(parsed.data)) return parsed.data;
          } catch { /* skip */ }
        }

        // Try markdown fence extractor
        const fenced = this.stripMarkdownAndParse(t);
        if (fenced) {
          if (Array.isArray(fenced?.questions)) return fenced.questions;
          if (Array.isArray(fenced)) return fenced;
        }
      }
    }

    this.logger.debug(`[AiBridge] resolveToQuestionList failed to find questions in: ${typeof raw === 'string' ? raw.slice(0, 100) : JSON.stringify(raw).slice(0, 100)}`);
    return [];
  }

  private djangoQuestionTypes(requestType: string): string[] {
    // FastAPI /test/generate/ only accepts: mcq, true_false, short_answer, long_answer, fill_blank, mix
    if (requestType === 'mcq_single' || requestType === 'mcq_multi' || requestType === 'integer') {
      return ['mcq'];
    }
    if (requestType === 'descriptive' || requestType === 'long_answer' || requestType === 'subjective') {
      return ['long_answer'];
    }
    if (requestType === 'short_descriptive' || requestType === 'short_answer') {
      return ['short_answer'];
    }
    if (requestType === 'mix' || requestType === 'board_mix' || requestType === 'cbse_paper') {
      return ['mix'];
    }
    if (['mcq', 'true_false', 'short_answer', 'long_answer', 'fill_blank', 'mix'].includes(requestType)) {
      return [requestType];
    }
    return ['mcq'];
  }

  private topicSuffixForQuestionType(t: string): string {
    if (t === 'integer') {
      return (
        ' Each item must be a single-numerical-answer (integer 0–999) competitive-exam style. ' +
        'Output exactly four options; only one is correct; the options should be the candidate answers.'
      );
    }
    if (t === 'mcq_multi') {
      return (
        ' Each item is multiple-correct: two or more options can be true. ' +
        'In JSON, list every correct option label in a field "correctOptions" (e.g. ["A","C"]) in addition to options with isCorrect flags.'
      );
    }
    if (t === 'descriptive' || t === 'long_answer' || t === 'subjective') {
      return (
        ' Output short- or long-answer (constructed response) only — no A/B/C/D options. ' +
        'Include a model answer in the "answer" field using CBSE markwise structure: ' +
        '2m => definition + one point/example, ' +
        '3m => definition/principle + two explanation points, ' +
        '4m => statement/formula + 2-3 explanation steps + support (diagram/example/conclusion), ' +
        '5m => intro/definition + 3 core points + one support element.'
      );
    }
    if (t === 'short_descriptive' || t === 'short_answer') {
      return (
        ' Keep answers concise (2–4 sentences) for short constructed response; include a model answer in the "answer" field. ' +
        'For 2-mark style answers, keep exactly two clear components (definition/statement + second point/example).'
      );
    }
    return '';
  }

  // ── AI #13 — Quiz Question Generator from Topic ───────────────────────────
  async generateQuestionsFromTopic(
    dto: {
      topicId: string;
      topicName: string;
      count: number;
      difficulty: string;
      type: string;
    },
    tenantId?: string,
  ) {
    const questionTypes = this.djangoQuestionTypes(dto.type);
    const topic =
      `${dto.topicName} (Respond in English only)${this.topicSuffixForQuestionType(dto.type)}`.trim();
    const raw = await this.post<any>('/test/generate/', {
      topic,
      num_questions: dto.count,
      difficulty: dto.difficulty,
      question_types: questionTypes,
    }, tenantId);

    const questions = this.resolveToQuestionList(raw);

    if (questions.length > 0) {
      return this.normaliseStructuredQuestions(questions, dto.type);
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
      return this.parseRawTextQuestions(rawText, dto.type);
    }

    this.logger.warn('[AI #13] No questions in AI response');
    return [];
  }

  /** Transform any known AI question array shape into the frontend shape. */
  private normaliseStructuredQuestions(questions: any[], type: string) {
    const fallbackLabels = ['A', 'B', 'C', 'D', 'E'];
    const looksLikeOptionKey = (v: string) =>
      /^[A-E]$/i.test(v.trim()) || /^\(?[A-E]\)?[).:]?$/i.test(v.trim());
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

      // ── Multi-correct (MSQ) — from LLM or comma-separated key ─────────────
      const multiFromRaw: string[] = (() => {
        const a = (q as any).correctOptions ?? (q as any).correct_options;
        if (Array.isArray(a) && a.length) {
          return a.map((s: any) => String(s).toUpperCase().replace(/[^A-E]/g, '')).filter(Boolean);
        }
        if (type === 'mcq_multi' && rawAnswer) {
          return rawAnswer
            .split(/[,;/|]|\s+and\s+|\s+&\s+/i)
            .map((s) => s.trim().toUpperCase().match(/^([A-E])\b/)?.[1] ?? '')
            .filter(Boolean);
        }
        return [];
      })();

      // ── Options — support {label,text}, {label,content}, strings ─────────
      let correctLabelFound = false;
      const options = (q.options || []).map((opt: any, i: number) => {
        const text = typeof opt === 'string'
          ? opt
          : (opt.text || opt.content || opt.value || '').trim() || String(opt);
        const label = (typeof opt === 'object' && opt.label)
          ? String(opt.label).toUpperCase()
          : (fallbackLabels[i] || String.fromCharCode(65 + i));

        let isCorrect =
          (letterMatch !== null && label === letterMatch) ||
          (numericIndex >= 0 && i === numericIndex) ||
          text.trim().toLowerCase() === rawAnswer.toLowerCase();
        if (multiFromRaw.length) {
          isCorrect = multiFromRaw.includes(label);
        }
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

      const isSubjective = ['descriptive', 'long_answer', 'subjective', 'short_descriptive', 'short_answer'].includes(
        type,
      );
      if (isSubjective) {
        const modelFromFields = String((q as any).modelAnswer ?? (q as any).rubric ?? (q as any).answer ?? '').trim();
        const model = [modelFromFields, rawAnswer]
          .find((m) => m && !looksLikeOptionKey(m)) || '';
        return {
          content,
          options: [],
          explanation: [explanation, model && `Model answer: ${model}`].filter(Boolean).join('\n\n').trim(),
          integerAnswer: null,
        };
      }

      let intAns: string | null = type === 'integer' ? (rawAnswer || null) : null;
      if (type === 'integer' && intAns) {
        const m = intAns.toUpperCase().match(/^([A-E])\b/);
        if (m) {
          const opt = options.find((o) => o.label === m[1]);
          if (opt?.content && /^-?\d+$/.test(String(opt.content).trim())) {
            intAns = String(opt.content).trim();
          }
        } else if (!/^-?\d+$/.test(intAns) && intAns) {
          const onlyDigits = intAns.replace(/[^0-9-]/g, '');
          if (/^-?\d+$/.test(onlyDigits)) intAns = onlyDigits;
        }
      }
      if (type === 'integer' && !intAns) {
        const c = options.find((o) => o.isCorrect);
        if (c && /^-?\d+$/.test(String(c.content).trim())) {
          intAns = String(c.content).trim();
        }
      }
      if (type === 'integer' && intAns) {
        return {
          content,
          options: [],
          explanation,
          integerAnswer: intAns,
        };
      }

      return {
        content,
        options,
        explanation,
        integerAnswer: null,
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
    dto: {
      transcript: string;
      lectureTitle: string;
      topicId?: string;
    },
    tenantId?: string,
  ) {
    const payload = {
      ...dto,
      // Enforce English instructions for the LLM
      lectureTitle: `${dto.lectureTitle} (Generate questions and explanation in English only)`,
    };
    const raw = await this.post<any>('/quiz/generate', payload, tenantId);
    this.logger.log(`[AI #14] Received raw response from Django: ${JSON.stringify(raw)}`);
    const questions = this.resolveToQuestionList(raw);
    let normalised = questions.length > 0
      ? this.normaliseStructuredQuestions(questions, 'mcq_single')
      : [];

    // Fallback: raw text parser
    if (normalised.length === 0) {
      const rawText: string =
        typeof raw === 'string' ? raw :
        typeof raw?.text === 'string' ? raw.text :
        typeof raw?.content === 'string' ? raw.content :
        '';
      if (rawText.trim()) {
        this.logger.warn(`[AI #14] Falling back to raw text parser for quiz generation`);
        normalised = this.parseRawTextQuestions(rawText, 'mcq_single');
      }
    }

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
    dto: {
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
    const payload = {
      ...dto,
      extraContext: `${dto.extraContext || ''} (Generate all content in English only)`.trim(),
    };
    return this.post('/content/generate', payload, tenantId, 120_000);
  }
}
