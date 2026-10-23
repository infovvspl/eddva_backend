import { caching } from 'cache-manager';
import { BlogService } from './blog.service';
import { BlogPostStatus } from '../../database/entities/blog-post.entity';

const post = (over: Record<string, unknown>) => ({
  id: 'x', title: 'T', slug: 's', category: 'AI', excerpt: 'e', locale: 'en', translationGroup: null,
  status: BlogPostStatus.PUBLISHED, publishedAt: new Date(), ...over,
});

describe('BlogService public cache', () => {
  let rows: any[];
  let find: jest.Mock;
  let service: BlogService;

  beforeEach(async () => {
    rows = [
      post({ id: '1', slug: 'hello', locale: 'en', translationGroup: 'g1' }),
      post({ id: '2', slug: 'namaste', locale: 'hi', translationGroup: 'g1', title: 'नमस्ते' }),
      post({ id: '3', slug: 'only-english', locale: 'en' }),
    ];
    find = jest.fn(async () => rows);
    const repo: any = {
      find,
      query: jest.fn(async () => undefined),
      findOne: jest.fn(async () => null),
      save: jest.fn(async (p: any) => p),
      create: jest.fn((p: any) => p),
      softDelete: jest.fn(),
    };
    const cache = await caching('memory', { ttl: 0 });
    service = new BlogService(repo, cache as any);
    await service.onModuleInit();
  });

  it('warms on boot, then serves reads without querying the database', async () => {
    expect(find).toHaveBeenCalledTimes(1);
    await service.listPublic({ locale: 'en' } as any);
    await service.listPublic({ locale: 'hi' } as any);
    await service.findPublicBySlug('hello');
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('lists only the requested language and defaults to English', async () => {
    expect((await service.listPublic({ locale: 'hi' } as any)).items.map((p) => p.slug)).toEqual(['namaste']);
    expect((await service.listPublic({} as any)).items.map((p) => p.slug)).toEqual(['hello', 'only-english']);
  });

  it('links a post to its translations', async () => {
    expect((await service.findPublicBySlug('hello')).translations).toEqual([{ locale: 'hi', slug: 'namaste' }]);
    expect((await service.findPublicBySlug('only-english')).translations).toEqual([]);
  });

  it('rebuilds the cache when a post is created', async () => {
    rows.push(post({ id: '4', slug: 'new-hi', locale: 'hi' }));
    await service.create({ title: 'New', locale: 'hi', status: BlogPostStatus.PUBLISHED } as any);
    expect(find).toHaveBeenCalledTimes(2);
    expect((await service.listPublic({ locale: 'hi' } as any)).items.map((p) => p.slug)).toContain('new-hi');
    expect(find).toHaveBeenCalledTimes(2);
  });
});
