import { alertWeek, countReasons, digestMessage, findDefaulters, parentMessage } from './defaulters';

const row = (over: Record<string, unknown> = {}) => ({
  studentId: 's1', userId: 'u1', name: 'Meera Das', lastActiveDay: '2026-10-22', topicsStarted: 2, inactive: false,
  engagementLevel: 'high', engagementScore: 80, effortWithoutGain: false, seconds: 7200, improvement: 12, ...over,
});

describe('findDefaulters', () => {
  it('flags students who started and then stopped, are barely engaged, or study without improving', () => {
    const flags = findDefaulters([
      row({ studentId: 'ok' }),
      row({ studentId: 'stopped', inactive: true, lastActiveDay: '2026-10-01', engagementLevel: 'low' }),
      row({ studentId: 'low', engagementLevel: 'low', engagementScore: 20 }),
      row({ studentId: 'nogain', effortWithoutGain: true, improvement: -2 }),
      row({ studentId: 'both', engagementLevel: 'low', effortWithoutGain: true }),
    ]);
    expect(flags.map((f) => [f.studentId, f.reasons])).toEqual([
      ['stopped', ['stopped']], // a stopped student is not also "low engagement"
      ['low', ['low_engagement']],
      ['nogain', ['no_gain']],
      ['both', ['low_engagement', 'no_gain']],
    ]);
  });

  it('leaves out students who never opened the planner', () => {
    expect(findDefaulters([row({ lastActiveDay: null, topicsStarted: 0, inactive: true, engagementLevel: 'low' })])).toEqual([]);
    // but a student with a topic opened and no study counts as started
    expect(findDefaulters([row({ lastActiveDay: null, topicsStarted: 1, inactive: true })])).toHaveLength(1);
  });
});

describe('digest messages', () => {
  const flags = findDefaulters([
    row({ studentId: 'a', inactive: true }),
    row({ studentId: 'b', inactive: true }),
    row({ studentId: 'c', engagementLevel: 'low' }),
    row({ studentId: 'd', effortWithoutGain: true }),
  ]);

  it('counts each reason', () => {
    expect(countReasons(flags)).toEqual({ total: 4, stopped: 2, lowEngagement: 1, noGain: 1 });
  });

  it('summarises for the school and for a teacher, leaving out reasons with nobody', () => {
    expect(digestMessage(countReasons(flags), 'school').message).toBe(
      '4 students need attention in the AI Study Planner this week: 2 stopped studying, 1 with low engagement, 1 studying without improving.',
    );
    expect(digestMessage({ total: 1, stopped: 1, lowEngagement: 0, noGain: 0 }, 'teacher').message).toBe(
      '1 of your students needs attention in the AI Study Planner this week: 1 stopped studying.',
    );
  });
});

describe('parentMessage', () => {
  const [stopped] = findDefaulters([row({ inactive: true, lastActiveDay: '2026-10-15' })]);
  const [noGain] = findDefaulters([row({ effortWithoutGain: true, seconds: 7800 })]);
  const [low] = findDefaulters([row({ engagementLevel: 'low', engagementScore: 25 })]);

  it('names the child and says how long since they last studied', () => {
    expect(parentMessage(stopped, '2026-10-26')).toEqual({
      title: 'Meera has stopped using the AI Study Planner',
      message: 'Meera Das has not studied in the AI Study Planner for 11 days. A few minutes a day on the weak topics it suggests can make a big difference.',
    });
  });

  it('explains effort without improvement and low engagement', () => {
    expect(parentMessage(noGain, '2026-10-26').message).toContain('has studied 2 h 10 min in the AI Study Planner this month, but the scores');
    expect(parentMessage(low, '2026-10-26').message).toContain('engagement 25/100 this month');
  });
});

describe('alertWeek', () => {
  it('is the same key all week, and changes on Monday', () => {
    expect(alertWeek('2026-10-26')).toBe('week:2026-10-26'); // Monday
    expect(alertWeek('2026-11-01')).toBe('week:2026-10-26'); // Sunday
    expect(alertWeek('2026-11-02')).toBe('week:2026-11-02');
  });
});
