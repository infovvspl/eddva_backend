import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolAssessmentService {
  private schemaReady = false;
  private submissionSchemaReady = false;
  private resultSchemaReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly aiBridge: AiBridgeService,
  ) { }

  async translateText(user: any, text: string, language: string) {
    const instituteId = user?.instituteId;
    if (!text || !text.trim() || !language || language === 'en') {
      return { success: true, data: { translatedText: text } };
    }
    try {
      const res = (await this.aiBridge.translateText(
        { text, targetLanguage: language },
        instituteId,
      )) as any;
      const translated = res?.translatedText ?? res?.text ?? res?.translation ?? text;
      return { success: true, data: { translatedText: translated } };
    } catch (err) {
      throw new ServiceUnavailableException('Translation service is temporarily unavailable');
    }
  }

  private async ensureAssessmentContentColumns() {
    if (this.schemaReady) return;
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS content_text TEXT NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS content_source VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS file_path VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS chapter_id UUID NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS topic_id UUID NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS answer_key TEXT NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS language VARCHAR NULL DEFAULT 'en'`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS questions_json JSONB NULL`);
    this.schemaReady = true;
  }

  private async ensureAssessmentSubmissionSchema() {
    if (this.submissionSchemaReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS assessment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assessment_id UUID NOT NULL,
        student_user_id UUID NOT NULL,
        answer_text TEXT NULL,
        file_path VARCHAR NULL,
        status VARCHAR NOT NULL DEFAULT 'submitted',
        started_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (assessment_id, student_user_id)
      )
    `);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS answers_json JSONB NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS objective_score NUMERIC(6,2) NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS objective_total NUMERIC(6,2) NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS grading_details JSONB NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS grading_status VARCHAR NULL`);
    this.submissionSchemaReady = true;
  }

  private async ensureResultSchema() {
    if (this.resultSchemaReady) return;
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS total_marks NUMERIC(5,2) NOT NULL DEFAULT 100`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2) NOT NULL DEFAULT 0`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT false`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS grade VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS remarks VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'published'`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await this.ds.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_results_assessment_student ON results (assessment_id, student_id)`);
    this.resultSchemaReady = true;
  }

  private deriveTitle(content: string, fallback: string): string {
    const line = String(content || '').split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return fallback;
    const stripped = line.replace(/^#+\s*/, '').slice(0, 120);
    return stripped.length > 80 ? `${stripped.slice(0, 77)}...` : stripped;
  }

  private normalizeQuestions(input: any): any[] {
    if (!input) return [];
    if (Array.isArray(input)) return input.filter(Boolean);
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private stripCorrectAnswersFromQuestions(questions: any[]) {
    return this.normalizeQuestions(questions).map((question: any) => {
      const {
        correctAnswer: _correctAnswer,
        correct_answer: _correct_answer,
        explanation: _explanation,
        ...safeQuestion
      } = question;
      return safeQuestion;
    });
  }

  private hasInlineMcqOptions(text: string) {
    return Array.from(String(text || '').matchAll(/\(([a-dA-D])\)\s*/g)).length >= 2;
  }

  private sectionLetter(title: string) {
    return String(title || '').match(/section\s+([A-E])/i)?.[1]?.toUpperCase()
      || String(title || '').match(/[-–]\s*([A-E])\b/i)?.[1]?.toUpperCase()
      || String(title || '').match(/\b([A-E])\b/)?.[1]?.toUpperCase()
      || '';
  }

  private isInstructionLikeText(text: string) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) return true;
    return /^(read|write|use|do not|answer|attempt|follow|choose|fill|tick|select)\b/.test(normalized)
      || normalized.includes('general instruction')
      || normalized.includes('question paper consists')
      || normalized.includes('follow the instructions')
      || normalized.includes('space provided');
  }

  private parsedQuestionsNeedRefresh(questions: any[]) {
    return this.normalizeQuestions(questions).some((question: any) => {
      const type = question.type || 'short_answer';
      const sectionLetter = this.sectionLetter(question.sectionTitle || question.section || '');
      return this.isInstructionLikeText(question.text)
        || (sectionLetter === 'A' && type !== 'mcq_single')
        || (type !== 'mcq_single' && this.hasInlineMcqOptions(question.text));
    });
  }

  private async hydrateQuestions(row: any) {
    if (!row) return row;
    const existing = this.normalizeQuestions(row.questions_json);
    if (existing.length) {
      const objectiveMissingAnswers = existing.some((question: any) => {
        const type = question.type || 'short_answer';
        const correctAnswer = question.correctAnswer ?? question.correct_answer;
        return this.objectiveTypes.has(type) && (correctAnswer === undefined || correctAnswer === null || correctAnswer === '');
      });
      const answerKeyHasExplanations = /\b(?:explanation|reason)\s*[:\-]/i.test(String(row.answer_key || ''));
      const objectiveMissingExplanations = answerKeyHasExplanations && existing.some((question: any) => {
        const type = question.type || 'short_answer';
        return this.objectiveTypes.has(type) && !question.explanation;
      });
      const missingOrderMetadata = existing.some((question: any) => question.sectionTitle === undefined || question.sourceIndex === undefined);
      if ((objectiveMissingAnswers && row.answer_key) || objectiveMissingExplanations || missingOrderMetadata || this.parsedQuestionsNeedRefresh(existing)) {
        const reparsed = this.parseQuestionsFromMarkdown(row.content_text || '', row.answer_key || '');
        if (reparsed.length) {
          row.questions_json = reparsed;
          try {
            await this.ds.query(
              `UPDATE assessments SET questions_json=$2::jsonb WHERE id::text=$1::text`,
              [row.id, JSON.stringify(reparsed)],
            );
          } catch {
            // Non-critical: the current response can still use the reparsed questions.
          }
          return row;
        }
      }
      row.questions_json = existing;
      return row;
    }
    const parsed = this.parseQuestionsFromMarkdown(row.content_text || '', row.answer_key || '');
    row.questions_json = parsed;
    if (parsed.length && row.id) {
      try {
        await this.ds.query(
          `UPDATE assessments SET questions_json=$2::jsonb WHERE id::text=$1::text AND questions_json IS NULL`,
          [row.id, JSON.stringify(parsed)],
        );
      } catch {
        // Non-critical: the current response can still use the parsed questions.
      }
    }
    return row;
  }

  private parseAnswerMap(answerKeyText: string): Map<number, string> {
    const detailMap = this.parseAnswerDetailMap(answerKeyText);
    return new Map(Array.from(detailMap.entries()).map(([key, detail]) => [key, detail.answer]));
  }

  private parseAnswerDetailMap(answerKeyText: string): Map<number, { answer: string; explanation?: string }> {
    const answerMap = new Map<number, string>();
    const explanationMap = new Map<number, string>();
    const cleanAnswer = (raw: string) => {
      const trimmed = raw
        .replace(/^(?:answer|ans|correct)\s*[:\-]\s*/i, '')
        .replace(/^[=:–—-]\s*/, '')
        .trim();
      const option = trimmed.match(/^\(?([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)?(?:[.)\s]|$)/)?.[1];
      if (option) return this.normalizeOptionId(option);
      const tf = trimmed.match(/^(true|false|t|f)\b/i)?.[1]?.toLowerCase();
      if (tf) return tf === 't' ? 'true' : tf === 'f' ? 'false' : tf;
      if (/^(सत्य|सही|ठीक|ଠିକ|ସତ୍ୟ)\b/i.test(trimmed)) return 'true';
      if (/^(असत्य|गलत|मिथ्या|ଭୁଲ|ମିଥ୍ୟା)\b/i.test(trimmed)) return 'false';
      return trimmed;
    };

    const answerText = String(answerKeyText || '')
      .replace(/\r/g, '\n')
      .replace(/\s+(?=(?:[-*]\s*)?\d{1,2}[.)]\s*(?:answer|ans)\b)/gi, '\n')
      .replace(/\s+(?=(?:Section\s+[A-E]\s*[-:–—]?\s*)?Q\.?\s*\d{1,2}\b)/gi, '\n');

    let sequence = 0;
    let currentSequence = 0;
    for (const line of answerText.split(/\n+/)) {
      const match = line.match(/^\s*(?:[-*]\s*)?(?:(?:Section\s+[A-E])\s*[-:–—]?\s*)?(?:(?:(?:Q|Question)\.?\s*(\d{1,2}))|(\d{1,2})[.)]?\s*(?:answer|ans)\b)[.)]?\s*(?:answer|ans)?\s*[:\-]?\s*(.+)$/i);
      if (match) {
        sequence += 1;
        currentSequence = sequence;
        const displayNumber = Number(match[1] || match[2]);
        const rawAnswer = match[3].replace(/\b(?:explanation|reason)\s*[:\-].*$/i, '').trim();
        const answer = cleanAnswer(rawAnswer);
        answerMap.set(sequence, answer);
        if (!answerMap.has(displayNumber)) answerMap.set(displayNumber, answer);

        const inlineExplanation = match[3].match(/\b(?:explanation|reason)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
        if (inlineExplanation) explanationMap.set(sequence, inlineExplanation);
        continue;
      }

      const explanation = line.match(/^\s*(?:explanation|reason)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
      if (explanation && currentSequence) {
        explanationMap.set(currentSequence, explanation);
        continue;
      }

      if (currentSequence && explanationMap.has(currentSequence) && line.trim()) {
        explanationMap.set(currentSequence, `${explanationMap.get(currentSequence)} ${line.trim()}`);
      }
    }

    const detailMap = new Map<number, { answer: string; explanation?: string }>();
    answerMap.forEach((answer, key) => {
      detailMap.set(key, { answer, explanation: explanationMap.get(key) });
    });
    return detailMap;
  }

  private normalizeOptionId(label: string) {
    const map: Record<string, string> = {
      a: 'a', b: 'b', c: 'c', d: 'd',
      'क': 'a', 'ख': 'b', 'ग': 'c', 'घ': 'd',
      'କ': 'a', 'ଖ': 'b', 'ଗ': 'c', 'ଘ': 'd',
    };
    return map[String(label || '').trim().toLowerCase()] || String(label || '').trim().toLowerCase();
  }

  private rebuildAnswerKeyWithSections(contentText: string | null, answerKey: string | null) {
    const original = String(answerKey || '').trim();
    if (!String(contentText || '').trim() || !original) return original;

    const questions = this.parseQuestionsFromMarkdown(contentText || '', original)
      .filter((question: any) => this.objectiveTypes.has(question.type) && question.correctAnswer);
    if (!questions.length) return original;

    const groups = new Map<string, any[]>();
    for (const question of questions) {
      const sectionTitle = String(question.sectionTitle || 'Section A').replace(/^#+\s*/, '').trim();
      if (!groups.has(sectionTitle)) groups.set(sectionTitle, []);
      groups.get(sectionTitle)!.push(question);
    }

    const lines = ['## Answer Key'];
    groups.forEach((groupQuestions, sectionTitle) => {
      lines.push('', `### ${sectionTitle}`);
      groupQuestions.forEach((question: any) => {
        lines.push(`Q${question.displayNumber || question.number}. Answer: ${question.correctAnswer}`);
        if (question.explanation) {
          lines.push(`Explanation: ${question.explanation}`);
        }
      });
    });
    return lines.join('\n').trim();
  }

  private parseQuestionsFromMarkdown(content: string, answerKey = ''): any[] {
    const text = answerKey
      ? `${String(content || '')}\n\n## Answer Key\n${String(answerKey || '')}`
      : String(content || '');
    if (!text.trim()) return [];

    const answerKeyStart = text.search(/^##\s*Answer Key/im);
    let answerMap = new Map<number, string>();
    let answerDetailMap = new Map<number, { answer: string; explanation?: string }>();
    if (answerKeyStart >= 0) {
      const answerText = text.slice(answerKeyStart);
      answerDetailMap = this.parseAnswerDetailMap(answerText);
      answerMap = new Map(Array.from(answerDetailMap.entries()).map(([key, detail]) => [key, detail.answer]));
    }

    const questionText = answerKeyStart >= 0 ? text.slice(0, answerKeyStart) : text;
    const inlineQuestions = this.parseInlineQuestionPaper(questionText, answerMap, answerDetailMap);
    if (inlineQuestions.length >= 2) return inlineQuestions;

    const lines = questionText.split(/\r?\n/);
    const questions: any[] = [];
    let section = '';
    let current: any = null;

    const finishCurrent = () => {
      if (!current) return;
      current.text = String(current.text || '').trim();
      if (!current.text) {
        current = null;
        return;
      }
      if (answerMap.has(current.number)) {
        current.correctAnswer = answerMap.get(current.number);
      }
      questions.push(current);
      current = null;
    };

    const sectionType = () => {
      const lower = section.toLowerCase();
      if (lower.includes('multiple') || lower.includes('mcq')) return { type: 'mcq_single', marks: 1 };
      if (lower.includes('true') || lower.includes('false')) return { type: 'true_false', marks: 1 };
      if (lower.includes('fill')) return { type: 'fill_blank', marks: 1 };
      if (lower.includes('long')) return { type: 'long_answer', marks: 5 };
      if (lower.includes('short')) return { type: 'short_answer', marks: 3 };
      const letter = this.sectionLetter(section);
      if (letter === 'A') return { type: 'mcq_single', marks: 1 };
      if (letter === 'B') return { type: 'true_false', marks: 1 };
      if (letter === 'C') return { type: 'fill_blank', marks: 1 };
      if (letter === 'D') return { type: 'short_answer', marks: 3 };
      if (letter === 'E') return { type: 'long_answer', marks: 5 };
      return { type: 'short_answer', marks: 1 };
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^#{1,4}\s*/.test(line) || /^section\s+[a-z]/i.test(line)) {
        finishCurrent();
        section = line.replace(/^#+\s*/, '');
        continue;
      }
      const option = line.match(/^\(?([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)?[.)]?\s+(.+)$/);
      if (current?.type === 'mcq_single' && option) {
        current.options.push({ id: this.normalizeOptionId(option[1]), label: option[1], text: option[2].trim() });
        continue;
      }
      const qMatch = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
      if (qMatch) {
        if (!this.sectionLetter(section) || this.isInstructionLikeText(qMatch[2])) continue;
        finishCurrent();
        const spec = sectionType();
        const displayNumber = Number(qMatch[1]);
        const sequenceNumber = questions.length + 1;
        let questionBody = qMatch[2].trim();
        const inlineOptions: any[] = [];
        const optionMatches = Array.from(questionBody.matchAll(/\(([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)\s*/g));
        if (optionMatches.length >= 2) {
          const questionEnd = optionMatches[0].index || 0;
          const questionText = questionBody.slice(0, questionEnd).trim();
          optionMatches.forEach((optionMatch, optionIndex) => {
            const optionStart = (optionMatch.index || 0) + optionMatch[0].length;
            const optionEnd = optionIndex + 1 < optionMatches.length ? optionMatches[optionIndex + 1].index || questionBody.length : questionBody.length;
            const optionText = questionBody.slice(optionStart, optionEnd).trim();
            if (optionText) inlineOptions.push({ id: this.normalizeOptionId(optionMatch[1]), label: optionMatch[1], text: optionText });
          });
          questionBody = questionText || questionBody;
        }
        const finalSpec = inlineOptions.length ? { type: 'mcq_single', marks: 1 } : spec;
        current = {
          id: `q-${sequenceNumber}`,
          number: sequenceNumber,
          displayNumber,
          sectionTitle: section || null,
          sourceIndex: sequenceNumber - 1,
          type: finalSpec.type,
          text: questionBody,
          marks: finalSpec.marks,
          options: finalSpec.type === 'mcq_single' ? inlineOptions : undefined,
          correctAnswer: answerMap.get(sequenceNumber),
          explanation: this.objectiveTypes.has(finalSpec.type) ? answerDetailMap.get(sequenceNumber)?.explanation : undefined,
        };
        continue;
      }
      if (current) current.text = `${current.text}\n${line}`;
    }
    finishCurrent();

    return questions.map((q, index) => ({
      id: q.id || `q-${index + 1}`,
      number: q.number || index + 1,
      displayNumber: q.displayNumber || q.number || index + 1,
      sectionTitle: q.sectionTitle || q.section || null,
      sourceIndex: Number.isFinite(Number(q.sourceIndex)) ? Number(q.sourceIndex) : index,
      type: q.type || 'short_answer',
      text: q.text,
      marks: Number(q.marks || 1),
      options: Array.isArray(q.options) && q.options.length ? q.options : undefined,
      correctAnswer: q.correctAnswer,
      explanation: this.objectiveTypes.has(q.type || 'short_answer') ? q.explanation : undefined,
    }));
  }

  private parseInlineQuestionPaper(
    content: string,
    answerMap: Map<number, string>,
    answerDetailMap = new Map<number, { answer: string; explanation?: string }>(),
  ): any[] {
    const rawNormalized = String(content || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const firstQuestionSection = rawNormalized.search(/\bSection\s+A\b/i);
    const normalized = firstQuestionSection >= 0 ? rawNormalized.slice(firstQuestionSection).trim() : rawNormalized;
    if (!normalized) return [];

    const sectionPattern = /(##\s*)?(Section\s+[A-E]|ବିଭାଗ\s*[-–]?\s*[A-E])/gi;
    const sectionMatches = Array.from(normalized.matchAll(sectionPattern));
    const sections = sectionMatches.length
      ? sectionMatches.map((match, index) => ({
        title: match[2] || match[0],
        start: match.index || 0,
        end: index + 1 < sectionMatches.length ? sectionMatches[index + 1].index || normalized.length : normalized.length,
      }))
      : [{ title: '', start: 0, end: normalized.length }];

    const questions: any[] = [];
    const sectionSpec = (title: string) => {
      const letter = this.sectionLetter(title)
        || title.match(/[-–]\s*([A-E])\b/i)?.[1]?.toUpperCase()
        || title.match(/\b([A-E])\b/)?.[1]?.toUpperCase();
      if (letter === 'A') return { type: 'mcq_single', marks: 1 };
      if (letter === 'B') return { type: 'true_false', marks: 1 };
      if (letter === 'C') return { type: 'fill_blank', marks: 1 };
      if (letter === 'D') return { type: 'short_answer', marks: 3 };
      if (letter === 'E') return { type: 'long_answer', marks: 5 };
      return { type: 'short_answer', marks: 1 };
    };

    for (const section of sections) {
      const body = normalized.slice(section.start, section.end).replace(section.title, ' ').trim();
      const spec = sectionSpec(section.title);
      const matches = Array.from(body.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+/g));
      if (!matches.length) continue;

      matches.forEach((match, index) => {
        const start = (match.index || 0) + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index || body.length : body.length;
        let raw = body.slice(start, end).trim();
        if (raw.length < 8) return;
        if (this.isInstructionLikeText(raw)) return;

        const sequenceNumber = questions.length + 1;
        const displayNumber = Number(match[1]);
        const options: any[] = [];
        const optionMatches = Array.from(raw.matchAll(/\(([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)\s*/g));
        if (optionMatches.length >= 2) {
          const questionEnd = optionMatches[0].index || 0;
          const questionText = raw.slice(0, questionEnd).trim();
          optionMatches.forEach((optionMatch, optionIndex) => {
            const optionStart = (optionMatch.index || 0) + optionMatch[0].length;
            const optionEnd = optionIndex + 1 < optionMatches.length ? optionMatches[optionIndex + 1].index || raw.length : raw.length;
            const optionText = raw.slice(optionStart, optionEnd).trim();
            if (optionText) options.push({ id: this.normalizeOptionId(optionMatch[1]), label: optionMatch[1], text: optionText });
          });
          raw = questionText || raw;
        }
        const finalSpec = options.length ? { type: 'mcq_single', marks: 1 } : spec;

        questions.push({
          id: `q-${sequenceNumber}`,
          number: sequenceNumber,
          displayNumber,
          sectionTitle: section.title || null,
          sourceIndex: sequenceNumber - 1,
          type: finalSpec.type,
          text: raw,
          marks: finalSpec.marks,
          options: options.length ? options : undefined,
          correctAnswer: answerMap.get(sequenceNumber),
          explanation: this.objectiveTypes.has(finalSpec.type) ? answerDetailMap.get(sequenceNumber)?.explanation : undefined,
        });
      });
    }

    return questions;
  }

  private objectiveTypes = new Set(['mcq_single', 'true_false', 'fill_blank', 'integer']);

  private normalizeAnswer(value: any): string {
    if (Array.isArray(value)) return value.map((v) => this.normalizeAnswer(v)).sort().join(',');
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[।.,;:!?()[\]{}"']/g, '')
      .replace(/\s+/g, ' ');
  }

  private gradeObjective(questions: any[], answers: Record<string, any>) {
    let score = 0;
    let total = 0;
    let writtenPending = false;
    const details = questions.map((question: any) => {
      const type = question.type || 'short_answer';
      const marks = Number(question.marks || 1);
      const answer = answers?.[question.id];
      const correctAnswer = question.correctAnswer ?? question.correct_answer;
      if (!this.objectiveTypes.has(type) || correctAnswer === undefined || correctAnswer === null || correctAnswer === '') {
        writtenPending = true;
        return { questionId: question.id, status: 'pending', marks: 0, total: marks };
      }
      total += marks;
      const isCorrect = this.normalizeAnswer(answer) === this.normalizeAnswer(correctAnswer);
      const marksAwarded = isCorrect ? marks : 0;
      score += marksAwarded;
      return {
        questionId: question.id,
        status: isCorrect ? 'correct' : 'wrong',
        marks: marksAwarded,
        total: marks,
        correctAnswer,
        explanation: question.explanation,
      };
    });
    return { score, total, writtenPending, details };
  }

  async list(user: any, query: any) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();
    const params: any[] = [];
    const filters: string[] = [];

    if (user.role === 'STUDENT') {
      const profileRows: any[] = await this.ds.query(
        `SELECT sec.class_id
         FROM students s
         LEFT JOIN sections sec ON s.section_id::text = sec.id::text
         WHERE s.user_id::text = $1::text`,
        [user.id],
      );
      const classId = profileRows[0]?.class_id;
      if (!classId) return { success: true, data: [] };
      params.push(classId);
      filters.push(`a.class_id::text=$${params.length}::text`);
    } else if (query.classId) {
      params.push(query.classId);
      filters.push(`a.class_id::text=$${params.length}::text`);
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      filters.push(`a.subject_id::text=$${params.length}::text`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const sql = `
      SELECT a.*, c.name AS class_name, sub.name AS subject_name,
             ch.name AS chapter_name, t.name AS topic_name
      FROM assessments a
      LEFT JOIN classes c ON a.class_id::text = c.id::text
      LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text
      LEFT JOIN chapters ch ON a.chapter_id::text = ch.id::text
      LEFT JOIN topics t ON a.topic_id::text = t.id::text
      ${where}
      ORDER BY a.scheduled_date DESC NULLS LAST, a.created_at DESC
    `;
    const rows: any[] = await this.ds.query(sql, params);
    rows.forEach((row: any) => this.parseAndSplitLegacyAssessment(row));
    if (user.role === 'STUDENT' && rows.length) {
      const submissionRows: any[] = await this.ds.query(
        `SELECT * FROM assessment_submissions WHERE student_user_id::text=$1::text`,
        [user.id],
      );
      const submissionMap = new Map(submissionRows.map((row: any) => [String(row.assessment_id), row]));
      rows.forEach((row: any) => {
        row.mySubmission = submissionMap.get(String(row.id)) || null;
      });
    }
    return { success: true, data: rows.map((row: any) => this.stripAnswerKeyForStudent(user, row)) };
  }

  private stripAnswerKeyForStudent(user: any, row: any) {
    if (user?.role === 'STUDENT') {
      const { answer_key: _ak, ...rest } = row;
      if (rest.questions_json) {
        rest.questions_json = this.stripCorrectAnswersFromQuestions(rest.questions_json);
      }
      return rest;
    }
    return row;
  }

  private splitContentAndAnswerKey(contentText: string | null, answerKey: string | null) {
    let q = (contentText || '').trim();
    let a = (answerKey || '').trim();
    if (q) {
      const match = q.match(/^(?:#+\s*|\*\*|__)?\s*(?:\*\*|__|\*)?\s*(?:Answer\s*Key|Answers|Ans\s*Key|Grading\s*Key|उत्तर\s*कुंजी|ଉତ୍ତର\s*ସୂଚୀ|ଉତ୍ତର|ଉତ୍ତରସୂଚୀ)\s*(?:\*\*|__|\*)?[\s*:]*$/im);
      if (match && match.index !== undefined) {
        const extractedKey = q.slice(match.index).trim();
        q = q.slice(0, match.index).trimEnd();
        if (!a) {
          a = extractedKey;
        }
      }
    }
    return {
      contentText: q || null,
      answerKey: a || null,
    };
  }

  private parseAndSplitLegacyAssessment(row: any) {
    if (!row) return row;
    const { contentText, answerKey } = this.splitContentAndAnswerKey(row.content_text, row.answer_key);
    row.content_text = contentText;
    row.answer_key = answerKey;
    return row;
  }

  async legacyMockTests(user: any, query: any) {
    const response = await this.list(user, query);
    const rows = (response.data || []).filter((row: any) => {
      if (!query.status || query.status === 'published') {
        return row.status !== 'draft';
      }
      return row.status === query.status;
    });
    return {
      success: true,
      data: rows.map((row: any) => ({
        ...row,
        description: row.content_text || '',
        durationMinutes: row.duration_minutes,
        totalMarks: row.total_marks,
        questions: this.normalizeQuestions(row.questions_json),
      })),
    };
  }

  async aiGenerateDraft(user: any, body: any) {
    const instituteId = user.instituteId || body.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID is required');
    const subjectName = body.subjectName || 'General';
    const className = body.className || 'Class';
    const chapterName = (body.chapterName || '').trim();
    const topicName = (body.topicName || '').trim();
    const testType = body.type || body.assessmentType || 'topic';
    const difficulty = body.difficulty || 'intermediate';
    const totalMarks = body.totalMarks || body.total_marks || 100;
    const duration = body.durationMinutes || body.duration_minutes || 60;
    const language = (body.language || 'en').toLowerCase();

    // Human-readable language name for the prompt
    const languageNames: Record<string, string> = {
      en: 'English', hi: 'Hindi', od: 'Odia',
    };
    const languageName = languageNames[language] || 'English';

    const n = (v: any, d: number) => {
      const x = parseInt(v, 10);
      return Number.isFinite(x) && x >= 0 ? x : d;
    };
    const mcq = n(body.mcqCount, 5);
    const trueFalse = n(body.trueFalseCount, 5);
    const fillBlank = n(body.fillBlankCount, 5);
    const shortAns = n(body.shortCount, 3);
    const longAns = n(body.longCount, 2);

    const sections: string[] = [];
    if (mcq > 0) sections.push(`- Section A — Multiple Choice Questions: exactly ${mcq} questions, each with four options labelled (a), (b), (c), (d) and exactly one correct option. 1 mark each.`);
    if (trueFalse > 0) sections.push(`- Section B — True or False: exactly ${trueFalse} statements. 1 mark each.`);
    if (fillBlank > 0) sections.push(`- Section C — Fill in the Blanks: exactly ${fillBlank} questions, each containing a blank shown as "______". 1 mark each.`);
    if (shortAns > 0) sections.push(`- Section D — Short Answer: exactly ${shortAns} questions. 3 marks each.`);
    if (longAns > 0) sections.push(`- Section E — Long Answer: exactly ${longAns} questions. 5 marks each.`);
    if (sections.length === 0) sections.push(`- Section A — Multiple Choice Questions: exactly 10 questions, four options (a)-(d), one correct. 1 mark each.`);

    const scopeLine = topicName
      ? `IMPORTANT SCOPE: Generate questions ONLY about the topic "${topicName}"${chapterName ? ` (from chapter "${chapterName}")` : ''}. Every question must relate to this topic.`
      : chapterName
        ? `IMPORTANT SCOPE: Generate questions ONLY from the chapter "${chapterName}". Every question must relate to this chapter.`
        : '';

    const extraContext = [
      `LANGUAGE: Write the ENTIRE question paper in English. Every word — questions, instructions, options, section headings, and the answer key — must be in English only.`,
      `Produce a COMPLETE school examination QUESTION PAPER in clean Markdown — this is an exam paper, NOT lesson notes or an explanation.`,
      `Class: ${className}. Subject: ${subjectName}. Assessment type: ${testType}. Difficulty: ${difficulty}. Maximum Marks: ${totalMarks}. Time Allowed: ${duration} minutes.`,
      scopeLine,
      `Begin with a paper header (Subject, Class, Maximum Marks, Time Allowed) and a brief "General Instructions" list.`,
      `Include ONLY these sections, in this order, each with a clear section heading and the EXACT number of questions specified:`,
      ...sections,
      `Number questions clearly inside each section. The visible question numbers in the answer key must match the visible question numbers in the paper for that same section.`,
      `At the very END, add a "## Answer Key" section with correct answers ONLY for objective sections: MCQ, True/False, Fill in the Blanks. Do NOT include Short Answer or Long Answer questions in the answer key.`,
      `The answer key MUST mirror the question paper structure exactly: use the same section headings and list answers under each section in the same order as the questions appear.`,
      `Use this answer key format exactly:
## Answer Key
### Section A
Q1. Answer: a
Explanation: ...
Q2. Answer: c
Explanation: ...
### Section B
Q1. Answer: true
Explanation: ...
### Section C
Q1. Answer: expected word or phrase
Explanation: ...
Do not write answers as one flat paragraph. Do not mix answers from different sections.`,
      body.prompt?.trim() ? `Additional teacher instructions: ${body.prompt.trim()}` : '',
      `Output ONLY the Markdown question paper.`,
    ].filter(Boolean).join('\n');

    try {
      const result = await this.aiBridge.generateTopicContent(
        {
          topicName: topicName || `${subjectName} ${testType} assessment`,
          subjectName,
          chapterName: chapterName || className,
          // Unknown content type → falls back to the generic template; the
          // detailed extraContext above fully drives the exam-paper structure.
          contentType: 'assessment_paper',
          difficulty,
          length: 'detailed',
          extraContext,
        },
        instituteId,
        'school',
      );
      const content = result.content || '';

      // Split the AI-generated paper at the Answer Key heading so the two
      // parts can be stored and edited independently.
      const splitResult = this.splitContentAndAnswerKey(content, '');
      let questionsPart = splitResult.contentText || content;
      let answerKeyPart = splitResult.answerKey || '';

      if (language !== 'en') {
        try {
          if (questionsPart.trim()) {
            const transQ = (await this.aiBridge.translateText(
              { text: questionsPart, targetLanguage: language },
              instituteId,
            )) as any;
            questionsPart = transQ?.translatedText ?? transQ?.text ?? transQ?.translation ?? questionsPart;
          }
          if (answerKeyPart.trim()) {
            const transA = (await this.aiBridge.translateText(
              { text: answerKeyPart, targetLanguage: language },
              instituteId,
            )) as any;
            answerKeyPart = transA?.translatedText ?? transA?.text ?? transA?.translation ?? answerKeyPart;
          }
        } catch (transErr) {
          console.error('Failed to translate assessment parts:', transErr);
        }
      }

      answerKeyPart = this.rebuildAnswerKeyWithSections(questionsPart, answerKeyPart);

      return {
        success: true,
        data: {
          title: body.title?.trim() || this.deriveTitle(questionsPart, `${subjectName} ${testType} test`),
          contentText: questionsPart,
          answerKey: answerKeyPart,
        },
      };
    } catch {
      throw new ServiceUnavailableException('AI is temporarily unavailable. Please use manual entry or upload.');
    }
  }

  async create(user: any, body: any, file?: Express.Multer.File) {
    await this.ensureAssessmentContentColumns();
    const classId = body.classId || body.class_id || null;
    const sectionId = body.sectionId || body.section_id || null;
    const rawContentText = body.contentText || body.content_text || body.instructions || null;
    const rawAnswerKey = body.answerKey || body.answer_key || null;
    const { contentText, answerKey: splitAnswerKey } = this.splitContentAndAnswerKey(rawContentText, rawAnswerKey);
    const answerKey = this.rebuildAnswerKeyWithSections(contentText, splitAnswerKey);
    const questionsJson = this.parseQuestionsFromMarkdown(contentText || '', answerKey || '');
    const filePath = file ? file.path.replace(/\\/g, '/') : (body.filePath || body.file_path || null);
    const contentSource = filePath ? 'upload' : contentText ? (body.contentSource || body.content_source || 'manual') : 'metadata';
    const title = String(body.title || '').trim() || this.deriveTitle(contentText || '', '');
    if (!title) {
      throw new BadRequestException('Assessment title is required');
    }
    const rows: any[] = await this.ds.query(
      `INSERT INTO assessments
        (title, type, subject_id, class_id, total_marks, duration_minutes, scheduled_date, status, content_text, content_source, file_path, chapter_id, topic_id, answer_key, language, questions_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING *`,
      [
        title,
        body.assessmentType || body.type || 'exam',
        body.subjectId || body.subject_id || null,
        classId,
        body.totalMarks || body.total_marks || 100,
        body.durationMinutes || body.duration_minutes || 60,
        body.scheduledAt || body.scheduledDate || body.scheduled_date
          ? new Date(body.scheduledAt || body.scheduledDate || body.scheduled_date)
          : null,
        body.status || 'scheduled',
        contentText,
        contentSource,
        filePath,
        body.chapterId || body.chapter_id || null,
        body.topicId || body.topic_id || null,
        answerKey,
        body.language || 'en',
        questionsJson.length ? JSON.stringify(questionsJson) : null,
      ],
    );
    const assessment = rows[0];

    // Notify students
    try {
      if (classId) {
        const studentUsers = await this.ds.query(
          `SELECT s.user_id FROM students s
           JOIN sections sec ON s.section_id::text = sec.id::text
           WHERE sec.class_id::text = $1`,
          [classId]
        );

        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'assessment',
            title: 'New Assessment Available',
            message: `${body.title} is now available.`,
            actionUrl: '/school/student/assessments',
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send assessment notifications:', notifErr);
    }

    return { success: true, data: assessment };
  }

  async findOne(user: any, id: string) {
    await this.ensureAssessmentContentColumns();
    const rows: any[] = await this.ds.query(`SELECT * FROM assessments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assessment not found');
    const row = this.parseAndSplitLegacyAssessment(rows[0]);
    await this.hydrateQuestions(row);
    return { success: true, data: this.stripAnswerKeyForStudent(user, row) };
  }

  async update(id: string, body: any) {
    await this.ensureAssessmentContentColumns();
    const rawContentText = body.contentText || body.content_text || body.instructions || null;
    const rawAnswerKey = body.answerKey || body.answer_key || null;
    const { contentText, answerKey: splitAnswerKey } = this.splitContentAndAnswerKey(rawContentText, rawAnswerKey);
    const answerKey = this.rebuildAnswerKeyWithSections(contentText, splitAnswerKey);
    const questionsJson = contentText || answerKey
      ? this.parseQuestionsFromMarkdown(contentText || '', answerKey || '')
      : null;

    const rows: any[] = await this.ds.query(
      `UPDATE assessments
       SET title=COALESCE($2,title),
           type=COALESCE($3,type),
           total_marks=COALESCE($4,total_marks),
           duration_minutes=COALESCE($5,duration_minutes),
           status=COALESCE($6,status),
           scheduled_date=COALESCE($7,scheduled_date),
           content_text=COALESCE($8,content_text),
           content_source=COALESCE($9,content_source),
           file_path=COALESCE($10,file_path),
           answer_key=COALESCE($11,answer_key),
           language=COALESCE($12,language),
           questions_json=COALESCE($13::jsonb,questions_json)
       WHERE id=$1 RETURNING *`,
      [
        id,
        body.title || null,
        body.assessmentType || body.type || null,
        body.totalMarks || body.total_marks || null,
        body.durationMinutes || body.duration_minutes || null,
        body.status || null,
        body.scheduledAt || body.scheduledDate || body.scheduled_date
          ? new Date(body.scheduledAt || body.scheduledDate || body.scheduled_date)
          : null,
        contentText,
        body.contentSource || body.content_source || null,
        body.filePath || body.file_path || null,
        answerKey,
        body.language || null,
        questionsJson ? JSON.stringify(questionsJson) : null,
      ],
    );
    if (!rows.length) throw new NotFoundException('Assessment not found');
    const updated = rows[0];
    const refreshedQuestions = this.parseQuestionsFromMarkdown(updated.content_text || '', updated.answer_key || '');
    updated.questions_json = refreshedQuestions;
    await this.ds.query(
      `UPDATE assessments SET questions_json=$2::jsonb WHERE id::text=$1::text`,
      [id, refreshedQuestions.length ? JSON.stringify(refreshedQuestions) : null],
    );
    return { success: true, data: updated };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM assessment_submissions WHERE assessment_id::text=$1::text`, [id]);
    await this.ds.query(`DELETE FROM results WHERE assessment_id::text=$1::text`, [id]);
    await this.ds.query(`DELETE FROM assessments WHERE id::text=$1::text`, [id]);
    return { success: true };
  }


  async listResults(assessmentId: string) {
    await this.ensureAssessmentContentColumns();
    await this.ensureResultSchema();
    const rows: any[] = await this.ds.query(`SELECT r.*,u.name AS student_name FROM results r LEFT JOIN users u ON r.student_id=u.id WHERE r.assessment_id=$1`, [assessmentId]);
    return { success: true, data: rows };
  }

  async mySubmission(user: any, assessmentId: string) {
    await this.ensureAssessmentSubmissionSchema();
    const rows: any[] = await this.ds.query(
      `SELECT * FROM assessment_submissions
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       LIMIT 1`,
      [assessmentId, user.id],
    );
    return { success: true, data: rows[0] || null };
  }

  async startAttempt(user: any, assessmentId: string) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const assessmentRows: any[] = await this.ds.query(
      `SELECT id,title,duration_minutes,content_text,answer_key,questions_json FROM assessments WHERE id::text=$1::text`,
      [assessmentId],
    );
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const assessment = await this.hydrateQuestions(assessmentRows[0]);
    const durationMinutes = Math.max(1, Number(assessment.duration_minutes || 60));

    const existingRows: any[] = await this.ds.query(
      `SELECT * FROM assessment_submissions
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       LIMIT 1`,
      [assessmentId, user.id],
    );
    const existing = existingRows[0];
    if (existing?.status && existing.status !== 'in_progress') {
      return { success: true, data: existing };
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO assessment_submissions
        (assessment_id, student_user_id, status, started_at, expires_at, submitted_at)
       VALUES ($1,$2,'in_progress',NOW(),NOW() + ($3::int * INTERVAL '1 minute'),NOW())
       ON CONFLICT (assessment_id, student_user_id)
       DO UPDATE SET
        status=CASE
          WHEN assessment_submissions.status IN ('submitted','auto_submitted','graded') THEN assessment_submissions.status
          ELSE 'in_progress'
        END,
        started_at=COALESCE(assessment_submissions.started_at, NOW()),
        expires_at=COALESCE(assessment_submissions.expires_at, assessment_submissions.started_at + ($3::int * INTERVAL '1 minute'), NOW() + ($3::int * INTERVAL '1 minute')),
        updated_at=NOW()
       RETURNING *`,
      [assessmentId, user.id, durationMinutes],
    );
    return { success: true, data: { ...rows[0], questions: this.stripCorrectAnswersFromQuestions(assessment.questions_json || []) } };
  }

  async saveAnswer(user: any, assessmentId: string, body: any) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const attemptRes = await this.startAttempt(user, assessmentId);
    const attempt = attemptRes.data;
    if (attempt?.status && attempt.status !== 'in_progress') {
      throw new BadRequestException('This assessment has already been submitted');
    }
    if (attempt?.expires_at && new Date(attempt.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Time is over for this assessment');
    }

    const questionId = String(body.questionId || body.question_id || '').trim();
    if (!questionId) throw new BadRequestException('Question ID is required');
    const existingAnswers = typeof attempt.answers_json === 'object' && attempt.answers_json ? attempt.answers_json : {};
    const answers = { ...existingAnswers, [questionId]: body.answer ?? body.value ?? '' };
    const rows: any[] = await this.ds.query(
      `UPDATE assessment_submissions
       SET answers_json=$3::jsonb, updated_at=NOW()
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       RETURNING *`,
      [assessmentId, user.id, JSON.stringify(answers)],
    );
    return { success: true, data: rows[0] };
  }

  async submitAssessment(user: any, assessmentId: string, body: any, file?: Express.Multer.File) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const assessmentRows: any[] = await this.ds.query(`SELECT id,title,duration_minutes,total_marks,content_text,answer_key,questions_json FROM assessments WHERE id::text=$1::text`, [assessmentId]);
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const assessment = await this.hydrateQuestions(assessmentRows[0]);

    const answerText = String(body.answerText || body.answer_text || body.notes || '').trim();
    const submittedAnswers = body.answersJson || body.answers_json || body.answers;
    let bodyAnswers: Record<string, any> | null = null;
    if (submittedAnswers) {
      try {
        bodyAnswers = typeof submittedAnswers === 'string' ? JSON.parse(submittedAnswers || '{}') : submittedAnswers;
      } catch {
        throw new BadRequestException('Invalid answer format');
      }
    }
    const filePath = file ? file.path.replace(/\\/g, '/') : (body.filePath || body.file_path || null);
    const autoSubmit = body.autoSubmit === true || body.autoSubmit === 'true';
    if (!answerText && !filePath && !bodyAnswers && !autoSubmit) {
      throw new BadRequestException('Write an answer or upload a file');
    }

    const attemptRes = await this.startAttempt(user, assessmentId);
    const attempt = attemptRes.data;
    if (attempt?.status && attempt.status !== 'in_progress') {
      throw new BadRequestException('This assessment has already been submitted');
    }
    if (!autoSubmit && attempt?.expires_at && new Date(attempt.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Time is over for this assessment');
    }

    const existingAnswers = typeof attempt?.answers_json === 'object' && attempt.answers_json ? attempt.answers_json : {};
    const answers = bodyAnswers || existingAnswers;
    const questions = this.normalizeQuestions(assessment.questions_json);
    const grading = questions.length ? this.gradeObjective(questions, answers || {}) : null;
    const gradingStatus = grading
      ? grading.writtenPending
        ? 'objective_graded_pending_manual'
        : 'auto_graded'
      : null;

    const rows: any[] = await this.ds.query(
      `INSERT INTO assessment_submissions
        (assessment_id, student_user_id, answer_text, file_path, status, started_at, expires_at, completed_at, answers_json, objective_score, objective_total, grading_details, grading_status)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW() + ($6::int * INTERVAL '1 minute'),NOW(),$7::jsonb,$8,$9,$10::jsonb,$11)
       ON CONFLICT (assessment_id, student_user_id)
       DO UPDATE SET
        answer_text=EXCLUDED.answer_text,
        file_path=COALESCE(EXCLUDED.file_path, assessment_submissions.file_path),
        status=EXCLUDED.status,
        completed_at=NOW(),
        answers_json=COALESCE(EXCLUDED.answers_json, assessment_submissions.answers_json),
        objective_score=EXCLUDED.objective_score,
        objective_total=EXCLUDED.objective_total,
        grading_details=EXCLUDED.grading_details,
        grading_status=EXCLUDED.grading_status,
        submitted_at=NOW(),
        updated_at=NOW()
       RETURNING *`,
      [
        assessmentId,
        user.id,
        answerText || attempt?.answer_text || null,
        filePath,
        autoSubmit ? 'auto_submitted' : 'submitted',
        Math.max(1, Number(assessment.duration_minutes || 60)),
        answers ? JSON.stringify(answers) : null,
        grading ? grading.score : null,
        grading ? grading.total : null,
        grading ? JSON.stringify(grading.details) : null,
        gradingStatus,
      ],
    );

    if (grading && !grading.writtenPending) {
      const totalMarks = Number(assessment.total_marks || grading.total || 100);
      const marksObtained = grading.total > 0 ? Math.round((grading.score / grading.total) * totalMarks * 100) / 100 : 0;
      await this.saveResult({
        assessmentId,
        studentId: user.id,
        totalMarks,
        marksObtained,
        grade: marksObtained / Math.max(totalMarks, 1) >= 0.9 ? 'A+' : marksObtained / Math.max(totalMarks, 1) >= 0.75 ? 'A' : marksObtained / Math.max(totalMarks, 1) >= 0.6 ? 'B' : marksObtained / Math.max(totalMarks, 1) >= 0.4 ? 'C' : 'F',
        remarks: 'Auto-graded objective assessment',
      });
    }

    return { success: true, data: rows[0] };
  }

  async listSubmissions(assessmentId: string) {
    await this.ensureAssessmentSubmissionSchema();
    const rows: any[] = await this.ds.query(
      `SELECT
        sub.*,
        u.name AS student_name,
        s.roll_no AS roll_no,
        sec.name AS section_name
       FROM assessment_submissions sub
       LEFT JOIN users u ON sub.student_user_id::text = u.id::text
       LEFT JOIN students s ON s.user_id::text = sub.student_user_id::text
       LEFT JOIN sections sec ON s.section_id::text = sec.id::text
       WHERE sub.assessment_id::text=$1::text
       ORDER BY sub.submitted_at DESC`,
      [assessmentId],
    );
    return { success: true, data: rows };
  }

  async saveResult(body: any) {
    await this.ensureResultSchema();
    const assessmentRows: any[] = await this.ds.query(
      `SELECT title,total_marks FROM assessments WHERE id::text = $1::text`,
      [body.assessmentId],
    );
    const totalMarks = Number(body.totalMarks || body.total_marks || assessmentRows[0]?.total_marks || 100);
    const marksObtained = body.isAbsent ? 0 : Number(body.marksObtained || 0);
    const percentage = totalMarks ? Math.round((marksObtained / totalMarks) * 10000) / 100 : 0;
    const rows: any[] = await this.ds.query(
      `INSERT INTO results
        (assessment_id,student_id,total_marks,marks_obtained,percentage,is_absent,grade,remarks,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published')
       ON CONFLICT (assessment_id,student_id) DO UPDATE SET
        total_marks=EXCLUDED.total_marks,
        marks_obtained=EXCLUDED.marks_obtained,
        percentage=EXCLUDED.percentage,
        is_absent=EXCLUDED.is_absent,
        grade=EXCLUDED.grade,
        remarks=EXCLUDED.remarks,
        status='published',
        updated_at=NOW()
       RETURNING *`,
      [body.assessmentId, body.studentId, totalMarks, marksObtained, percentage, body.isAbsent || false, body.grade || null, body.remarks || null],
    );
    const result = rows[0];

    // Notify the student
    try {
      const assessmentTitle = assessmentRows[0]?.title || 'Assessment';

      await this.notificationService.create({
        recipientId: body.studentId,
        type: 'result',
        title: 'Result Published',
        message: `Your result for ${assessmentTitle} is available. Marks: ${body.marksObtained || 0}`,
        actionUrl: '/school/student/assessments',
      });
    } catch (notifErr) {
      console.error('Failed to send result notification:', notifErr);
    }

    return { success: true, data: result };
  }

  async listSessions(user: any) {
    const instituteId = user.instituteId;
    const page = Math.max(1, parseInt(user.query?.page) || 1);
    const limit = Math.max(1, parseInt(user.query?.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM test_sessions ts
      INNER JOIN students s ON ts.student_id = s.id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
      WHERE ts.tenant_id = $1 AND ts.deleted_at IS NULL
    `;
    const countResult = await this.ds.query(countSql, [instituteId]);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const rows = await this.ds.query(`
      SELECT 
        ts.id,
        ts.status,
        ts.total_score AS "totalScore",
        ts.accuracy,
        ts.correct_count AS "correctCount",
        ts.wrong_count AS "wrongCount",
        u.name AS "student_name",
        mt.title AS "mock_test_title"
      FROM test_sessions ts
      INNER JOIN students s ON ts.student_id = s.id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
      WHERE ts.tenant_id = $1 AND ts.deleted_at IS NULL
      ORDER BY ts.submitted_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, [instituteId, limit, offset]);

    const mapped = rows.map((r: any) => ({
      id: r.id,
      status: r.status,
      totalScore: r.totalScore,
      accuracy: r.accuracy,
      correctCount: r.correctCount,
      wrongCount: r.wrongCount,
      student: {
        user: {
          name: r.student_name
        }
      },
      mockTest: {
        title: r.mock_test_title
      }
    }));
    return { success: true, data: mapped, total, page, limit, totalPages };
  }
}