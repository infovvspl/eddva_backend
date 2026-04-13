import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  error?: string;
}

export interface GenerateMCQParams {
  topic: string;
  subject: string;
  difficulty?: string;
  count?: number;
  chapter?: string;
}

export interface GenerateDPPParams {
  topic: string;
  subject: string;
  difficulty?: string;
  count?: number;
  referenceQuestions?: string;
}

export interface GenerateNotesParams {
  topic: string;
  subject: string;
  chapter?: string;
  ncertContext?: string;
  similarQuestions?: string;
}

export interface GenerateCurriculumParams {
  subject: string;
  exam: string;
  syllabusContext?: string;
  weeksAvailable?: number;
}

// ── Subject-specific system prompts ──────────────────────────────────────────

const SUBJECT_PROMPTS: Record<string, string> = {
  Physics: `You are an expert JEE/NEET Physics teacher with 15 years of experience.
You explain concepts clearly using first principles, show step-by-step derivations,
and always connect theory to exam application. Use SI units consistently.
For MCQs, always identify the core formula/concept before solving.`,

  Chemistry: `You are an expert JEE/NEET Chemistry teacher with 15 years of experience.
For Organic Chemistry: show reaction mechanisms and key steps.
For Inorganic Chemistry: state rules, exceptions, and periodic trends.
For Physical Chemistry: show formulas and numerical working.
Always mention why wrong options fail in MCQs.`,

  Maths: `You are an expert JEE Mathematics teacher with 15 years of experience.
You show complete algebraic working — never skip steps.
You state which theorem/formula/identity is being applied.
When multiple methods exist, show the fastest one and mention the shortcut.
End solutions with "Shortcut:" if a faster approach exists.`,

  Biology: `You are an expert NEET Biology teacher with 15 years of experience.
You state biological facts directly and accurately.
You use proper biological terminology.
For diagram-based questions, describe structures clearly in text.
You mention NEET frequency notes for commonly tested topics.`,

  default: `You are an expert JEE/NEET teacher with 15 years of experience.
You explain concepts clearly, show complete working, and help students
understand both the correct answer and why other options are wrong.`,
};

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class LLMService implements OnModuleInit {
  private readonly logger = new Logger(LLMService.name);
  private readonly ollamaUrl: string;
  private readonly model: string;
  private readonly timeoutMs = 120_000; // 120 s — local LLM can be slow

  constructor(private readonly config: ConfigService) {
    this.ollamaUrl = config.get<string>('OLLAMA_URL') ?? 'http://localhost:11434';
    this.model = config.get<string>('OLLAMA_MODEL') ?? 'llama3.1:8b';
  }

  async onModuleInit() {
    const health = await this.healthCheck();
    if (health.status === 'ok') {
      this.logger.log(`Ollama ready — model: ${this.model} @ ${this.ollamaUrl}`);
    } else {
      this.logger.warn(
        `Ollama not reachable at ${this.ollamaUrl}. ` +
        `AI features will be unavailable until it starts. ` +
        `Run: ollama serve && ollama pull ${this.model}`,
      );
    }
  }

  // ── Core completion ───────────────────────────────────────────────────────

  async complete(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<LLMResponse> {
    const { temperature = 0.3, maxTokens = 1024 } = options;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          options: {
            temperature,
            num_predict: maxTokens,
          },
        }),
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown');
        this.logger.error(`Ollama HTTP ${res.status}: ${errText}`);
        return { text: '', model: this.model, error: `Ollama error: ${res.status}` };
      }

      const data = (await res.json()) as {
        message?: { content?: string };
        model?: string;
      };

      const text = data?.message?.content?.trim() ?? '';
      return { text, model: data?.model ?? this.model };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('abort') || msg.includes('timeout');
      this.logger.error(`Ollama ${isTimeout ? 'timeout' : 'error'}: ${msg}`);
      return {
        text: '',
        model: this.model,
        error: isTimeout ? 'LLM request timed out' : `LLM unavailable: ${msg}`,
      };
    }
  }

  // ── Simple prompt helper ──────────────────────────────────────────────────

  async prompt(
    userMessage: string,
    systemMessage?: string,
    options: LLMOptions = {},
  ): Promise<string> {
    const messages: LLMMessage[] = [];
    if (systemMessage) messages.push({ role: 'system', content: systemMessage });
    messages.push({ role: 'user', content: userMessage });

    const res = await this.complete(messages, options);
    return res.text;
  }

  // ── Domain methods ────────────────────────────────────────────────────────

  async solveDoubt(
    question: string,
    subject?: string,
    ragContext?: string,
  ): Promise<LLMResponse> {
    const systemPrompt = SUBJECT_PROMPTS[subject ?? ''] ?? SUBJECT_PROMPTS.default;

    const contextSection = ragContext
      ? `${ragContext}\n\nUsing the above context where relevant, answer the student's question below.`
      : '';

    const userMessage =
      `${contextSection}\n\nStudent Question: ${question}\n\n` +
      `Provide a clear, step-by-step explanation. ` +
      `If this is an MCQ, identify the core concept first, then solve.`;

    return this.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.3 },
    );
  }

  async generateMCQ(params: GenerateMCQParams): Promise<string> {
    const { topic, subject, difficulty = 'medium', count = 5, chapter } = params;
    const systemPrompt = SUBJECT_PROMPTS[subject] ?? SUBJECT_PROMPTS.default;

    const userMessage =
      `Generate ${count} high-quality MCQ questions on "${topic}"` +
      (chapter ? ` from ${chapter}` : '') +
      ` for ${subject} (${difficulty} difficulty, JEE/NEET level).\n\n` +
      `Format each question as:\n` +
      `Q: [question text]\n` +
      `A) [option a]\nB) [option b]\nC) [option c]\nD) [option d]\n` +
      `Answer: [A/B/C/D]\n` +
      `Explanation: [brief explanation]\n\n` +
      `Return ONLY the questions in the above format. No preamble.`;

    return this.prompt(userMessage, systemPrompt, { temperature: 0.6 });
  }

  async generateDPP(params: GenerateDPPParams): Promise<string> {
    const { topic, subject, difficulty = 'medium', count = 10, referenceQuestions } = params;
    const systemPrompt = SUBJECT_PROMPTS[subject] ?? SUBJECT_PROMPTS.default;

    const refSection = referenceQuestions
      ? `Reference questions for style (do NOT copy, use as style guide only):\n${referenceQuestions}\n\n`
      : '';

    const userMessage =
      `${refSection}Create a Daily Practice Problem (DPP) set of ${count} MCQs on "${topic}" (${subject}).\n` +
      `Difficulty: ${difficulty}\n` +
      `Mix concept-based and numerical questions.\n` +
      `Format each as:\n` +
      `Q[n]: [question text]\n` +
      `A) [option a]  B) [option b]  C) [option c]  D) [option d]\n` +
      `Answer: [letter]\n` +
      `Explanation: [brief]\n\n` +
      `Return ONLY the DPP questions. No preamble.`;

    return this.prompt(userMessage, systemPrompt, { temperature: 0.5 });
  }

  async generateNotes(params: GenerateNotesParams): Promise<string> {
    const { topic, subject, chapter, ncertContext, similarQuestions } = params;
    const systemPrompt = SUBJECT_PROMPTS[subject] ?? SUBJECT_PROMPTS.default;

    const ncertSection = ncertContext
      ? `NCERT Reference Material:\n${ncertContext}\n\n`
      : '';
    const examSection = similarQuestions
      ? `Related Exam Questions:\n${similarQuestions}\n\n`
      : '';

    const userMessage =
      `${ncertSection}${examSection}` +
      `Create comprehensive study notes on "${topic}"` +
      (chapter ? ` (Chapter: ${chapter})` : '') +
      ` for ${subject}.\n\n` +
      `Structure:\n` +
      `1. Key Concepts & Definitions\n` +
      `2. Important Formulas / Reactions / Rules\n` +
      `3. Common Exam Traps & Mistakes to Avoid\n` +
      `4. Quick Revision Points\n` +
      `5. Practice Questions (3-5 MCQs)\n\n` +
      `Keep it concise, exam-focused, and NCERT-aligned.`;

    return this.prompt(userMessage, systemPrompt, { temperature: 0.5 });
  }

  async generateCurriculum(params: GenerateCurriculumParams): Promise<Record<string, unknown>> {
    const { subject, exam, syllabusContext, weeksAvailable = 16 } = params;

    const systemPrompt = `You are an expert academic counselor for JEE/NEET preparation.
You design optimal study plans based on official syllabuses and exam weightages.
Always respond with valid JSON only — no markdown, no preamble.`;

    const syllabusSection = syllabusContext
      ? `Official ${exam.toUpperCase()} ${subject} syllabus:\n${syllabusContext}\n\n`
      : '';

    const userMessage =
      `${syllabusSection}` +
      `Create a ${weeksAvailable}-week study curriculum for ${subject} (${exam.toUpperCase()}).\n\n` +
      `Return a JSON object with this exact structure:\n` +
      `{\n` +
      `  "subject": "${subject}",\n` +
      `  "exam": "${exam}",\n` +
      `  "totalWeeks": ${weeksAvailable},\n` +
      `  "weeks": [\n` +
      `    {\n` +
      `      "week": 1,\n` +
      `      "focus": "chapter name",\n` +
      `      "topics": ["topic 1", "topic 2"],\n` +
      `      "dailyTarget": "2 topics/day",\n` +
      `      "revisionDay": "Sunday"\n` +
      `    }\n` +
      `  ]\n` +
      `}\n\n` +
      `Return ONLY valid JSON. No explanation.`;

    const raw = await this.prompt(userMessage, systemPrompt, { temperature: 0.3, maxTokens: 2048 });

    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      this.logger.warn('Curriculum JSON parse failed — returning raw text');
      return { raw, subject, exam, error: 'JSON parse failed' };
    }
  }

  // ── Health check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ status: string; model: string; url: string; error?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);

      const res = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { status: 'error', model: this.model, url: this.ollamaUrl, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as { models?: { name: string }[] };
      const models = data?.models?.map((m) => m.name) ?? [];
      const modelLoaded = models.some((m) => m.startsWith(this.model.split(':')[0]));

      return {
        status: 'ok',
        model: this.model,
        url: this.ollamaUrl,
        ...(!modelLoaded && { warning: `Model ${this.model} not found. Run: ollama pull ${this.model}` }),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'error', model: this.model, url: this.ollamaUrl, error: msg };
    }
  }
}
