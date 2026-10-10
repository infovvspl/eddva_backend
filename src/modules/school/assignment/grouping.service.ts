export type GroupingStrategy = 'balanced' | 'random' | 'manual';

export interface GroupingStudent {
  id: string;
  name: string;
  rollNo?: string | null;
  /** Past performance (0-100). Only used by the balanced strategy. */
  score?: number | null;
}

export interface GeneratedGroup {
  groupNumber: number;
  name: string;
  members: GroupingStudent[];
}

export interface CreateGroupsOptions {
  strategy: GroupingStrategy;
  groupSize?: number;
  groupCount?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export const MAX_GROUP_SIZE = 50;

/**
 * Splits a student pool into assignment-specific groups. Pure and free of any
 * DB / Nest dependencies. Group sizes always differ by at most one, so a
 * remainder never leaves a tiny leftover group (e.g. 42 students at size 4 ->
 * 11 groups: nine of 4 and two of 3, rather than ten of 4 and one of 2).
 */
export class GroupingService {
  static groupName(groupNumber: number): string {
    return `Group ${groupNumber}`;
  }

  /** Number of groups needed for a target size / explicit count. */
  static computeGroupCount(total: number, opts: Pick<CreateGroupsOptions, 'groupSize' | 'groupCount'>): number {
    if (total <= 0) return 0;
    let count: number;
    if (opts.groupCount && opts.groupCount > 0) {
      count = Math.floor(opts.groupCount);
    } else if (opts.groupSize && opts.groupSize > 0) {
      count = Math.ceil(total / Math.floor(opts.groupSize));
    } else {
      throw new Error('groupSize or groupCount is required');
    }
    return Math.min(Math.max(count, 1), total);
  }

  static createGroups(students: GroupingStudent[], opts: CreateGroupsOptions): GeneratedGroup[] {
    const unique = Array.from(new Map(students.map((s) => [s.id, s])).values());
    const count = GroupingService.computeGroupCount(unique.length, opts);
    const groups: GeneratedGroup[] = Array.from({ length: count }, (_, i) => ({
      groupNumber: i + 1,
      name: GroupingService.groupName(i + 1),
      members: [],
    }));
    if (count === 0 || opts.strategy === 'manual') return groups;

    const rand = opts.random ?? Math.random;
    const shuffled = GroupingService.shuffle(unique, rand);

    if (opts.strategy === 'random') {
      GroupingService.dealEvenly(shuffled, groups);
      return groups;
    }

    // balanced: rank by score (unscored students get the pool median so they
    // don't skew one group), then deal in a snake so each group gets a mix of
    // strong and weak students. The shuffle above randomises ties.
    const scored = unique
      .map((s) => s.score)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const median = scored.length ? scored[Math.floor(scored.length / 2)] : 0;
    const ranked = [...shuffled].sort(
      (a, b) => (b.score ?? median) - (a.score ?? median),
    );
    GroupingService.dealSnake(ranked, groups);
    return groups;
  }

  private static shuffle<T>(items: T[], rand: () => number): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Fill groups so sizes differ by at most one (first `rem` groups get +1). */
  private static dealEvenly(students: GroupingStudent[], groups: GeneratedGroup[]) {
    const base = Math.floor(students.length / groups.length);
    const rem = students.length % groups.length;
    let cursor = 0;
    groups.forEach((g, i) => {
      const size = base + (i < rem ? 1 : 0);
      g.members = students.slice(cursor, cursor + size);
      cursor += size;
    });
  }

  /**
   * Snake deal (0..n-1, n-1..0, ...) skipping groups that already reached
   * their even target size, so sizes still differ by at most one.
   */
  private static dealSnake(ranked: GroupingStudent[], groups: GeneratedGroup[]) {
    const n = groups.length;
    const base = Math.floor(ranked.length / n);
    const rem = ranked.length % n;
    const capacity = groups.map((_, i) => base + (i < rem ? 1 : 0));
    let round = 0;
    let placed = 0;
    while (placed < ranked.length) {
      const order = Array.from({ length: n }, (_, i) => (round % 2 === 0 ? i : n - 1 - i));
      for (const gi of order) {
        if (placed >= ranked.length) break;
        if (groups[gi].members.length >= capacity[gi]) continue;
        groups[gi].members.push(ranked[placed++]);
      }
      round++;
    }
  }
}
