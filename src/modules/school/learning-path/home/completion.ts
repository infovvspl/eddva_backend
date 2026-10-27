/**
 * Binary "finished" rollup for the per-subtopic learning paths, deliberately
 * separate from the continuous weak/at_risk/ok/mastered mastery model
 * (mastery-engine.ts): a topic can be "mastered" through evidence (an
 * assignment, a game) without a thread ever existing on it, while
 * "completed" here means specifically that its own thread(s) ran their
 * course. The two signals are allowed to disagree and are never merged.
 *
 * Pure, so the rollup rule itself is unit-tested here independent of the DB
 * shapes (`ThreadRow`, `SubtopicUnit`, ...) `home/mind-map.ts` reads it from.
 */

/**
 * A topic with subtopics is judged entirely by them: every one of its
 * (active) subtopics' own threads must be completed. A topic with none is
 * judged by its own thread, exactly as before this feature existed.
 */
export function topicCompleted(hasSubtopics: boolean, subtopicThreadStatuses: (string | null)[], topicThreadStatus: string | null): boolean {
  if (hasSubtopics) return subtopicThreadStatuses.length > 0 && subtopicThreadStatuses.every((s) => s === 'completed');
  return topicThreadStatus === 'completed';
}

/** Every topic in the chapter's full roadmap roster (not just whichever subset is shown) completed. */
export function chapterCompleted(topicCompletions: boolean[]): boolean {
  return topicCompletions.length > 0 && topicCompletions.every(Boolean);
}
