import { continuesSession, creditSeconds, DAILY_CAP_SECONDS, istDay } from './activity-credit';
import { streak } from './activity.service';

describe('streak', () => {
  it('counts consecutive days ending today', () => {
    expect(streak(['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-18'], '2026-10-22')).toBe(3);
  });

  it('keeps yesterday\'s streak alive before today\'s study', () => {
    expect(streak(['2026-10-21', '2026-10-20'], '2026-10-22')).toBe(2);
  });

  it('is zero after a missed day', () => {
    expect(streak(['2026-10-20'], '2026-10-22')).toBe(0);
    expect(streak([], '2026-10-22')).toBe(0);
  });
});

const NOW = new Date('2026-10-22T10:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('creditSeconds', () => {
  it('credits a normal 15 s heartbeat', () => {
    expect(creditSeconds({ beats: [15], now: NOW, lastCreditAt: ago(15), creditedTodaySeconds: 0 })).toBe(15);
  });

  it('caps one heartbeat at 20 s and ignores negative or junk values', () => {
    expect(creditSeconds({ beats: [3600], now: NOW, lastCreditAt: null, creditedTodaySeconds: 0 })).toBe(20);
    expect(creditSeconds({ beats: [-50, NaN as any], now: NOW, lastCreditAt: null, creditedTodaySeconds: 0 })).toBe(0);
  });

  it('never credits more than the time that actually passed (two tabs, too-fast beats)', () => {
    // A second tab's beat 4 s after the first tab's was credited.
    expect(creditSeconds({ beats: [15], now: NOW, lastCreditAt: ago(4), creditedTodaySeconds: 0 })).toBe(6);
    expect(creditSeconds({ beats: [15], now: NOW, lastCreditAt: NOW, creditedTodaySeconds: 0 })).toBe(2);
  });

  it('bounds a replayed offline batch by elapsed time and by 20 s per beat', () => {
    expect(creditSeconds({ beats: [15, 15, 15, 15], now: NOW, lastCreditAt: ago(600), creditedTodaySeconds: 0 })).toBe(60);
    expect(creditSeconds({ beats: [20, 20, 20], now: NOW, lastCreditAt: ago(30), creditedTodaySeconds: 0 })).toBe(32);
  });

  it('stops at the daily cap', () => {
    expect(creditSeconds({ beats: [15], now: NOW, lastCreditAt: ago(60), creditedTodaySeconds: DAILY_CAP_SECONDS - 5 })).toBe(5);
    expect(creditSeconds({ beats: [15], now: NOW, lastCreditAt: ago(60), creditedTodaySeconds: DAILY_CAP_SECONDS })).toBe(0);
  });
});

describe('continuesSession', () => {
  it('continues the same section within the gap', () => {
    expect(continuesSession({ key: 'notes|t|s', lastHeartbeatAt: ago(60) }, 'notes|t|s', NOW)).toBe(true);
  });

  it('starts a new visit after a long pause, a section change, or with no current visit', () => {
    expect(continuesSession({ key: 'notes|t|s', lastHeartbeatAt: ago(301) }, 'notes|t|s', NOW)).toBe(false);
    expect(continuesSession({ key: 'notes|t|s', lastHeartbeatAt: ago(10) }, 'quiz|t|q', NOW)).toBe(false);
    expect(continuesSession({ key: null, lastHeartbeatAt: null }, 'home||', NOW)).toBe(false);
  });
});

describe('istDay', () => {
  it('uses the Indian calendar day', () => {
    expect(istDay(new Date('2026-10-21T18:29:00Z'))).toBe('2026-10-21');
    expect(istDay(new Date('2026-10-21T18:31:00Z'))).toBe('2026-10-22');
  });
});
