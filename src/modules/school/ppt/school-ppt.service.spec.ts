/**
 * Background deck generation through the backend.
 *
 * A deck takes one to three minutes; held open as one request it ran into
 * the AI service's 120s worker timeout and this service's 240s wait. Now the
 * studio starts a job and polls. These tests pin that the background route
 * prepares the request exactly as the old one did, and finishes the result
 * exactly as the old one did.
 */
import { SchoolPptService, safeStudioPath } from './school-ppt.service';

function build() {
  const aiBridge = {
    generatePpt: jest.fn().mockResolvedValue({ success: true, data: { title: 'Deck', slides: [] } }),
    startPptGeneration: jest.fn().mockResolvedValue({ success: true, jobId: 'job-1' }),
    getPptGenerationStatus: jest.fn(),
    getGeneratedImage: jest.fn().mockResolvedValue({ contentType: 'image/png', buffer: Buffer.from('png') }),
  };
  const ds = { query: jest.fn().mockResolvedValue([]) };
  const textbooks = {
    getGroundingPassages: jest.fn().mockResolvedValue({
      passages: [{ page_no: 4, content: 'Leaves make food.' }],
    }),
  };
  const flags = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
  const svc = new SchoolPptService(aiBridge as any, ds as any, textbooks as any, flags as any);
  return { svc, aiBridge, textbooks };
}

describe('SchoolPptService background generation', () => {
  it('starts a job with the same body generate() sends, plus what finishing needs', async () => {
    const { svc, aiBridge } = build();
    const out = await svc.startGeneration(
      { topic: 'Photosynthesis', slideCount: 8, pptVersion: 'image', chapterId: 'ch-1' }, 'inst-1');
    expect(out).toEqual({ success: true, jobId: 'job-1' });
    const [body, tenant] = aiBridge.startPptGeneration.mock.calls[0];
    expect(tenant).toBe('inst-1');
    expect(body.topic).toBe('Photosynthesis');
    expect(body.slideCount).toBe(8);
    expect(body.pptVersion).toBe('image');
    expect(body.sourcePassages).toEqual([{ page_no: 4, content: 'Leaves make food.' }]);
    expect(body.clientMeta).toMatchObject({ sourceMode: 'ebook', passages: 1, chapterId: 'ch-1' });
  });

  it('passes "make a fresh one" on, and nothing else that claims to be it', async () => {
    const { svc, aiBridge } = build();
    await svc.startGeneration({ topic: 'T', fresh: true }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].fresh).toBe(true);
    await svc.startGeneration({ topic: 'T', fresh: 'yes' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[1][0]).not.toHaveProperty('fresh');
    await svc.startGeneration({ topic: 'T' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[2][0]).not.toHaveProperty('fresh');
  });

  it('lets the content decide the slide count when asked to', async () => {
    const { svc, aiBridge } = build();
    await svc.startGeneration({ topic: 'T', slideCount: 'auto' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].slideCount).toBe('auto');
    await svc.startGeneration({ topic: 'T', slideCount: 40 }, 'inst-1');
    // Decks are capped at 10 slides.
    expect(aiBridge.startPptGeneration.mock.calls[1][0].slideCount).toBe(10);
  });

  it('refuses an unknown slide style rather than passing it on', async () => {
    const { svc, aiBridge } = build();
    await svc.startGeneration({ topic: 'T', pptVersion: 'experimental' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].pptVersion).toBeUndefined();
  });

  it('passes the studio theme on, for both the job and the one-request route', async () => {
    const { svc, aiBridge } = build();
    await svc.startGeneration({ topic: 'T', deckTheme: 'ocean-blue' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].deckTheme).toBe('ocean-blue');
    await svc.generate({ topic: 'T', deckTheme: ' Royal-Purple ' }, 'inst-1');
    expect(aiBridge.generatePpt.mock.calls[0][0].deckTheme).toBe('royal-purple');
  });

  it('sends no theme for "match the subject", nothing, or an unknown value', async () => {
    const { svc, aiBridge } = build();
    for (const deckTheme of ['subject', undefined, '', 'neon', '<script>']) {
      await svc.startGeneration({ topic: 'T', deckTheme }, 'inst-1');
    }
    for (const [body] of aiBridge.startPptGeneration.mock.calls) {
      expect(body).not.toHaveProperty('deckTheme');
    }
  });

  it('names the deck from its IDs, not from names sent alongside them', async () => {
    // A teacher reported decks for one topic coming out about another; the
    // IDs decide which topic it is, so the names the database gives for them
    // win over whatever names came with the request.
    const { svc, aiBridge } = build();
    const ds = (svc as any).ds;
    ds.query.mockImplementation(async (sql: string) => (sql.includes('FROM topics t')
      ? [{ topic_name: 'Respiration', chapter_name: 'Life Processes', subject_name: 'Science',
           subject_id: 's1', class_name: 'Class 10' }]
      : []));
    await svc.startGeneration({
      topic: 'Respiration', topicId: 't1',
      topicName: 'Nutrition', chapterName: 'Old chapter', className: 'Class 9',
    }, 'inst-1');
    const body = aiBridge.startPptGeneration.mock.calls[0][0];
    expect(body).toMatchObject({
      topicName: 'Respiration', chapterName: 'Life Processes', subjectName: 'Science', className: 'Class 10',
    });
  });

  it('keeps a sent name when the database has none for it', async () => {
    const { svc, aiBridge } = build();
    (svc as any).ds.query.mockImplementation(async (sql: string) => (sql.includes('FROM topics t')
      ? [{ topic_name: 'Respiration', chapter_name: 'Life Processes', subject_name: 'Science',
           subject_id: 's1', class_name: null }]
      : []));
    await svc.startGeneration({ topic: 'T', topicId: 't1', className: 'Class 10' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].className).toBe('Class 10');
  });

  it('finishes a done job exactly as generate() finishes a deck', async () => {
    const { svc, aiBridge } = build();
    aiBridge.getPptGenerationStatus.mockResolvedValue({
      status: 'done',
      meta: { sourceMode: 'ebook', effectiveSourceMode: 'ebook', passages: 0 },
      result: { success: true, data: { title: 'Deck', slides: [] } },
    });
    const job = await svc.generationStatus('job-1', 'inst-1');
    expect(job.result.data.sourceMode).toBe('ebook');
    expect(job.result.data.source).toEqual({ grounded: false, reason: 'not_indexed' });
  });

  it('passes a running job through untouched', async () => {
    const { svc, aiBridge } = build();
    const running = { status: 'running', stage: 'pictures', done: 2, total: 6, partial: { slides: [] } };
    aiBridge.getPptGenerationStatus.mockResolvedValue(running);
    expect(await svc.generationStatus('job-1', 'inst-1')).toEqual(running);
  });

  it('keeps the old one-request route working the same way', async () => {
    const { svc, aiBridge } = build();
    const out: any = await svc.generate({ topic: 'T' }, 'inst-1');
    expect(aiBridge.generatePpt).toHaveBeenCalled();
    expect(out.data.source).toEqual({ grounded: false, reason: 'unavailable' });
  });
});

describe('generated images served through the backend', () => {
  // Browsers cannot reach the AI service on dev; painted slides link here instead.
  it('serves an AI-generated image by its file name', async () => {
    const { svc, aiBridge } = build();
    const out = await svc.generatedImage('98e3c1a0f5b44d3e9b2b1f0c7a6d5e4f.png');
    expect(out?.contentType).toBe('image/png');
    expect(aiBridge.getGeneratedImage).toHaveBeenCalledWith('98e3c1a0f5b44d3e9b2b1f0c7a6d5e4f.png');
  });

  it('never fetches anything that is not a plain generated-image name', async () => {
    const { svc, aiBridge } = build();
    for (const bad of ['../settings.py', '..%2F.env', 'http://169.254.169.254/latest', 'a/b.png',
                       'x.png?y=1', 'notes.txt', '', 'short.png']) {
      expect(await svc.generatedImage(bad)).toBeNull();
    }
    expect(aiBridge.getGeneratedImage).not.toHaveBeenCalled();
  });
});

describe('decks generated in the background', () => {
  // A teacher can leave PPT Studio while a deck is made and follow it, then
  // open it, from Course Content.
  class MemoryStore {
    records = new Map<string, any>();
    async put(_i: string, _u: string, r: any) { this.records.set(r.jobId, JSON.parse(JSON.stringify(r))); }
    async list() { return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt); }
    async remove(_i: string, _u: string, id: string) { this.records.delete(id); }
  }
  const teacher = { id: 'teacher-7' };

  function withStore() {
    const store = new MemoryStore();
    const aiBridge = {
      startPptGeneration: jest.fn().mockResolvedValue({ success: true, jobId: 'job-1' }),
      getPptGenerationStatus: jest.fn(),
    };
    const ds = { query: jest.fn().mockResolvedValue([]) };
    const textbooks = { getGroundingPassages: jest.fn().mockResolvedValue({ passages: [] }) };
    const flags = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
    const svc = new SchoolPptService(aiBridge as any, ds as any, textbooks as any, flags as any, store as any);
    return { svc, aiBridge, store };
  }

  it('remembers a started deck for its teacher, with the page to open it in', async () => {
    const { svc, store } = withStore();
    await svc.startGeneration({ topic: 'Respiration', pptVersion: 'image',
      pagePath: '/school/teacher/ppt-studio?topic=Respiration&topicId=t1' }, 'inst-1', teacher);
    const [r] = await store.list();
    expect(r).toMatchObject({ jobId: 'job-1', topic: 'Respiration', style: 'image',
      pagePath: '/school/teacher/ppt-studio?topic=Respiration&topicId=t1' });
  });

  it('never keeps a page outside PPT Studio', () => {
    for (const bad of ['https://evil.example/school/teacher/ppt-studio', '//evil.example/x',
                       '/school/admin', '/school/teacher/ppt-studio?x=<script>', 'javascript:alert(1)', 42]) {
      expect(safeStudioPath(bad)).toBeNull();
    }
    expect(safeStudioPath('/school/teacher/ppt-studio?topic=A')).toBe('/school/teacher/ppt-studio?topic=A');
  });

  it('lists a running deck with its live progress, asking for the summary only', async () => {
    const { svc, aiBridge } = withStore();
    await svc.startGeneration({ topic: 'Respiration' }, 'inst-1', teacher);
    aiBridge.getPptGenerationStatus.mockResolvedValue({ status: 'running', stage: 'pictures', done: 4,
      total: 10, activity: 'Slide 5: painting the slide' });
    const { jobs } = await svc.listJobs('inst-1', teacher);
    expect(jobs[0]).toMatchObject({ jobId: 'job-1', status: 'running', done: 4, total: 10,
      activity: 'Slide 5: painting the slide' });
    expect(aiBridge.getPptGenerationStatus).toHaveBeenCalledWith('job-1', 'inst-1', { summary: true });
  });

  it('stops asking the AI service about a deck once it has finished', async () => {
    const { svc, aiBridge } = withStore();
    await svc.startGeneration({ topic: 'Respiration' }, 'inst-1', teacher);
    aiBridge.getPptGenerationStatus.mockResolvedValue({ status: 'done', title: 'Respiration', slides: 10 });
    await svc.listJobs('inst-1', teacher);
    const { jobs } = await svc.listJobs('inst-1', teacher);
    expect(jobs[0]).toMatchObject({ status: 'done', title: 'Respiration', slides: 10 });
    expect(aiBridge.getPptGenerationStatus).toHaveBeenCalledTimes(1);
  });

  it('drops a deck the AI service no longer has, and keeps one it cannot reach', async () => {
    const { svc, aiBridge, store } = withStore();
    await svc.startGeneration({ topic: 'A' }, 'inst-1', teacher);
    aiBridge.getPptGenerationStatus.mockRejectedValueOnce({ response: { status: 503 } });
    expect((await svc.listJobs('inst-1', teacher)).jobs[0].status).toBe('running');
    aiBridge.getPptGenerationStatus.mockRejectedValueOnce({ response: { status: 404 } });
    expect((await svc.listJobs('inst-1', teacher)).jobs).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it('a dismissed deck leaves the list; another teacher has no list here', async () => {
    const { svc } = withStore();
    await svc.startGeneration({ topic: 'A' }, 'inst-1', teacher);
    await svc.dismissJob('job-1', 'inst-1', teacher);
    expect((await svc.listJobs('inst-1', teacher)).jobs).toEqual([]);
    expect((await svc.listJobs('inst-1', null)).jobs).toEqual([]);
  });
});
