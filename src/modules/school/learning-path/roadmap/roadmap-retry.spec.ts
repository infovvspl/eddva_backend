import { FAILURE_BACKOFF_MS, FALLBACK_RETRY_MS, failureRetryDue, fallbackRetryDue } from './roadmap.service';

describe('roadmap retry timing', () => {
  const now = Date.parse('2026-10-23T06:00:00Z');
  const ago = (ms: number) => new Date(now - ms);

  it('tries a roadmap that has never failed straight away', () => {
    expect(failureRetryDue(0, ago(0), now)).toBe(true);
  });

  it('waits a minute after the first failure and five after the second, so a short outage cannot use up every attempt', () => {
    expect(FAILURE_BACKOFF_MS).toEqual([60_000, 300_000]);
    expect(failureRetryDue(1, ago(10_000), now)).toBe(false);
    expect(failureRetryDue(1, ago(60_000), now)).toBe(true);
    expect(failureRetryDue(2, ago(60_000), now)).toBe(false);
    expect(failureRetryDue(2, ago(300_000), now)).toBe(true);
  });

  it('keeps the longest wait for any later failure, and retries a row with no timestamp', () => {
    expect(failureRetryDue(7, ago(299_000), now)).toBe(false);
    expect(failureRetryDue(2, null, now)).toBe(true);
  });

  it('retries a fallback roadmap after an hour', () => {
    expect(FALLBACK_RETRY_MS).toBe(3_600_000);
    expect(fallbackRetryDue(ago(59 * 60_000), now)).toBe(false);
    expect(fallbackRetryDue(ago(60 * 60_000), now)).toBe(true);
    expect(fallbackRetryDue(undefined, now)).toBe(true);
  });
});
