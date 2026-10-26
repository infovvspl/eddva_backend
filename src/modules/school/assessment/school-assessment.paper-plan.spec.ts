/**
 * The paperPlan sent with an AI assessment draft.
 *
 * The AI service writes the objective and written sections in parallel by
 * removing the other group's instruction lines from extraContext, so every
 * string in the plan must appear in extraContext exactly once. If one does
 * not, the service quietly falls back to a single call — correct, but slow —
 * so these tests pin the contract.
 */
import { SchoolAssessmentService } from './school-assessment.service';

const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';

async function capture(body: Record<string, any>, figures: any[] = []) {
  const ds = { query: jest.fn(async () => []) };
  const textbooks = {
    getChapterFigures: jest.fn(async () => figures),
    getSubjectFigures: jest.fn(async () => []),
    getGroundingPassages: jest.fn(async () => ({ passages: [], ebookAvailable: false, lectureAvailable: false })),
  };
  const svc: any = new SchoolAssessmentService(
    ds as any, {} as any, {} as any, {} as any, {} as any, textbooks as any,
  );
  const generateTopicContent = jest.fn(async (_dto: any, ..._rest: any[]) => ({ content: '## Section A\n1. q' }));
  svc.aiBridge = { generateTopicContent };
  svc.resolveAssessmentNames = jest.fn(async () => ({}));
  svc.resolveChapterList = jest.fn(async () => [{ id: 'ch-1', name: 'Life Processes' }]);
  svc.normalizeChapterIds = jest.fn(() => ['ch-1']);
  svc.resolveBoard = jest.fn(async () => 'cbse');
  svc.resolvePlotMarkers = jest.fn(async (t: string) => ({ text: t, drawn: 0, failed: 0 }));
  await svc.aiGenerateDraft({ instituteId: INSTITUTE }, {
    subjectName: 'Science', className: 'Class 10', chapterId: 'ch-1', ...body,
  });
  return generateTopicContent.mock.calls[0][0];
}

const once = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('paperPlan', () => {
  it('1. describes every section with its kind and count', async () => {
    const dto = await capture({ mcqCount: 4, trueFalseCount: 3, fillBlankCount: 2, shortCount: 2, longCount: 1 });
    expect(dto.paperPlan.sections.map((s: any) => [s.letter, s.kind, s.count])).toEqual([
      ['A', 'objective', 4], ['B', 'objective', 3], ['C', 'objective', 2],
      ['D', 'written', 2], ['E', 'written', 1],
    ]);
  });

  it('2. every plan string appears in extraContext exactly once', async () => {
    const figure = { id: 'f', pageNo: 3, figureIndex: 0, label: 'Fig. 5.1', caption: 'Fig. 5.1: Leaf', imageUrl: 'https://x/y.png' };
    const dto = await capture({ difficulty: 'mix' }, [figure]);
    const { paperPlan: plan, extraContext } = dto;
    for (const s of plan.sections) expect(once(extraContext, s.text)).toBe(1);
    expect(once(extraContext, plan.header)).toBe(1);
    expect(once(extraContext, plan.difficulty.line)).toBe(1);
    expect(plan.figures).toContain('FIGURES AVAILABLE');
    expect(once(extraContext, plan.figures)).toBe(1);
    expect(once(extraContext, plan.plots)).toBe(1);
  });

  it('3. a mixed difficulty is sent as numbers that add up to the paper', async () => {
    const dto = await capture({ difficulty: 'mix', mcqCount: 5, trueFalseCount: 5, fillBlankCount: 5, shortCount: 3, longCount: 2 });
    const d = dto.paperPlan.difficulty;
    expect(d.easy + d.medium + d.hard).toBe(20);
  });

  it('4. a single difficulty needs no split', async () => {
    const dto = await capture({ difficulty: 'hard' });
    expect(dto.paperPlan.difficulty).toBeNull();
  });

  it('5. no figures offered means an empty figures rule, not a missing one', async () => {
    const dto = await capture({});
    expect(dto.paperPlan.figures).toBe('');
  });
});
