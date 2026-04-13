import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { LLMService } from './llm.service';
import { RagService, RagQuestion } from './rag.service';

// ── Request / Response DTOs ───────────────────────────────────────────────────

export interface DoubtRequest {
  question: string;
  subject?: string;
  batchId?: string;
  topicId?: string;
}

export interface DoubtResponse {
  answer: string;
  usedRag: boolean;
  ragSourceCount: number;
  subject: string;
  status: 'pending_review';
}

export interface DPPRequest {
  topic: string;
  subject: string;
  difficulty?: string;
  count?: number;
  exam?: string;
  batchId?: string;
}

export interface DPPResponse {
  questions: RagQuestion[] | string;
  source: 'rag' | 'llm';
  count: number;
  topic: string;
  subject: string;
  status: 'pending_review';
}

export interface NotesRequest {
  topic: string;
  subject: string;
  chapter?: string;
  batchId?: string;
}

export interface NotesResponse {
  notes: string;
  topic: string;
  subject: string;
  usedNcert: boolean;
  status: 'pending_review';
}

export interface CurriculumRequest {
  subject: string;
  exam: string;
  weeksAvailable?: number;
  batchId?: string;
}

export interface CurriculumResponse {
  curriculum: Record<string, unknown>;
  subject: string;
  exam: string;
  status: 'pending_review';
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * AIService
 *
 * Main AI orchestration service — combines LLMService + RagService.
 *
 * CRITICAL RULE: Every AI-generated response carries status: 'pending_review'.
 * Admin/teacher must approve content before students can see it.
 */
@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly llm: LLMService,
    private readonly rag: RagService,
  ) {}

  // ── 1. Solve Doubt ────────────────────────────────────────────────────────

  async solveDoubt(req: DoubtRequest): Promise<DoubtResponse> {
    // Step 1: Get RAG context (non-blocking — never fails)
    const { context: ragContext, similarQuestions } =
      await this.rag.getDoubtContext(req.question, req.subject);

    const ragSourceCount = ragContext
      ? (ragContext.match(/\nQ\d+:/g) ?? []).length
      : 0;

    // Step 2: Call LLM with RAG context injected
    const llmRes = await this.llm.solveDoubt(
      req.question,
      req.subject,
      ragContext || undefined,
    );

    if (llmRes.error && !llmRes.text) {
      throw new ServiceUnavailableException(
        `AI service unavailable: ${llmRes.error}. Run: ollama serve`,
      );
    }

    return {
      answer:          llmRes.text,
      usedRag:         ragSourceCount > 0,
      ragSourceCount,
      subject:         req.subject ?? 'General',
      status:          'pending_review',
    };
  }

  // ── 2. Generate DPP ───────────────────────────────────────────────────────

  async generateDPP(req: DPPRequest): Promise<DPPResponse> {
    const count = req.count ?? 10;

    // Step 1: Try to get real questions from RAG
    const ragQuestions = await this.rag.getDppQuestions(
      req.topic,
      req.subject,
      req.difficulty,
      req.exam,
    );

    // Step 2: If enough real questions — use them directly
    if (ragQuestions.length >= count) {
      return {
        questions: ragQuestions.slice(0, count),
        source:    'rag',
        count:     Math.min(ragQuestions.length, count),
        topic:     req.topic,
        subject:   req.subject,
        status:    'pending_review',
      };
    }

    // Step 3: Generate with LLM, using real questions as style reference
    const referenceQuestions =
      ragQuestions.length > 0
        ? this._formatQuestionsForPrompt(ragQuestions.slice(0, 3))
        : undefined;

    const llmRes = await this.llm.generateDPP({
      topic:              req.topic,
      subject:            req.subject,
      difficulty:         req.difficulty,
      count,
      referenceQuestions,
    });

    if (!llmRes) {
      throw new ServiceUnavailableException(
        'AI service unavailable. Run: ollama serve',
      );
    }

    return {
      questions: llmRes,
      source:    'llm',
      count,
      topic:     req.topic,
      subject:   req.subject,
      status:    'pending_review',
    };
  }

  // ── 3. Generate Notes ─────────────────────────────────────────────────────

  async generateNotes(req: NotesRequest): Promise<NotesResponse> {
    // Step 1: Get NCERT context + similar PYQs from RAG
    const { ncertContext, similarQuestions } = await this.rag.getNotesContext(
      req.topic,
      req.subject,
      req.chapter,
    );

    // Step 2: Format similar questions for prompt
    const similarQuestionsText =
      similarQuestions.length > 0
        ? this._formatQuestionsForPrompt(similarQuestions.slice(0, 3))
        : undefined;

    // Step 3: Generate notes with full context
    const notes = await this.llm.generateNotes({
      topic:            req.topic,
      subject:          req.subject,
      chapter:          req.chapter,
      ncertContext:     ncertContext || undefined,
      similarQuestions: similarQuestionsText,
    });

    if (!notes) {
      throw new ServiceUnavailableException(
        'AI service unavailable. Run: ollama serve',
      );
    }

    return {
      notes,
      topic:     req.topic,
      subject:   req.subject,
      usedNcert: ncertContext.length > 0,
      status:    'pending_review',
    };
  }

  // ── 4. Generate Curriculum ────────────────────────────────────────────────

  async generateCurriculum(req: CurriculumRequest): Promise<CurriculumResponse> {
    // Step 1: Get official syllabus from RAG
    const syllabusData = await this.rag.getCurriculum(req.subject, req.exam);

    // Step 2: Format syllabus as readable context for LLM
    const syllabusContext = syllabusData
      ? syllabusData.chapters
          .slice(0, 25)
          .map(
            (ch) =>
              `${ch.chapter} (${ch.question_count} exam Qs): ${ch.topics.slice(0, 5).join(', ')}`,
          )
          .join('\n')
      : undefined;

    // Step 3: Generate curriculum JSON
    const curriculum = await this.llm.generateCurriculum({
      subject:         req.subject,
      exam:            req.exam,
      syllabusContext,
      weeksAvailable:  req.weeksAvailable ?? 16,
    });

    if (!curriculum || curriculum['error']) {
      this.logger.warn(`Curriculum generation partial failure for ${req.subject}/${req.exam}`);
    }

    return {
      curriculum,
      subject: req.subject,
      exam:    req.exam,
      status:  'pending_review',
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _formatQuestionsForPrompt(questions: RagQuestion[]): string {
    return questions
      .map(
        (q, i) =>
          `Q${i + 1}: ${q.question_text}\n` +
          `A) ${q.option_a}  B) ${q.option_b}  C) ${q.option_c}  D) ${q.option_d}\n` +
          `Answer: ${q.correct_option}` +
          (q.explanation ? `\nExplanation: ${q.explanation.slice(0, 150)}` : ''),
      )
      .join('\n\n');
  }
}
