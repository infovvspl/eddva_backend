import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

type GameType = 'quiz_rush' | 'treasure_hunt' | 'math_sprint' | 'memory_match' | 'word_master';

@Injectable()
export class GamificationService implements OnModuleInit {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
  ) {}

  async onModuleInit() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS school_game_sessions (
        id uuid PRIMARY KEY,
        institute_id uuid,
        student_id uuid,
        student_user_id uuid,
        class_id uuid,
        subject_id uuid,
        chapter_id uuid,
        game_type varchar(50) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active',
        xp_earned int NOT NULL DEFAULT 0,
        coins_earned int NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS school_game_scores (
        id uuid PRIMARY KEY,
        session_id uuid REFERENCES school_game_sessions(id) ON DELETE CASCADE,
        institute_id uuid,
        student_id uuid,
        student_user_id uuid,
        game_type varchar(50) NOT NULL,
        score float NOT NULL DEFAULT 0,
        xp_earned int NOT NULL DEFAULT 0,
        coins_earned int NOT NULL DEFAULT 0,
        total_questions int NOT NULL DEFAULT 0,
        correct_answers int NOT NULL DEFAULT 0,
        max_streak int NOT NULL DEFAULT 0,
        time_taken_seconds int NOT NULL DEFAULT 0,
        difficulty varchar(20),
        deck_category varchar(120),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Performance indexes for leaderboard + score queries
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_institute ON school_game_sessions (institute_id, status, created_at)`);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_student ON school_game_sessions (student_user_id, created_at)`);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_institute_student ON school_game_scores (institute_id, student_user_id)`);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_session ON school_game_scores (session_id)`);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_metadata ON school_game_sessions USING GIN (metadata)`);
  }

  /** Returns the student's real-time gamification stats from gamification_profiles */
  async getMyProfile(user: any) {
    const userId = String(user?.id || '');
    try {
      const rows = await this.ds.query(
        `SELECT xp, coins, level, badges, current_streak, longest_streak
         FROM gamification_profiles
         WHERE user_id = $1`,
        [userId],
      );
      if (rows.length === 0) {
        return { xp: 0, coins: 0, level: 1, badges: [], currentStreak: 0, longestStreak: 0 };
      }
      const r = rows[0];
      return {
        xp: Number(r.xp || 0),
        coins: Number(r.coins || 0),
        level: Number(r.level || 1),
        badges: Array.isArray(r.badges) ? r.badges : [],
        currentStreak: Number(r.current_streak || 0),
        longestStreak: Number(r.longest_streak || 0),
      };
    } catch {
      return { xp: 0, coins: 0, level: 1, badges: [], currentStreak: 0, longestStreak: 0 };
    }
  }

  async startQuizRush(user: any, query: any) {
    const ctx = await this.resolveContext(user, query.subjectId, query.chapterId);
    const questions = await this.generateMcqs(ctx, 5, query.difficulty || 'medium', 'Quiz Rush');
    const session = await this.createSession(user, ctx, 'quiz_rush', { questions, difficulty: query.difficulty || 'medium' });
    return { sessionId: session.id, questions: this.publicQuestions(questions) };
  }

  async submitQuizRush(user: any, body: any) {
    const session = await this.getActiveSession(user, body.sessionId, 'quiz_rush');
    const result = this.gradeMcqRun(session.metadata.questions, body.answers || [], true);
    const perfect = result.correctAnswers === result.totalQuestions && result.totalQuestions > 0;
    const xpEarned = result.xpEarned + (perfect ? 50 : 0);
    const coinsEarned = result.coinsEarned + (perfect ? 5 : 0);
    await this.completeSession(session.id, xpEarned, coinsEarned, { answers: body.answers || [], graded: result.gradedAnswers });
    await this.saveScore(session, result.score + (perfect ? 50 : 0), xpEarned, coinsEarned, result);
    return this.resultPayload({ ...result, xpEarned, coinsEarned, score: result.score + (perfect ? 50 : 0) });
  }

  async getTreasureMaps(user: any) {
    const subjects = await this.listClassSubjects(user);
    const progressRows = await this.ds.query(
      `SELECT subject_id, MAX((metadata->>'stageOrder')::int) AS completed_stage
       FROM school_game_sessions
       WHERE student_user_id::text = $1::text
         AND game_type = 'treasure_hunt'
         AND status = 'completed'
         AND COALESCE((metadata->>'passed')::boolean, false) = true
       GROUP BY subject_id`,
      [user.id],
    );
    const progressBySubject = new Map<string, number>(
      progressRows.map((row: any) => [String(row.subject_id), Number(row.completed_stage || 0)]),
    );

    return subjects.map((subject: any, index: number) => {
      const completedStage = Math.min(5, progressBySubject.get(String(subject.id)) || 0);
      const currentStageOrder = Math.min(5, completedStage + 1);
      return {
        quest: {
          id: subject.id,
          name: this.intriguingGameName(subject.name, 'treasure'),
          description: `Crack AI-made clue chambers from Class ${user.studentProfile?.className || ''} ${subject.name}.`,
          mapType: index % 2 === 0 ? 'forest' : 'ruins',
          difficulty: index % 3 === 0 ? 'medium' : 'easy',
          stages: this.treasureStages(subject.name),
        },
        progress: { status: completedStage >= 5 ? 'completed' : 'active', currentStageOrder },
      };
    });
  }

  async getTreasureChallenge(user: any, subjectId: string, stageOrder = 1) {
    const ctx = await this.resolveContext(user, subjectId, null);
    const safeStageOrder = Math.max(1, Math.min(5, Number(stageOrder || 1)));
    const questions = await this.generateMcqs(ctx, 3, 'medium', `Treasure Hunt checkpoint ${safeStageOrder} application riddle`);
    const session = await this.createSession(user, ctx, 'treasure_hunt', { questions, questId: subjectId, stageOrder: safeStageOrder });
    return { sessionId: session.id, questId: subjectId, stageOrder: safeStageOrder, questions: this.publicQuestions(questions) };
  }

  async completeTreasureStage(user: any, body: any) {
    const session = await this.findTreasureSession(user, body.sessionId, body.questId);
    const result = this.gradeMcqRun(session.metadata.questions, body.answers || [], false);
    const passed = result.totalQuestions > 0 && result.correctAnswers / result.totalQuestions >= 0.6;
    const stageOrder = Number(session.metadata?.stageOrder || 1);
    const xpEarned = passed ? result.correctAnswers * 20 + 20 : result.correctAnswers * 5;
    const coinsEarned = passed ? 8 : 0;
    await this.completeSession(session.id, xpEarned, coinsEarned, { answers: body.answers || [], graded: result.gradedAnswers, passed, stageOrder });
    await this.saveScore(session, xpEarned, xpEarned, coinsEarned, result);
    return {
      passed,
      questCompleted: passed && stageOrder >= 5,
      currentStageOrder: passed ? Math.min(5, stageOrder + 1) : stageOrder,
      xpEarned,
      coinsEarned,
      correctAnswers: result.correctAnswers,
      totalQuestions: result.totalQuestions,
    };
  }

  async startMathSprint(user: any, difficulty = 'medium') {
    const subject = await this.findMathSubject(user);
    const ctx = await this.resolveContext(user, subject?.id || null, null);
    const questions = await this.generateMathSprintQuestions(ctx, difficulty);
    const session = await this.createSession(user, ctx, 'math_sprint', { questions, difficulty });
    return { sessionId: session.id, questions: this.publicQuestions(questions) };
  }

  async submitMathSprint(user: any, body: any) {
    const session = await this.getActiveSession(user, body.sessionId, 'math_sprint');
    const result = this.gradeMcqRun(session.metadata.questions, body.answers || [], false);
    await this.completeSession(session.id, result.xpEarned, result.coinsEarned, { answers: body.answers || [], graded: result.gradedAnswers });
    await this.saveScore(session, result.score, result.xpEarned, result.coinsEarned, result);
    return this.resultPayload(result);
  }

  async getMemoryMatchDecks(user: any) {
    const subjects = await this.listClassSubjects(user);
    return this.memoryMatchThemes(subjects).map((theme) => ({
      id: this.themeDeckId(theme.key, theme.subjectId),
      name: theme.name,
      description: theme.description,
      defaultDifficulty: theme.difficulty || 'medium',
      pairsCount: 6,
    }));
  }

  async startMemoryMatch(user: any, deckId: string, difficultyParam?: string) {
    const subjects = await this.listClassSubjects(user);
    const theme = this.resolveMemoryMatchTheme(deckId, subjects);
    const difficulty = (difficultyParam && ['easy', 'medium', 'hard'].includes(difficultyParam.toLowerCase()))
      ? difficultyParam.toLowerCase()
      : (theme.difficulty || 'medium');
    const ctx = await this.resolveContext(user, theme.subjectId, null);
    const promptMode = [
      `Memory Match: ${theme.name} (${difficulty})`,
      theme.description,
      theme.prompt,
      'Generate paired terms and meanings that feel like clue cards, with concise matchable definitions.',
    ].join(' - ');
    const pairs = await this.generateConceptPairs(ctx, 6, promptMode);
    const cards = this.shuffle(pairs.flatMap((p: any) => {
      const matchId = randomUUID();
      return [
        { id: randomUUID(), matchId, content: p.term },
        { id: randomUUID(), matchId, content: p.definition },
      ];
    }));
    const session = await this.createSession(user, ctx, 'memory_match', { pairs, cards, deckName: theme.name, difficulty, themeKey: theme.key });
    return { sessionId: session.id, deckName: theme.name, difficulty, cards };
  }

  async submitMemoryMatch(user: any, body: any) {
    const session = await this.getActiveSession(user, body.sessionId, 'memory_match');
    const pairs = Number(session.metadata.pairs?.length || 6);
    const turns = Number(body.turnsCount || 0);
    const misses = Number(body.mismatchesCount || 0);
    const xpEarned = Math.max(20, pairs * 15 + Math.max(0, 100 - Math.max(0, turns - pairs) * 6));
    const coinsEarned = Math.max(1, pairs - Math.min(misses, pairs));
    const result = { totalQuestions: pairs, correctAnswers: pairs, maxStreak: pairs, timeTakenSeconds: 0, questionsAttempted: pairs, turnsCount: turns, mismatchesCount: misses };
    await this.completeSession(session.id, xpEarned, coinsEarned, result);
    await this.saveScore(session, xpEarned, xpEarned, coinsEarned, result);
    return this.resultPayload({ ...result, score: xpEarned, xpEarned, coinsEarned });
  }

  async getWordMasterDecks(user: any) {
    const subjects = await this.listClassSubjects(user);
    return this.wordMasterThemes(subjects).map((theme) => ({
      id: this.themeDeckId(theme.key, theme.subjectId),
      name: theme.name,
      description: theme.description,
      defaultDifficulty: theme.difficulty || 'medium',
      wordsCount: 10,
    }));
  }

  async startWordMaster(user: any, deckId: string, difficultyParam?: string) {
    const subjects = await this.listClassSubjects(user);
    const theme = this.resolveWordMasterTheme(deckId, subjects);
    const difficulty = (difficultyParam && ['easy', 'medium', 'hard'].includes(difficultyParam.toLowerCase()))
      ? difficultyParam.toLowerCase()
      : (theme.difficulty || 'medium');
    const ctx = await this.resolveContext(user, theme.subjectId, null);
    const promptMode = [
      `Word Master: ${theme.name} (${difficulty})`,
      theme.description,
      theme.prompt,
      this.wordMasterDifficultyPrompt(difficulty),
      'Choose surprising, student-friendly syllabus vocabulary that feels like a puzzle, but never put the answer word inside the clue.',
    ].join(' - ');
    const pairs = await this.generateConceptPairs(ctx, 10, promptMode, difficulty);
    const words = pairs.map((pair: any) => {
      const word = this.toVocabularyWord(pair.term);
      const hint = this.sanitizeWordHint(pair.definition, pair.term, word);
      return { word, scrambled: this.scramble(word), hint, length: word.length };
    }).filter((w: any) => w.word.length >= 4 && w.hint.length >= 12 && !this.hintContainsAnswer(w.hint, w.word));
    if (words.length < 4) throw new BadRequestException('AI could not generate enough vocabulary words. Please try again.');
    const session = await this.createSession(user, ctx, 'word_master', { words, deckName: theme.name, difficulty, themeKey: theme.key });
    return { sessionId: session.id, deckName: theme.name, difficulty, words: words.map(({ word, ...rest }: any) => rest) };
  }

  async submitWordMaster(user: any, body: any) {
    const session = await this.getActiveSession(user, body.sessionId, 'word_master');
    const words = session.metadata.words || [];
    const answers = body.answers || [];
    let correctAnswers = 0;
    let maxStreak = 0;
    let streak = 0;
    for (const answer of answers) {
      const word = words[answer.index]?.word;
      const ok = word && String(answer.word || '').toUpperCase() === String(word).toUpperCase();
      if (ok) {
        correctAnswers += 1;
        streak += 1;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }
    const xpEarned = correctAnswers * 15 + (correctAnswers === words.length ? 50 : 0);
    const coinsEarned = correctAnswers + (correctAnswers === words.length ? 5 : 0);
    const result = { totalQuestions: words.length, correctAnswers, maxStreak, wordsAttempted: words.length, score: xpEarned };
    await this.completeSession(session.id, xpEarned, coinsEarned, { answers, correctAnswers });
    await this.saveScore(session, xpEarned, xpEarned, coinsEarned, result);
    return this.resultPayload({ ...result, xpEarned, coinsEarned });
  }

  async leaderboard(user: any, gameType: GameType) {
    const rows = await this.ds.query(
      `SELECT gs.*, u.name
       FROM school_game_scores gs
       LEFT JOIN users u ON u.id = gs.student_user_id
       WHERE gs.institute_id::text = $1::text AND gs.game_type = $2
       ORDER BY gs.score DESC, gs.created_at ASC
       LIMIT 50`,
      [user.instituteId || user.studentProfile?.instituteId, gameType],
    );
    return rows.map((r: any, i: number) => ({
      rank: i + 1,
      studentId: r.student_id,
      name: r.name || 'Student',
      score: Math.round(Number(r.score || 0)),
      totalQuestions: r.total_questions,
      correctAnswers: r.correct_answers,
      questionsAttempted: r.total_questions,
      wordsAttempted: r.total_questions,
      maxStreak: r.max_streak,
      timeTakenSeconds: r.time_taken_seconds,
      difficulty: r.difficulty || 'medium',
      deckCategory: r.deck_category || 'School AI',
      turnsCount: r.metadata?.turnsCount || 0,
      mismatchesCount: r.metadata?.mismatchesCount || 0,
      date: r.created_at,
    }));
  }

  private async resolveContext(user: any, subjectId?: string | null, chapterId?: string | null) {
    const profile = user.studentProfile || {};
    const instituteId = user.instituteId || profile.instituteId;
    const classId = profile.classId;
    if (!instituteId || !classId) throw new BadRequestException('Student class profile is required for school games.');

    const subject = subjectId && subjectId !== 'any'
      ? (await this.ds.query(
        `SELECT * FROM subjects WHERE id::text=$1::text AND institute_id::text=$2::text AND (class_id::text=$3::text OR class_id IS NULL) LIMIT 1`,
        [subjectId, instituteId, classId],
      ))[0]
      : (await this.listClassSubjects(user))[0];
    if (!subject) throw new BadRequestException('No subject found for this class.');

    const chapter = chapterId && chapterId !== 'any'
      ? (await this.ds.query(`SELECT * FROM chapters WHERE id::text=$1::text AND subject_id::text=$2::text LIMIT 1`, [chapterId, subject.id]))[0]
      : null;

    return {
      instituteId,
      classId,
      className: profile.className || 'Class',
      studentId: profile.id,
      subjectId: subject.id,
      subjectName: subject.name,
      chapterId: chapter?.id || null,
      chapterName: chapter?.name || null,
    };
  }

  private async listClassSubjects(user: any) {
    const profile = user.studentProfile || {};
    const instituteId = user.instituteId || profile.instituteId;
    const classId = profile.classId;
    const rows = await this.ds.query(
      `SELECT s.*
       FROM subjects s
       WHERE s.institute_id::text=$1::text AND (s.class_id::text=$2::text OR s.class_id IS NULL)
       ORDER BY s.name`,
      [instituteId, classId],
    );
    // Deduplicate by subject name — prevents same-named subjects from bloating game deck lists
    const seen = new Set<string>();
    return rows.filter((s: any) => {
      const key = String(s.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async findMathSubject(user: any) {
    const subjects = await this.listClassSubjects(user);
    return subjects.find((s: any) => /math/i.test(s.name)) || subjects[0];
  }

  private async generateMcqs(ctx: any, count: number, difficulty: string, mode: string) {
    const topicName = [
      `Class ${ctx.className}`,
      ctx.subjectName,
      ctx.chapterName || 'mixed school syllabus',
      mode,
      'Generate school-level questions only. Do not include coaching, JEE, NEET, or competitive-exam framing.',
      mode.toLowerCase().includes('riddle')
        ? 'Question text should be a short scenario, clue, or application riddle suitable for a treasure checkpoint.'
        : '',
    ].filter(Boolean).join(' - ');
    let questions: any[];
    try {
      questions = await this.aiBridge.generateQuestionsFromTopic({
        topicId: ctx.chapterId || ctx.subjectId,
        topicName,
        count,
        difficulty: difficulty === 'any' ? 'medium' : difficulty,
        type: 'mcq_single',
        examTarget: 'cbse',
        subject: ctx.subjectName,
        chapter: ctx.chapterName || undefined,
      }, ctx.instituteId, 'school');
    } catch (err: any) {
      this.logger.error(`Gamification AI error [${mode}]: ${err?.message || err}`);
      throw new BadRequestException('Could not generate quiz questions. The AI service is temporarily unavailable. Please try again in a moment.');
    }
    const mapped = (questions || []).slice(0, count).map((q: any) => this.toGameQuestion(q));
    if (mapped.length < Math.min(3, count)) {
      throw new BadRequestException('AI could not generate enough school questions. Please try again.');
    }
    return mapped;
  }

  private async generateMathSprintQuestions(ctx: any, difficulty: string) {
    try {
      const questions = await this.aiBridge.generateQuestionsFromTopic({
        topicId: ctx.chapterId || ctx.subjectId,
        topicName: [
          `Class ${ctx.className}`,
          'Math Sprint',
          'Generate rapid mental-maths arithmetic only.',
          'Each question content must be ONLY an expression like "24 + 18", "7 x 8", "96 / 12", or "15% of 80".',
          'Do not include words, explanations, equal signs, or question marks in the question content.',
          'Every option must be a numeric answer.',
        ].join(' - '),
        count: 12,
        difficulty: difficulty === 'any' ? 'medium' : difficulty,
        type: 'mcq_single',
        examTarget: 'cbse',
        subject: 'Mathematics',
      }, ctx.instituteId, 'school');
      const mapped = (questions || [])
        .map((q: any) => this.toGameQuestion(q))
        .map((q: any) => this.toMathSprintQuestion(q))
        .filter(Boolean);
      const unique = this.uniqueMathQuestions(mapped);
      if (unique.length >= 8) return this.fillMathQuestions(unique, difficulty, ctx.className, 12);
    } catch (err) {
      this.logger.warn(`Math Sprint AI fallback used: ${err?.message || err}`);
    }
    return this.fillMathQuestions([], difficulty, ctx.className, 12);
  }

  private async generateConceptPairs(ctx: any, count: number, mode: string, difficulty = 'medium') {
    let raw: any[];
    try {
      raw = await this.aiBridge.generateQuestionsFromTopic({
        topicId: ctx.chapterId || ctx.subjectId,
        topicName: [
          `Class ${ctx.className}`,
          ctx.subjectName,
          ctx.chapterName || 'mixed school syllabus',
          mode,
          'Generate key school syllabus terminology only.',
          'For each item, the question/content field must be ONLY the term or phrase, max 4 words.',
          'The answer/model answer field must be a one-sentence student-friendly definition or clue.',
          'Do not include coaching, JEE, NEET, competitive-exam framing, or MCQ options.',
        ].join(' - '),
        count,
        difficulty,
        type: 'short_answer',
        examTarget: 'cbse',
        subject: ctx.subjectName,
        chapter: ctx.chapterName || undefined,
      }, ctx.instituteId, 'school');
    } catch (err: any) {
      this.logger.warn(`${mode} AI error: ${err?.message || err}; falling back to subject terms`);
      return this.fallbackConceptPairs(ctx).slice(0, count);
    }

    const pairs = (raw || [])
      .map((q: any) => ({
        term: this.cleanTerm(q.content || q.questionText || q.question || ''),
        definition: this.cleanDefinition(q.answer || q.solutionText || q.explanation || q.content || ''),
      }))
      .filter((p: any) => this.isUsablePair(p));

    if (pairs.length >= Math.min(4, count)) return this.dedupePairs(pairs).slice(0, count);

    this.logger.warn(`${mode} AI pair output was not usable; falling back to subject terms`);
    return this.fallbackConceptPairs(ctx).slice(0, count);
  }

  private toGameQuestion(q: any) {
    const options = (q.options || []).slice(0, 4).map((o: any) => ({
      id: randomUUID(),
      optionLabel: o.label,
      content: String(o.content || '').trim(),
      isCorrect: Boolean(o.isCorrect),
    }));
    if (!options.some((o: any) => o.isCorrect) && options[0]) options[0].isCorrect = true;
    return {
      id: randomUUID(),
      content: String(q.content || q.questionText || '').trim(),
      contentImageUrl: null,
      type: 'mcq_single',
      difficulty: 'medium',
      explanation: q.explanation || q.solutionText || '',
      options,
    };
  }

  private toMathSprintQuestion(q: any) {
    const expression = this.extractMathExpression(q.content);
    if (!expression) return null;

    const normalizedExpression = expression.replace(/\s+/g, ' ');
    const correctAnswer = this.evaluateExpression(normalizedExpression);
    const numericOptions = (q.options || [])
      .map((o: any) => ({ ...o, content: this.extractNumericAnswer(o.content) }))
      .filter((o: any) => o.content !== null);
    if (numericOptions.length < 4) return null;

    const values = this.uniqueAnswerValues([
      correctAnswer,
      ...numericOptions.map((o: any) => Number(o.content)),
    ]);
    if (values.length < 4) return null;

    return {
      ...q,
      content: normalizedExpression,
      options: values.slice(0, 4).map((value: number) => ({
        id: randomUUID(),
        optionLabel: '',
        content: String(value),
        isCorrect: value === correctAnswer,
      })),
    };
  }

  private publicQuestions(questions: any[]) {
    return questions.map((q) => ({ ...q, options: q.options.map((o: any) => ({ ...o })) }));
  }

  private gradeMcqRun(questions: any[], answers: any[], timed: boolean) {
    const answerMap = new Map((answers || []).map((a: any) => [a.questionId, a]));
    let correctAnswers = 0;
    let xpEarned = 0;
    let coinsEarned = 0;
    let maxStreak = 0;
    let streak = 0;
    let timeTakenSeconds = 0;
    const gradedAnswers = questions.map((q: any) => {
      const answer: any = answerMap.get(q.id) || {};
      const correct = q.options.find((o: any) => o.isCorrect);
      const isCorrect = !!correct && correct.id === answer.selectedOptionId;
      timeTakenSeconds += Number(answer.timeTakenSeconds || 0);
      if (isCorrect) {
        correctAnswers += 1;
        streak += 1;
        maxStreak = Math.max(maxStreak, streak);
        xpEarned += timed && Number(answer.timeTakenSeconds || 99) <= 5 ? 15 : 10;
        coinsEarned += 1;
      } else {
        streak = 0;
      }
      return { questionId: q.id, selectedOptionId: answer.selectedOptionId || null, correctOptionId: correct?.id || null, isCorrect };
    });
    return {
      totalQuestions: questions.length,
      correctAnswers,
      maxStreak,
      timeTakenSeconds,
      xpEarned,
      coinsEarned,
      score: xpEarned,
      gradedAnswers,
    };
  }

  private async createSession(user: any, ctx: any, gameType: GameType, metadata: any) {
    const rows = await this.ds.query(
      `INSERT INTO school_game_sessions
       (id, institute_id, student_id, student_user_id, class_id, subject_id, chapter_id, game_type, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [randomUUID(), ctx.instituteId, ctx.studentId, user.id, ctx.classId, ctx.subjectId, ctx.chapterId, gameType, JSON.stringify(metadata)],
    );
    return rows[0];
  }

  private async getActiveSession(user: any, sessionId: string, gameType: GameType) {
    const rows = await this.ds.query(
      `SELECT * FROM school_game_sessions WHERE id::text=$1::text AND student_user_id::text=$2::text AND game_type=$3 LIMIT 1`,
      [sessionId, user.id, gameType],
    );
    const session = rows[0];
    if (!session) throw new NotFoundException('Game session not found');
    if (session.status === 'completed') throw new BadRequestException('Session has already been submitted');
    return session;
  }

  private async findTreasureSession(user: any, sessionId?: string, questId?: string) {
    if (sessionId) return this.getActiveSession(user, sessionId, 'treasure_hunt');
    const rows = await this.ds.query(
      `SELECT * FROM school_game_sessions
       WHERE student_user_id::text=$1::text AND game_type='treasure_hunt' AND status='active' AND subject_id::text=$2::text
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, questId],
    );
    if (!rows[0]) throw new NotFoundException('Game session not found');
    return rows[0];
  }

  private async completeSession(sessionId: string, xp: number, coins: number, extra: any) {
    await this.ds.query(
      `UPDATE school_game_sessions
       SET status='completed', xp_earned=$2, coins_earned=$3, metadata = metadata || $4::jsonb, updated_at=now()
       WHERE id=$1`,
      [sessionId, Math.round(xp), Math.round(coins), JSON.stringify(extra)],
    );
  }

  private async saveScore(session: any, score: number, xp: number, coins: number, result: any) {
    await this.ds.query(
      `INSERT INTO school_game_scores
       (id, session_id, institute_id, student_id, student_user_id, game_type, score, xp_earned, coins_earned,
        total_questions, correct_answers, max_streak, time_taken_seconds, difficulty, deck_category, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
      [
        randomUUID(), session.id, session.institute_id, session.student_id, session.student_user_id, session.game_type,
        score, Math.round(xp), Math.round(coins), result.totalQuestions || result.questionsAttempted || result.wordsAttempted || 0,
        result.correctAnswers || 0, result.maxStreak || 0, result.timeTakenSeconds || 0,
        session.metadata?.difficulty || 'medium', session.metadata?.deckName || session.game_type, JSON.stringify(result),
      ],
    );

    // ── Update gamification_profiles so the student dashboard shows real XP/coins ──
    try {
      const userId = String(session.student_user_id);
      const xpInt = Math.round(xp);
      const coinsInt = Math.round(coins);

      // Compute new level from total XP after this game
      const profileRows = await this.ds.query(
        `SELECT xp, level FROM gamification_profiles WHERE user_id = $1`,
        [userId],
      );

      if (profileRows.length === 0) {
        const newXp = xpInt;
        const newLevel = this.computeLevel(newXp);
        await this.ds.query(
          `INSERT INTO gamification_profiles (user_id, xp, coins, level, badges, current_streak, longest_streak)
           VALUES ($1, $2, $3, $4, '[]', 0, 0)`,
          [userId, newXp, coinsInt, newLevel],
        );
      } else {
        const newXp = Number(profileRows[0].xp || 0) + xpInt;
        const newLevel = this.computeLevel(newXp);
        await this.ds.query(
          `UPDATE gamification_profiles
           SET xp = xp + $1, coins = coins + $2, level = $3, updated_at = NOW()
           WHERE user_id = $4`,
          [xpInt, coinsInt, newLevel, userId],
        );
      }
    } catch (err: any) {
      this.logger.warn(`[saveScore] Could not update gamification_profiles: ${err?.message}`);
    }
  }

  /** Compute level from total XP (mirrors the frontend getLevelThresholds logic) */
  private computeLevel(xp: number): number {
    if (xp >= 1000) return 5;
    if (xp >= 500) return 4;
    if (xp >= 250) return 3;
    if (xp >= 100) return 2;
    return 1;
  }



  private resultPayload(result: any) {
    const xp = Math.round(result.xpEarned || result.score || 0);
    return {
      ...result,
      score: Math.round(result.score || xp),
      xpEarned: xp,
      coinsEarned: Math.round(result.coinsEarned || 0),
      hasLeveledUp: false,
      newLevel: 1,
      newTitle: 'School Learner',
      badgeUnlocked: false,
      currentXp: xp,
      currentCoins: Math.round(result.coinsEarned || 0),
      levelProgress: Math.min(100, xp % 100),
    };
  }

  private wordMasterThemes(subjects: any[]) {
    const themes = subjects
      .map((subject: any) => this.wordMasterSubjectTheme(subject))
      .filter((theme) => theme && theme.subjectId);
    const seen = new Set<string>();
    return themes.filter((theme) => {
      if (seen.has(theme.name)) return false;
      seen.add(theme.name);
      return true;
    });
  }

  private wordMasterSubjectTheme(subject: any) {
    const subjectName = String(subject?.name || 'Subject');
    const normalized = subjectName.toLowerCase();
    const subjectId = subject?.id;
    const slug = subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subject';
    const base = {
      difficulty: 'medium',
      subjectId,
    };

    if (normalized.includes('science')) {
      return {
        key: 'science-explorers',
        name: 'Science Explorers',
        description: 'Unscramble key concepts from Earth, Life, and Physical Sciences!',
        difficulty: 'easy',
        subjectId,
        prompt: 'Generate terms from school science: earth science, life processes, forces, matter, energy, cells, ecosystems, acids, bases, light, sound, and simple experiments.',
      };
    }

    if (normalized.includes('math')) {
      return {
        key: 'math-vocabulary',
        name: 'Math Vocabulary',
        description: 'Unscramble geometry, algebra, number, and coordinate terms!',
        difficulty: 'medium',
        subjectId,
        prompt: 'Generate mathematics vocabulary only: geometry, algebra, number systems, fractions, ratios, graphs, coordinates, data handling, and measurement terms.',
      };
    }

    if (normalized.includes('literature')) {
      return {
        key: 'advanced-vocabulary',
        name: 'Advanced Vocabulary',
        description: 'Tackle high-level NCERT English literature and academic words!',
        difficulty: 'hard',
        subjectId,
        prompt: 'Generate advanced school-level English vocabulary from literature, comprehension, academic writing, emotions, tone, themes, and literary devices.',
      };
    }

    if (normalized.includes('english') || normalized.includes('language')) {
      return {
        key: 'synonyms-antonyms',
        name: 'Synonyms & Antonyms',
        description: 'Crack word-pair vocabulary used in reading and writing!',
        difficulty: 'medium',
        subjectId,
        prompt: 'Generate English vocabulary for synonyms, antonyms, word meanings, prefixes, suffixes, adjectives, and expressive academic words.',
      };
    }

    if (normalized.includes('civic') || normalized.includes('political') || normalized.includes('social')) {
      return {
        key: 'civics-landmarks',
        name: 'Civics & Landmarks',
        description: 'Decode vocabulary about constitutions, empires, maps, and public life!',
        difficulty: 'hard',
        subjectId,
        prompt: 'Generate social science vocabulary from civics, history, geography, constitutions, democracy, landmarks, empires, resources, maps, and public institutions.',
      };
    }

    if (normalized.includes('physics')) {
      return {
        ...base,
        key: `${slug}-force-files`,
        name: 'Force Files',
        description: 'Unscramble motion, light, electricity, sound, and energy terms!',
        prompt: 'Generate school physics vocabulary about force, motion, energy, light, sound, electricity, magnetism, pressure, and measurement.',
      };
    }

    if (normalized.includes('chem')) {
      return {
        ...base,
        key: `${slug}-element-hunt`,
        name: 'Element Hunt',
        description: 'Crack terms from atoms, reactions, acids, bases, and materials!',
        prompt: 'Generate school chemistry vocabulary about atoms, molecules, elements, compounds, reactions, acids, bases, salts, metals, and materials.',
      };
    }

    if (normalized.includes('bio')) {
      return {
        ...base,
        key: `${slug}-life-lab`,
        name: 'Life Lab',
        description: 'Unscramble words from cells, organs, nutrition, heredity, and habitats!',
        prompt: 'Generate school biology vocabulary about cells, tissues, organs, nutrition, respiration, reproduction, heredity, microbes, habitats, and ecosystems.',
      };
    }

    if (normalized.includes('history')) {
      return {
        ...base,
        key: `${slug}-time-capsule`,
        name: 'Time Capsule Terms',
        description: 'Unearth empires, movements, rulers, revolts, and ancient ideas!',
        prompt: 'Generate history vocabulary about civilizations, empires, rulers, trade, movements, revolts, sources, monuments, chronology, and historical ideas.',
      };
    }

    if (normalized.includes('geo')) {
      return {
        ...base,
        key: `${slug}-map-mysteries`,
        name: 'Map Mysteries',
        description: 'Decode landforms, climates, resources, maps, and coordinates!',
        prompt: 'Generate geography vocabulary about maps, landforms, rivers, climate, resources, settlements, coordinates, regions, population, and environment.',
      };
    }

    if (normalized.includes('computer') || normalized.includes('ict')) {
      return {
        ...base,
        key: `${slug}-code-crackers`,
        name: 'Code Crackers',
        description: 'Unscramble digital terms from hardware, software, networks, and safety!',
        prompt: 'Generate school computer science vocabulary about hardware, software, networks, internet, algorithms, data, safety, devices, and coding basics.',
      };
    }

    return {
      ...base,
      key: `${slug}-mystery-words`,
      name: `${subjectName} Mystery Words`,
      description: `Unscramble curious terms from your Class ${subjectName} syllabus!`,
      prompt: `Generate intriguing school-level vocabulary from ${subjectName}, using core syllabus terms, definitions, processes, people, places, concepts, and examples.`,
    };
  }

  private memoryMatchThemes(subjects: any[]) {
    const themes = subjects
      .map((subject: any) => this.memoryMatchSubjectTheme(subject))
      .filter((theme) => theme && theme.subjectId);
    const seen = new Set<string>();
    return themes.filter((theme) => {
      if (seen.has(theme.name)) return false;
      seen.add(theme.name);
      return true;
    });
  }

  private memoryMatchSubjectTheme(subject: any) {
    const subjectName = String(subject?.name || 'Subject');
    const normalized = subjectName.toLowerCase();
    const subjectId = subject?.id;
    const slug = subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subject';
    const base = { difficulty: 'medium', subjectId };

    if (normalized.includes('science')) {
      return {
        ...base,
        key: `${slug}-discovery-pairs`,
        name: 'Discovery Pairs',
        description: 'Match science ideas with the clues that reveal how the world works.',
        prompt: 'Generate science term-definition pairs from experiments, matter, energy, life, Earth, forces, reactions, and observation skills.',
      };
    }

    if (normalized.includes('math')) {
      return {
        ...base,
        key: `${slug}-formula-flip`,
        name: 'Formula Flip',
        description: 'Match formulas, shapes, operations, and meanings before the board wins.',
        prompt: 'Generate mathematics term-definition pairs from formulas, operations, geometry, algebra, data, fractions, ratios, and measurement.',
      };
    }

    if (normalized.includes('english') || normalized.includes('language') || normalized.includes('literature')) {
      return {
        ...base,
        key: `${slug}-word-web`,
        name: 'Word Web',
        description: 'Match meanings, grammar clues, and literary terms like a word detective.',
        prompt: 'Generate English term-definition pairs from grammar, vocabulary, synonyms, antonyms, story elements, poetry, tone, and literary devices.',
      };
    }

    if (normalized.includes('history')) {
      return {
        ...base,
        key: `${slug}-era-links`,
        name: 'Era Links',
        description: 'Match people, events, sources, empires, and turning points.',
        prompt: 'Generate history match pairs about civilizations, empires, events, rulers, sources, movements, monuments, timelines, and historical terms.',
      };
    }

    if (normalized.includes('geo')) {
      return {
        ...base,
        key: `${slug}-map-links`,
        name: 'Map Links',
        description: 'Pair landforms, climate clues, map terms, and resource ideas.',
        prompt: 'Generate geography match pairs about maps, landforms, climate, rivers, resources, coordinates, regions, settlements, and environment.',
      };
    }

    if (normalized.includes('civic') || normalized.includes('political')) {
      return {
        ...base,
        key: `${slug}-democracy-deck`,
        name: 'Democracy Deck',
        description: 'Match rights, duties, institutions, elections, and constitution clues.',
        prompt: 'Generate civics match pairs about democracy, constitution, rights, duties, government, parliament, courts, elections, equality, and public institutions.',
      };
    }

    if (normalized.includes('computer') || normalized.includes('ict')) {
      return {
        ...base,
        key: `${slug}-digital-pairs`,
        name: 'Digital Pairs',
        description: 'Match hardware, software, networks, internet, and safety terms.',
        prompt: 'Generate computer science match pairs about hardware, software, networks, internet, data, algorithms, coding basics, devices, and cyber safety.',
      };
    }

    return {
      ...base,
      key: `${slug}-brain-links`,
      name: `${subjectName} Brain Links`,
      description: `Match curious ${subjectName} ideas with their meanings.`,
      prompt: `Generate matchable term-definition pairs from ${subjectName}, using core syllabus concepts, examples, processes, people, places, and vocabulary.`,
    };
  }

  private resolveMemoryMatchTheme(deckId: string, subjects: any[]) {
    const themes = this.memoryMatchThemes(subjects);
    const parsed = this.parseThemeDeckId(deckId);
    return themes.find((theme) => theme.key === parsed.themeKey)
      || themes.find((theme) => theme.subjectId === deckId)
      || themes[0];
  }

  private resolveWordMasterTheme(deckId: string, subjects: any[]) {
    const themes = this.wordMasterThemes(subjects);
    const parsed = this.parseThemeDeckId(deckId);
    const themeKey = this.stripDifficultySuffix(parsed.themeKey);
    return themes.find((theme) => theme.key === themeKey)
      || themes.find((theme) => theme.subjectId === deckId)
      || themes[0];
  }

  private wordMasterDifficultyLevels() {
    return [
      {
        difficulty: 'easy',
        description: (base: string) => `${base} Start with familiar 4-6 letter terms.`,
      },
      {
        difficulty: 'medium',
        description: (base: string) => `${base} Mix familiar and challenge words for a balanced run.`,
      },
      {
        difficulty: 'hard',
        description: (base: string) => `${base} Tackle trickier 7-12 letter academic terms.`,
      },
    ];
  }

  private resolveWordMasterDifficulty(deckId: string, fallback: string) {
    const parsed = this.parseThemeDeckId(deckId);
    const match = parsed.themeKey.match(/-(easy|medium|hard)$/i);
    return match?.[1]?.toLowerCase() || fallback || 'medium';
  }

  private stripDifficultySuffix(themeKey: string) {
    return String(themeKey || '').replace(/-(easy|medium|hard)$/i, '');
  }

  private wordMasterDifficultyPrompt(difficulty: string) {
    if (difficulty === 'easy') {
      return 'Use familiar school terms, mostly 4 to 6 letters, with direct but answer-safe clues.';
    }
    if (difficulty === 'hard') {
      return 'Use more advanced academic terms, mostly 7 to 12 letters, with indirect but fair clues.';
    }
    return 'Use a balanced mix of familiar and moderately challenging school terms, mostly 5 to 9 letters.';
  }

  private themeDeckId(themeKey: string, subjectId: string) {
    return `theme:${themeKey}:${subjectId}`;
  }

  private parseThemeDeckId(deckId: string) {
    const parts = String(deckId || '').split(':');
    if (parts[0] === 'theme' && parts.length >= 3) {
      return { themeKey: parts[1], subjectId: parts.slice(2).join(':') };
    }
    return { themeKey: deckId, subjectId: deckId };
  }

  private findSubjectId(subjects: any[], keywords: string[]) {
    const match = subjects.find((subject: any) => {
      const name = String(subject.name || '').toLowerCase();
      return keywords.some((keyword) => name.includes(keyword));
    });
    return match?.id || null;
  }

  private intriguingGameName(subjectName: string, game: 'memory' | 'treasure') {
    const subject = String(subjectName || 'School');
    const normalized = subject.toLowerCase();
    if (game === 'treasure') {
      if (normalized.includes('history')) return 'Time-Travel Treasure Trail';
      if (normalized.includes('science')) return 'Science Relic Expedition';
      if (normalized.includes('math')) return 'Number Vault Quest';
      if (normalized.includes('geo')) return 'Mapmaker Mystery Trail';
      if (normalized.includes('civic') || normalized.includes('political')) return 'Constitution Cipher Hunt';
      if (normalized.includes('english')) return 'Story Clue Expedition';
      return `${subject} Mystery Trail`;
    }
    if (normalized.includes('science')) return 'Science Explorer Cards';
    if (normalized.includes('math')) return 'Number Ninja Match';
    if (normalized.includes('history')) return 'Time Capsule Match';
    if (normalized.includes('geo')) return 'Map Quest Match';
    if (normalized.includes('civic') || normalized.includes('political')) return 'Citizen Code Cards';
    if (normalized.includes('english')) return 'Word Detective Match';
    return `${subject} Brain Match`;
  }

  private treasureStages(subjectName: string) {
    const labels = ['Trail Gate', 'Clue Bridge', 'Riddle Ruins', 'Cipher Cave', 'Treasure Vault'];
    return labels.map((label, index) => {
      const stageOrder = index + 1;
      return {
        id: `${subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'quest'}-${stageOrder}`,
        name: label,
        stageOrder,
        xpReward: 40 + stageOrder * 10,
        coinsReward: 4 + stageOrder,
      };
    });
  }

  private scramble(word: string) {
    const chars = word.toUpperCase().split('');
    if (chars.length < 2) return word.toUpperCase();
    let shuffled = this.shuffle(chars).join('');
    if (shuffled === word.toUpperCase()) shuffled = chars.reverse().join('');
    return shuffled;
  }

  private localMathQuestion(difficulty: string, className: string) {
    const level = String(className || '').match(/\d+/)?.[0] ? Number(String(className).match(/\d+/)?.[0]) : 5;
    const max = difficulty === 'hard' || level >= 7 ? 99 : difficulty === 'easy' || level <= 3 ? 20 : 50;
    const a = Math.floor(Math.random() * max) + 1;
    const b = Math.floor(Math.random() * Math.max(10, Math.floor(max / 2))) + 1;
    const ops = difficulty === 'easy' || level <= 3 ? ['+', '-'] : ['+', '-', 'x', '/'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const expression = op === '/'
      ? `${a * b} / ${b}`
      : op === 'x'
        ? `${Math.min(a, 12)} x ${Math.min(b, 12)}`
        : `${a} ${op} ${b}`;
    const ans = this.evaluateExpression(expression);
    const values = this.uniqueAnswerValues([ans, ans + 1, ans - 1, ans + 3, ans - 3, ans + 5]);
    return {
      id: randomUUID(),
      content: expression,
      contentImageUrl: null,
      type: 'mcq_single',
      difficulty,
      options: values.map((v) => ({ id: randomUUID(), optionLabel: '', content: String(v), isCorrect: v === ans })),
      explanation: `Class ${className} mental maths`,
    };
  }

  private fillMathQuestions(existing: any[], difficulty: string, className: string, count: number) {
    const questions = this.uniqueMathQuestions(existing);
    const seen = new Set(questions.map((q) => this.mathQuestionKey(q.content)));
    let attempts = 0;
    while (questions.length < count && attempts < count * 80) {
      attempts += 1;
      const question = this.localMathQuestion(difficulty, className);
      const key = this.mathQuestionKey(question.content);
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(question);
    }
    return questions.slice(0, count);
  }

  private uniqueMathQuestions(questions: any[]) {
    const seen = new Set<string>();
    return questions.filter((question) => {
      const key = this.mathQuestionKey(question.content);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private mathQuestionKey(expression: string) {
    const normalized = String(expression || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const percent = normalized.match(/^(\d+)\s*%\s*of\s*(\d+)$/);
    if (percent) return `${percent[1]}%-of-${percent[2]}`;
    const match = normalized.match(/^(\d+)\s*(\+|-|x|\/)\s*(\d+)$/);
    if (!match) return normalized;
    const left = Number(match[1]);
    const op = match[2];
    const right = Number(match[3]);
    if (op === '+' || op === 'x') {
      const [first, second] = [left, right].sort((a, b) => a - b);
      return `${first}${op}${second}`;
    }
    return `${left}${op}${right}`;
  }

  private uniqueAnswerValues(values: number[]) {
    const seen = new Set<number>();
    const output: number[] = [];
    for (const value of values) {
      const normalized = Number(value);
      if (!Number.isFinite(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
      if (output.length === 4) break;
    }
    let delta = 2;
    const answer = output[0] ?? 0;
    while (output.length < 4) {
      const next = answer + delta;
      if (!seen.has(next)) {
        seen.add(next);
        output.push(next);
      }
      delta += 1;
    }
    return this.shuffle(output);
  }

  private shuffle<T>(arr: T[]): T[] {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  private extractMathExpression(value: string) {
    const text = String(value || '').replace(/[×÷]/g, (m) => (m === '×' ? 'x' : '/'));
    const percent = text.match(/\b\d+\s*%\s*of\s*\d+\b/i)?.[0];
    if (percent) return percent.replace(/\s+/g, ' ');
    const match = text.match(/\b\d+\s*(?:\+|-|x|\*|\/)\s*\d+\b/i)?.[0];
    return match ? match.replace('*', 'x').replace(/\s+/g, ' ') : null;
  }

  private extractNumericAnswer(value: string) {
    const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  private evaluateExpression(expression: string) {
    const percent = expression.match(/^(\d+)\s*%\s*of\s*(\d+)$/i);
    if (percent) return Math.round((Number(percent[1]) / 100) * Number(percent[2]));
    const match = expression.match(/^(\d+)\s*(\+|-|x|\/)\s*(\d+)$/i);
    if (!match) return 0;
    const a = Number(match[1]);
    const b = Number(match[3]);
    if (match[2] === '+') return a + b;
    if (match[2] === '-') return a - b;
    if (match[2].toLowerCase() === 'x') return a * b;
    return Math.round(a / b);
  }

  private cleanTerm(value: string) {
    return String(value || '')
      .replace(/^Q\.?\s*\d+[:.)-]?\s*/i, '')
      .replace(/^(what is|define|explain)\s+/i, '')
      .replace(/[?"]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(' ');
  }

  private cleanDefinition(value: string) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  private sanitizeWordHint(definition: string, term: string, word: string) {
    let hint = this.cleanDefinition(definition);
    const variants = this.answerVariants(term, word);
    for (const variant of variants) {
      hint = hint.replace(new RegExp(`\\b${this.escapeRegExp(variant)}\\b`, 'gi'), '_____');
    }
    hint = this.maskAnswerPhraseByLetters(hint, word);
    hint = hint
      .replace(/^_____+\s+(is|are|means|refers to)\s+/i, '')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (!hint || /^_+$/.test(hint)) return `A key idea from this topic with ${word.length} letters.`;
    return hint;
  }

  private hintContainsAnswer(hint: string, word: string) {
    const normalizedHint = String(hint || '').replace(/[^A-Za-z]/g, '').toLowerCase();
    const normalizedWord = String(word || '').replace(/[^A-Za-z]/g, '').toLowerCase();
    return !!normalizedWord && normalizedHint.includes(normalizedWord);
  }

  private answerVariants(term: string, word: string) {
    const cleanedTerm = String(term || '').replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(new Set([
      word,
      cleanedTerm,
      ...cleanedTerm.split(' '),
    ].map((value) => String(value || '').trim()).filter((value) => value.length >= 3)));
  }

  private escapeRegExp(value: string) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private maskAnswerPhraseByLetters(hint: string, word: string) {
    const sortedAnswer = this.sortLetters(word);
    const answerLength = this.normalizeLetters(word).length;
    if (!hint || !sortedAnswer || !answerLength) return hint;

    const matches = Array.from(String(hint).matchAll(/[A-Za-z]+/g)).map((match) => ({
      start: match.index || 0,
      end: (match.index || 0) + match[0].length,
    }));
    const ranges: Array<[number, number]> = [];
    for (let start = 0; start < matches.length; start += 1) {
      for (let end = start; end < Math.min(matches.length, start + 5); end += 1) {
        const phraseStart = matches[start].start;
        const phraseEnd = matches[end].end;
        const letters = this.normalizeLetters(hint.slice(phraseStart, phraseEnd));
        if (letters.length === answerLength && this.sortLetters(letters) === sortedAnswer) {
          ranges.push([phraseStart, phraseEnd]);
        }
      }
    }
    return ranges
      .sort((a, b) => b[0] - a[0])
      .reduce((masked, [start, end]) => `${masked.slice(0, start)}_____ ${masked.slice(end)}`, hint);
  }

  private normalizeLetters(value: string) {
    return String(value || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  }

  private sortLetters(value: string) {
    return this.normalizeLetters(value).split('').sort().join('');
  }

  private isUsablePair(pair: any) {
    return pair.term && pair.definition && pair.term.length >= 3 && pair.definition.length >= 12 && pair.term.toLowerCase() !== pair.definition.toLowerCase();
  }

  private dedupePairs(pairs: Array<{ term: string; definition: string }>) {
    const seen = new Set<string>();
    return pairs.filter((pair) => {
      const key = pair.term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private toVocabularyWord(term: string) {
    return String(term || '').replace(/[^A-Za-z]/g, '').slice(0, 12).toUpperCase();
  }

  private fallbackConceptPairs(ctx: any) {
    const subject = String(ctx.subjectName || '').toLowerCase();
    if (subject.includes('math')) {
      return [
        { term: 'Fraction', definition: 'A number that shows part of a whole.' },
        { term: 'Equation', definition: 'A statement where two mathematical expressions are equal.' },
        { term: 'Perimeter', definition: 'The total distance around the outside of a shape.' },
        { term: 'Area', definition: 'The amount of surface covered by a flat shape.' },
        { term: 'Ratio', definition: 'A comparison between two quantities.' },
        { term: 'Variable', definition: 'A letter or symbol that stands for an unknown value.' },
      ];
    }
    if (subject.includes('science') || subject.includes('physics') || subject.includes('chem') || subject.includes('bio')) {
      return [
        { term: 'Force', definition: 'A push or pull that can change an object’s motion.' },
        { term: 'Energy', definition: 'The ability to do work or cause change.' },
        { term: 'Cell', definition: 'The basic structural and functional unit of living things.' },
        { term: 'Matter', definition: 'Anything that has mass and occupies space.' },
        { term: 'Habitat', definition: 'The natural home or environment of a living organism.' },
        { term: 'Mixture', definition: 'A combination of substances that are not chemically joined.' },
      ];
    }
    return [
      { term: 'Concept', definition: `An important idea from ${ctx.subjectName}.` },
      { term: 'Example', definition: `A case that helps explain a topic in ${ctx.subjectName}.` },
      { term: 'Definition', definition: 'A clear meaning of a word or idea.' },
      { term: 'Reason', definition: 'An explanation for why something happens.' },
      { term: 'Compare', definition: 'To identify similarities and differences.' },
      { term: 'Summary', definition: 'A short version of the main points.' },
    ];
  }
}
