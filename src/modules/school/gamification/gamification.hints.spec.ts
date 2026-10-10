import { BadRequestException } from '@nestjs/common';
import { GamificationService } from './gamification.service';

/**
 * Hints feature — unit tests (mocked DataSource, no Postgres).
 *
 * `ds.transaction` is mocked to run its callback against the SAME in-memory
 * tables as `ds.query`, which is enough to verify the business logic
 * (free-pool depletion order, the per-question purchase cap, the reward
 * penalty curve, and the coin-ledger subtraction in getMyProfile). It does
 * NOT prove real Postgres row-level locking under true concurrency — that
 * requires an integration test against a real database, which this suite
 * does not have access to.
 */
describe('GamificationService — hints', () => {
  let svc: GamificationService;
  let ds: any;

  let wallets: Map<string, { id: string; free_hints_total: number; free_hints_used: number }>;
  let ledger: Array<{ student_user_id: string; delta: number }>;
  let sessions: Map<string, any>;
  let grossCoins: number;
  let seq: number;
  let aiBridge: { resolveDoubt: jest.Mock };

  const STUDENT_USER_ID = 'student-1';
  const SESSION_ID = 'session-1';

  const makeSession = (gameType: string, questions: any[], status = 'active', id = SESSION_ID) => ({
    id,
    institute_id: 'inst-1',
    student_id: 'sp-1',
    student_user_id: STUDENT_USER_ID,
    game_type: gameType,
    status,
    metadata: { questions },
  });

  beforeEach(() => {
    wallets = new Map();
    ledger = [];
    sessions = new Map();
    grossCoins = 12; // gamification_profiles.coins for the test student
    seq = 0;

    const query = jest.fn(async (sql: string, params: any[] = []) => {
      // ── sessions ──
      if (/FROM school_game_sessions WHERE id::text=\$1::text AND student_user_id::text=\$2::text/.test(sql)) {
        const row = sessions.get(params[0]);
        return row && String(row.student_user_id) === String(params[1]) ? [row] : [];
      }
      if (/UPDATE school_game_sessions SET metadata/.test(sql)) {
        const row = sessions.get(params[0]);
        if (row) row.metadata = JSON.parse(params[1]);
        return [];
      }

      // ── hint wallets ──
      if (/INSERT INTO school_hint_wallets/.test(sql)) {
        const key = `${params[0]}|${params[1]}`;
        if (!wallets.has(key)) {
          wallets.set(key, { id: `w${++seq}`, free_hints_total: Number(params[2]), free_hints_used: 0 });
        }
        return [];
      }
      if (/FROM school_hint_wallets WHERE student_user_id::text=\$1::text AND game_type=\$2/.test(sql)) {
        const key = `${params[0]}|${params[1]}`;
        const w = wallets.get(key);
        return w ? [{ ...w, student_user_id: params[0], game_type: params[1] }] : [];
      }
      if (/UPDATE school_hint_wallets SET free_hints_used/.test(sql)) {
        for (const w of wallets.values()) {
          if (w.id === params[0]) w.free_hints_used += 1;
        }
        return [];
      }

      // ── coin/xp sources shared by getGrossCoins() AND getMyProfile()'s own
      // inline queries (same WHERE shape, different column lists — one mock
      // row satisfies both). ──
      if (/FROM gamification_profiles\s+WHERE user_id/.test(sql)) {
        return [{
          coins: grossCoins, xp: 0, level: 1, badges: [], current_streak: 0, longest_streak: 0,
          memory_score: 75, learning_score: 80, focus_score: 85,
          current_difficulty: 'Intermediate', rank_tier: 'Gold', league_name: 'Gold League',
        }];
      }
      if (/FROM users WHERE id::text/.test(sql)) return [{ xp_total: 0, current_streak: 0, longest_streak: 0 }];
      if (/FROM students WHERE user_id::text = \$1::text OR id::text/.test(sql)) {
        return [{ xp_total: 0, eddva_coins: 0, current_streak: 0, longest_streak: 0 }];
      }
      if (/COALESCE\(SUM\(coins_earned\)/.test(sql)) return [{ total_xp: 0, total_coins: 0 }];

      // ── coin ledger ──
      if (/COALESCE\(SUM\(-delta\)/.test(sql)) {
        const spent = ledger
          .filter((l) => String(l.student_user_id) === String(params[0]) && l.delta < 0)
          .reduce((sum, l) => sum - l.delta, 0);
        return [{ total_spent: spent }];
      }
      if (/INSERT INTO school_coin_ledger/.test(sql)) {
        ledger.push({ student_user_id: params[0], delta: Number(params[1]) });
        return [];
      }

      // ── institute board lookup (resolveBoard, used when generating AI hints) ──
      if (/FROM institutes WHERE id/.test(sql)) return [];

      return [];
    });

    ds = {
      query,
      transaction: jest.fn(async (cb: any) => cb({ query })),
    };

    // Defaults to "no AI response" so tests that don't care about hint
    // *content* exercise the (already well-covered) local fallback ladder.
    aiBridge = { resolveDoubt: jest.fn().mockResolvedValue({ answer: '' }) };

    svc = new GamificationService(ds, {} as any, aiBridge as any);
  });

  const Q = (id: string, correctContent = 'B') => ({
    id,
    content: `Question ${id}`,
    explanation: 'Recall the chapter on photosynthesis. Light reactions happen in the thylakoid. The answer involves chlorophyll.',
    options: [
      { id: 'a', content: 'A', isCorrect: false },
      { id: 'b', content: correctContent, isCorrect: true },
      { id: 'c', content: 'C', isCorrect: false },
      { id: 'd', content: 'D', isCorrect: false },
    ],
  });

  describe('gradeMcqRun — reward penalty curve', () => {
    const grade = (hintsUsed: number) =>
      (svc as any).gradeMcqRun([Q('q1')], [{ questionId: 'q1', selectedOptionId: 'b', timeTakenSeconds: 20, hintsUsed }], false);

    it('0 hints — full reward', () => {
      const r = grade(0);
      expect(r.xpEarned).toBe(10);
      expect(r.coinsEarned).toBe(1);
    });

    it('1 hint — 75% of reward', () => {
      const r = grade(1);
      expect(r.xpEarned).toBeCloseTo(7.5);
      expect(r.coinsEarned).toBeCloseTo(0.75);
    });

    it('2 hints — 50% of reward', () => {
      const r = grade(2);
      expect(r.xpEarned).toBeCloseTo(5);
      expect(r.coinsEarned).toBeCloseTo(0.5);
    });

    it('3 hints — floors at 25%, never zero', () => {
      const r = grade(3);
      expect(r.xpEarned).toBeCloseTo(2.5);
      expect(r.coinsEarned).toBeCloseTo(0.25);
    });

    it('5 hints (max purchasable) — still floors at 25%, does not go negative or to zero', () => {
      const r = grade(5);
      expect(r.xpEarned).toBeCloseTo(2.5);
      expect(r.coinsEarned).toBeCloseTo(0.25);
    });

    it('an incorrect answer earns nothing regardless of hints used', () => {
      const r = (svc as any).gradeMcqRun(
        [Q('q1')],
        [{ questionId: 'q1', selectedOptionId: 'a', timeTakenSeconds: 20, hintsUsed: 2 }],
        false,
      );
      expect(r.xpEarned).toBe(0);
      expect(r.coinsEarned).toBe(0);
      expect(r.correctAnswers).toBe(0);
    });

    it('records hintsUsed on the graded answer', () => {
      const r = grade(2);
      expect(r.gradedAnswers[0].hintsUsed).toBe(2);
    });
  });

  describe('requestHint — free pool, then coins, then the per-question cap', () => {
    const user = { id: STUDENT_USER_ID, studentProfile: { id: 'sp-1' } };

    it('the first 3 hints on a game type are free, in order, across different questions', async () => {
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1'), Q('q2'), Q('q3')]));

      const r1 = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });
      expect(r1.source).toBe('free');
      expect(r1.freeRemaining).toBe(2);

      const r2 = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q2' });
      expect(r2.source).toBe('free');
      expect(r2.freeRemaining).toBe(1);

      const r3 = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q3' });
      expect(r3.source).toBe('free');
      expect(r3.freeRemaining).toBe(0);

      expect(ledger).toHaveLength(0); // no coins spent yet
    });

    it('the 4th hint for that game type must be bought, and deducts coins via the ledger', async () => {
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1'), Q('q2'), Q('q3'), Q('q4')]));
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q2' });
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q3' });

      const r4 = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q4' });
      expect(r4.source).toBe('purchased');
      expect(r4.coins).toBe(grossCoins - 5);
      expect(ledger).toEqual([{ student_user_id: STUDENT_USER_ID, delta: -5 }]);
    });

    it('rejects a purchase when the student cannot afford it', async () => {
      grossCoins = 2; // less than the 5-coin hint cost
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1'), Q('q2'), Q('q3'), Q('q4')]));
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q2' });
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q3' });

      await expect(svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q4' })).rejects.toBeInstanceOf(BadRequestException);
      expect(ledger).toHaveLength(0);
    });

    it('caps bought hints at 2 per question even with plenty of coins', async () => {
      grossCoins = 1000;
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1')]));
      // Burn the free pool elsewhere first isn't needed here — spend all 3 free + 2 bought on q1 itself.
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' }); // free 1/3
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' }); // free 2/3
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' }); // free 3/3
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' }); // bought 1/2
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' }); // bought 2/2

      await expect(svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' })).rejects.toBeInstanceOf(BadRequestException);
      expect(ledger).toHaveLength(2); // only 2 purchases ever went through
    });

    it('the free pool for one game type does not leak into another', async () => {
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1'), Q('q2'), Q('q3')]));
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q2' });
      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q3' }); // quiz_rush free pool now empty

      sessions.set('session-2', makeSession('math_sprint', [Q('m1')], 'active', 'session-2'));
      const r = await svc.requestHint(user, { sessionId: 'session-2', questionId: 'm1' });
      expect(r.source).toBe('free'); // math_sprint has its own separate 3
      expect(r.freeRemaining).toBe(2);
    });

    it('rejects hints on a completed session', async () => {
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1')], 'completed'));
      await expect(svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects hints for a game type that is not hint-eligible', async () => {
      sessions.set(SESSION_ID, makeSession('memory_match', [Q('q1')]));
      await expect(svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never reveals the literal correct-option text in the hint', async () => {
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1', 'Chlorophyll')]));
      const r = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });
      expect((r as any).hintText.toLowerCase()).not.toContain('chlorophyll');
    });
  });

  describe('requestHint — AI-generated, question-specific hints', () => {
    const user = { id: STUDENT_USER_ID, instituteId: 'inst-1', studentProfile: { id: 'sp-1', className: 'Class 10' } };

    it('uses the AI-provided hint text when the AI call succeeds', async () => {
      aiBridge.resolveDoubt.mockResolvedValue({
        answer: 'Hint 1: Think about the law governing light bouncing off a flat surface.\nHint 2: The angle measured from the normal matters here.\nHint 3: Incoming and outgoing angles follow the same rule.',
      });
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1', '30')]));

      const r = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });

      expect((r as any).hintText).toBe('Think about the law governing light bouncing off a flat surface.');
      expect(aiBridge.resolveDoubt).toHaveBeenCalledTimes(1);
    });

    it('calls the AI only once per question — later hints on the same question reuse the cached ladder', async () => {
      aiBridge.resolveDoubt.mockResolvedValue({
        answer: 'Hint 1: First clue.\nHint 2: Second clue.\nHint 3: Third clue.',
      });
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1', '30')]));

      await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });
      const r2 = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });

      expect((r2 as any).hintText).toBe('Second clue.');
      expect(aiBridge.resolveDoubt).toHaveBeenCalledTimes(1);
    });

    it('falls back to the local ladder if every AI-returned line leaks the answer', async () => {
      aiBridge.resolveDoubt.mockResolvedValue({
        answer: 'Hint 1: The answer is 30.\nHint 2: It is definitely 30.\nHint 3: 30 is correct.',
      });
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1', '30')]));

      const r = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });

      expect((r as any).hintText.toLowerCase()).not.toContain('30');
    });

    it('falls back to the local ladder if the AI call rejects, without failing the request', async () => {
      aiBridge.resolveDoubt.mockRejectedValue(new Error('AI service unavailable'));
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1')]));

      const r = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });

      expect(typeof (r as any).hintText).toBe('string');
      expect((r as any).hintText.length).toBeGreaterThan(0);
    });

    it('still charges the wallet/coins correctly on the AI-backed path', async () => {
      aiBridge.resolveDoubt.mockResolvedValue({ answer: 'Hint 1: A.\nHint 2: B.\nHint 3: C.' });
      sessions.set(SESSION_ID, makeSession('quiz_rush', [Q('q1')]));

      const r = await svc.requestHint(user, { sessionId: SESSION_ID, questionId: 'q1' });

      expect(r.source).toBe('free');
      expect(r.freeRemaining).toBe(2);
    });
  });

  describe('requestHint — Word Master letter reveal', () => {
    const user = { id: STUDENT_USER_ID, studentProfile: { id: 'sp-1' } };

    const makeWordMasterSession = (words: any[], id = SESSION_ID) => ({
      id,
      institute_id: 'inst-1',
      student_id: 'sp-1',
      student_user_id: STUDENT_USER_ID,
      game_type: 'word_master',
      status: 'active',
      metadata: { words },
    });

    it('the first hint reveals exactly one letter from the start of the word', async () => {
      sessions.set(SESSION_ID, makeWordMasterSession([{ word: 'PHOTOSYNTHESIS', scrambled: 'X', hint: 'h', length: 14 }]));

      const r: any = await svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 });

      expect(r.revealPattern).toBe('P_____________');
      expect(r.hintsUsedThisQuestion).toBe(1);
      expect(r.source).toBe('free');
      expect(r.hintText).toBeUndefined();
    });

    it('a second hint on the same word reveals two letters, cumulatively', async () => {
      sessions.set(SESSION_ID, makeWordMasterSession([{ word: 'PHOTOSYNTHESIS', scrambled: 'X', hint: 'h', length: 14 }]));

      await svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 });
      const r: any = await svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 });

      expect(r.revealPattern).toBe('PH____________');
    });

    it('never reveals past (word length - 2) letters, even with free hints and coins to spare', async () => {
      grossCoins = 1000;
      // 4-letter word: free pool alone (3) would reveal all-but-one — capped at length-2 = 2 instead.
      sessions.set(SESSION_ID, makeWordMasterSession([{ word: 'IRON', scrambled: 'X', hint: 'h', length: 4 }]));

      const r1: any = await svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 });
      expect(r1.revealPattern).toBe('I___');
      const r2: any = await svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 });
      expect(r2.revealPattern).toBe('IR__');

      await expect(svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('has its own free-hint pool, separate from the MCQ games', async () => {
      sessions.set(SESSION_ID, makeWordMasterSession([{ word: 'OXYGEN', scrambled: 'X', hint: 'h', length: 6 }]));
      sessions.set('mcq-session', makeSession('quiz_rush', [Q('q1'), Q('q2'), Q('q3')], 'active', 'mcq-session'));

      await svc.requestHint(user, { sessionId: 'mcq-session', questionId: 'q1' });
      await svc.requestHint(user, { sessionId: 'mcq-session', questionId: 'q2' });
      await svc.requestHint(user, { sessionId: 'mcq-session', questionId: 'q3' }); // quiz_rush pool now empty

      const r: any = await svc.requestHint(user, { sessionId: SESSION_ID, wordIndex: 0 });
      expect(r.source).toBe('free'); // word_master still has its own 3
      expect(r.freeRemaining).toBe(2);
    });

    it('requires a wordIndex', async () => {
      sessions.set(SESSION_ID, makeWordMasterSession([{ word: 'OXYGEN', scrambled: 'X', hint: 'h', length: 6 }]));
      await expect(svc.requestHint(user, { sessionId: SESSION_ID } as any)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('submitWordMaster — hints discount XP/coins the same way as the other games', () => {
    it('scales reward by the hint-weighted effective correct count', async () => {
      const user = { id: STUDENT_USER_ID, studentProfile: { id: 'sp-1' } };
      sessions.set(SESSION_ID, {
        id: SESSION_ID,
        institute_id: 'inst-1',
        student_id: 'sp-1',
        student_user_id: STUDENT_USER_ID,
        subject_id: 'sub-1',
        chapter_id: null,
        game_type: 'word_master',
        status: 'active',
        play_mode: 'free_play',
        metadata: {
          words: [
            { word: 'IRON', scrambled: 'X', hint: 'h', length: 4 },
            { word: 'ZINC', scrambled: 'X', hint: 'h', length: 4 },
            { word: 'GOLD', scrambled: 'X', hint: 'h', length: 4 },
          ],
        },
      });

      const result: any = await svc.submitWordMaster(user, {
        sessionId: SESSION_ID,
        answers: [
          { index: 0, word: 'IRON', hintsUsed: 0 },
          { index: 1, word: 'ZINC', hintsUsed: 1 },
          { index: 2, word: 'GOLD', hintsUsed: 2 },
        ],
        tabSwitchesCount: 0,
        timeTakenSeconds: 60,
      });

      // effectiveCorrect = 1 (0 hints) + 0.75 (1 hint) + 0.5 (2 hints) = 2.25.
      // submitWordMaster's return goes through resultPayload(), which rounds
      // for display — 2.25*15=33.75 -> 34, 2.25 -> 2 — still well short of
      // the unpenalized 3*15=45 XP / 3 coins a hint-free run would earn.
      expect(result.xpEarned).toBe(34);
      expect(result.coinsEarned).toBe(2);
    });
  });

  describe('completeTreasureStage — hints discount its own XP/coin formula too', () => {
    // Regression test: this stage computes xpEarned/coinsEarned from
    // result.correctAnswers directly (its own point scale), NOT from
    // gradeMcqRun's xpEarned/coinsEarned fields — so the hint penalty has to
    // be re-applied explicitly here, or it silently has no effect at all.
    it('scales XP by a hint-weighted effective correct count, and coins by the average multiplier', async () => {
      const user = { id: STUDENT_USER_ID, studentProfile: { id: 'sp-1' } };
      const treasureSessionId = 'treasure-session-1';
      sessions.set(treasureSessionId, {
        id: treasureSessionId,
        institute_id: 'inst-1',
        student_id: 'sp-1',
        student_user_id: STUDENT_USER_ID,
        subject_id: 'sub-1',
        chapter_id: null,
        game_type: 'treasure_hunt',
        status: 'active',
        play_mode: 'free_play',
        metadata: { questions: [Q('t1'), Q('t2'), Q('t3')], stageOrder: 1 },
      });

      const result = await svc.completeTreasureStage(user, {
        sessionId: treasureSessionId,
        answers: [
          { questionId: 't1', selectedOptionId: 'b', timeTakenSeconds: 20, hintsUsed: 0 },
          { questionId: 't2', selectedOptionId: 'b', timeTakenSeconds: 20, hintsUsed: 1 },
          { questionId: 't3', selectedOptionId: 'b', timeTakenSeconds: 20, hintsUsed: 2 },
        ],
        tabSwitchesCount: 0,
        timeTakenSeconds: 60,
      });

      expect(result.passed).toBe(true);
      // effectiveCorrect = 1 (0 hints) + 0.75 (1 hint) + 0.5 (2 hints) = 2.25
      // xpEarned = 2.25 * 20 + 20 = 65 (not the unpenalized 3*20+20 = 80)
      expect(result.xpEarned).toBeCloseTo(65);
      // avgMultiplier = 2.25 / 3 = 0.75 → coinsEarned = 8 * 0.75 = 6 (not the flat 8)
      expect(result.coinsEarned).toBeCloseTo(6);
    });
  });

  describe('getMyProfile — coin ledger nets out spend', () => {
    it('subtracts total ledger spend from the gross MAX() balance', async () => {
      ledger.push({ student_user_id: STUDENT_USER_ID, delta: -5 });
      ledger.push({ student_user_id: STUDENT_USER_ID, delta: -5 });

      const profile = await svc.getMyProfile({ id: STUDENT_USER_ID, instituteId: 'inst-1', studentProfile: { id: 'sp-1', instituteId: 'inst-1', classId: 'c1' } });
      expect(profile.coins).toBe(grossCoins - 10);
    });

    it('never returns negative coins even if spend exceeds the gross balance', async () => {
      grossCoins = 3;
      ledger.push({ student_user_id: STUDENT_USER_ID, delta: -5 });

      const profile = await svc.getMyProfile({ id: STUDENT_USER_ID, instituteId: 'inst-1', studentProfile: { id: 'sp-1', instituteId: 'inst-1', classId: 'c1' } });
      expect(profile.coins).toBe(0);
    });
  });
});
