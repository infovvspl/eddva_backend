import { summarizeMap } from './learning-home.service';
import { buildMindMap, chapterScope, ChapterRow, MasteryRow, MindMapInput, RoadmapInfo, subtopicStatus, ThreadRow, TopicUnit } from './mind-map';

const chapter = (subjectId: string, chapterId: string, chapterName: string): ChapterRow => ({
  subjectId, subjectName: subjectId === 's1' ? 'Maths' : 'Science', chapterId, chapterName, chapterOrder: 0,
});
const m = (status: string, mastery: number | null, estMinutes = 0, chapterLevelStatus?: string): MasteryRow => ({ status, mastery, estMinutes, chapterLevelStatus });
const sub = (id: string, name: string) => ({ id, name });
const unit = (
  id: string,
  chapterId: string,
  name: string,
  kind: 'roadmap' | 'recorded',
  ord: number | null = null,
  subtopics: { id: string; name: string }[] = [],
): TopicUnit => ({ id, chapterId, name, ord, subtopics, kind });
const thresholds = { minQuestions: 2, weakBelow: 60, atRisk: 70, mastered: 85 };

const c1Roadmap: RoadmapInfo = {
  state: 'ready', source: 'ai',
  topics: [
    { id: 'r3', ord: 1, name: 'Standard form', subtopics: [sub('s-gf', 'General form')] },
    { id: 'r1', ord: 2, name: 'Discriminant', subtopics: [sub('s-df', 'Discriminant formula'), sub('s-sd', 'Sign of the discriminant')] },
    { id: 'r2', ord: 3, name: 'Roots', subtopics: [sub('s-rr', 'Real roots')] },
  ],
};

const input = (over: Partial<MindMapInput> = {}): MindMapInput => ({
  chapters: [chapter('s1', 'c1', 'Quadratics'), chapter('s1', 'c2', 'Triangles'), chapter('s2', 'c3', 'Acids'), chapter('s2', 'c4', 'Light')],
  chapterRoadmaps: new Map([['c1', c1Roadmap]]),
  units: [
    unit('r3', 'c1', 'Standard form', 'roadmap', 1, [sub('s-gf', 'General form')]),
    unit('r1', 'c1', 'Discriminant', 'roadmap', 2, [sub('s-df', 'Discriminant formula'), sub('s-sd', 'Sign of the discriminant')]),
    unit('r2', 'c1', 'Roots', 'roadmap', 3, [sub('s-rr', 'Real roots')]),
    unit('k4', 'c2', 'SIMILARITY', 'recorded'),
    unit('k6', 'c2', 'PYTHAGORAS THEOREM', 'recorded'),
    unit('r7', 'c2', 'Basic proportionality theorem', 'roadmap', null, [sub('s-st', 'Statement'), sub('s-pr', 'Proof')]),
    unit('k5', 'c4', 'REFLECTION', 'recorded'),
  ],
  topicMastery: new Map([
    ['r1', m('weak', 30, 50)],
    ['r2', m('at_risk', 60, 35)],
    ['r3', m('mastered', 90)],
    ['k4', m('ok', 75)],
    ['k6', m('weak', 40, 45)],
    ['r7', m('at_risk', 55, 30)],
  ]),
  chapterMastery: new Map([
    ['c1', m('weak', 45, 85)],
    ['c2', m('ok', 72)],
    ['c3', m('weak', 20, 60)],
    ['c4', m('ok', 80)],
  ]),
  threads: [],
  scores: new Map([['r1', new Map([['discriminant formula', { correct: 1, total: 4 }], ['sign of the discriminant', { correct: 1, total: 1 }]])]]),
  thresholds,
  ...over,
});

const find = (result: ReturnType<typeof buildMindMap>, chapterId: string) =>
  result.subjects.flatMap((s) => s.chapters).find((c) => c.chapterId === chapterId);

describe('subtopicStatus', () => {
  it.each([
    [0, 0, 'not_assessed'],
    [1, 1, 'insufficient_data'],
    [1, 4, 'weak'],
    [13, 20, 'at_risk'],
    [3, 4, 'ok'],
    [9, 10, 'mastered'],
  ])('%p of %p correct is %p', (correct, total, status) => {
    expect(subtopicStatus(correct, total, thresholds)).toBe(status);
  });
});

describe('buildMindMap', () => {
  it('shows a weak chapter as its chapter roadmap: all topics in order, with subtopics', () => {
    const c1 = find(buildMindMap(input()), 'c1')!;
    expect(c1).toMatchObject({ expanded: true, roadmapState: 'ready', estMinutes: 85 });
    expect(c1.topics.map((t) => [t.order, t.name, t.status, t.roadmapState])).toEqual([
      [1, 'Standard form', 'mastered', 'ready'],
      [2, 'Discriminant', 'weak', 'ready'],
      [3, 'Roots', 'at_risk', 'ready'],
    ]);
    expect(c1.topics[1].subtopics).toEqual([
      { id: 's-df', name: 'Discriminant formula', order: 1, status: 'weak', accuracy: 25, answered: 4, thread: null },
      { id: 's-sd', name: 'Sign of the discriminant', order: 2, status: 'insufficient_data', accuracy: 100, answered: 1, thread: null },
    ]);
  });

  it('in a chapter that is fine, shows only the weak topics with their own topic roadmap, not the chapter roadmap', () => {
    const result = buildMindMap(input());
    const c2 = find(result, 'c2')!;
    expect(c2).toMatchObject({ expanded: false, roadmapState: null });
    expect(c2.topics.map((t) => [t.topicId, t.roadmapState, t.subtopics.length])).toEqual([
      ['k6', 'pending', 0],
      ['r7', 'ready', 2],
    ]);
    expect(result.topicRoadmapsNeeded).toEqual([{ chapterId: 'c2', topicId: 'k6' }]);
    expect(result.chapterRoadmapsNeeded).not.toContain('c2');
  });

  it('shows a weak chapter without a roadmap yet as preparing, and asks for one', () => {
    const result = buildMindMap(input());
    expect(find(result, 'c3')).toMatchObject({ expanded: true, roadmapState: 'pending', topics: [], estMinutes: 60 });
    expect(result.chapterRoadmapsNeeded).toEqual(['c3']);
  });

  it('does not show or generate anything for chapters with nothing weak', () => {
    const result = buildMindMap(input());
    expect(find(result, 'c4')).toBeUndefined();
    expect(result.subjects.find((s) => s.name === 'Science')!.hiddenChapters).toBe(1);
  });

  it('keeps a topic with a chat visible and hangs suggested prerequisites under it', () => {
    const threads: ThreadRow[] = [
      { id: 'th4', topicId: 'r7', subtopicId: null, status: 'active', round: 2, parentThreadId: null },
      { id: 'th1', topicId: 'r1', subtopicId: null, status: 'suggested', round: 1, parentThreadId: 'th4' },
    ];
    const r7 = find(buildMindMap(input({ threads, topicMastery: new Map([['r7', m('ok', 75)]]) })), 'c2')!.topics.find((t) => t.topicId === 'r7')!;
    expect(r7.thread).toEqual({ id: 'th4', status: 'active', round: 2, stepsDone: 0 });
    expect(r7.children).toEqual([{ threadId: 'th1', topicId: 'r1', name: 'Discriminant', status: 'suggested', stepsDone: 0, subtopicId: null }]);
  });

  it('keeps a topic with subtopics visible once any of them has a chat, even if the topic itself is not weak', () => {
    const threads: ThreadRow[] = [{ id: 'th-st', topicId: 'r7', subtopicId: 's-st', status: 'active', round: 1, parentThreadId: null }];
    const c2 = find(buildMindMap(input({ threads, topicMastery: new Map([['r7', m('ok', 75)]]) })), 'c2')!;
    expect(c2.topics.map((t) => t.topicId)).toContain('r7');
  });

  it('shows a "weak chapter" whose marks all come from one weak topic as that topic, not a chapter roadmap', () => {
    // c2 is weak overall, but only PYTHAGORAS THEOREM (k6) is weak: one test covered just that topic
    const result = buildMindMap(input({
      chapterMastery: new Map([['c1', m('weak', 45, 85)], ['c2', m('weak', 40, 45, 'not_assessed')], ['c3', m('weak', 20, 60)], ['c4', m('ok', 80)]]),
      topicMastery: new Map([['r1', m('weak', 30, 50)], ['r2', m('at_risk', 60, 35)], ['k6', m('weak', 40, 45)]]),
    }));
    const c2 = find(result, 'c2')!;
    expect(c2).toMatchObject({ expanded: false, roadmapState: null });
    expect(c2.topics.map((t) => t.topicId)).toEqual(['k6']);
    expect(result.chapterRoadmapsNeeded).not.toContain('c2');
    expect(result.topicRoadmapsNeeded).toContainEqual({ chapterId: 'c2', topicId: 'k6' });
    // the subject counts only chapters shown as chapters
    expect(result.subjects.find((s) => s.name === 'Maths')!.weakChapters).toBe(1);
  });

  it('keeps the chapter roadmap when the chapter-level marks (e.g. games) are weak too', () => {
    const result = buildMindMap(input({
      chapterMastery: new Map([['c1', m('weak', 45, 85)], ['c2', m('weak', 40, 45, 'weak')], ['c3', m('weak', 20, 60)], ['c4', m('ok', 80)]]),
      topicMastery: new Map([['k6', m('weak', 40, 45)]]),
    }));
    expect(find(result, 'c2')).toMatchObject({ expanded: true });
  });

  it('gives each subtopic its own thread, independent of its siblings', () => {
    const threads: ThreadRow[] = [{ id: 'th-sd', topicId: 'r1', subtopicId: 's-sd', status: 'active', round: 1, parentThreadId: null }];
    const r1 = find(buildMindMap(input({ threads })), 'c1')!.topics.find((t) => t.topicId === 'r1')!;
    expect(r1.subtopics.map((s) => [s.name, s.thread])).toEqual([
      ['Discriminant formula', null],
      ['Sign of the discriminant', { id: 'th-sd', status: 'active', round: 1, stepsDone: 0 }],
    ]);
  });

  it('marks a topic with subtopics completed only once every one of them is, not merely started', () => {
    const oneDone: ThreadRow[] = [
      { id: 't1', topicId: 'r1', subtopicId: 's-df', status: 'completed', round: 1, parentThreadId: null },
      { id: 't2', topicId: 'r1', subtopicId: 's-sd', status: 'active', round: 1, parentThreadId: null },
    ];
    const r1 = find(buildMindMap(input({ threads: oneDone })), 'c1')!.topics.find((t) => t.topicId === 'r1')!;
    expect(r1.completed).toBe(false);

    const bothDone: ThreadRow[] = [
      { id: 't1', topicId: 'r1', subtopicId: 's-df', status: 'completed', round: 1, parentThreadId: null },
      { id: 't2', topicId: 'r1', subtopicId: 's-sd', status: 'completed', round: 1, parentThreadId: null },
    ];
    const r1Done = find(buildMindMap(input({ threads: bothDone })), 'c1')!.topics.find((t) => t.topicId === 'r1')!;
    expect(r1Done.completed).toBe(true);
  });

  it('marks a topic with no subtopics completed from its own thread', () => {
    const threads: ThreadRow[] = [{ id: 't1', topicId: 'k6', subtopicId: null, status: 'completed', round: 1, parentThreadId: null }];
    const c2 = find(buildMindMap(input({ threads, topicMastery: new Map([['k6', m('weak', 40, 45)]]) })), 'c2')!;
    expect(c2.topics.find((t) => t.topicId === 'k6')!.completed).toBe(true);
  });

  it('marks a chapter completed only once every topic of its full roadmap roster is, not just the ones shown', () => {
    const allDone: ThreadRow[] = [
      { id: 't1', topicId: 'r3', subtopicId: 's-gf', status: 'completed', round: 1, parentThreadId: null },
      { id: 't2', topicId: 'r1', subtopicId: 's-df', status: 'completed', round: 1, parentThreadId: null },
      { id: 't3', topicId: 'r1', subtopicId: 's-sd', status: 'completed', round: 1, parentThreadId: null },
      { id: 't4', topicId: 'r2', subtopicId: 's-rr', status: 'completed', round: 1, parentThreadId: null },
    ];
    expect(find(buildMindMap(input({ threads: allDone })), 'c1')!.completed).toBe(true);
    expect(find(buildMindMap(input({ threads: allDone.slice(0, 3) })), 'c1')!.completed).toBe(false); // r2's subtopic never completed
  });

  it('handles a student with nothing assessed yet', () => {
    const result = buildMindMap(input({ topicMastery: new Map(), chapterMastery: new Map() }));
    expect(result.subjects.every((s) => s.chapters.length === 0)).toBe(true);
    expect(result.chapterRoadmapsNeeded).toEqual([]);
    expect(result.topicRoadmapsNeeded).toEqual([]);
  });
});

describe('chapterScope', () => {
  it.each([
    ['ok chapter', m('ok', 80), 1, 'topics'],
    ['weak, one weak topic, nothing chapter-wide', m('weak', 18, 0, 'not_assessed'), 1, 'topics'],
    ['at risk, one at-risk topic', m('at_risk', 50, 0, 'not_assessed'), 1, 'topics'],
    ['weak, one weak topic, weak games', m('weak', 23, 0, 'weak'), 1, 'chapter'],
    ['weak, two flagged topics', m('weak', 30, 0, 'not_assessed'), 2, 'chapter'],
    ['at risk, marks not traceable to any topic', m('at_risk', 59, 0, 'at_risk'), 0, 'chapter'],
    ['weak, no flagged topic at all', m('weak', 30, 0, 'not_assessed'), 0, 'chapter'],
  ])('%s -> %s', (_label, chapter, flagged, scope) => {
    expect(chapterScope(chapter as MasteryRow, flagged as number)).toBe(scope);
  });
});

describe('summarizeMap', () => {
  it('counts what the map shows, once each: chapters shown as chapters plus weak or at-risk topics on their own', () => {
    // the student from the screenshot: 2 weak, 2 at risk
    const result = buildMindMap({
      ...input(),
      chapters: [chapter('s2', 'mag', 'Magnetic Effects'), chapter('s2', 'acid', 'Acids'), chapter('s2', 'life', 'Life Processes'), chapter('s1', 'real', 'Real Numbers')],
      chapterRoadmaps: new Map(),
      units: [unit('mf', 'mag', 'Magnetic Field', 'roadmap', 1, [sub('s-l', 'Lines')]), unit('cp', 'acid', 'Chemical Properties', 'roadmap', 1), unit('ns', 'real', 'Number Systems', 'roadmap', 1, [sub('s-b', 'Basics')])],
      topicMastery: new Map([['mf', m('weak', 18, 40)], ['cp', m('weak', 19, 40)], ['ns', m('at_risk', 50, 30)]]),
      chapterMastery: new Map([
        ['mag', m('weak', 18, 40, 'not_assessed')],
        ['acid', m('weak', 23, 60, 'weak')],
        ['life', m('at_risk', 59, 50, 'at_risk')],
        ['real', m('at_risk', 50, 30, 'not_assessed')],
      ]),
    });
    const shown = result.subjects.flatMap((s) => s.chapters).map((c) => [c.name, c.expanded ? 'chapter' : c.topics.map((t) => t.name).join()]);
    expect(shown).toEqual(expect.arrayContaining([
      ['Magnetic Effects', 'Magnetic Field'],
      ['Acids', 'chapter'],
      ['Life Processes', 'chapter'],
      ['Real Numbers', 'Number Systems'],
    ]));
    expect(summarizeMap(result.subjects)).toMatchObject({ weakChapters: 1, weakTopics: 1, atRiskChapters: 1, atRiskTopics: 1 });
  });
});
