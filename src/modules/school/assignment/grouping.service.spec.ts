import { GroupingService, GroupingStudent } from './grouping.service';

const pool = (n: number, scored = true): GroupingStudent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    name: `Student ${i}`,
    score: scored ? i : null,
  }));

const sizes = (g: { members: unknown[] }[]) => g.map((x) => x.members.length);

describe('GroupingService', () => {
  it('splits 42 students at size 4 into 11 even groups (no group of 2)', () => {
    const groups = GroupingService.createGroups(pool(42), { strategy: 'random', groupSize: 4 });
    expect(groups).toHaveLength(11);
    expect(Math.max(...sizes(groups)) - Math.min(...sizes(groups))).toBeLessThanOrEqual(1);
    expect(sizes(groups).reduce((a, b) => a + b, 0)).toBe(42);
  });

  it('honours an explicit group count', () => {
    const groups = GroupingService.createGroups(pool(10), { strategy: 'random', groupCount: 3 });
    expect(sizes(groups).sort()).toEqual([3, 3, 4]);
  });

  it('never creates more groups than students', () => {
    expect(GroupingService.createGroups(pool(3), { strategy: 'random', groupCount: 9 })).toHaveLength(3);
  });

  it('places every student exactly once', () => {
    for (const strategy of ['random', 'balanced'] as const) {
      const ids = GroupingService.createGroups(pool(23), { strategy, groupSize: 5 })
        .flatMap((g) => g.members.map((m) => m.id));
      expect(new Set(ids).size).toBe(23);
      expect(ids).toHaveLength(23);
    }
  });

  it('balanced keeps group averages close together', () => {
    const groups = GroupingService.createGroups(pool(40), { strategy: 'balanced', groupSize: 4 });
    const avgs = groups.map((g) => g.members.reduce((a, m) => a + (m.score ?? 0), 0) / g.members.length);
    expect(Math.max(...avgs) - Math.min(...avgs)).toBeLessThanOrEqual(2);
  });

  it('balanced works when nobody has a score', () => {
    const groups = GroupingService.createGroups(pool(9, false), { strategy: 'balanced', groupSize: 3 });
    expect(sizes(groups)).toEqual([3, 3, 3]);
  });

  it('manual returns empty groups to be filled by the teacher', () => {
    const groups = GroupingService.createGroups(pool(8), { strategy: 'manual', groupSize: 4 });
    expect(sizes(groups)).toEqual([0, 0]);
  });

  it('returns no groups for an empty pool and requires a size or count', () => {
    expect(GroupingService.createGroups([], { strategy: 'random', groupSize: 4 })).toEqual([]);
    expect(() => GroupingService.createGroups(pool(4), { strategy: 'random' })).toThrow();
  });
});
