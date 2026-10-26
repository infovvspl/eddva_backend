/**
 * Animation materials keep their type. 'animation' was missing from the allowed
 * types, so they were saved as 'notes' and only an .mp4 file URL let the
 * student page recognise one (a YouTube/Vimeo/Drive link never showed).
 */
import { SchoolMaterialService } from './school-material.service';

const ADMIN = { id: 'u-1', role: 'INSTITUTE_ADMIN', instituteId: 'inst-1' };

function makeService() {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO study_materials')) {
      return [{ id: 'm-1', type: params[1], title: params[2], description: params[5], s3_key: params[6], content_source: params[14] }];
    }
    return [];
  });
  const svc = new SchoolMaterialService(
    { query } as any, {} as any, {} as any, { create: jest.fn() } as any, {} as any, {} as any, {} as any,
  );
  return { svc, query };
}

describe('SchoolMaterialService — animation type', () => {
  it('saves an animation link as an animation, not notes', async () => {
    const { svc } = makeService();
    const res: any = await svc.create(ADMIN, { title: 'Real numbers', fileType: 'animation', fileUrl: 'https://youtu.be/abc123' });
    expect(res.data.fileType).toBe('animation');
  });

  it('an unknown type still falls back to notes', async () => {
    const { svc } = makeService();
    const res: any = await svc.create(ADMIN, { title: 'X', fileType: 'hologram', fileUrl: 'https://cdn.example/x.pdf' });
    expect(res.data.fileType).toBe('notes');
  });

  it('adds the animation value to the database type on start', async () => {
    const { svc, query } = makeService();
    await (svc as any).onModuleInit?.().catch?.(() => undefined);
    expect(query.mock.calls.some(([sql]) => /ADD VALUE IF NOT EXISTS 'animation'/.test(String(sql)))).toBe(true);
  });
});
