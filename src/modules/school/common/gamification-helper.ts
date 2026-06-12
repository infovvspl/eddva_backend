import { DataSource } from 'typeorm';
import { Cache } from 'cache-manager';

export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateCurrentStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const todayStrLocal = getLocalDateString(new Date());
  const yesterdayStrLocal = getLocalDateString(new Date(Date.now() - 86400000));

  const dateSet = new Set(dates);

  let streak = 0;
  if (dateSet.has(todayStrLocal) || dateSet.has(yesterdayStrLocal)) {
    const startStr = dateSet.has(todayStrLocal) ? todayStrLocal : yesterdayStrLocal;
    const parts = startStr.split('-');
    const currentDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

    while (true) {
      const checkStr = getLocalDateString(currentDate);
      if (dateSet.has(checkStr)) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  return streak;
}

export async function recordStudentActivity(
  ds: DataSource,
  userId: string,
  activityType: string,
  cacheManager?: Cache,
) {
  try {
    const todayStr = getLocalDateString(new Date());
    await ds.query(
      `INSERT INTO student_activity (user_id, activity_date, activity_type)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT unique_user_date_type DO NOTHING`,
      [userId, todayStr, activityType],
    );

    // Fetch all activity dates
    const rows = await ds.query(
      `SELECT DISTINCT activity_date::text FROM student_activity
       WHERE user_id = $1
       ORDER BY activity_date DESC`,
      [userId],
    );

    const dates = rows.map((r: any) => r.activity_date);
    const streak = calculateCurrentStreak(dates);

    // Fetch or insert profile
    const exist = await ds.query(
      `SELECT longest_streak FROM gamification_profiles WHERE user_id = $1`,
      [userId],
    );

    let longestStreak = streak;
    if (exist.length > 0) {
      longestStreak = Math.max(Number(exist[0].longest_streak || 0), streak);
    }

    if (exist.length === 0) {
      await ds.query(
        `INSERT INTO gamification_profiles (user_id, xp, coins, level, badges, current_streak, longest_streak)
         VALUES ($1, 0, 0, 1, '[]', $2, $3)`,
        [userId, streak, longestStreak],
      );
    } else {
      await ds.query(
        `UPDATE gamification_profiles
         SET current_streak = $1, longest_streak = $2, updated_at = NOW()
         WHERE user_id = $3`,
        [streak, longestStreak, userId],
      );
    }

    if (cacheManager) {
      const cacheKey = `dashboard:${userId}`;
      await cacheManager.del(cacheKey);
    }
  } catch (err) {
    console.error('[recordStudentActivity Error]:', err.message);
  }
}
