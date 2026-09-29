/**
 * Phase 8 — diagrams in the student-facing assessment interface.
 *
 * A student sees a paper through three reads: the assessment list, a single
 * assessment, and the attempt returned by `startAttempt` (which is what
 * TestEngine actually answers from, because it prefers the attempt's questions
 * over the assessment's). All three must turn an approved marker into a
 * figure, and none of them may show anything else.
 *
 * The rules under test are the ones a student flow can get wrong silently:
 *
 *   ONLY APPROVED, RENDERED, ATTACHED diagrams expand. An unapproved diagram
 *   has not been reviewed; a detached one was removed from the paper. Neither
 *   may appear — and neither may be ADVERTISED either, so the authoring map
 *   and the per-question diagram metadata are stripped from the student
 *   projection as well.
 *
 *   ASSOCIATION IS SERVER-SIDE. The marker resolves against the assessment's
 *   own institute, derived from the trusted access check, never from anything
 *   the client sends. No client-supplied marker->image mapping is accepted.
 *
 *   NOTHING ELSE MOVES. Question ids, order, marks, the answer mapping, the
 *   attempt lifecycle and timing are byte-identical whether or not the paper
 *   carries a diagram, and a missing or broken diagram store still opens the
 *   exam.
 *
 * The fake datasource below applies the real WHERE clauses to its rows, so the
 * isolation tests prove the SQL scoping rather than assuming it.
 */
import { SchoolAssessmentService } from './school-assessment.service';

const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';
const OTHER_INSTITUTE = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';
const PAPER = 'aa11bb22-0000-4000-8000-000000000001';
const OTHER_PAPER = 'bb22cc33-0000-4000-8000-000000000002';
const CLASS = 'cc33dd44-0000-4000-8000-000000000003';
const MARKER = 'aaaa1111';

const CONTENT = [
  '## Section A',
  '',
  '1. Study the figure and find the length of AB. [2]',
  `[DIAGRAM: ${MARKER}]`,
  '',
  '2. Define a rational number. [1]',
].join('\n');

const ANSWER_KEY = '1. 12 cm\n2. A number of the form p/q.';

const STUDENT = {
  id: 'stu-0001',
  role: 'STUDENT',
  instituteId: INSTITUTE,
  studentProfile: { class_id: CLASS },
};

const TEACHER = {
  id: 'tea-0001',
  role: 'TEACHER',
  instituteId: INSTITUTE,
};

type DiagramSeed = Partial<{
  id: string;
  institute_id: string;
  assessment_id: string;
  marker_key: string;
  diagram_type: string;
  image_key: string | null;
  alt_text: string | null;
  approved: boolean;
  detached_at: any;
}>;

function diagramRow(seed: DiagramSeed = {}) {
  return {
    id: 'dia-0001',
    institute_id: INSTITUTE,
    assessment_id: PAPER,
    marker_key: MARKER,
    diagram_type: 'geometry',
    image_key: 'tenants/x/assessment-diagrams/v1/abc.svg',
    alt_text: 'Triangle ABC with AB marked',
    approved: true,
    detached_at: null,
    ...seed,
  };
}

/**
 * A datasource that answers the queries this flow issues, filtering by the
 * same columns the production SQL filters by.
 */
function makeService(opts: {
  diagrams?: any[];
  assessment?: Record<string, any>;
  existingAttempt?: any;
  diagramStoreFails?: boolean;
} = {}) {
  const diagrams = opts.diagrams || [];
  const assessment = {
    id: PAPER,
    title: 'Unit Test 1',
    duration_minutes: 45,
    scheduled_date: null,
    status: 'published',
    institute_id: INSTITUTE,
    class_id: CLASS,
    teacher_id: 'tea-0001',
    content_text: CONTENT,
    answer_key: ANSWER_KEY,
    questions_json: null,
    ...(opts.assessment || {}),
  };

  const diagramQueries: any[][] = [];
  let inserted: any = null;

  const ds = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (/^\s*(ALTER TABLE|CREATE TABLE|CREATE (UNIQUE )?INDEX)/i.test(sql)) return [];
      if (/UPDATE assessments SET questions_json/i.test(sql)) return [];

      if (/FROM assessments a\s+LEFT JOIN classes c/i.test(sql)) {
        return String(params[0]) === String(assessment.id)
          ? [{ ...assessment, class_institute_id: assessment.institute_id }]
          : [];
      }
      if (/FROM assessments WHERE id/i.test(sql)) {
        return String(params[0]) === String(assessment.id) ? [{ ...assessment }] : [];
      }

      if (/FROM assessment_diagrams/i.test(sql)) {
        diagramQueries.push(params);
        if (opts.diagramStoreFails) throw new Error('relation "assessment_diagrams" does not exist');
        const [instituteId, ids] = params;
        // Exactly the production WHERE: institute AND assessment.
        return diagrams
          .filter((row) => String(row.institute_id) === String(instituteId))
          .filter((row) => (ids || []).map(String).includes(String(row.assessment_id)))
          .map((row) => ({ ...row }));
      }

      if (/SELECT \* FROM assessment_submissions/i.test(sql)) {
        return opts.existingAttempt ? [{ ...opts.existingAttempt }] : [];
      }
      if (/INSERT INTO assessment_submissions/i.test(sql)) {
        inserted = opts.existingAttempt || {
          id: 'sub-0001',
          assessment_id: PAPER,
          student_user_id: STUDENT.id,
          status: 'in_progress',
          started_at: '2026-09-21T09:00:00.000Z',
          expires_at: '2026-09-21T09:45:00.000Z',
          answers_json: {},
        };
        return [{ ...inserted }];
      }

      if (/FROM assessment_submissions WHERE student_user_id/i.test(sql)) return [];
      return [];
    }),
  };

  const s3Service = { toPublicUrl: jest.fn((key: string) => `https://media.eddva.in/${key}`) };
  const svc: any = new SchoolAssessmentService(
    ds as any, {} as any, {} as any, {} as any, s3Service as any, {} as any,
  );
  return { svc, ds, diagramQueries, assessment, get inserted() { return inserted; } };
}

/** The list() row shape, before the service enriches and strips it. */
function listRow(extra: Record<string, any> = {}): Record<string, any> {
  return {
    id: PAPER,
    institute_id: INSTITUTE,
    title: 'Unit Test 1',
    content_text: CONTENT,
    answer_key: ANSWER_KEY,
    questions_json: null,
    ...extra,
  };
}

// ── What a student is shown ─────────────────────────────────────────────────

describe('approved diagrams reach the student', () => {
  it('1. an approved diagram becomes an image in the attempt the student answers from', async () => {
    const { svc } = makeService({ diagrams: [diagramRow()] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const questions = res.data.questions;

    const withFigure = questions.find((q: any) => /find the length of AB/i.test(q.text));
    expect(withFigure.text).toContain(
      '![Triangle ABC with AB marked](https://media.eddva.in/tenants/x/assessment-diagrams/v1/abc.svg)',
    );
    // The raw marker never survives into anything a student renders.
    expect(JSON.stringify(res.data)).not.toContain('DIAGRAM');
  });

  it('2. the single-assessment read expands it too, and the list read as well', async () => {
    const one = makeService({ diagrams: [diagramRow()] });
    const single = await one.svc.findOne(STUDENT, PAPER);
    expect(single.data.content_text).toContain('![Triangle ABC with AB marked](https://media.eddva.in/');
    expect(single.data.content_text).not.toContain('[DIAGRAM:');

    const many = makeService({ diagrams: [diagramRow()] });
    const rows = [listRow()];
    await many.svc.attachDiagramsToRows(rows, INSTITUTE);
    const asStudent = rows.map((row: any) => many.svc.stripAnswerKeyForStudent(STUDENT, row));
    expect(asStudent[0].content_text).toContain('![Triangle ABC with AB marked](https://media.eddva.in/');
    expect(asStudent[0].content_text).not.toContain('[DIAGRAM:');
  });

  it('3. alt text survives, and the expansion is a Markdown image — never markup', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow({ alt_text: 'Circle with chord [AB] of length 12 cm' })],
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const text = res.data.questions.map((q: any) => q.text).join('\n');

    // Brackets are removed so the alt cannot close the image and inject text.
    expect(text).toContain('![Circle with chord AB of length 12 cm](https://media.eddva.in/');
    expect(text).not.toMatch(/<\s*(img|svg|script|iframe|object|embed)/i);
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('onerror');
  });

  it('4. an empty alt still produces a usable image, never an empty label', async () => {
    const { svc } = makeService({ diagrams: [diagramRow({ alt_text: null })] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const text = res.data.questions.map((q: any) => q.text).join('\n');
    expect(text).toContain('![Diagram](https://media.eddva.in/');
  });
});

// ── What a student is NOT shown ─────────────────────────────────────────────

describe('unapproved and detached diagrams stay hidden', () => {
  it('5. an unapproved diagram is neither expanded nor mentioned', async () => {
    const { svc } = makeService({ diagrams: [diagramRow({ approved: false })] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const payload = JSON.stringify(res.data);

    expect(payload).not.toContain('![');
    expect(payload).not.toContain('media.eddva.in');
    expect(payload).not.toContain('DIAGRAM');
    // Not advertised either: no row id, no kind, no pending flag.
    expect(payload).not.toContain('dia-0001');
    expect(res.data.questions.every((q: any) => q.diagram === undefined)).toBe(true);
  });

  it('6. a detached diagram is neither expanded nor mentioned', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow({ detached_at: '2026-09-01T00:00:00.000Z' })],
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const payload = JSON.stringify(res.data);
    expect(payload).not.toContain('![');
    expect(payload).not.toContain('media.eddva.in');
    expect(payload).not.toContain('dia-0001');
  });

  it('7. a diagram that never rendered is not shown', async () => {
    const { svc } = makeService({ diagrams: [diagramRow({ image_key: null })] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(JSON.stringify(res.data)).not.toContain('![');
  });

  it('8. the authoring map is stripped for a student and kept for a teacher', async () => {
    const svcA = makeService({ diagrams: [diagramRow({ approved: false })] });
    const rowsA = [listRow()];
    await svcA.svc.attachDiagramsToRows(rowsA, INSTITUTE);
    // The map exists on the enriched row — it is the STRIP that protects the
    // student, so assert the thing being stripped is really there first.
    expect(rowsA[0].diagrams[MARKER].approved).toBe(false);

    const forStudent = svcA.svc.stripAnswerKeyForStudent(STUDENT, rowsA[0]);
    expect(forStudent.diagrams).toBeUndefined();
    expect(JSON.stringify(forStudent)).not.toContain('media.eddva.in');

    const svcB = makeService({ diagrams: [diagramRow({ approved: false })] });
    const rowsB = [listRow()];
    await svcB.svc.attachDiagramsToRows(rowsB, INSTITUTE);
    const forTeacher = svcB.svc.stripAnswerKeyForStudent(TEACHER, rowsB[0]);
    expect(forTeacher.diagrams[MARKER].approved).toBe(false);
    expect(forTeacher.diagrams[MARKER].url).toContain('media.eddva.in');
  });
});

// ── Association is server-side ──────────────────────────────────────────────

describe('scoping and isolation', () => {
  it('9. a diagram belonging to another institute does not resolve', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow({ institute_id: OTHER_INSTITUTE })],
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(JSON.stringify(res.data)).not.toContain('media.eddva.in');
    expect(JSON.stringify(res.data)).not.toContain('DIAGRAM');
  });

  it('10. a diagram belonging to another assessment does not resolve', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow({ assessment_id: OTHER_PAPER })],
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(JSON.stringify(res.data)).not.toContain('media.eddva.in');
  });

  it('11. a caller from another institute is refused before diagrams matter', async () => {
    const { svc, diagramQueries } = makeService({ diagrams: [diagramRow()] });
    await expect(
      svc.startAttempt({ ...STUDENT, instituteId: OTHER_INSTITUTE }, PAPER),
    ).rejects.toThrow(/do not have access/i);
    expect(diagramQueries).toHaveLength(0);
  });

  it('12. the tenant comes from the assessment row, not from the caller', async () => {
    // A super-admin passes the access check carrying their own (different)
    // institute. The diagram query must still be issued for the PAPER's
    // institute — that is what makes the association server-derived rather
    // than a function of who is reading.
    const { svc, diagramQueries } = makeService({ diagrams: [diagramRow()] });
    const res = await svc.startAttempt(
      { id: 'adm-0001', role: 'SUPER_ADMIN', instituteId: OTHER_INSTITUTE }, PAPER,
    );
    expect(diagramQueries[0][0]).toBe(INSTITUTE);
    expect(diagramQueries[0][1]).toEqual([PAPER]);
    expect(JSON.stringify(res.data)).toContain('media.eddva.in');
  });

  it('13. both scopes are always applied in SQL, on every read path', async () => {
    const attempt = makeService({ diagrams: [diagramRow()] });
    await attempt.svc.startAttempt(STUDENT, PAPER);
    const single = makeService({ diagrams: [diagramRow()] });
    await single.svc.findOne(STUDENT, PAPER);

    for (const params of [...attempt.diagramQueries, ...single.diagramQueries]) {
      expect(params[0]).toBe(INSTITUTE);
      expect(params[1]).toEqual([PAPER]);
    }
    expect(attempt.diagramQueries.length + single.diagramQueries.length).toBe(2);
  });

  it('14. no marker-to-image mapping is accepted from the request body', async () => {
    const { svc } = makeService({ diagrams: [] });
    const res = await svc.startAttempt(
      {
        ...STUDENT,
        // Whatever a client might attach is ignored: only the store resolves.
        diagrams: { [MARKER]: { url: 'https://evil.example/x.svg', approved: true } },
      },
      PAPER,
    );
    expect(JSON.stringify(res.data)).not.toContain('evil.example');
  });
});

// ── Nothing else moves ──────────────────────────────────────────────────────

describe('the attempt is otherwise unchanged', () => {
  it('15. question ids, order, type and marks are identical with and without a diagram', async () => {
    const shape = (res: any) => res.data.questions.map((q: any) => ({
      id: q.id, type: q.type, marks: q.marks, order: q.sourceIndex,
    }));

    const withDiagram = await makeService({ diagrams: [diagramRow()] })
      .svc.startAttempt(STUDENT, PAPER);
    const withoutDiagram = await makeService({ diagrams: [] })
      .svc.startAttempt(STUDENT, PAPER);

    expect(shape(withDiagram)).toEqual(shape(withoutDiagram));
    expect(withDiagram.data.questions.length).toBe(withoutDiagram.data.questions.length);
    // Only the text of the diagram's own question differs.
    const changed = withDiagram.data.questions.filter(
      (q: any, i: number) => q.text !== withoutDiagram.data.questions[i].text,
    );
    expect(changed).toHaveLength(1);
  });

  it('16. the attempt row itself — status, timing, answers — passes through untouched', async () => {
    const { svc } = makeService({ diagrams: [diagramRow()] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(res.data.id).toBe('sub-0001');
    expect(res.data.status).toBe('in_progress');
    expect(res.data.started_at).toBe('2026-09-21T09:00:00.000Z');
    expect(res.data.expires_at).toBe('2026-09-21T09:45:00.000Z');
    expect(res.data.answers_json).toEqual({});
  });

  it('17. resuming returns the same attempt, with the figure still expanded', async () => {
    const existing = {
      id: 'sub-0001', assessment_id: PAPER, student_user_id: STUDENT.id,
      status: 'in_progress', started_at: '2026-09-21T09:00:00.000Z',
      expires_at: '2026-09-21T09:45:00.000Z',
      answers_json: { 'q-1': 'B' },
    };
    const { svc } = makeService({ diagrams: [diagramRow()], existingAttempt: existing });

    const first = await svc.startAttempt(STUDENT, PAPER);
    const second = await svc.startAttempt(STUDENT, PAPER);

    expect(second.data.id).toBe(first.data.id);
    expect(second.data.answers_json).toEqual({ 'q-1': 'B' });
    expect(second.data.questions.map((q: any) => q.id))
      .toEqual(first.data.questions.map((q: any) => q.id));
    expect(second.data.questions.map((q: any) => q.text))
      .toEqual(first.data.questions.map((q: any) => q.text));
    expect(JSON.stringify(second.data)).toContain('media.eddva.in');
  });

  it('18. a submitted attempt is still returned as-is, without a questions payload', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow()],
      existingAttempt: {
        id: 'sub-0001', assessment_id: PAPER, student_user_id: STUDENT.id,
        status: 'submitted', answers_json: { 'q-1': 'B' },
      },
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(res.data.status).toBe('submitted');
    expect(res.data.questions).toBeUndefined();
  });

  it('19. the answer key never reaches the student, diagram or not', async () => {
    const { svc } = makeService({ diagrams: [diagramRow()] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const payload = JSON.stringify(res.data);
    expect(payload).not.toContain('12 cm');
    expect(res.data.questions.every(
      (q: any) => q.correctAnswer === undefined && q.explanation === undefined && q.rubric === undefined,
    )).toBe(true);
  });

  it('20. a paper with no diagrams issues no diagram query at all', async () => {
    const { svc, diagramQueries } = makeService({
      diagrams: [diagramRow()],
      assessment: { content_text: '## Section A\n\n1. Define a rational number. [1]' },
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(diagramQueries).toHaveLength(0);
    expect(res.data.questions).toHaveLength(1);
  });
});

// ── Broken diagram data must not break the exam ─────────────────────────────

describe('degrading safely', () => {
  it('21. a diagram store outage still opens the attempt', async () => {
    const { svc } = makeService({ diagrams: [diagramRow()], diagramStoreFails: true });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(res.data.status).toBe('in_progress');
    expect(res.data.questions).toHaveLength(2);
    expect(JSON.stringify(res.data)).not.toContain('DIAGRAM');
  });

  it('22. a marker with no row behaves exactly as Phase 1 defined: it disappears', async () => {
    const { svc } = makeService({ diagrams: [] });
    const res = await svc.startAttempt(STUDENT, PAPER);
    const text = res.data.questions.map((q: any) => q.text).join('\n');
    expect(text).not.toContain('DIAGRAM');
    expect(text).not.toContain('![');
    expect(text).toContain('find the length of AB');
  });

  it('23. malformed stored diagram metadata does not throw', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow({
        marker_key: null as any, image_key: undefined as any,
        alt_text: undefined as any, approved: null as any, diagram_type: null as any,
      })],
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(res.data.status).toBe('in_progress');
    expect(JSON.stringify(res.data)).not.toContain('![');
  });

  it('24. a paper whose questions were never parsed still loads', async () => {
    const { svc } = makeService({
      diagrams: [diagramRow()],
      assessment: { content_text: '', questions_json: null },
    });
    const res = await svc.startAttempt(STUDENT, PAPER);
    expect(res.data.status).toBe('in_progress');
    expect(res.data.questions).toEqual([]);
  });
});

// ── One page, more than one tenant (Phase 9.2) ──────────────────────────────

describe('a list page resolves each paper under its own institute', () => {
  const OTHER_MARKER = 'bbbb2222';
  const OTHER_CONTENT = [
    '## Section A',
    '',
    '1. Name the parts of the cell shown. [3]',
    `[DIAGRAM: ${OTHER_MARKER}]`,
  ].join('\n');

  const otherRow = () => listRow({
    id: OTHER_PAPER, institute_id: OTHER_INSTITUTE, content_text: OTHER_CONTENT,
  });

  const otherDiagram = () => diagramRow({
    id: 'dia-0002', institute_id: OTHER_INSTITUTE, assessment_id: OTHER_PAPER,
    marker_key: OTHER_MARKER, diagram_type: 'template',
    image_key: 'tenants/y/assessment-diagrams/v1/def.svg', alt_text: 'Plant cell',
  });

  it('25. a super-admin page spanning two institutes expands BOTH papers', async () => {
    // The bug this pins: resolving the whole page under one institute left
    // every paper from the other one silently figureless.
    const { svc, diagramQueries } = makeService({
      diagrams: [diagramRow(), otherDiagram()],
    });
    const rows = [listRow(), otherRow()];
    await svc.attachDiagramsToRows(rows, undefined);

    expect(rows[0].content_text).toContain('![Triangle ABC with AB marked](https://media.eddva.in/');
    expect(rows[1].content_text).toContain('![Plant cell](https://media.eddva.in/');
    expect(rows[0].content_text).not.toContain('[DIAGRAM:');
    expect(rows[1].content_text).not.toContain('[DIAGRAM:');

    // One query per distinct institute, each carrying only its own papers.
    expect(diagramQueries).toHaveLength(2);
    const issued = diagramQueries.map((p) => [p[0], p[1]]).sort();
    expect(issued).toEqual([[INSTITUTE, [PAPER]], [OTHER_INSTITUTE, [OTHER_PAPER]]].sort());
  });

  it('26. neither paper can pick up the other institute\'s diagram', async () => {
    // Same marker key present in both institutes. Each must resolve to its own
    // row, and a paper whose institute has no such row gets nothing.
    const { svc } = makeService({
      diagrams: [diagramRow({ alt_text: 'Mine' })],
    });
    const rows = [listRow(), otherRow()];
    await svc.attachDiagramsToRows(rows, undefined);

    expect(rows[0].content_text).toContain('![Mine](');
    expect(rows[1].content_text).not.toContain('![');
    expect(JSON.stringify(rows[1].diagrams)).not.toContain('media.eddva.in');
  });

  it('27. an ordinary single-institute page is still exactly ONE query', async () => {
    const { svc, diagramQueries } = makeService({ diagrams: [diagramRow()] });
    const second = listRow({ id: 'cc44dd55-0000-4000-8000-000000000004' });
    const rows = [listRow(), second];
    await svc.attachDiagramsToRows(rows, INSTITUTE);

    expect(diagramQueries).toHaveLength(1);
    expect(diagramQueries[0][0]).toBe(INSTITUTE);
    expect(diagramQueries[0][1]).toEqual([PAPER, second.id]);
  });

  it('28. a page where no paper carries a marker issues NO query', async () => {
    const { svc, diagramQueries } = makeService({ diagrams: [diagramRow()] });
    const rows = [
      listRow({ content_text: '## Section A\n\n1. Define a rational number. [1]' }),
      listRow({ id: OTHER_PAPER, content_text: '1. State Ohm\'s law. [2]' }),
    ];
    await svc.attachDiagramsToRows(rows, INSTITUTE);
    expect(diagramQueries).toHaveLength(0);
    expect(rows[0].diagrams).toBeUndefined();
  });

  it('29. a paper with no institute of its own falls back to the caller\'s', async () => {
    const { svc, diagramQueries } = makeService({ diagrams: [diagramRow()] });
    const rows = [listRow({ institute_id: null })];
    await svc.attachDiagramsToRows(rows, INSTITUTE);

    expect(diagramQueries[0][0]).toBe(INSTITUTE);
    expect(rows[0].content_text).toContain('![Triangle ABC with AB marked](');
  });

  it('30. with no institute anywhere, the paper is left alone rather than guessed at', async () => {
    const { svc, diagramQueries } = makeService({ diagrams: [diagramRow()] });
    const rows = [listRow({ institute_id: null })];
    await svc.attachDiagramsToRows(rows, undefined);

    expect(diagramQueries).toHaveLength(0);
    // Untouched: the marker is still there, nothing was resolved or stripped.
    expect(rows[0].content_text).toContain('[DIAGRAM:');
    expect(rows[0].diagrams).toBeUndefined();
  });
});
