import {
  extractJson, extractJsonValue, periodMinutes, renderLegacyFields, renderLegacyPeriod, sourceContextFromReply, validateLessonPlan,
} from './lesson-plan-schema';
import { goodPlan } from './test-lesson-plan-fixtures';

const ctx = (over: any = {}) => ({ expectedPeriods: 2, minutesPerPeriod: 45, allowedPages: new Set([3, 4]), ...over });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe('lesson plan schema v2 — parsing', () => {
  it('reads JSON wrapped in a fence or surrounded by prose', () => {
    const plan = goodPlan();
    expect(extractJson('```json\n' + JSON.stringify(plan) + '\n```')).toEqual(plan);
    expect(extractJson('Here you go:\n' + JSON.stringify(plan) + '\nHope it helps')).toEqual(plan);
  });

  it('reports a reply that is not JSON instead of throwing', () => {
    const r = validateLessonPlan('Sorry, I cannot help with that.', ctx());
    expect(r.content).toBeNull();
    expect(codes(r.errors)).toEqual(['not_json']);
  });

  it('accepts a valid plan with no errors or warnings', () => {
    const r = validateLessonPlan(JSON.stringify(goodPlan()), ctx());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.content!.periods).toHaveLength(2);
  });

  it('coerces loose types: numbers as strings, analyse/analyze, phase synonyms', () => {
    const p = goodPlan();
    p.periods[0].number = '1';
    p.periods[0].sequence[0].minutes = '5';
    p.periods[0].sequence[0].phase = 'Warm-up';
    p.objectives[1].bloom = 'analyze';
    const r = validateLessonPlan(p, ctx());
    expect(r.errors).toEqual([]);
    expect(r.content!.periods[0].sequence[0]).toMatchObject({ phase: 'introduction', minutes: 5 });
    expect(r.content!.objectives[1].bloom).toBe('Analyse');
  });
});

describe('lesson plan schema v2 — deterministic checks', () => {
  it('a 6-period request must produce 6 periods, numbered in order', () => {
    expect(codes(validateLessonPlan(goodPlan(2), ctx({ expectedPeriods: 6 })).errors)).toContain('period_count');
    const p = goodPlan(2);
    p.periods[1].number = 3;
    expect(codes(validateLessonPlan(p, ctx()).errors)).toContain('period_numbering');
  });

  it('a period whose minutes do not add up to the period length is an error', () => {
    const r = validateLessonPlan(goodPlan(2, 40), ctx());
    expect(r.errors.filter((e) => e.code === 'minutes_mismatch')).toHaveLength(2);
    expect(r.errors.find((e) => e.code === 'minutes_mismatch')!.message).toBe('Period 1 adds up to 40 minutes, not 45');
    expect(codes(validateLessonPlan(goodPlan(2, 50), ctx()).errors)).toContain('minutes_mismatch');
  });

  it('every question needs an answer and a link to an existing objective', () => {
    const p = goodPlan();
    p.periods[0].questions = [
      { question: 'Q', answer: '', objectiveIds: ['O1'] },
      { question: 'Q', answer: 'A', objectiveIds: [] },
      { question: 'Q', answer: 'A', objectiveIds: ['O9'] },
    ];
    expect(codes(validateLessonPlan(p, ctx()).errors)).toEqual(expect.arrayContaining(['question_no_answer', 'question_unmapped', 'question_unknown_objective']));
  });

  it('objectives need text and an assessment method; periods need a topic, sequence and questions', () => {
    const p = goodPlan();
    p.objectives[0].assessment = '';
    p.periods[1].topic = '';
    p.periods[1].sequence = [];
    p.periods[1].questions = [];
    expect(codes(validateLessonPlan(p, ctx()).errors)).toEqual(expect.arrayContaining(['objective_no_assessment', 'period_no_topic', 'period_no_sequence', 'period_no_questions']));
  });

  it('a period referring to a missing objective is an error; an untaught objective a warning', () => {
    const p = goodPlan();
    p.periods[0].objectiveIds = ['O7'];
    const r = validateLessonPlan(p, ctx());
    expect(codes(r.errors)).toContain('unknown_objective');
    expect(codes(r.warnings)).toContain('objective_not_taught');
  });

  it('the teaching sequence should open with an introduction and close with a check or conclusion', () => {
    const p = goodPlan();
    p.periods[0].sequence = [p.periods[0].sequence[1], p.periods[0].sequence[0], p.periods[0].sequence[2]];
    p.periods[1].sequence[2].phase = 'explanation';
    const w = codes(validateLessonPlan(p, ctx()).warnings);
    expect(w).toEqual(expect.arrayContaining(['sequence_start', 'sequence_end']));
  });
});

describe('lesson plan schema v2 — step durations', () => {
  const withSequence = (sequence: any[]) => {
    const p = goodPlan(1);
    p.periods[0].sequence = sequence;
    return validateLessonPlan(p, ctx({ expectedPeriods: 1 }));
  };
  const step = (phase: string, minutes: unknown, extra: any = {}) => ({ phase, minutes, teacher: `${phase} work`, students: 'Respond', ...extra });

  it('first pilot regression: a 0-minute conclusion without the marker flag is rejected', () => {
    // chem12, call 6: 5 + 15 + 15 + 7 + 3 + 0 = 45, conclusion "Summarise the seven concentration units".
    const r = withSequence([step('introduction', 5), step('explanation', 15), step('guided_practice', 15),
      step('independent_practice', 7), step('check', 3), step('conclusion', 0)]);
    expect(r.errors.map((e) => e.message)).toEqual(['Period 1, step 6 (Conclusion): minutes must be a whole number of at least 1 (found 0)']);
    expect(r.content!.periods[0].sequence[5].minutes).toBe(0); // reported, not bumped to 1
  });

  it('an explicit closing marker as the last step may take 0 minutes; timed steps still total the period', () => {
    const r = withSequence([step('introduction', 5), step('explanation', 30), step('check', 10),
      step('conclusion', 0, { marker: true })]);
    expect(r.errors).toEqual([]);
    expect(r.content!.periods[0].sequence[3]).toMatchObject({ marker: true, minutes: 0 });
    expect(periodMinutes(r.content!.periods[0])).toBe(45);
    expect(renderLegacyPeriod(r.content!.periods[0], r.content!).activities).toContain('Conclusion (closing note)');
  });

  it('a marker with no minutes field is read as 0 and accepted', () => {
    const r = withSequence([step('introduction', 5), step('explanation', 40), { phase: 'conclusion', marker: true, teacher: 'Period ends' }]);
    expect(r.errors).toEqual([]);
  });

  it('a marker does not excuse a wrong total', () => {
    const r = withSequence([step('introduction', 5), step('explanation', 30), step('conclusion', 0, { marker: true })]);
    expect(codes(r.errors)).toEqual(['minutes_mismatch']);
  });

  it('the marker flag is refused on an instructional step, before the end, or with time on it', () => {
    expect(codes(withSequence([step('introduction', 5), step('explanation', 0, { marker: true }), step('check', 40)]).errors))
      .toEqual(['step_marker']);
    expect(codes(withSequence([step('introduction', 5), step('conclusion', 0, { marker: true }), step('explanation', 40)]).errors))
      .toEqual(['step_marker']);
    expect(codes(withSequence([step('introduction', 5), step('explanation', 35), step('conclusion', 5, { marker: true })]).errors))
      .toEqual(['step_marker', 'minutes_mismatch']);
  });

  it('only a literal true sets the marker', () => {
    const r = withSequence([step('introduction', 5), step('explanation', 40), step('conclusion', 0, { marker: 'yes' })]);
    expect(codes(r.errors)).toEqual(['step_minutes']);
    expect(r.content!.periods[0].sequence[2].marker).toBeUndefined();
  });

  it('zero-minute instructional steps fail', () => {
    for (const phase of ['introduction', 'explanation', 'guided_practice', 'independent_practice', 'check']) {
      const r = withSequence([step('introduction', 5), step(phase, 0), step('conclusion', 40)]);
      expect(codes(r.errors)).toEqual(['step_minutes']);
    }
  });

  it('negative, fractional and missing durations fail and are not adjusted', () => {
    const neg = withSequence([step('introduction', -5), step('explanation', 40), step('check', 10)]);
    expect(codes(neg.errors)).toEqual(['step_minutes']); // -5 + 40 + 10 = 45: the total alone would pass
    expect(neg.content!.periods[0].sequence[0].minutes).toBe(-5);

    const frac = withSequence([step('introduction', 4.5), step('explanation', 30.5), step('check', 10)]);
    expect(codes(frac.errors)).toEqual(['step_minutes', 'step_minutes']);
    expect(frac.content!.periods[0].sequence[0].minutes).toBe(4.5);

    const missing = withSequence([step('introduction', undefined), step('explanation', 35), step('check', 10)]);
    expect(missing.errors.map((e) => e.message)).toEqual([
      'Period 1, step 1 (Introduction): minutes must be a whole number of at least 1 (found missing)',
      'Period 1 adds up to an unknown number of minutes, not 45',
    ]);
  });
});

describe('lesson plan schema v2 — sources', () => {
  it('page numbers not in the textbook extract are removed and reported', () => {
    const p = goodPlan();
    p.objectives[0].source.pages = [3, 99];
    p.periods[0].pages = [4, 120];
    const r = validateLessonPlan(p, ctx());
    expect(r.content!.objectives[0].source.pages).toEqual([3]);
    expect(r.content!.periods[0].pages).toEqual([4]);
    expect(r.warnings.find((w) => w.code === 'pages_removed')!.message).toContain('99, 120');
  });

  it('without a textbook nothing can claim the book, and the plan says so', () => {
    const r = validateLessonPlan(goodPlan(), ctx({ allowedPages: new Set() }));
    expect(r.content!.objectives.every((o) => o.source.type === 'suggestion' && !o.source.pages.length)).toBe(true);
    expect(codes(r.warnings)).toContain('ungrounded');
  });

  it('first pilot regression: a fully cited plan gets no coverage warning, whatever its groundingNotes say', () => {
    for (const note of ['The source text covers all chapter content needed.', 'The extract has no worked example for three numbers.']) {
      const p = goodPlan();
      p.groundingNotes = note;
      const r = validateLessonPlan(p, ctx());
      expect(r.warnings).toEqual([]);
      expect(r.content!.groundingNotes).toBe(note); // kept as the model's note, not turned into a finding
    }
  });

  it('a claim of full coverage does not hide a period that cites nothing from the extract', () => {
    const p = goodPlan();
    p.groundingNotes = 'The source text covers all chapter content needed.';
    p.periods[1].pages = [];
    const r = validateLessonPlan(p, ctx());
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'grounding_gaps', period: 2 })]);
    expect(r.warnings[0].message).toContain('Period 2 cites no page of the textbook extract');
  });

  it('a period citing only pages outside the extract loses them and is reported twice: removed pages and the gap', () => {
    const p = goodPlan();
    p.periods[0].pages = [99];
    const r = validateLessonPlan(p, ctx());
    expect(r.content!.periods[0].pages).toEqual([]);
    expect(codes(r.warnings)).toEqual(['pages_removed', 'grounding_gaps']);
  });

  it('textbook claims that cite no valid page become suggestions and are reported', () => {
    const p = goodPlan();
    p.objectives[0].source.pages = [];
    p.objectives[1].source.pages = [77];
    p.keyConcepts[0].pages = [88];
    const r = validateLessonPlan(p, ctx());
    expect(r.content!.objectives.map((o) => o.source.type)).toEqual(['suggestion', 'suggestion']);
    const claims = r.warnings.filter((w) => w.code === 'unsupported_claims').map((w) => w.message);
    expect(claims).toEqual([expect.stringContaining('Objective O1, O2 claimed the textbook'), expect.stringContaining('Key concept Lemma')]);
    expect(r.warnings.find((w) => w.code === 'pages_removed')!.message).toContain('77, 88');
  });

  it('an objective honestly marked as a suggestion is not an unsupported claim', () => {
    const p = goodPlan();
    p.objectives[1].source = { type: 'suggestion', pages: [] };
    expect(validateLessonPlan(p, ctx()).warnings).toEqual([]);
  });

  it('a truncated extract is reported', () => {
    const r = validateLessonPlan(goodPlan(), ctx({ sourceTruncated: { used: 18, available: 30 } }));
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringContaining('the AI saw 18 of 30 passages')]);
  });
});

describe('sourceContextFromReply — which pages the model actually saw', () => {
  it('uses the pages the AI service reports, not every page the backend fetched', () => {
    const c = sourceContextFromReply({ source: { grounded: true, pages: [1, 2, 3], truncated: true, passagesUsed: 3, passagesAvailable: 5 } }, [1, 2, 3, 4, 5]);
    expect([...c.allowedPages]).toEqual([1, 2, 3]);
    expect(c.sourceTruncated).toEqual({ used: 3, available: 5 });
    const p = goodPlan();
    p.periods[1].pages = [4];
    const r = validateLessonPlan(p, ctx({ allowedPages: new Set([3]), ...sourceContextFromReply({ source: { grounded: true, pages: [3] } }, [3, 4]) }));
    expect(codes(r.warnings)).toEqual(expect.arrayContaining(['pages_removed', 'grounding_gaps']));
  });

  it('a reply that says it was not grounded allows no pages, even if passages were sent', () => {
    expect(sourceContextFromReply({ source: { grounded: false, pages: [1, 2] } }, [1, 2]).allowedPages.size).toBe(0);
  });

  it('falls back to the passages sent when the reply carries no source block', () => {
    expect([...sourceContextFromReply({ content: '{}' }, [3, 4, 0, -1]).allowedPages]).toEqual([3, 4]);
  });
});

describe('lesson plan schema v2 — legacy rendering', () => {
  it('fills the v1 text columns so existing readers keep working', () => {
    const c = validateLessonPlan(goodPlan(), ctx()).content!;
    const f = renderLegacyFields(c);
    expect(f.learningObjectives).toContain('**O2** (Apply) Find the HCF');
    expect(f.methodology).toContain('Common misconceptions');
    expect(f.methodology).toContain('*Challenge:*');
    const p = renderLegacyPeriod(c.periods[0], c);
    expect(p.durationMinutes).toBe(45);
    expect(p.activities).toContain('**Introduction (5 min)**');
    expect(p.assessment).toContain('*Answer:* 455 = 42 × 10 + 35');
  });
});

describe('extractJsonValue', () => {
  it('reads arrays as well as objects, fenced or with prose around them', () => {
    expect(extractJsonValue('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(extractJsonValue('```json\n[{"a":1},{"a":2}]\n```')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(extractJsonValue('Here: {"a":[1,2]} done')).toEqual({ a: [1, 2] });
    expect(() => extractJsonValue('nothing here')).toThrow();
  });
});
