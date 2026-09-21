/**
 * Diagram anchoring — stable association between a question and its diagram.
 *
 * The design rests on one property: the association is DERIVED from where the
 * `[DIAGRAM: key]` marker sits in `content_text`, and is never stored. There is
 * therefore no (question -> diagram) mapping that can go stale when a paper is
 * edited, reordered or renumbered.
 *
 * That property is not optional. `questions_json` is overwritten by `update()`
 * after every edit and rewritten by `hydrateQuestions()` during a plain read,
 * so a diagram stored there can be destroyed by a GET.
 *
 * These tests pin the six requirements the design had to satisfy, plus the
 * duplicate and cross-paper cases, plus the regression that matters most: a
 * paper with no diagrams must behave exactly as it did before.
 */
import { SchoolAssessmentService } from './school-assessment.service';
import {
  extractDiagramMarkers,
  hasDiagramMarkers,
  expandDiagramMarkers,
  stripDiagramMarkers,
  replaceMarkerAt,
  generateMarkerKey,
} from './assessment-diagram-anchor';

const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';
const PAPER = 'aa11bb22-0000-4000-8000-000000000001';
const OTHER_PAPER = 'bb22cc33-0000-4000-8000-000000000002';

/** An in-memory stand-in for the assessment_diagrams table. */
function makeStore(seed: any[] = []) {
  const rows: any[] = seed.map((r, i) => ({
    id: `row-${i + 1}`, institute_id: INSTITUTE, assessment_id: PAPER,
    diagram_type: 'circle_chord', spec: { t: 'x' }, renderer_version: 'v1',
    image_key: 'k/one.svg', alt_text: 'Circle with chord AB',
    approved: true, detached_at: null, ...r,
  }));

  const exec = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (/SELECT \* FROM assessment_diagrams/i.test(sql)) {
        const [inst, key] = params;
        return rows.filter(
          (r) => r.institute_id === inst && r.marker_key === key,
        ).slice(0, 1);
      }
      if (/INSERT INTO assessment_diagrams/i.test(sql)) {
        const [instituteId, assessmentId, markerKey, type, spec, version, imageKey, alt, approved] = params;
        if (rows.some((r) => r.institute_id === instituteId && r.marker_key === markerKey)) {
          throw new Error('duplicate key value violates unique constraint');
        }
        rows.push({
          id: `row-${rows.length + 1}`, institute_id: instituteId, assessment_id: assessmentId,
          marker_key: markerKey, diagram_type: type, spec, renderer_version: version,
          image_key: imageKey, alt_text: alt, approved, detached_at: null,
        });
        return [];
      }
      if (/SET detached_at = NULL/i.test(sql)) {
        const row = rows.find((r) => r.id === params[0]);
        if (row) row.detached_at = null;
        return [];
      }
      if (/SET detached_at = NOW\(\)/i.test(sql)) {
        const [assessmentId, kept] = params;
        for (const r of rows) {
          if (String(r.assessment_id) === String(assessmentId)
              && !r.detached_at && !(kept || []).includes(r.marker_key)) {
            r.detached_at = new Date();
          }
        }
        return [];
      }
      return [];
    }),
  };
  return { rows, exec };
}

function makeService() {
  const ds = { query: jest.fn(async () => []) };
  const s3 = { toPublicUrl: jest.fn((k: string) => `https://media.example/${k}`) };
  const svc: any = new SchoolAssessmentService(
    ds as any, {} as any, {} as any, {} as any, s3 as any, {} as any,
  );
  return { svc, ds, s3 };
}

const Q = (n: number, text: string) => `${n}. ${text}`;

// ── Pure marker mechanics ───────────────────────────────────────────────────

describe('marker extraction and rewriting', () => {
  it('1. finds markers in document order with their offsets', () => {
    const text = `${Q(1, 'a')}\n[DIAGRAM: aaaa1111]\n${Q(2, 'b')}\n[DIAGRAM: bbbb2222]`;
    const found = extractDiagramMarkers(text);
    expect(found.map((m) => m.key)).toEqual(['aaaa1111', 'bbbb2222']);
    expect(found[0].start).toBeLessThan(found[1].start);
  });

  it('2. normalises case so a retyped marker still resolves', () => {
    expect(extractDiagramMarkers('[DIAGRAM: AAAA1111]')[0].key).toBe('aaaa1111');
    expect(extractDiagramMarkers('[diagram:aaaa1111]')[0].key).toBe('aaaa1111');
    expect(extractDiagramMarkers('[ DIAGRAM : aaaa1111 ]')[0].key).toBe('aaaa1111');
  });

  it('3. a paper with no markers is detected without work', () => {
    expect(hasDiagramMarkers('## Section A\n\n1. What is a polynomial?')).toBe(false);
    expect(extractDiagramMarkers('')).toEqual([]);
  });

  it('4. rewrites ONE occurrence, leaving identical markers alone', () => {
    // Replacing by value would rewrite every copy and defeat cloning.
    const text = '1. a\n[DIAGRAM: aaaa1111]\n2. b\n[DIAGRAM: aaaa1111]';
    const second = extractDiagramMarkers(text)[1];
    const out = replaceMarkerAt(text, second, 'cccc3333');
    expect(out).toContain('[DIAGRAM: aaaa1111]');
    expect(out).toContain('[DIAGRAM: cccc3333]');
    expect(extractDiagramMarkers(out).map((m) => m.key)).toEqual(['aaaa1111', 'cccc3333']);
  });

  it('5. generates distinct, opaque, markdown-safe keys', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateMarkerKey()));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('display expansion', () => {
  const MAP = {
    aaaa1111: { url: 'https://media.example/a.svg', alt: 'Circle with chord AB', approved: true },
  };

  it('6. turns a marker into a Markdown image', () => {
    const out = expandDiagramMarkers('1. Study it.\n[DIAGRAM: aaaa1111]\n', MAP);
    expect(out).toContain('![Circle with chord AB](https://media.example/a.svg)');
    expect(out).not.toContain('DIAGRAM');
  });

  it('7. an unknown key is removed, never printed to a student', () => {
    const out = expandDiagramMarkers('1. q\n[DIAGRAM: ffff9999]\n', MAP);
    expect(out).not.toContain('DIAGRAM');
    expect(out).not.toContain('ffff9999');
  });

  it('8. an unapproved diagram is not shown unless explicitly requested', () => {
    const pending = { aaaa1111: { ...MAP.aaaa1111, approved: false } };
    expect(expandDiagramMarkers('1. q\n[DIAGRAM: aaaa1111]', pending)).not.toContain('![');
    expect(
      expandDiagramMarkers('1. q\n[DIAGRAM: aaaa1111]', pending, { includeUnapproved: true }),
    ).toContain('![');
  });

  it('9. a diagram with no rendered image is not linked broken', () => {
    const unrendered = { aaaa1111: { url: null, alt: 'x', approved: true } };
    expect(expandDiagramMarkers('1. q\n[DIAGRAM: aaaa1111]', unrendered)).not.toContain('![');
  });

  it('10. brackets in alt text cannot break the Markdown link', () => {
    const odd = { aaaa1111: { url: 'https://media.example/a.svg', alt: 'A [weird] label', approved: true } };
    const out = expandDiagramMarkers('[DIAGRAM: aaaa1111]', odd);
    expect(out).toContain('](https://media.example/a.svg)');
    expect(out).toContain('![A weird label]');
  });

  it('11. strip removes every marker regardless of state', () => {
    const out = stripDiagramMarkers('Q1. Answer: a\n[DIAGRAM: aaaa1111]\nQ2. Answer: b');
    expect(out).not.toContain('DIAGRAM');
    expect(out).toContain('Q1. Answer: a');
    expect(out).toContain('Q2. Answer: b');
  });
});

// ── The six requirements ────────────────────────────────────────────────────

describe('requirement 1 — editing question text does not detach its diagram', () => {
  it('12. the diagram stays with its question after the prose is rewritten', async () => {
    const { svc } = makeService();
    const { exec } = makeStore([{ marker_key: 'aaaa1111' }]);
    const before = `${Q(1, 'A wheel of radius 10 m.')}\n[DIAGRAM: aaaa1111]\n${Q(2, 'Define radius.')}`;
    const after = `${Q(1, 'A giant wheel of radius 10 m has a chord AB of 12 m.')}\n[DIAGRAM: aaaa1111]\n${Q(2, 'Define radius.')}`;

    const r = await svc.reconcileDiagramMarkers(INSTITUTE, PAPER, after, exec);
    expect(r.changed).toBe(false);

    const q = svc.parseQuestionsFromMarkdown(after, '');
    expect(q[0].diagram).toEqual({ key: 'aaaa1111' });
    expect(q[1].diagram).toBeUndefined();
    // and it was on question 1 before the edit too
    expect(svc.parseQuestionsFromMarkdown(before, '')[0].diagram.key).toBe('aaaa1111');
  });
});

describe('requirement 2 — reordering preserves associations', () => {
  it('13. moving a question block moves its diagram with it', async () => {
    const { svc } = makeService();
    const { exec } = makeStore([{ marker_key: 'aaaa1111' }]);
    const original = `${Q(1, 'First.')}\n[DIAGRAM: aaaa1111]\n${Q(2, 'Second.')}\n${Q(3, 'Third.')}`;
    const reordered = `${Q(1, 'Second.')}\n${Q(2, 'Third.')}\n${Q(3, 'First.')}\n[DIAGRAM: aaaa1111]`;

    const r = await svc.reconcileDiagramMarkers(INSTITUTE, PAPER, reordered, exec);
    expect(r.changed).toBe(false);

    const before = svc.parseQuestionsFromMarkdown(original, '');
    const after = svc.parseQuestionsFromMarkdown(reordered, '');
    // The diagram followed the TEXT, not the position: it was on "First."
    // before and is still on "First." after, even though "First." is now q3.
    expect(before.find((q: any) => q.diagram)?.text).toContain('First.');
    expect(after.find((q: any) => q.diagram)?.text).toContain('First.');
    expect(after[0].diagram).toBeUndefined();
  });
});

describe('requirement 3 — deleting a question is safe', () => {
  it('14. the row is flagged detached, never deleted, and keeps its image', async () => {
    const { svc } = makeService();
    const { rows, exec } = makeStore([{ marker_key: 'aaaa1111' }]);
    // The previous text is what tells the reconciler this paper HAD a diagram;
    // without it, a paper that now has no markers is correctly a no-op.
    await svc.reconcileDiagramMarkers(
      INSTITUTE, PAPER, `${Q(1, 'Only question left.')}`, exec,
      `${Q(1, 'Deleted question.')}
[DIAGRAM: aaaa1111]`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].detached_at).toBeTruthy();
    expect(rows[0].image_key).toBe('k/one.svg');
  });

  it('15. re-pasting the question rebinds it', async () => {
    const { svc } = makeService();
    const { rows, exec } = makeStore([{ marker_key: 'aaaa1111', detached_at: new Date() }]);
    const r = await svc.reconcileDiagramMarkers(
      INSTITUTE, PAPER, `${Q(1, 'Back again.')}\n[DIAGRAM: aaaa1111]`, exec,
    );
    expect(r.changed).toBe(false);
    expect(rows[0].detached_at).toBeNull();
  });
});

describe('requirement 4 — duplicate questions get distinct identifiers', () => {
  it('16. the second occurrence is cloned under a fresh key', async () => {
    const { svc } = makeService();
    const { rows, exec } = makeStore([{ marker_key: 'aaaa1111' }]);
    const duplicated =
      `${Q(1, 'A wheel.')}\n[DIAGRAM: aaaa1111]\n${Q(2, 'A wheel.')}\n[DIAGRAM: aaaa1111]`;

    const r = await svc.reconcileDiagramMarkers(INSTITUTE, PAPER, duplicated, exec);
    expect(r.changed).toBe(true);

    const keys = extractDiagramMarkers(r.text).map((m) => m.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);              // distinct
    expect(keys[0]).toBe('aaaa1111');                // first keeps its key
    expect(rows).toHaveLength(2);                     // an independent row exists

    // Each question now owns one, so editing one cannot change the other.
    const parsed = svc.parseQuestionsFromMarkdown(r.text, '');
    expect(parsed[0].diagram.key).not.toBe(parsed[1].diagram.key);
  });

  it('17. the clone is independent but reuses the stored image', async () => {
    const { svc } = makeService();
    const { rows, exec } = makeStore([{ marker_key: 'aaaa1111' }]);
    await svc.reconcileDiagramMarkers(
      INSTITUTE, PAPER, `1. a\n[DIAGRAM: aaaa1111]\n2. b\n[DIAGRAM: aaaa1111]`, exec,
    );
    const clone = rows[1];
    expect(clone.id).not.toBe(rows[0].id);
    // Content-addressed storage: a copy costs a row and no bytes.
    expect(clone.image_key).toBe(rows[0].image_key);
    expect(clone.approved).toBe(true);
  });
});

describe('requirement 5 — re-parsing never re-points a diagram', () => {
  it('18. inserting a question above does not move the diagram', () => {
    const { svc } = makeService();
    const before = `${Q(1, 'Alpha.')}\n${Q(2, 'Beta.')}\n[DIAGRAM: aaaa1111]`;
    const after = `${Q(1, 'Inserted.')}\n${Q(2, 'Alpha.')}\n${Q(3, 'Beta.')}\n[DIAGRAM: aaaa1111]`;

    const b = svc.parseQuestionsFromMarkdown(before, '');
    const a = svc.parseQuestionsFromMarkdown(after, '');
    // Positional ids shifted (q-2 -> q-3) but the diagram stayed on "Beta."
    expect(b.find((q: any) => q.diagram)?.text).toContain('Beta.');
    expect(a.find((q: any) => q.diagram)?.text).toContain('Beta.');
    expect(a.find((q: any) => q.diagram)?.id).not.toBe(b.find((q: any) => q.diagram)?.id);
  });

  it('19. the marker is consumed, never printed into the question text', () => {
    const { svc } = makeService();
    const parsed = svc.parseQuestionsFromMarkdown(
      `${Q(1, 'Study the figure.')}\n[DIAGRAM: aaaa1111]`, '',
    );
    expect(parsed[0].text).not.toContain('DIAGRAM');
    expect(parsed[0].text).not.toContain('aaaa1111');
    expect(parsed[0].diagram.key).toBe('aaaa1111');
  });

  it('20. a marker sharing a line with text keeps the text', () => {
    const { svc } = makeService();
    const parsed = svc.parseQuestionsFromMarkdown(
      `${Q(1, 'A wheel.')}\nRefer to it. [DIAGRAM: aaaa1111]`, '',
    );
    expect(parsed[0].text).toContain('Refer to it.');
    expect(parsed[0].text).not.toContain('DIAGRAM');
    expect(parsed[0].diagram.key).toBe('aaaa1111');
  });
});

describe('requirement 6 — papers without diagrams are unaffected', () => {
  const PLAIN = [
    '## Section A — Multiple Choice Questions',
    '1. What is the degree of a linear polynomial? (a) 0 (b) 1 (c) 2 (d) 3',
    '## Section D — Short Answer',
    '2. Define the zero of a polynomial.',
    '3. State the factor theorem.',
  ].join('\n');

  it('21. the reconciler issues NO query and changes nothing', async () => {
    const { svc } = makeService();
    const { exec } = makeStore([]);
    const r = await svc.reconcileDiagramMarkers(INSTITUTE, PAPER, PLAIN, exec);
    expect(r.text).toBe(PLAIN);
    expect(r.changed).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(exec.query).not.toHaveBeenCalled();
  });

  it('22. parsing is byte-identical to a paper with no diagram support', () => {
    const { svc } = makeService();
    const parsed = svc.parseQuestionsFromMarkdown(PLAIN, '');
    expect(parsed).toHaveLength(3);
    expect(parsed.every((q: any) => q.diagram === undefined)).toBe(true);
    // Every other field is exactly what it was before diagrams existed.
    expect(parsed[0].type).toBe('mcq_single');
    expect(parsed[1].type).toBe('short_answer');
    expect(parsed.map((q: any) => q.id)).toEqual(['q-1', 'q-2', 'q-3']);
  });

  it('23. attachDiagrams is a no-op and loads nothing', async () => {
    const { svc, ds } = makeService();
    const row = {
      id: PAPER, institute_id: INSTITUTE, content_text: PLAIN,
      questions_json: svc.parseQuestionsFromMarkdown(PLAIN, ''),
    };
    const out = await svc.attachDiagrams(row, INSTITUTE);
    expect(out.content_text).toBe(PLAIN);
    expect(out.diagrams).toBeUndefined();
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('24. expansion of a diagram-free paper returns it unchanged', () => {
    expect(expandDiagramMarkers(PLAIN, {})).toBe(PLAIN);
    expect(stripDiagramMarkers(PLAIN)).toBe(PLAIN);
  });
});

// ── Cross-paper copying ─────────────────────────────────────────────────────

describe('cross-paper paste copies the diagram in', () => {
  it('25. a marker owned by another paper is copied under a fresh key', async () => {
    const { svc } = makeService();
    const { rows, exec } = makeStore([
      { marker_key: 'dddd4444', assessment_id: OTHER_PAPER },
    ]);
    const pasted = `${Q(1, 'Pasted question.')}\n[DIAGRAM: dddd4444]`;

    const r = await svc.reconcileDiagramMarkers(INSTITUTE, PAPER, pasted, exec);
    expect(r.changed).toBe(true);

    const key = extractDiagramMarkers(r.text)[0].key;
    expect(key).not.toBe('dddd4444');
    const copy = rows.find((x) => x.marker_key === key);
    expect(copy.assessment_id).toBe(PAPER);
    expect(copy.image_key).toBe('k/one.svg');       // shares the stored object
    // The source paper is untouched.
    expect(rows.find((x) => x.marker_key === 'dddd4444').assessment_id).toBe(OTHER_PAPER);
  });

  it('26. a key from ANOTHER institute resolves to nothing and is stripped', async () => {
    // The institute always comes from the trusted server-side context, so a
    // guessed or cross-tenant key must never resolve.
    const { svc } = makeService();
    const { exec } = makeStore([
      { marker_key: 'eeee5555', institute_id: 'someone-else', assessment_id: OTHER_PAPER },
    ]);
    const r = await svc.reconcileDiagramMarkers(
      INSTITUTE, PAPER, `${Q(1, 'q')}\n[DIAGRAM: eeee5555]`, exec,
    );
    expect(r.text).not.toContain('DIAGRAM');
    expect(r.warnings.join(' ')).toContain('unknown diagram marker removed');
  });

  it('27. an entirely unknown key is stripped with a warning', async () => {
    const { svc } = makeService();
    const { exec } = makeStore([]);
    const r = await svc.reconcileDiagramMarkers(
      INSTITUTE, PAPER, `${Q(1, 'q')}\n[DIAGRAM: 99999999]`, exec,
    );
    expect(r.text).not.toContain('DIAGRAM');
    expect(r.changed).toBe(true);
  });
});

// ── Enrichment for display ──────────────────────────────────────────────────

describe('attachDiagrams', () => {
  function rowWithDiagram(svc: any, approved = true) {
    const content = `${Q(1, 'Study the circle.')}\n[DIAGRAM: aaaa1111]`;
    return {
      row: {
        id: PAPER, institute_id: INSTITUTE, content_text: content,
        questions_json: svc.parseQuestionsFromMarkdown(content, ''),
      },
      approved,
    };
  }

  it('28. expands the paper and inlines the image into the question', async () => {
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([{
      id: 'row-1', assessment_id: PAPER, marker_key: 'aaaa1111', diagram_type: 'circle_chord',
      image_key: 'k/one.svg', alt_text: 'Circle with chord AB', approved: true, detached_at: null,
    }]);
    const { row } = rowWithDiagram(svc);
    const out = await svc.attachDiagrams(row, INSTITUTE);

    expect(out.content_text).toContain('![Circle with chord AB](https://media.example/k/one.svg)');
    expect(out.content_text).not.toContain('DIAGRAM');
    // Inlined into q.text, which is what makes the student view work unchanged.
    expect(out.questions_json[0].text).toContain('![Circle with chord AB]');
    expect(out.questions_json[0].diagram.url).toBe('https://media.example/k/one.svg');
  });

  it('29. an unapproved diagram is listed but not shown in the paper', async () => {
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([{
      id: 'row-1', assessment_id: PAPER, marker_key: 'aaaa1111', diagram_type: 'circle_chord',
      image_key: 'k/one.svg', alt_text: 'Pending', approved: false, detached_at: null,
    }]);
    const { row } = rowWithDiagram(svc, false);
    const out = await svc.attachDiagrams(row, INSTITUTE);

    expect(out.content_text).not.toContain('![');
    expect(out.content_text).not.toContain('DIAGRAM');
    expect(out.diagrams.aaaa1111.approved).toBe(false);   // still listed
    expect(out.questions_json[0].text).not.toContain('![');
  });

  it('30. a store outage degrades to a paper with no figures, not an error', async () => {
    const { svc, ds } = makeService();
    ds.query.mockRejectedValueOnce(new Error('relation does not exist'));
    const { row } = rowWithDiagram(svc);
    const out = await svc.attachDiagrams(row, INSTITUTE);
    expect(out.content_text).not.toContain('DIAGRAM');
    expect(out.diagrams).toEqual({});
  });
});
