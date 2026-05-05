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

  /**
   * @param purpose `grading` = transcribe the student's answer only (no "the image shows…");
   *                `doubt` = richer extraction for doubt flows (default).
   */
  async extractImageText(
    payload: { imageUrl: string; purpose?: 'doubt' | 'grading' },
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

  // ── AI #7a — Transcribe-only (Phase 1 of two-phase pipeline) ─────────────
  /**
   * Whisper transcription only — no LLM note generation.
   * Returns { rawTranscript, transcript } in ~2-5 minutes for an 80-min video.
   * Call generateNotesFromTranscript() afterwards for notes (Phase 2).
   */
  async transcribeAudio(
    payload: {
      audioUrl: string;
      language: 'en' | 'hi' | 'hinglish' | 'hi-in';
      topicId?: string;
    },
    tenantId?: string,
  ) {
    return this.post('/stt/transcribe', payload, tenantId, 600_000); // 10 min — Whisper only
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
    if (requestType === 'mcq_single' || requestType === 'mcq') return ['mcq'];
    if (requestType === 'mcq_multi') return ['mcq_multi'];
    if (requestType === 'integer') return ['integer'];
    if (requestType === 'match_the_following') return ['match_the_following'];
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
      /** Lane-specific format hint: assertion_reason, statement, match, diagram, case_study, short_answer, detailed_answer */
      style?: string;
      /** "jee main" | "jee advanced" | "neet" | "cbse" — activates exam-specific difficulty heuristic in Django */
      examTarget?: string;
      notes?: string | string[];
      subject?: string;   // activates subject-specific prompt rules in Django
      chapter?: string;   // adds curriculum breadcrumb & scope constraint
      /** For subject tests: exact chapter names from the DB — AI must ONLY generate from these */
      chapters?: string[];
    },
    tenantId?: string,
  ) {
    const raw = await this.post<any>('/test/generate/', {
      topic: dto.topicName,
      num_questions: dto.count,
      difficulty: dto.difficulty,
      type: dto.type,
      style: dto.style,                 // forwards lane-specific format prompt
      exam_target: dto.examTarget,      // activates JEE Main / JEE Advanced / NEET difficulty formula
      question_types: [this.djangoQuestionTypes(dto.type)[0]],
      notes: Array.isArray(dto.notes) ? dto.notes.join('\n').slice(0, 4000) : (dto.notes as string)?.slice(0, 4000),
      subject: dto.subject,             // enables _SUBJECT_RULES_TEST + scope_constraint in Django
      chapter: dto.chapter,
      chapters: dto.chapters,           // subject-test: exact DB chapters to generate from
      seed: (dto as any).seed,          // force LLM variety
    }, tenantId);

    const questions = this.resolveToQuestionList(raw);

    if (questions.length > 0) {
      const normalised = this.normaliseStructuredQuestions(questions, dto.type);
      const processed = this.postProcessGeneratedQuestions(normalised, dto.type);
      return this.filterByScope(processed, dto.subject, dto.chapter);
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
      const parsed = this.parseRawTextQuestions(rawText, dto.type);
      return this.postProcessGeneratedQuestions(parsed, dto.type);
    }

    this.logger.warn('[AI #13] No questions in AI response');
    return [];
  }

  // ── AI #13b — Generate questions STRICTLY from in-video lecture notes ────────
  /**
   * Dedicated call that uses the lecture notes content as the PRIMARY source for
   * question generation. Unlike generateQuestionsFromTopic (which uses notes as
   * supplementary context), every generated question here must be directly
   * answerable from the provided notes.
   */
  async generateQuestionsFromLectureNotes(
    dto: {
      topicName: string;
      notes: string[];
      count: number;
      difficulty: string;
      examTarget?: string;
      subject?: string;
      chapter?: string;
    },
    tenantId?: string,
  ) {
    if (!dto.notes?.length) return [];

    // Combine notes into a single rich content block (cap at 6 000 chars to stay within context)
    const combinedNotes = dto.notes.join('\n\n---\n\n').slice(0, 6000);

    // Embed an explicit instruction in the topic field so the AI treats notes as the only source
    const noteFocusedTopic =
      `[LECTURE NOTES QUIZ — ${dto.topicName}] ` +
      `Generate every question STRICTLY from the lecture notes provided below. ` +
      `Each question must be directly answerable using only the information in these notes. ` +
      `Do NOT use general textbook knowledge not present in the notes.\n\nNOTES:\n${combinedNotes}`;

    const raw = await this.post<any>('/test/generate/', {
      topic: noteFocusedTopic,
      num_questions: dto.count,
      difficulty: dto.difficulty,
      type: 'mcq_single',
      question_types: [this.djangoQuestionTypes('mcq_single')[0]],
      generate_from_notes: true,
      exam_target: dto.examTarget,
      subject: dto.subject,
      chapter: dto.chapter,
      seed: (dto as any).seed,
    }, tenantId);

    const questions = this.resolveToQuestionList(raw);
    if (questions.length > 0) {
      const normalised = this.normaliseStructuredQuestions(questions, 'mcq_single');
      return this.postProcessGeneratedQuestions(normalised, 'mcq_single');
    }

    const rawText: string =
      typeof raw === 'string' ? raw :
      typeof raw?.text === 'string' ? raw.text :
      typeof raw?.content === 'string' ? raw.content :
      typeof raw?.result === 'string' ? raw.result : '';

    if (rawText.trim()) {
      const parsed = this.parseRawTextQuestions(rawText, 'mcq_single');
      return this.postProcessGeneratedQuestions(parsed, 'mcq_single');
    }

    this.logger.warn('[AI #13b] No questions generated from lecture notes');
    return [];
  }

  /**
   * Reject AI-generated questions whose content drifts away from the requested chapter.
   * Uses chapter-specific keyword sets — if a question doesn't contain ANY chapter keyword
   * AND the AI's `scope_check` doesn't include the chapter name, the question is dropped.
   */
  private filterByScope(questions: any[], subject?: string, chapter?: string): any[] {
    if (!chapter || !chapter.trim()) return questions;
    const chapKw = chapter.toLowerCase().trim();
    const chapTokens = chapKw.split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    // Anti-keywords: words that strongly indicate the wrong chapter
    const antiKeywords = this.getOffScopeKeywords(subject, chapter);
    const validKeywords = this.getInScopeKeywords(subject, chapter);

    const accepted: any[] = [];
    let rejected = 0;
    for (const q of questions) {
      const text = `${q.content || ''} ${q.explanation || ''} ${q.solutionText || ''}`.toLowerCase();
      const sc = (q.scope_check || '').toString().toLowerCase();

      // 1) AI confirmed the chapter via scope_check → soft signal (cannot override content evidence)
      const scopeConfirmed = sc && (
        sc.includes(chapKw) ||
        chapTokens.some(t => sc.includes(t)) ||
        chapKw.includes(sc.slice(0, 8))
      );

      // 2) Content contains a chapter-specific keyword → in scope
      const contentMentionsScope = validKeywords.length === 0
        ? true   // no keyword set = unknown chapter, accept
        : validKeywords.some(kw => text.includes(kw));

      // 3) Content contains an off-scope keyword from a different chapter → hard reject
      //    This OVERRIDES scope_check — the AI may echo the right chapter but generate wrong content.
      const contentLooksOffScope = antiKeywords.length > 0 && antiKeywords.some(kw => text.includes(kw));

      // Accept only when content is clean: scope confirmed OR has in-scope keywords; AND no off-scope content
      if (!contentLooksOffScope && (scopeConfirmed || contentMentionsScope)) {
        accepted.push(q);
      } else {
        rejected++;
        this.logger.warn(
          `[scope-drift] Dropped question (chapter="${chapter}", scope_check="${q.scope_check ?? '—'}"): "${(q.content || '').slice(0, 80)}"`,
        );
      }
    }
    if (rejected > 0) {
      this.logger.log(`[scope-filter] kept ${accepted.length}, rejected ${rejected} off-scope questions for chapter "${chapter}"`);
    }
    return accepted.length > 0 ? accepted : questions;  // fall back to all if filter would empty the list
  }

  /** In-scope keywords for a given chapter — at least ONE must appear in the question text. */
  private getInScopeKeywords(subject: string | undefined, chapter: string): string[] {
    const sub = (subject || '').toLowerCase();
    const ch = chapter.toLowerCase();
    const k = (...words: string[]) => words;

    if (sub.includes('chem')) {
      if (/\b(solution|colligative|raoult|henry|molarity|molality|osmotic)\b/.test(ch)) return k('solution', 'raoult', 'henry', 'molarity', 'molality', 'colligative', 'osmotic', 'vapour pressure', 'vapor pressure', 'boiling point', 'freezing point', 'van\'t hoff', 'van t hoff', 'mole fraction', 'azeotrope', 'solute', 'solvent', 'dilute', 'concentration');
      if (/\b(solid state|crystal|lattice|unit cell)\b/.test(ch)) return k('crystal', 'lattice', 'unit cell', 'bcc', 'fcc', 'hcp', 'packing', 'schottky', 'frenkel', 'ionic solid', 'covalent solid', 'amorphous', 'crystalline');
      if (/\b(thermodynamic|enthalpy|entropy|gibbs)\b/.test(ch)) return k('enthalpy', 'entropy', 'gibbs', 'free energy', 'spontane', 'first law', 'second law', 'hess', 'bond enthalpy', 'standard heat', 'calorimet', 'isothermal', 'adiabatic', 'system and surrounding');
      if (/\b(equilibrium|le chatelier|kp|kc|ka|kb|buffer|ph |acid base|ksp)\b/.test(ch)) return k('equilibrium', 'le chatelier', 'kp', 'kc', 'ka', 'kb', 'kw', 'buffer', ' ph', 'acid', 'base', 'conjugate', 'henderson', 'common ion', 'ksp', 'solubility product');
      if (/\b(electrochem|galvanic|electrolyt|nernst|emf)\b/.test(ch)) return k('electrochem', 'galvanic', 'electrolytic', 'electrolysis', 'nernst', 'emf', 'electrode', 'cathode', 'anode', 'cell potential', 'kohlrausch', 'conductivity', 'fuel cell', 'corrosion', 'faraday');
      if (/\b(kinetic|rate|order of reaction|arrhenius|half life)\b/.test(ch)) return k('rate of reaction', 'order of reaction', 'molecularity', 'arrhenius', 'activation energy', 'half life', 'half-life', 'pseudo first', 'integrated rate', 'rate constant', 'rate law');
      if (/\b(surface chem|adsorption|colloid|catalyst)\b/.test(ch)) return k('adsorption', 'absorption', 'freundlich', 'colloid', 'emulsion', 'micelle', 'tyndall', 'brownian', 'catalyst', 'enzyme catalysis', 'sol ', 'gel ', 'aerosol');
      if (/\b(atomic structure|bohr|quantum|orbital|de broglie)\b/.test(ch)) return k('bohr', 'quantum number', 'orbital', 'electronic configuration', 'de broglie', 'heisenberg', 'aufbau', 'pauli', 'hund', 'spectral series', 'schrodinger', 'azimuthal', 'principal quantum');
      if (/\b(mole concept|stoichiom|equivalent|empirical|molecular formula)\b/.test(ch)) return k('mole', 'avogadro', 'stoichiometr', 'empirical formula', 'molecular formula', 'limiting reagent', 'percentage composition', 'equivalent weight');
      if (/\b(gas|states of matter|ideal gas|van der waals)\b/.test(ch)) return k('gas', 'ideal gas', 'real gas', 'boyle', 'charles', 'avogadro', 'van der waals', 'compressibility', 'kinetic theory', 'rms', 'mean free path', 'pressure of gas');
      if (/\b(redox|oxidation number|balancing)\b/.test(ch)) return k('redox', 'oxidation', 'reduction', 'oxidation number', 'oxidation state', 'oxidising agent', 'reducing agent', 'half reaction', 'ion electron');
      if (/\b(periodic|periodicity|ionization|electronegativity)\b/.test(ch)) return k('periodic', 'periodicity', 'ionization energy', 'ionisation energy', 'electron affinity', 'electronegativity', 'atomic radius', 'ionic radius', 'mendeleev', 'modern periodic');
      if (/\b(bonding|vsepr|hybrid|molecular orbital|valence bond)\b/.test(ch)) return k('bond', 'vsepr', 'hybridi', 'sp3', 'sp2', 'sigma', 'pi bond', 'molecular orbital', 'mo theory', 'lewis', 'octet', 'electronegativity', 'bond order', 'resonance');
      if (/\bhydrogen\b/.test(ch) || /heavy water|hydride/.test(ch)) return k('hydrogen', 'isotope', 'hydride', 'heavy water', 'hydrogen peroxide', 'h2o2', 'hard water', 'soft water', 'ortho', 'para hydrogen');
      if (/\b(s-block|s block|alkali metal|alkaline earth)\b/.test(ch)) return k('alkali', 'alkaline earth', 'sodium', 'potassium', 'lithium', 'magnesium', 'calcium', 'cesium', 'rubidium', 'group 1', 'group 2', 's-block', 's block', 'plaster of paris', 'naoh', 'na2co3');
      if (/\b(p-block|p block|halogen|noble gas|carbon family|nitrogen family|group 1[3-8])\b/.test(ch)) return k('p-block', 'p block', 'boron', 'aluminium', 'carbon', 'silicon', 'nitrogen', 'phosphorus', 'oxygen', 'sulphur', 'sulfur', 'chlorine', 'bromine', 'iodine', 'noble gas', 'group 13', 'group 14', 'group 15', 'group 16', 'group 17', 'group 18', 'halogen', 'interhalogen');
      if (/\b(d-block|d block|f-block|transition|lanthan|actin)\b/.test(ch)) return k('transition metal', 'd-block', 'd block', 'lanthan', 'actin', 'kmno4', 'k2cr2o7', 'oxidation state', 'colour of complex', 'magnetic moment', 'unpaired electron');
      if (/\b(coordination|complex compound|ligand|werner|cfse)\b/.test(ch)) return k('coordination', 'complex', 'ligand', 'werner', 'cfse', 'crystal field', 'octahedral', 'tetrahedral', 'square planar', 'chelate', 'spectrochemical', 'high spin', 'low spin');
      if (/\b(metallurg|extraction|ore|isolation of element)\b/.test(ch)) return k('metallurgy', 'extraction', 'ore', 'mineral', 'froth flotation', 'roasting', 'calcination', 'smelting', 'ellingham', 'electrolytic refining', 'iron', 'copper', 'aluminium', 'zinc');
      if (/\b(salt analysis|qualitative)\b/.test(ch)) return k('salt analysis', 'qualitative', 'cation', 'anion', 'group reagent', 'precipitate', 'confirmatory test');
      if (/\b(environmental|pollution|smog|ozone|acid rain|greenhouse)\b/.test(ch)) return k('pollution', 'pollutant', 'smog', 'ozone', 'acid rain', 'greenhouse', 'global warming', 'bod', 'cod', 'green chemistry');
      if (/\b(goc|general organic|hyperconjugation|inductive|mesomeric|carbocation)\b/.test(ch)) return k('inductive', 'mesomeric', 'electromeric', 'hyperconjugation', 'resonance', 'carbocation', 'carbanion', 'free radical', 'electrophile', 'nucleophile', 'sn1', 'sn2', 'e1', 'e2');
      if (/\b(iupac|nomenclature|isomer)\b/.test(ch)) return k('iupac', 'nomenclature', 'isomer', 'stereoisomer', 'enantiomer', 'r/s', 'e/z', 'chirality', 'optical activity', 'racemic', 'meso');
      if (/\b(hydrocarbon|alkane|alkene|alkyne|aromatic|benzene)\b/.test(ch)) return k('alkane', 'alkene', 'alkyne', 'benzene', 'aromatic', 'wurtz', 'kolbe', 'markovnikov', 'friedel', 'crafts', 'addition', 'electrophilic substitution', 'hydrocarbon');
      if (/\b(haloalkane|haloarene|alkyl halide|aryl halide|sn1|sn2)\b/.test(ch)) return k('haloalkane', 'haloarene', 'alkyl halide', 'aryl halide', 'sn1', 'sn2', 'e1', 'e2', 'walden inversion', 'grignard', 'chloroform', 'ccl4', 'freon');
      if (/\b(alcohol|phenol|ether|williamson)\b/.test(ch)) return k('alcohol', 'phenol', 'ether', 'williamson', 'kolbe', 'reimer', 'tiemann', 'lucas', 'iodoform', '-oh', 'esterification');
      if (/\b(aldehyde|ketone|carboxylic|cannizzaro|aldol|perkin)\b/.test(ch)) return k('aldehyde', 'ketone', 'carboxylic', 'cannizzaro', 'aldol', 'perkin', 'claisen', 'tollens', 'fehling', 'rosenmund', 'stephen', 'etard', 'esterification', 'decarboxylation');
      if (/\b(amine|diazonium|aniline|hofmann|gabriel)\b/.test(ch)) return k('amine', 'aniline', 'diazonium', 'hofmann', 'gabriel', 'sandmeyer', 'gattermann', 'azo coupling', 'carbylamine', 'primary amine', 'secondary amine', 'tertiary amine');
      if (/\b(biomolecule|carbohydrate|protein|amino acid|lipid|nucleic|enzyme)\b/.test(ch)) return k('biomolecule', 'carbohydrate', 'monosaccharide', 'disaccharide', 'polysaccharide', 'glucose', 'fructose', 'sucrose', 'starch', 'cellulose', 'protein', 'amino acid', 'peptide', 'enzyme', 'vitamin', 'dna', 'rna', 'nucleic acid', 'lipid', 'fat ');
      if (/\b(polymer|polymerization|monomer)\b/.test(ch)) return k('polymer', 'monomer', 'polymerization', 'polymerisation', 'polythene', 'pvc', 'teflon', 'bakelite', 'nylon', 'rubber', 'addition polymer', 'condensation polymer', 'thermoplast', 'thermoset');
      if (/\b(everyday life|drug|antibiotic|analgesic|antiseptic|soap|detergent)\b/.test(ch)) return k('drug', 'medicine', 'analgesic', 'antibiotic', 'antiseptic', 'antacid', 'antihistamine', 'soap', 'detergent', 'saponification', 'preservative', 'sweetener');
    }

    if (sub.includes('physics')) {
      if (/\b(unit|measurement|dimensional|significant)\b/.test(ch)) return k('unit', 'dimensional', 'significant figure', 'error', 'precision', 'accuracy', 'si unit');
      if (/\b(kinematic|motion in|projectile|relative velocity)\b/.test(ch)) return k('velocity', 'acceleration', 'displacement', 'projectile', 'relative motion', 'equation of motion', 'kinematic', 'circular motion', 'uniform motion');
      if (/\b(newton|law of motion|friction|free body)\b/.test(ch)) return k('newton', 'force', 'friction', 'free body', 'tension', 'normal force', 'pseudo force', 'banking', 'inertia', 'momentum');
      if (/\b(work|energy|power|collision)\b/.test(ch)) return k('work done', 'kinetic energy', 'potential energy', 'conservation of energy', 'collision', 'spring', 'power', 'work-energy theorem');
      if (/\b(rotation|rotational|torque|angular momentum|moment of inertia)\b/.test(ch)) return k('torque', 'angular momentum', 'moment of inertia', 'centre of mass', 'rotational kinetic', 'rolling', 'angular velocity', 'angular acceleration', 'parallel axis', 'perpendicular axis');
      if (/\b(gravitation|gravity|kepler|satellite)\b/.test(ch)) return k('gravitation', 'gravitational', 'kepler', 'satellite', 'orbit', 'escape velocity', 'orbital velocity', 'geostationary', 'gravitational potential');
      if (/\b(elastic|stress|strain|modulus)\b/.test(ch)) return k('stress', 'strain', 'young modulus', 'bulk modulus', 'shear modulus', 'elasticity', 'hooke', 'poisson');
      if (/\b(fluid|pressure|bernoulli|viscosity|surface tension)\b/.test(ch)) return k('fluid', 'pressure', 'bernoulli', 'pascal', 'archimedes', 'viscosity', 'stokes', 'surface tension', 'capillary', 'reynolds', 'flow');
      if (/\b(thermal|temperature|heat transfer|calorimetry|specific heat)\b/.test(ch)) return k('heat', 'temperature', 'thermal', 'calorimet', 'specific heat', 'latent heat', 'conduction', 'convection', 'radiation', 'stefan', 'wien', 'thermal expansion');
      if (/\b(thermodynamic|first law|second law|carnot|isothermal|adiabatic)\b/.test(ch)) return k('thermodynamic', 'first law', 'second law', 'carnot', 'isothermal', 'adiabatic', 'isobaric', 'isochoric', 'entropy', 'efficiency', 'engine', 'refrigerator');
      if (/\b(kinetic theory|rms speed|mean free path|degree of freedom)\b/.test(ch)) return k('kinetic theory', 'rms speed', 'mean free path', 'degree of freedom', 'maxwell distribution', 'equipartition', 'molar specific heat');
      if (/\b(oscillat|shm|simple harmonic|pendulum|spring oscill|damped|resonance)\b/.test(ch)) return k('shm', 'simple harmonic', 'oscillation', 'pendulum', 'spring', 'damped', 'forced oscillation', 'resonance', 'angular frequency', 'time period');
      if (/\b(wave motion|wave on string|sound|doppler|stationary wave|beats)\b/.test(ch)) return k('wave', 'transverse', 'longitudinal', 'sound', 'doppler', 'stationary wave', 'beat', 'organ pipe', 'resonance', 'superposition', 'frequency', 'wavelength');
      if (/\b(electrostatic|electric field|electric potential|gauss|capacitor|coulomb)\b/.test(ch)) return k('electric field', 'electric potential', 'coulomb', 'gauss', 'capacitor', 'capacitance', 'dielectric', 'electric flux', 'dipole', 'point charge');
      if (/\b(current electric|resistance|kirchhoff|ohm|wheatstone|potentiometer)\b/.test(ch)) return k('current', 'resistance', 'resistivity', 'ohm', 'kirchhoff', 'wheatstone', 'potentiometer', 'galvanometer', 'ammeter', 'voltmeter', 'emf', 'drift velocity', 'cell ');
      if (/\b(magnetic effect|biot-savart|ampere|lorentz|cyclotron|solenoid)\b/.test(ch)) return k('magnetic field', 'biot-savart', 'biot savart', 'ampere', 'lorentz', 'magnetic force', 'cyclotron', 'solenoid', 'toroid', 'magnetic dipole', 'moving charge');
      if (/\b(magnetism and matter|diamagnet|paramagnet|ferromagnet|hysteresis)\b/.test(ch)) return k('diamagnet', 'paramagnet', 'ferromagnet', 'hysteresis', 'magnetic susceptibility', 'magnetization', 'magnetic moment', 'earth magnetism', 'bar magnet');
      if (/\b(electromagnetic induction|faraday|lenz|self induct|mutual induct|eddy)\b/.test(ch)) return k('faraday', 'lenz', 'induced emf', 'self induction', 'mutual induction', 'inductance', 'eddy current', 'flux change', 'motional emf');
      if (/\b(alternating current|ac circuit|lcr|impedance|reactance|transformer)\b/.test(ch)) return k('alternating current', 'ac ', 'lcr', 'impedance', 'reactance', 'transformer', 'rms value', 'peak value', 'phase difference', 'wattless', 'power factor');
      if (/\b(electromagnetic wave|em wave|displacement current|maxwell|spectrum)\b/.test(ch)) return k('electromagnetic wave', 'em wave', 'displacement current', 'maxwell', 'em spectrum', 'radio wave', 'microwave', 'infrared', 'ultraviolet', 'x-ray', 'gamma ray');
      if (/\b(ray optic|reflection|refraction|lens|mirror|prism|optical instrument)\b/.test(ch)) return k('reflection', 'refraction', 'mirror', 'lens', 'prism', 'total internal', 'snell', 'critical angle', 'focal length', 'magnification', 'telescope', 'microscope', 'eye ');
      if (/\b(wave optic|interference|diffraction|polari[sz]ation|young double|huygens)\b/.test(ch)) return k('interference', 'diffraction', 'polari', 'young double slit', 'ydse', 'huygens', 'fringe', 'brewster', 'malus', 'coherent');
      if (/\b(dual nature|photoelectric|matter wave|de broglie|davisson)\b/.test(ch)) return k('photoelectric', 'work function', 'threshold', 'photon', 'einstein', 'de broglie', 'matter wave', 'davisson', 'germer', 'planck constant');
      if (/\b(\batom\b|bohr model|spectral line|hydrogen spectrum|rutherford)\b/.test(ch)) return k('bohr', 'rutherford', 'spectral series', 'lyman', 'balmer', 'paschen', 'brackett', 'pfund', 'energy level', 'ionization energy', 'orbit', 'hydrogen atom');
      if (/\b(\bnuclei\b|nuclear|binding energy|radioactive|fission|fusion|half life)\b/.test(ch)) return k('nuclear', 'nucleus', 'binding energy', 'mass defect', 'radioactive', 'alpha decay', 'beta decay', 'gamma', 'fission', 'fusion', 'half life', 'half-life', 'decay constant');
      if (/\b(semiconductor|p-n junction|diode|transistor|logic gate|rectifier|zener)\b/.test(ch)) return k('semiconductor', 'p-n junction', 'pn junction', 'diode', 'transistor', 'logic gate', 'rectifier', 'zener', 'forward bias', 'reverse bias', 'depletion', 'doping', 'intrinsic', 'extrinsic');
      if (/\b(communication|modulation|amplitude modulation|frequency modulation)\b/.test(ch)) return k('modulation', 'transmission', 'antenna', 'bandwidth', 'amplitude modulation', 'frequency modulation', 'sky wave', 'space wave', 'ionosphere');
    }

    if (sub.includes('math')) {
      if (/\b(set|relation|function|domain|range|one-one|onto)\b/.test(ch)) return k('set', 'relation', 'function', 'domain', 'range', 'one-one', 'onto', 'bijective', 'injective', 'surjective', 'inverse function', 'composition');
      if (/\b(trigonometric function|trigonometry|trigonometric identit|trigonometric equation)\b/.test(ch) && !ch.includes('inverse')) return k('sin', 'cos', 'tan', 'sec', 'cosec', 'cot', 'trigonometric', 'identity', 'general solution', 'principal solution', 'height and distance');
      if (/\b(inverse trigonometric|inverse trigo|sin inverse|cos inverse|tan inverse)\b/.test(ch)) return k('sin⁻¹', 'cos⁻¹', 'tan⁻¹', 'inverse trigonometric', 'principal value', 'arcsin', 'arccos', 'arctan');
      if (/\b(complex number|iota|argand|de moivre|cube root of unity)\b/.test(ch)) return k('complex number', 'iota', 'i²', 'argand', 'modulus', 'argument', 'polar form', 'de moivre', 'conjugate', 'cube root of unity', 'omega');
      if (/\b(quadratic|discriminant|roots of quadratic|vieta)\b/.test(ch)) return k('quadratic', 'discriminant', 'roots', 'sum of roots', 'product of roots', 'nature of roots', 'real roots', 'imaginary roots');
      if (/\b(sequence|series|ap|gp|hp|arithmetic progression|geometric progression)\b/.test(ch)) return k('arithmetic progression', 'geometric progression', 'harmonic progression', ' ap ', ' gp ', ' hp ', 'common difference', 'common ratio', 'nth term', 'sum to n', 'arithmetic mean', 'geometric mean');
      if (/\b(permutation|combination|factorial|ncr|npr)\b/.test(ch)) return k('permutation', 'combination', 'factorial', 'ncr', 'npr', 'arrangement', 'selection', 'circular permutation');
      if (/\b(binomial theorem|binomial expansion|general term|middle term)\b/.test(ch)) return k('binomial', 'binomial expansion', 'general term', 'middle term', 'binomial coefficient', 'pascal');
      if (/\b(matrix|matrices|matrix multiplication|transpose)\b/.test(ch) && !ch.includes('determ')) return k('matrix', 'matrices', 'transpose', 'symmetric', 'skew-symmetric', 'identity matrix', 'inverse matrix', 'elementary operation');
      if (/\b(determinant|cofactor|adjoint|cramer|minor)\b/.test(ch)) return k('determinant', 'cofactor', 'adjoint', 'minor', 'cramer', 'cofactor matrix');
      if (/\b(limit|continuity|differentiabil|l hopital)\b/.test(ch)) return k('limit', 'continuity', 'differentiability', 'left hand limit', 'right hand limit', 'l\'hôpital', 'lhopital', 'discontinuity', 'continuous');
      if (/\b(differentiation|derivative|chain rule|implicit|logarithmic differentiation)\b/.test(ch) && !ch.includes('application')) return k('derivative', 'differentiat', 'chain rule', 'implicit', 'logarithmic differentiation', 'parametric', 'higher order derivative');
      if (/\b(application of derivative|maxima|minima|tangent|normal|monotonic|rolle|mean value)\b/.test(ch)) return k('rate of change', 'tangent', 'normal', 'increasing function', 'decreasing function', 'maxima', 'minima', 'maximum', 'minimum', 'rolle', 'mean value theorem', 'approximation');
      if (/\b(indefinite integral|integration by part|integration by substitut|partial fraction)\b/.test(ch)) return k('integral', 'integration', 'by parts', 'by substitution', 'partial fraction', 'antiderivative');
      if (/\b(definite integral|fundamental theorem|property of definite)\b/.test(ch)) return k('definite integral', 'fundamental theorem', 'limit of sum', 'evaluate the integral');
      if (/\b(area under curve|area between curve|application of integral)\b/.test(ch)) return k('area under', 'area between', 'area bounded', 'area enclosed', 'sq units');
      if (/\b(differential equation|order of differential|homogeneous differential|linear differential)\b/.test(ch)) return k('differential equation', 'order of de', 'degree of de', 'homogeneous', 'linear differential', 'integrating factor', 'variable separable');
      if (/\b(straight line|slope|equation of line|distance between line)\b/.test(ch)) return k('straight line', 'slope', 'equation of line', 'point-slope', 'two-point', 'intercept', 'normal form', 'angle between', 'perpendicular distance');
      if (/\b(circle|tangent to circle|chord of circle|system of circle)\b/.test(ch)) return k('circle', 'centre and radius', 'tangent', 'chord', 'system of circle', 'family of circle', 'common chord');
      if (/\b(conic|parabola|ellipse|hyperbola|directrix|eccentricity)\b/.test(ch)) return k('parabola', 'ellipse', 'hyperbola', 'conic', 'directrix', 'eccentricity', 'latus rectum', 'focus', 'asymptote');
      if (/\b(vector|scalar product|dot product|cross product)\b/.test(ch)) return k('vector', 'dot product', 'cross product', 'scalar triple', 'vector triple', 'projection', 'unit vector', 'î', 'ĵ', 'k̂');
      if (/\b(3d geometry|three.dimensional|direction cosine|equation of plane|skew line)\b/.test(ch)) return k('direction cosine', 'direction ratio', 'equation of plane', 'skew line', 'plane', 'distance from', 'angle between');
      if (/\b(probability|bayes|conditional probability|binomial distribution|random variable)\b/.test(ch)) return k('probability', 'event', 'sample space', 'conditional probability', 'bayes', 'random variable', 'binomial distribution', 'expected value', 'mean of distribution');
      if (/\b(statistic|mean deviation|standard deviation|variance|median|mode)\b/.test(ch)) return k('mean', 'median', 'mode', 'standard deviation', 'variance', 'mean deviation', 'frequency distribution');
      if (/\b(linear programming|lpp|feasible region|objective function)\b/.test(ch)) return k('linear programming', 'lpp', 'objective function', 'feasible region', 'constraint', 'optimi', 'corner point');
      if (/\b(mathematical reasoning|tautology|contradiction|negation|implication)\b/.test(ch)) return k('statement', 'negation', 'tautology', 'contradiction', 'implication', 'converse', 'contrapositive', 'logical');
    }

    if (sub.includes('bio')) {
      if (/\b(living world|diversity in living|taxonomy|binomial nomenclature|kingdom)\b/.test(ch)) return k('taxonomy', 'binomial nomenclature', 'kingdom', 'monera', 'protista', 'fungi', 'plantae', 'animalia', 'classification', 'taxonomic hierarchy');
      if (/\b(plant kingdom|cryptogam|algae|bryo|pterido|gymnosperm|angiosperm)\b/.test(ch)) return k('algae', 'bryophyte', 'pteridophyte', 'gymnosperm', 'angiosperm', 'thallus', 'archegonium', 'antheridium', 'plant kingdom');
      if (/\b(animal kingdom|porifera|coelenterate|platyhelminthes|annelida|arthropoda|mollusca|chordata)\b/.test(ch)) return k('porifera', 'coelenterate', 'cnidaria', 'platyhelminthes', 'aschelminthes', 'annelida', 'arthropoda', 'mollusca', 'echinodermata', 'chordata', 'vertebrate', 'phylum');
      if (/\b(morphology of flowering|root|stem|leaf|inflorescence|flower|fruit|seed)\b/.test(ch)) return k('root', 'stem', 'leaf', 'inflorescence', 'flower', 'fruit', 'seed', 'venation', 'phyllotaxy', 'aestivation', 'placentation', 'morphology');
      if (/\b(anatomy of flowering|tissue system|epidermis of plant|vascular bundle)\b/.test(ch)) return k('meristem', 'parenchyma', 'collenchyma', 'sclerenchyma', 'xylem', 'phloem', 'epidermis', 'cortex', 'pericycle', 'vascular bundle', 'cambium', 'secondary growth', 'plant tissue');
      if (/\b(structural organisation in animal|animal tissue|epithelial|connective|muscular tissue|nervous tissue|frog|cockroach|earthworm)\b/.test(ch)) return k('epithelial tissue', 'connective tissue', 'muscular tissue', 'nervous tissue', 'frog', 'earthworm', 'cockroach', 'animal tissue');
      if (/\b(cell unit of life|cell theory|prokaryotic cell|eukaryotic cell|cell organelle|mitochondria|chloroplast)\b/.test(ch)) return k('cell theory', 'prokaryotic', 'eukaryotic', 'nucleus', 'mitochondria', 'chloroplast', 'ribosome', 'endoplasmic reticulum', 'golgi', 'lysosome', 'cytoplasm', 'cell wall', 'cell membrane', 'cell organelle');
      if (/\b(biomolecule|amino acid|protein|carbohydrate|lipid|enzyme|metabolism)\b/.test(ch)) return k('amino acid', 'protein', 'carbohydrate', 'lipid', 'enzyme', 'cofactor', 'coenzyme', 'metabolism', 'biomolecule', 'glycoside');
      if (/\b(cell cycle|cell division|mitosis|meiosis|prophase|metaphase)\b/.test(ch)) return k('mitosis', 'meiosis', 'prophase', 'metaphase', 'anaphase', 'telophase', 'interphase', 'cell cycle', 'centromere', 'chromatid', 'spindle');
      if (/\b(transport in plant|osmosis|active transport in plant|ascent of sap|transpiration|stomata)\b/.test(ch)) return k('osmosis', 'plasmolysis', 'water potential', 'ascent of sap', 'transpiration', 'stomata', 'guard cell', 'cohesion', 'tension', 'phloem transport', 'translocation', 'munch hypothesis');
      if (/\b(mineral nutrition|essential mineral|macronutrient|micronutrient|deficiency symptom|nitrogen fixation)\b/.test(ch)) return k('mineral', 'macronutrient', 'micronutrient', 'deficiency', 'nitrogen fixation', 'nitrogen cycle', 'nitrogenase', 'essential element');
      if (/\b(photosynthesis|calvin cycle|light reaction|dark reaction|c3 plant|c4 plant|kranz|chlorophyll)\b/.test(ch)) return k('photosynthesis', 'chlorophyll', 'photosystem', 'calvin cycle', 'kranz anatomy', 'c3 plant', 'c4 plant', 'rubisco', 'thylakoid', 'photolysis', 'photophosphorylation');
      if (/\b(respiration in plant|glycolysis|krebs|tca|electron transport chain|fermentation)\b/.test(ch)) return k('glycolysis', 'krebs cycle', 'tca cycle', 'electron transport chain', 'oxidative phosphorylation', 'fermentation', 'atp', 'nadh', 'fadh', 'respiratory quotient', 'mitochondria');
      if (/\b(plant growth|phytohormone|auxin|gibberellin|cytokinin|ethylene|abscisic|photoperiod)\b/.test(ch)) return k('auxin', 'gibberellin', 'cytokinin', 'ethylene', 'abscisic acid', 'phytohormone', 'plant growth', 'photoperiodism', 'vernalisation', 'apical dominance');
      if (/\b(digest|alimentary|absorption of food|liver function|pancreas function|digestive enzyme)\b/.test(ch)) return k('digestion', 'alimentary canal', 'oesophagus', 'stomach', 'intestine', 'liver', 'pancreas', 'bile', 'enzyme', 'digestive', 'absorption', 'villi');
      if (/\b(breathing|respiration in human|respiratory system|lung|alveoli|haldane|bohr effect)\b/.test(ch)) return k('breathing', 'respiratory system', 'lung', 'alveoli', 'oxygen transport', 'co2 transport', 'haemoglobin', 'bohr effect', 'haldane', 'inspiration', 'expiration', 'tidal volume');
      if (/\b(body fluid|circulation|blood|heart|cardiac cycle|ecg|lymph|blood group)\b/.test(ch)) return k('blood', 'plasma', 'rbc', 'wbc', 'platelet', 'haemoglobin', 'heart', 'cardiac cycle', 'systole', 'diastole', 'ecg', 'blood pressure', 'lymph', 'blood group');
      if (/\b(excret|kidney|nephron|urine formation|osmoregulation|dialysis|renal)\b/.test(ch)) return k('kidney', 'nephron', 'glomerulus', 'bowman', 'urine', 'reabsorption', 'filtrate', 'ammonia', 'urea', 'uric acid', 'osmoregulation', 'dialysis');
      if (/\b(locomotion|movement|muscle contraction|skeletal system|sliding filament)\b/.test(ch)) return k('muscle', 'sliding filament', 'actin', 'myosin', 'sarcomere', 'skeletal', 'joint', 'bone', 'cartilage', 'arthritis', 'osteoporosis');
      if (/\b(neural control|nervous system|neuron|synapse|reflex|brain|spinal cord)\b/.test(ch)) return k('neuron', 'axon', 'dendrite', 'synapse', 'neurotransmitter', 'reflex', 'brain', 'spinal cord', 'central nervous', 'peripheral nervous', 'nerve impulse', 'action potential');
      if (/\b(chemical coordination|endocrine|hormone in human|pituitary|thyroid|adrenal|gonad|hypothalamus)\b/.test(ch)) return k('hormone', 'endocrine', 'pituitary', 'thyroid', 'parathyroid', 'pancreas', 'insulin', 'glucagon', 'adrenal', 'gonad', 'testis', 'ovary', 'hypothalamus');
      if (/\b(reproduction in organism|asexual|sexual reproduction overview|vegetative)\b/.test(ch)) return k('asexual reproduction', 'sexual reproduction', 'vegetative propagation', 'binary fission', 'budding', 'fragmentation', 'gamete', 'fertilization');
      if (/\b(sexual reproduction in flowering|microsporogen|megasporogen|double fertilization|endosperm|polyembryony)\b/.test(ch)) return k('microsporogenesis', 'megasporogenesis', 'pollen grain', 'embryo sac', 'pollination', 'double fertilization', 'endosperm', 'embryo', 'apomixis', 'polyembryony');
      if (/\b(human reproduction|spermatogenes|oogenes|menstrual cycle|fertilization in human|implantation|pregnancy|parturition)\b/.test(ch)) return k('spermatogenesis', 'oogenesis', 'menstrual cycle', 'ovulation', 'fertilization', 'implantation', 'pregnancy', 'parturition', 'lactation', 'testis', 'ovary', 'uterus', 'fallopian');
      if (/\b(reproductive health|contracept|amniocent|infertility|sexually transmitted)\b/.test(ch)) return k('reproductive health', 'contraception', 'amniocentesis', 'infertility', 'std', 'aids', 'art ', 'ivf', 'mtp', 'population');
      if (/\b(inheritance|principles of inheritance|mendel|segregation|independent assortment|linkage|crossing over|sex determination|pedigree)\b/.test(ch)) return k('mendel', 'monohybrid', 'dihybrid', 'segregation', 'independent assortment', 'linkage', 'crossing over', 'allele', 'genotype', 'phenotype', 'pedigree', 'sex determination', 'mutation', 'codominance', 'incomplete dominance');
      if (/\b(molecular basis of inheritance|dna structure|dna replication|transcription|translation|genetic code|operon)\b/.test(ch)) return k('dna', 'rna', 'replication', 'transcription', 'translation', 'genetic code', 'codon', 'mrna', 'trna', 'rrna', 'lac operon', 'gene expression', 'human genome', 'fingerprint', 'helix');
      if (/\b(evolution|darwin|natural selection|lamarck|hardy weinberg|speciation|adaptive radiation)\b/.test(ch)) return k('evolution', 'darwin', 'natural selection', 'lamarck', 'hardy weinberg', 'speciation', 'adaptive radiation', 'origin of life', 'fossil', 'homologous', 'analogous');
      if (/\b(health and disease|infectious disease|vaccination|immunity|antigen|antibody|aids|cancer)\b/.test(ch)) return k('immunity', 'antigen', 'antibody', 'vaccination', 'pathogen', 'infectious disease', 'malaria', 'typhoid', 'pneumonia', 'aids', 'hiv', 'cancer', 'tumour', 'drug abuse');
      if (/\b(food production|improvement in food|plant breeding|tissue culture|animal husbandry)\b/.test(ch)) return k('animal husbandry', 'plant breeding', 'tissue culture', 'single cell protein', 'apiculture', 'pisciculture', 'green revolution', 'biofortification', 'hybrid');
      if (/\b(microbes in human welfare|industrial product|biofertilizer|biocontrol|sewage)\b/.test(ch)) return k('microbe', 'lab', 'curd', 'yeast', 'bread', 'cheese', 'biogas', 'biofertilizer', 'biocontrol', 'sewage', 'antibiotic', 'lactobacillus');
      if (/\b(biotechnology principle|recombinant dna|restriction enzyme|cloning vector|pcr|transgenic)\b/.test(ch)) return k('recombinant dna', 'restriction enzyme', 'plasmid', 'vector', 'pcr', 'gel electrophoresis', 'transformation', 'cloning', 'biotechnology');
      if (/\b(biotechnology and its application|transgenic plant|transgenic animal|gene therapy|molecular diagnos)\b/.test(ch)) return k('transgenic', 'bt cotton', 'bt brinjal', 'rnai', 'gene therapy', 'molecular diagnosis', 'insulin', 'biopiracy', 'biosafety', 'gmo');
      if (/\b(organism and population|habitat|niche|population attribute|population growth)\b/.test(ch)) return k('habitat', 'niche', 'population density', 'natality', 'mortality', 'population growth', 'exponential', 'logistic', 'mutualism', 'competition', 'predation', 'parasitism');
      if (/\b(ecosystem|energy flow|trophic level|food chain|food web|ecological pyramid)\b/.test(ch)) return k('ecosystem', 'producer', 'consumer', 'decomposer', 'food chain', 'food web', 'trophic level', 'ecological pyramid', 'productivity', 'energy flow', 'biogeochemical', 'nutrient cycle');
      if (/\b(biodiversity|hot spot|extinct|endemic|in situ|ex situ|biosphere reserve)\b/.test(ch)) return k('biodiversity', 'species diversity', 'genetic diversity', 'hot spot', 'endemic', 'endangered', 'extinct', 'in situ', 'ex situ', 'biosphere reserve', 'national park', 'iucn');
      if (/\b(environmental issue|air pollution|water pollution|noise pollution|global warming|ozone depletion|deforestation)\b/.test(ch)) return k('air pollution', 'water pollution', 'soil pollution', 'noise pollution', 'global warming', 'greenhouse', 'ozone depletion', 'deforestation', 'e-waste', 'chipko');
    }

    return [];
  }

  /** Off-scope keywords — if a question contains ANY of these, it's likely from a different chapter. */
  private getOffScopeKeywords(subject: string | undefined, chapter: string): string[] {
    const sub = (subject || '').toLowerCase();
    const ch = chapter.toLowerCase();
    if (sub.includes('chem')) {
      // If chapter is physical chem, anti = organic functional groups + inorganic blocks
      if (/\b(solution|solid state|thermodynamic|equilibrium|electrochem|kinetic|surface chem|atomic structure|mole concept|gas |state of matter|redox)\b/.test(ch)) {
        return ['alcohol -oh', 'aldehyde -cho', 'ketone -co-', 'amine -nh2', 'aromatic ring', 'benzene reaction', 'wurtz reaction', 'kolbe synthesis', 'friedel-crafts', 'sn1 mechanism', 'sn2 mechanism', 'p-block', 'd-block', 'lanthanoid', 'coordination complex', 'metallurgy', 'froth flotation'];
      }
      if (/\b(periodic|bonding|hydrogen|s-block|p-block|d-block|coordination|metallurg|salt analysis|environmental)\b/.test(ch)) {
        return ['raoult', 'henry law', 'colligative', 'gibbs free', 'arrhenius equation', 'rate of reaction', 'order of reaction', 'aldol', 'cannizzaro', 'wurtz', 'sn1', 'sn2', 'amino acid', 'monosaccharide', 'protein structure'];
      }
      if (/\b(hydrocarbon|alkane|alkene|alkyne|aromatic|benzene|haloalkane|alcohol|phenol|ether|aldehyde|ketone|carboxylic|amine|biomolecule|polymer|everyday life|goc|iupac)\b/.test(ch)) {
        return ['kp =', 'kc =', 'gibbs free energy', 'arrhenius equation', 'nernst equation', 'galvanic cell', 'electrolytic cell', 'crystal field', 'ligand', 'coordination compound', 'p-block element', 'd-block element', 's-block element', 'group 1 element', 'group 17 element'];
      }
    }
    if (sub.includes('physics')) {
      // Units & Dimensions / Measurements — everything else is off-scope
      if (/\b(unit|measurement|dimension|significant figure|error analysis)\b/.test(ch)) {
        return ['carnot', 'efficiency of engine', 'entropy', 'thermodynamic cycle', 'isothermal', 'adiabatic',
          'newton\'s law of motion', 'projectile motion', 'circular motion', 'centripetal', 'angular velocity',
          'electric field', 'magnetic field', 'capacitance', 'inductance', 'ohm\'s law', 'kirchhoff',
          'refractive index', 'snell\'s law', 'interference', 'diffraction', 'photoelectric effect',
          'de broglie', 'bohr model', 'binding energy', 'radioactive', 'nuclear fission', 'transistor',
          'logic gate', 'p-n junction', 'wave equation', 'frequency of oscillation', 'kepler'];
      }
      // If chapter is mechanics, anti = optics + electricity + modern
      if (/\b(kinematic|newton|work|energy|rotation|gravitation|elastic|fluid)\b/.test(ch)) {
        return ['photoelectric', 'de broglie', 'bohr orbit', 'binding energy', 'half life', 'transistor', 'p-n junction', 'capacitance', 'inductance', 'lenz law', 'faraday law', 'doppler effect', 'snell law', 'refractive index', 'biot-savart'];
      }
      if (/\b(thermal|thermodynamic|kinetic theory)\b/.test(ch)) {
        return ['friction force', 'projectile motion', 'gravitational', 'photoelectric', 'capacitance', 'inductance', 'snell law', 'bohr', 'transistor'];
      }
      if (/\b(oscillat|wave|sound|doppler)\b/.test(ch)) {
        return ['kepler law', 'gravitational potential', 'photoelectric', 'binding energy', 'bohr orbit', 'transistor', 'p-n junction'];
      }
      if (/\b(electrostatic|electric field|capacitor|coulomb|gauss)\b/.test(ch)) {
        return ['projectile motion', 'kepler law', 'gravitational', 'photoelectric', 'binding energy', 'bohr orbit', 'transistor', 'snell law', 'doppler effect'];
      }
      if (/\b(current electricity|kirchhoff|ohm|wheatstone|potentiometer)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'photoelectric', 'binding energy', 'bohr orbit', 'snell law', 'doppler effect', 'capacitance =', 'magnetic flux'];
      }
      if (/\b(magnetic|biot-savart|ampere|cyclotron|magnetism|electromagnetic induction|alternating)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'photoelectric', 'binding energy', 'bohr orbit', 'snell law', 'transistor'];
      }
      if (/\b(electromagnetic wave|displacement current|maxwell|spectrum)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'kepler', 'transistor', 'p-n junction', 'binding energy'];
      }
      if (/\b(ray optic|reflection|refraction|lens|mirror|prism)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'photoelectric', 'binding energy', 'bohr orbit', 'transistor', 'capacitance', 'inductance'];
      }
      if (/\b(wave optic|interference|diffraction|polari|huygens)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'transistor', 'binding energy', 'bohr orbit', 'snell law calculation'];
      }
      if (/\b(dual nature|photoelectric|matter wave|de broglie)\b/.test(ch)) {
        return ['projectile motion', 'gravitational', 'kepler law', 'capacitance =', 'inductance', 'transistor', 'snell law'];
      }
      if (/\b(\batom\b|bohr|spectral|hydrogen spectrum|rutherford)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'kepler', 'capacitance', 'inductance', 'snell law', 'transistor', 'fission', 'fusion'];
      }
      if (/\b(\bnuclei\b|nuclear|fission|fusion|radioactive)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'kepler', 'capacitance', 'inductance', 'snell law', 'transistor', 'photoelectric', 'bohr orbit'];
      }
      if (/\b(semiconductor|diode|transistor|logic gate|rectifier)\b/.test(ch)) {
        return ['projectile', 'gravitational', 'kepler', 'snell law', 'photoelectric', 'binding energy', 'bohr orbit', 'fission'];
      }
    }
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
      
      const modelAnswer = String((q as any).modelAnswer ?? (q as any).rubric ?? (q as any).answer ?? '').trim();

      const scopeCheck = (q.scope_check || q.scopeCheck || q.scope || '').toString().trim() || undefined;
      const subtopic = (q.subtopic || q.sub_topic || q.subTopic || '').toString().trim() || undefined;
      // AI-labeled chapter — used for subject tests where the AI selects the chapter per question
      const aiChapter = (q.chapter || q.chapter_name || q.chapterName || '').toString().trim() || undefined;

      if (isSubjective) {
        return {
          questionText: content,
          content,
          options: [],
          explanation,
          solutionText: modelAnswer || rawAnswer || '',
          integerAnswer: null,
          answer: modelAnswer || rawAnswer || '',
          scope_check: scopeCheck,
          subtopic,
          chapter: aiChapter,
          meta: q._meta || {},
        };
      }

      let intAns: string | null = type === 'integer' ? (rawAnswer || (q as any).integerAnswer || (q as any).answer || null) : null;
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
          questionText: content,
          content,
          options: [],
          explanation,
          integerAnswer: intAns,
          answer: intAns,
          scope_check: scopeCheck,
          subtopic,
          chapter: aiChapter,
          meta: q._meta || {},
        };
      }

      return {
        questionText: content,
        content,
        options,
        explanation,
        integerAnswer: null,
        solutionText: explanation,
        answer: rawAnswer,
        scope_check: scopeCheck,
        subtopic,
        chapter: aiChapter,
        meta: q._meta || {},
      };
    });
  }

  private normalizeTextKey(value: string, maskDigits = false): string {
    let t = String(value || '').toLowerCase();
    if (maskDigits) {
      t = t.replace(/[0-9]+/g, '#');
    }
    return t
      .replace(/[^a-z0-9#\u0900-\u0fff\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Final guardrail pass:
   * - Drop duplicate question stems
   * - Remove duplicate/blank options
   * - Ensure objective MCQs have exactly 4 unique options
   * - Enforce a single correct option for single-correct MCQ
   */
  /**
   * Strip LaTeX formatting from AI-generated text and convert common commands
   * to readable plain text / Unicode. Handles both well-formed `\command{x}`
   * and JSON-mangled variants where backslashes were stripped (`command{x}`).
   */
  private cleanLatexFormatting(input: string): string {
    if (!input) return input;
    let s = String(input);

    // Display math delimiters first (to avoid eating singles): $$...$$, \[ ... \]
    s = s.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
    s = s.replace(/\\\[([\s\S]*?)\\\]/g, '$1');
    // Inline math: $...$, \( ... \)
    s = s.replace(/\$([^\$\n]+?)\$/g, '$1');
    s = s.replace(/\\\(([\s\S]*?)\\\)/g, '$1');

    // \text{X} / \mathrm{X} / \mathbf{X} / \mathit{X} → X (also stripped-backslash variants)
    s = s.replace(/\\?(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1');

    // \frac{a}{b} → (a/b)   (handle one-level nesting only, that covers ~95% of cases)
    s = s.replace(/\\?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1/$2)');

    // \sqrt{x} → √(x), \sqrt[n]{x} → ⁿ√(x)
    s = s.replace(/\\?sqrt\s*\[([^\]]+)\]\s*\{([^{}]*)\}/g, '$1√($2)');
    s = s.replace(/\\?sqrt\s*\{([^{}]*)\}/g, '√($1)');

    // Common LaTeX symbols → Unicode
    const symMap: Record<string, string> = {
      times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
      leq: '≤', geq: '≥', neq: '≠', approx: '≈', equiv: '≡',
      infty: '∞', partial: '∂', nabla: '∇',
      rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
      zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
      lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
      sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
      Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Theta: 'Θ',
      Lambda: 'Λ', Mu: 'Μ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
      degree: '°', circ: '°',
      sum: '∑', prod: '∏', int: '∫',
      ldots: '…', cdots: '⋯',
    };
    for (const [name, glyph] of Object.entries(symMap)) {
      // Match both \name and bare-name (when backslash was stripped) followed by non-letter or end
      s = s.replace(new RegExp(`\\\\${name}\\b`, 'g'), glyph);
    }

    // Unicode super/subscripts for simple digit groups: ^{2} → ², _{2} → ₂
    const supMap: Record<string, string> = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾' };
    const subMap: Record<string, string> = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎' };
    s = s.replace(/\^\{([\d+\-=()]+)\}/g, (_m, g) => g.split('').map((c: string) => supMap[c] ?? c).join(''));
    s = s.replace(/_\{([\d+\-=()]+)\}/g, (_m, g) => g.split('').map((c: string) => subMap[c] ?? c).join(''));
    // Single-char super/subscript: x^2 → x²,   H_2 → H₂
    s = s.replace(/\^([\d+\-=])/g, (_m, c) => supMap[c] ?? `^${c}`);
    s = s.replace(/_([\d+\-=])/g, (_m, c) => subMap[c] ?? `_${c}`);

    // LaTeX spacing commands → space (or remove): \,  \;  \:  \!  \quad  \qquad
    s = s.replace(/\\(?:[,;:]|!|quad|qquad)/g, ' ');
    // Same, but with backslash already stripped (e.g. lone " ; " between digits/letters)
    s = s.replace(/(\d|\w)\s*;\s*(?=[a-zA-Z\(])/g, '$1 ');

    // Curly braces around plain content: drop them (e.g. "{mol}" → "mol")
    s = s.replace(/\{([^{}]*)\}/g, '$1');

    // Remaining \command sequences with no special handling: drop the backslash, keep the word
    s = s.replace(/\\([a-zA-Z]+)/g, '$1');

    // Collapse extra spaces caused by the above substitutions
    s = s.replace(/[ \t]{2,}/g, ' ').trim();

    return s;
  }

  private postProcessGeneratedQuestions(questions: any[], type: string): any[] {
    const seenQuestionKeys = new Set<string>();
    const output: any[] = [];

    for (const row of questions || []) {
      const content = this.cleanLatexFormatting(String(row?.content || '').trim());
      if (!content) continue;

      const qKey = this.normalizeTextKey(content, true).slice(0, 220);
      if (!qKey || seenQuestionKeys.has(qKey)) continue;
      seenQuestionKeys.add(qKey);

      const next = { ...row, content };

      // Sanitize companion fields too
      if (typeof next.explanation === 'string') next.explanation = this.cleanLatexFormatting(next.explanation);
      if (typeof next.solutionText === 'string') next.solutionText = this.cleanLatexFormatting(next.solutionText);
      if (typeof next.solution_text === 'string') next.solution_text = this.cleanLatexFormatting(next.solution_text);
      if (typeof next.integerAnswer === 'string') next.integerAnswer = this.cleanLatexFormatting(next.integerAnswer);

      const isObjective = !['descriptive', 'long_answer', 'subjective', 'short_descriptive', 'short_answer'].includes(type);

      if (isObjective) {
        const seenOptionKeys = new Set<string>();
        const cleanedOptions: Array<{ label: string; content: string; isCorrect: boolean }> = [];

        for (const opt of Array.isArray(next.options) ? next.options : []) {
          const text = this.cleanLatexFormatting(String(opt?.content ?? '').trim());
          if (!text) continue;
          const oKey = this.normalizeTextKey(text, false);
          if (!oKey || seenOptionKeys.has(oKey)) continue;
          seenOptionKeys.add(oKey);
          cleanedOptions.push({
            label: '',
            content: text,
            isCorrect: Boolean(opt?.isCorrect),
          });
        }

        if (cleanedOptions.length < 4) continue;

        let finalOptions = cleanedOptions.slice(0, 4);
        const firstCorrectIdx = finalOptions.findIndex((o) => o.isCorrect);
        if (firstCorrectIdx < 0) continue;

        if (type === 'mcq_single' || type === 'integer' || type === 'mcq') {
          finalOptions = finalOptions.map((o, idx) => ({ ...o, isCorrect: idx === firstCorrectIdx }));
        }

        next.options = finalOptions.map((o, idx) => ({
          ...o,
          label: String.fromCharCode(65 + idx),
        }));
      }

      output.push(next);
    }

    return output;
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
      notes?: string;
      lectureTitle: string;
      topicId?: string;
      numQuestions?: number;
      courseLevel?: string;
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
