/**
 * Background deck generation through the backend.
 *
 * A deck takes one to three minutes; held open as one request it ran into
 * the AI service's 120s worker timeout and this service's 240s wait. Now the
 * studio starts a job and polls. These tests pin that the background route
 * prepares the request exactly as the old one did, and finishes the result
 * exactly as the old one did.
 */
import { SchoolPptService } from './school-ppt.service';

function build() {
  const aiBridge = {
    generatePpt: jest.fn().mockResolvedValue({ success: true, data: { title: 'Deck', slides: [] } }),
    startPptGeneration: jest.fn().mockResolvedValue({ success: true, jobId: 'job-1' }),
    getPptGenerationStatus: jest.fn(),
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

  it('lets the content decide the slide count when asked to', async () => {
    const { svc, aiBridge } = build();
    await svc.startGeneration({ topic: 'T', slideCount: 'auto' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].slideCount).toBe('auto');
    await svc.startGeneration({ topic: 'T', slideCount: 40 }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[1][0].slideCount).toBe(25);
  });

  it('refuses an unknown slide style rather than passing it on', async () => {
    const { svc, aiBridge } = build();
    await svc.startGeneration({ topic: 'T', pptVersion: 'experimental' }, 'inst-1');
    expect(aiBridge.startPptGeneration.mock.calls[0][0].pptVersion).toBeUndefined();
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
