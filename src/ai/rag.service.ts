import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RagQuestion {
  id: string;
  subject: string;
  chapter: string;
  topic: string;
  exam: string;
  difficulty: string;
  similarity: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  explanation: string;
}

export interface DoubtContext {
  context: string;
  similarQuestions: RagQuestion[];
}

export interface NotesContext {
  ncertContext: string;
  similarQuestions: RagQuestion[];
}

export interface CurriculumChapter {
  chapter: string;
  topics: string[];
  topic_count: number;
  question_count: number;
  exam_types: string[];
}

export interface CurriculumResult {
  subject: string;
  exam: string;
  chapters: CurriculumChapter[];
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * RagService
 *
 * Calls the Python RAG FastAPI sidecar (port 8001).
 * CRITICAL: Every method returns empty/null on ANY error.
 * RAG failure must NEVER break the main AI feature.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly ragUrl: string;
  private readonly timeoutMs = 5_000; // 5 s — fast sidecar call

  constructor(private readonly config: ConfigService) {
    this.ragUrl = config.get<string>('RAG_URL') ?? 'http://localhost:8001';
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Returns context string + similar questions for doubt solving.
   * Returns { context: '', similarQuestions: [] } on any error.
   */
  async getDoubtContext(
    query: string,
    subject?: string,
  ): Promise<DoubtContext> {
    const empty: DoubtContext = { context: '', similarQuestions: [] };
    try {
      const data = await this._post<{
        context?: string;
        similar_questions?: RagQuestion[];
      }>('/rag/doubt-context', {
        question: query,
        subject: subject ?? null,
        n_results: 5,
      });

      // The server returns context string + source_count; also fetch similar for injection
      const context = data?.context ?? '';
      const similarQuestions = data?.similar_questions ?? [];
      return { context, similarQuestions };
    } catch {
      return empty;
    }
  }

  /**
   * Returns similar exam questions for DPP generation.
   * Returns [] on any error.
   */
  async getDppQuestions(
    topic: string,
    subject: string,
    difficulty?: string,
    exam?: string,
  ): Promise<RagQuestion[]> {
    try {
      const data = await this._post<{ questions?: RagQuestion[] }>(
        '/rag/dpp-questions',
        {
          topic,
          subject,
          difficulty: difficulty ?? null,
          exam: exam ?? null,
          n_results: 15,
        },
      );
      return data?.questions ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Returns NCERT text + similar questions for notes generation.
   * Returns { ncertContext: '', similarQuestions: [] } on any error.
   */
  async getNotesContext(
    topic: string,
    subject: string,
    chapter?: string,
  ): Promise<NotesContext> {
    const empty: NotesContext = { ncertContext: '', similarQuestions: [] };
    try {
      const data = await this._post<{
        ncert_context?: string;
        similar_questions?: RagQuestion[];
      }>('/rag/notes-context', {
        topic,
        subject,
        chapter: chapter ?? null,
        n_results: 3,
      });
      return {
        ncertContext:     data?.ncert_context     ?? '',
        similarQuestions: data?.similar_questions ?? [],
      };
    } catch {
      return empty;
    }
  }

  /**
   * Returns chapter→topics curriculum structure.
   * Returns null on any error.
   */
  async getCurriculum(
    subject: string,
    exam: string,
  ): Promise<CurriculumResult | null> {
    try {
      const params = new URLSearchParams({ subject, exam });
      const data = await this._get<CurriculumResult>(
        `/rag/curriculum?${params.toString()}`,
      );
      if (!data || (data as { error?: string }).error) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Health check — returns true only when RAG sidecar is running.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const data = await this._get<{ status?: string }>('/rag/health');
      return data?.status === 'ok';
    } catch {
      return false;
    }
  }

  // ── Private HTTP helpers ──────────────────────────────────────────────────

  private async _post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.ragUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.logger.debug(`RAG POST ${path} → HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`RAG POST ${path} failed: ${msg}`);
      return null;
    }
  }

  private async _get<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.ragUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.logger.debug(`RAG GET ${path} → HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`RAG GET ${path} failed: ${msg}`);
      return null;
    }
  }
}
