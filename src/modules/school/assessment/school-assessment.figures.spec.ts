/**
 * Chapter figures in a generated question paper.
 *
 * A paper was text-only: a question needing a diagram either could not be set
 * or was set badly as prose, and a subjective question carrying one was sent to
 * the rubric writer and the grader stripped of the very thing it asked about.
 *
 * The model is offered a catalogue of the chapter's own figures (captions only
 * — never the images, so the cost is a few hundred tokens rather than a vision
 * call) and asks for one by writing [FIGURE: Fn]. These tests pin the two
 * halves that must never go wrong: a marker the model invents must never reach
 * a student, and a question carrying a figure must never be marked blind.
 */
import { SchoolAssessmentService } from './school-assessment.service';

const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';

function makeService(figuresByChapter: Record<string, any[]> = {}) {
  const ds = { query: jest.fn(async () => []) };
  const textbooks = {
    getChapterFigures: jest.fn(async (_inst: string, chapterId: string) => figuresByChapter[chapterId] || []),
  };
  // Constructor order is (ds, notificationService, aiBridge, fcm, s3Service, textbooks).
  const svc: any = new SchoolAssessmentService(
    ds as any, {} as any, {} as any, {} as any, {} as any, textbooks as any,
  );
  return { svc, ds, textbooks };
}

function figure(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'fig-1', pageNo: 8, figureIndex: 0,
    label: 'Fig. 10.13', caption: 'Fig. 10.13: Transverse Wave',
    description: '', detector: 'vector', width: 900, height: 260,
    imageUrl: 'https://media.example/tenants/t/textbook-figures/ch/p8-0.png',
    ...over,
  };
}

describe('collectChapterFigures', () => {
  it('1. builds a positional catalogue across every selected chapter', async () => {
    const { svc } = makeService({
      'ch-1': [figure({ id: 'a' })],
      'ch-2': [figure({ id: 'b', label: 'Fig. 11.2' })],
    });
    const out = await svc.collectChapterFigures(
      INSTITUTE, [{ id: 'ch-1', name: 'Sound' }, { id: 'ch-2', name: 'Light' }], {},
    );
    expect(out.map((f: any) => f.ref)).toEqual(['F1', 'F2']);
    expect(out.map((f: any) => f.id)).toEqual(['a', 'b']);
  });

  it('2. falls back to the single chapterId on the body', async () => {
    const { svc, textbooks } = makeService({ 'ch-9': [figure()] });
    const out = await svc.collectChapterFigures(INSTITUTE, [], { chapterId: 'ch-9' });
    expect(textbooks.getChapterFigures).toHaveBeenCalledWith(INSTITUTE, 'ch-9');
    expect(out).toHaveLength(1);
  });

  it('3. returns nothing when no chapter is in scope', async () => {
    const { svc, textbooks } = makeService();
    expect(await svc.collectChapterFigures(INSTITUTE, [], {})).toEqual([]);
    expect(textbooks.getChapterFigures).not.toHaveBeenCalled();
  });

  it('4. a lookup failure never breaks paper generation', async () => {
    const { svc, textbooks } = makeService();
    textbooks.getChapterFigures.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.collectChapterFigures(INSTITUTE, [{ id: 'ch-1', name: 'Sound' }], {}),
    ).resolves.toEqual([]);
  });

  it('5. caps the catalogue so it cannot crowd out the textbook passages', async () => {
    const many = Array.from({ length: 200 }, (_v, i) => figure({ id: `f${i}` }));
    const { svc } = makeService({ 'ch-1': many });
    const out = await svc.collectChapterFigures(INSTITUTE, [{ id: 'ch-1', name: 'Sound' }], {});
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('resolveFigureMarkers', () => {
  const catalogue = [
    { ref: 'F1', label: 'Fig. 10.13', caption: 'Transverse Wave', imageUrl: 'https://media.example/a.png' },
    { ref: 'F2', label: 'Fig. 10.14', caption: 'Sound moving grains', imageUrl: 'https://media.example/b.png' },
  ];

  it('6. turns a marker into a Markdown image with the caption as alt text', () => {
    const { svc } = makeService();
    const out = svc.resolveFigureMarkers('3. Study the wave shown.\n[FIGURE: F1]\n', catalogue);
    expect(out.text).toContain('![Fig. 10.13 Transverse Wave](https://media.example/a.png)');
    expect(out.text).not.toContain('[FIGURE:');
    expect(out.used).toEqual(['F1']);
  });

  it('7. an invented reference is REMOVED, never printed to a student', () => {
    const { svc } = makeService();
    const out = svc.resolveFigureMarkers('4. Look at this.\n[FIGURE: F9]\n', catalogue);
    expect(out.text).not.toContain('FIGURE');
    expect(out.text).not.toContain('F9');
    expect(out.unresolved).toEqual(['F9']);
  });

  it('8. the same figure is never used twice in one paper', () => {
    const { svc } = makeService();
    const out = svc.resolveFigureMarkers('1. a\n[FIGURE: F1]\n2. b\n[FIGURE: F1]\n', catalogue);
    expect(out.text.match(/!\[/g) || []).toHaveLength(1);
    expect(out.used).toEqual(['F1']);
  });

  it('9. tolerates the spacing and case variations models actually emit', () => {
    const { svc } = makeService();
    for (const marker of ['[FIGURE: F1]', '[figure:F1]', '[ FIGURE : f1 ]', '[Figure:  F1  ]']) {
      const out = svc.resolveFigureMarkers(`1. q\n${marker}\n`, catalogue);
      expect(out.text).toContain('https://media.example/a.png');
      expect(out.text).not.toContain('FIGURE');
    }
  });

  it('10. a figure with no stored image is dropped rather than linked broken', () => {
    const { svc } = makeService();
    const out = svc.resolveFigureMarkers('1. q\n[FIGURE: F1]\n', [{ ...catalogue[0], imageUrl: '' }]);
    expect(out.text).not.toContain('![');
    expect(out.text).not.toContain('FIGURE');
  });

  it('11. strips markers when no figures were offered at all', () => {
    const { svc } = makeService();
    const out = svc.resolveFigureMarkers('1. q\n[FIGURE: F1]\n', []);
    expect(out.text).not.toContain('FIGURE');
  });

  it('12. square brackets in a caption cannot break the Markdown link', () => {
    const { svc } = makeService();
    const out = svc.resolveFigureMarkers('1. q\n[FIGURE: F1]\n', [
      { ref: 'F1', label: 'Fig. 1', caption: 'A [weird] caption', imageUrl: 'https://media.example/a.png' },
    ]);
    expect(out.text).toContain('](https://media.example/a.png)');
    expect(out.text).toContain('![Fig. 1 A weird caption]');
  });

  it('13. leaves a paper with no markers untouched apart from blank-line tidying', () => {
    const { svc } = makeService();
    const paper = '## Section A\n\n1. What is sound?\n\n2. Define frequency.';
    expect(svc.resolveFigureMarkers(paper, catalogue).text).toBe(paper);
  });
});

describe('stripFigureMarkers', () => {
  it('14. removes every marker from the answer key', () => {
    const { svc } = makeService();
    const out = svc.stripFigureMarkers('### Section A\nQ1. Answer: a\n[FIGURE: F1]\nQ2. Answer: b');
    expect(out).not.toContain('FIGURE');
    expect(out).toContain('Q1. Answer: a');
    expect(out).toContain('Q2. Answer: b');
  });
});

describe('the paper prompt', () => {
  /** Runs aiGenerateDraft far enough to capture the prompt it builds. */
  async function capturePrompt(figures: any[]) {
    const { svc } = makeService(figures.length ? { 'ch-1': figures } : {});
    const generateTopicContent = jest.fn(async (_dto: any, ..._rest: any[]) =>
      ({ content: '## Section A\n1. q' }));
    (svc as any).aiBridge = { generateTopicContent };
    (svc as any).textbooks.getGroundingPassages = jest.fn(async () => ({
      passages: [], ebookAvailable: false, lectureAvailable: false,
    }));
    svc.resolveAssessmentNames = jest.fn(async () => ({}));
    svc.resolveChapterList = jest.fn(async () => [{ id: 'ch-1', name: 'Coordinate Geometry' }]);
    svc.normalizeChapterIds = jest.fn(() => ['ch-1']);
    svc.resolveBoard = jest.fn(async () => 'cbse');
    svc.resolvePlotMarkers = jest.fn(async (t: string) => ({ text: t, drawn: 0, failed: 0 }));

    await svc.aiGenerateDraft(
      { instituteId: INSTITUTE },
      { subjectName: 'Mathematics', className: 'Class 10', chapterId: 'ch-1' },
    );
    return String(generateTopicContent.mock.calls[0]?.[0]?.extraContext ?? "");
  }

  it('34. forbids referring to a diagram that is not attached', async () => {
    // Without this the model writes "Study the figure below and find the area"
    // with no figure — an unanswerable question on a student's paper.
    const prompt = await capturePrompt([]);
    expect(prompt).toContain('DIAGRAM RULE');
    expect(prompt.toLowerCase()).toContain('never refer to a diagram');
    expect(prompt).toContain('answerable by a student who sees only what is printed');
  });

  it('35. states the rule even when the chapter has NO figures at all', async () => {
    // That is exactly when it matters most, and exactly when the figure offer
    // is silent.
    const prompt = await capturePrompt([]);
    expect(prompt).toContain('DIAGRAM RULE');
    expect(prompt).not.toContain('FIGURES AVAILABLE');
  });

  it('36. offers drawn diagrams for question-determined figures', async () => {
    const prompt = await capturePrompt([]);
    expect(prompt).toContain('[PLOT:');
    expect(prompt).toContain('coordinate geometry');
    // ...and warns the model off using them for things that must be observed.
    expect(prompt).toContain('photograph');
  });

  it('37. lists the chapter figures when the book has them', async () => {
    const prompt = await capturePrompt([figure()]);
    expect(prompt).toContain('FIGURES AVAILABLE');
    expect(prompt).toContain('Fig. 10.13');
    expect(prompt).toContain('[FIGURE: Fn]');
  });
});

describe('resolvePlotMarkers — figures the textbook does not contain', () => {
  const PNG = 'data:image/png;base64,aGVsbG8=';

  function makePlotService(render?: jest.Mock) {
    const { svc } = makeService();
    const aiBridge = {
      renderDiagram: render || jest.fn(async () => ({ success: true, data: { imageBase64: PNG, attempts: 1 } })),
    };
    const s3 = { upload: jest.fn(async (key: string) => `https://media.example/${key}`) };
    (svc as any).aiBridge = aiBridge;
    (svc as any).s3Service = s3;
    return { svc, aiBridge, s3 };
  }

  const CTX = { subjectName: 'Mathematics', className: 'Class 10', board: 'cbse' };

  it('22. draws a spec and inlines it as a Markdown image', async () => {
    const { svc, aiBridge } = makePlotService();
    const out = await svc.resolvePlotMarkers(
      '1. Show that the points are a right triangle.\n' +
      '[PLOT: right-angled triangle with vertices A(1,1), B(4,1), C(4,5)]\n',
      INSTITUTE, CTX,
    );
    expect(out.drawn).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.text).toContain('![right-angled triangle with vertices A(1,1), B(4,1), C(4,5)](');
    expect(out.text).not.toContain('[PLOT:');
    expect(aiBridge.renderDiagram).toHaveBeenCalledWith(
      expect.objectContaining({ subjectName: 'Mathematics', className: 'Class 10', board: 'cbse' }),
      INSTITUTE, 'school', 'cbse',
    );
  });

  it('23. a figure that cannot be drawn leaves a VISIBLE note for the teacher', async () => {
    // Silently dropping the marker would leave the question saying "study the
    // figure below" with nothing below it.
    const render = jest.fn(async () => { throw new Error('422 could not draw'); });
    const { svc } = makePlotService(render);
    const out = await svc.resolvePlotMarkers('1. Study the graph.\n[PLOT: impossible thing]\n', INSTITUTE, CTX);
    expect(out.drawn).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.text).toContain('Diagram could not be generated');
    expect(out.text).not.toContain('[PLOT:');
  });

  it('24. identical specs are drawn once and reused', async () => {
    const { svc, aiBridge } = makePlotService();
    const out = await svc.resolvePlotMarkers(
      '1. a\n[PLOT: a number line from -5 to 5]\n2. b\n[PLOT: a number line from -5 to 5]\n',
      INSTITUTE, CTX,
    );
    expect(aiBridge.renderDiagram).toHaveBeenCalledTimes(1);
    expect(out.drawn).toBe(2);
    expect((out.text.match(/!\[/g) || []).length).toBe(2);
  });

  it('25. caps how many distinct diagrams one paper can request', async () => {
    const { svc, aiBridge } = makePlotService();
    const markers = Array.from({ length: 12 }, (_v, i) => `${i}. q\n[PLOT: figure number ${i}]`).join('\n');
    const out = await svc.resolvePlotMarkers(markers, INSTITUTE, CTX);
    expect(aiBridge.renderDiagram.mock.calls.length).toBeLessThanOrEqual(4);
    // Everything over the cap still gets a note rather than an orphan marker.
    expect(out.text).not.toContain('[PLOT:');
    expect(out.drawn + out.failed).toBe(12);
  });

  it('26. a non-PNG payload is treated as a failure, not inlined', async () => {
    const render = jest.fn(async () => ({ success: true, data: { imageBase64: 'https://evil.example/x.png' } }));
    const { svc, s3 } = makePlotService(render);
    const out = await svc.resolvePlotMarkers('1. q\n[PLOT: something]\n', INSTITUTE, CTX);
    expect(s3.upload).not.toHaveBeenCalled();
    expect(out.failed).toBe(1);
    expect(out.text).toContain('Diagram could not be generated');
  });

  it('27. an upload failure degrades to the teacher note', async () => {
    const { svc, s3 } = makePlotService();
    s3.upload.mockRejectedValueOnce(new Error('R2 down'));
    const out = await svc.resolvePlotMarkers('1. q\n[PLOT: a triangle]\n', INSTITUTE, CTX);
    expect(out.failed).toBe(1);
    expect(out.text).toContain('Diagram could not be generated');
  });

  it('28. a paper with no plot markers is returned untouched', async () => {
    const { svc, aiBridge } = makePlotService();
    const paper = '## Section A\n\n1. What is sound?\n\n2. Define frequency.';
    const out = await svc.resolvePlotMarkers(paper, INSTITUTE, CTX);
    expect(out.text).toBe(paper);
    expect(out.drawn).toBe(0);
    expect(aiBridge.renderDiagram).not.toHaveBeenCalled();
  });

  it('29. a marker cannot swallow the rest of the paper', async () => {
    // An unterminated marker must not consume every following question.
    const { svc } = makePlotService();
    const out = await svc.resolvePlotMarkers(
      '1. q\n[PLOT: a triangle\n2. Second question stays.\n3. Third stays too.\n',
      INSTITUTE, CTX,
    );
    expect(out.text).toContain('2. Second question stays.');
    expect(out.text).toContain('3. Third stays too.');
  });

  it('30. tolerates the spacing and case models actually emit', async () => {
    for (const marker of ['[PLOT: a triangle]', '[plot:a triangle]', '[ PLOT : a triangle ]']) {
      const { svc } = makePlotService();
      const out = await svc.resolvePlotMarkers(`1. q\n${marker}\n`, INSTITUTE, CTX);
      expect(out.drawn).toBe(1);
      expect(out.text).not.toMatch(/\[\s*plot/i);
    }
  });
});

describe('storeGeneratedFigure', () => {
  it('31. keys by a hash of the spec so redrafting reuses one object', async () => {
    const { svc } = makeService();
    const s3 = { upload: jest.fn(async (key: string) => `https://media.example/${key}`) };
    (svc as any).s3Service = s3;
    const first = await svc.storeGeneratedFigure(INSTITUTE, 'a triangle', 'data:image/png;base64,aGk=');
    const second = await svc.storeGeneratedFigure(INSTITUTE, 'a triangle', 'data:image/png;base64,aGk=');
    expect(first).toBe(second);
    expect(s3.upload.mock.calls[0][0]).toMatch(
      new RegExp(`^tenants/${INSTITUTE}/assessment-figures/[0-9a-f]{32}\\.png$`),
    );
    const other = await svc.storeGeneratedFigure(INSTITUTE, 'a circle', 'data:image/png;base64,aGk=');
    expect(other).not.toBe(first);
  });

  it('32. returns null rather than throwing when storage fails', async () => {
    const { svc } = makeService();
    (svc as any).s3Service = { upload: jest.fn(async () => { throw new Error('R2 down'); }) };
    await expect(
      svc.storeGeneratedFigure(INSTITUTE, 'a triangle', 'data:image/png;base64,aGk='),
    ).resolves.toBeNull();
  });
});

describe('stripFigureMarkers', () => {
  it('33. strips drawn-diagram markers from the answer key too', async () => {
    const { svc } = makeService();
    const out = svc.stripFigureMarkers('Q1. Answer: a\n[PLOT: a triangle]\n[FIGURE: F1]\nQ2. Answer: b');
    expect(out).not.toContain('PLOT');
    expect(out).not.toContain('FIGURE');
    expect(out).toContain('Q1. Answer: a');
    expect(out).toContain('Q2. Answer: b');
  });
});

describe('question parsing with figures', () => {
  it('15. attaches a resolved image to the question that precedes it', () => {
    const { svc } = makeService();
    const paper = [
      '### Section D — Short Answer',
      '1. Study the wave and state its wavelength.',
      '![Fig. 10.13 Transverse Wave](https://media.example/a.png)',
      '2. Define amplitude.',
    ].join('\n');
    const questions = svc.parseQuestionsFromMarkdown(paper, '');
    expect(questions).toHaveLength(2);
    expect(questions[0].image).toEqual({
      url: 'https://media.example/a.png', alt: 'Fig. 10.13 Transverse Wave',
    });
    // Kept inline too, which is what renders it in both paper and test views.
    expect(questions[0].text).toContain('![Fig. 10.13 Transverse Wave]');
    expect(questions[1].image).toBeUndefined();
  });

  it('16. a paper with no images parses exactly as before', () => {
    const { svc } = makeService();
    const questions = svc.parseQuestionsFromMarkdown(
      '### Section D — Short Answer\n1. Define sound.\n2. Define echo.', '',
    );
    expect(questions).toHaveLength(2);
    expect(questions.every((q: any) => q.image === undefined)).toBe(true);
  });

  it('17. the image survives the student-facing strip of answers', () => {
    const { svc } = makeService();
    const questions = svc.parseQuestionsFromMarkdown(
      '### Section D\n1. Study the diagram.\n![Fig. 1 Wave](https://media.example/a.png)', '',
    );
    const safe = svc.stripCorrectAnswersFromQuestions(questions);
    expect(safe[0].image).toEqual({ url: 'https://media.example/a.png', alt: 'Fig. 1 Wave' });
    expect(safe[0].correctAnswer).toBeUndefined();
  });
});

describe('questionTextForMarking', () => {
  it('18. tells the rubric writer a diagram is part of the question', () => {
    const { svc } = makeService();
    const text = svc.questionTextForMarking({
      text: 'Study the wave shown.\n![Fig. 10.13 Transverse Wave](https://media.example/a.png)',
      image: { url: 'https://media.example/a.png', alt: 'Fig. 10.13 Transverse Wave' },
    });
    expect(text).toContain('Study the wave shown.');
    expect(text).toContain('Fig. 10.13 Transverse Wave');
    // The raw Markdown/URL is useless to a text model and must not be sent.
    expect(text).not.toContain('https://media.example/a.png');
    expect(text).not.toContain('![');
  });

  it('19. a question with no figure is passed through byte for byte', () => {
    const { svc } = makeService();
    const original = 'Define the amplitude of a wave.';
    expect(svc.questionTextForMarking({ text: original })).toBe(original);
  });

  it('20. a figure with no alt text still announces the diagram', () => {
    const { svc } = makeService();
    const text = svc.questionTextForMarking({
      text: 'Study it.\n![](https://media.example/a.png)',
      image: { url: 'https://media.example/a.png', alt: '' },
    });
    expect(text).toContain('accompanied by a diagram');
    expect(text).not.toContain('https://media.example/a.png');
  });

  it('21. never throws on a malformed question', () => {
    const { svc } = makeService();
    expect(svc.questionTextForMarking({})).toBe('');
    expect(svc.questionTextForMarking(null)).toBe('');
  });
});
