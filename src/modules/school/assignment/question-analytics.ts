const round1 = (n: number) => Math.round(n * 10) / 10;

export interface QuestionInfo {
  id: string;
  position: number;
  text: string;
  type: string;
  marks: number;
  topicName: string | null;
  options?: { label: string; text: string }[] | null;
  correctAnswer?: string | null;
}

export interface AnswerInfo {
  questionId: string;
  answer: string | null;
  isCorrect: boolean | null;
  marksAwarded: number | null;
}

export const WEAK_TOPIC_THRESHOLD = 60;

/** Per-question and per-topic performance from the stored answers. */
export function buildQuestionAnalytics(questions: QuestionInfo[], answers: AnswerInfo[]) {
  const perQuestion = questions.map((q) => {
    const mine = answers.filter((a) => a.questionId === q.id);
    const graded = mine.filter((a) => a.marksAwarded != null);
    const awarded = graded.reduce((n, a) => n + (a.marksAwarded as number), 0);
    const avgPercent = graded.length && q.marks > 0 ? round1((awarded / graded.length / q.marks) * 100) : null;

    let optionCounts: Record<string, number> | null = null;
    let mostChosenWrong: string | null = null;
    if (q.options?.length) {
      optionCounts = Object.fromEntries(q.options.map((o) => [o.label, 0]));
      for (const a of mine) {
        for (const label of String(a.answer ?? '').split(',').filter(Boolean)) {
          if (label in optionCounts) optionCounts[label]++;
        }
      }
      const correct = new Set(String(q.correctAnswer ?? '').split(',').filter(Boolean));
      const wrong = Object.entries(optionCounts).filter(([label, n]) => !correct.has(label) && n > 0);
      wrong.sort((a, b) => b[1] - a[1]);
      mostChosenWrong = wrong[0]?.[0] ?? null;
    }
    const objectiveAnswers = mine.filter((a) => a.isCorrect != null);
    const correctCount = objectiveAnswers.filter((a) => a.isCorrect).length;
    return {
      id: q.id,
      position: q.position,
      text: q.text,
      type: q.type,
      marks: q.marks,
      topicName: q.topicName,
      attempts: mine.length,
      skipped: mine.filter((a) => !a.answer).length,
      correctCount: objectiveAnswers.length ? correctCount : null,
      correctPercent: objectiveAnswers.length ? Math.round((correctCount / objectiveAnswers.length) * 100) : null,
      avgPercent,
      optionCounts,
      mostChosenWrong,
    };
  });

  // Topic = marks earned / marks available across every graded answer on that topic.
  const topicMap = new Map<string, { earned: number; possible: number; questions: Set<string> }>();
  for (const q of questions) {
    const topic = q.topicName || 'General';
    for (const a of answers.filter((x) => x.questionId === q.id && x.marksAwarded != null)) {
      const t = topicMap.get(topic) ?? { earned: 0, possible: 0, questions: new Set<string>() };
      t.earned += a.marksAwarded as number;
      t.possible += q.marks;
      t.questions.add(q.id);
      topicMap.set(topic, t);
    }
  }
  const topics = Array.from(topicMap.entries())
    .map(([topic, t]) => {
      const avgPercent = t.possible > 0 ? round1((t.earned / t.possible) * 100) : null;
      return { topic, questions: t.questions.size, avgPercent, weak: avgPercent != null && avgPercent < WEAK_TOPIC_THRESHOLD };
    })
    .sort((a, b) => (a.avgPercent ?? 101) - (b.avgPercent ?? 101));

  return { questions: perQuestion, topics };
}
