import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { BlogLocale, BlogPost, BlogPostStatus } from '../../database/entities/blog-post.entity';
import { CreateBlogPostDto, ListBlogPostsQueryDto, PublicBlogQueryDto, UpdateBlogPostDto } from './dto/blog.dto';

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'post';

/**
 * Every published post, all languages, under one key. Public reads are served
 * from this entry and never touch the database; it has no TTL and is rebuilt
 * whenever the admin panel creates, edits or deletes a post.
 */
const PUBLIC_CACHE_KEY = 'blog:public:v1';
const FOREVER = 0;

type PlainBlogPost = Omit<BlogPost, 'hasId' | 'save' | 'remove' | 'softRemove' | 'recover' | 'reload'>;
export type PublicBlogPost = PlainBlogPost & { translations: { locale: BlogLocale; slug: string }[] };

@Injectable()
export class BlogService implements OnModuleInit {
  private readonly logger = new Logger(BlogService.name);
  private inflightLoad: Promise<BlogPost[]> | null = null;

  constructor(
    @InjectRepository(BlogPost, 'coaching')
    private readonly blogRepo: Repository<BlogPost>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** The coaching DataSource has synchronize off, so self-create the table. */
  async onModuleInit() {
    try {
      await this.blogRepo.query(`
        CREATE TABLE IF NOT EXISTS blog_posts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title varchar NOT NULL,
          slug varchar NOT NULL,
          category varchar,
          excerpt text,
          author varchar,
          cover_image varchar,
          cover_image_alt varchar,
          read_time int,
          sections jsonb,
          document_settings jsonb,
          status varchar NOT NULL DEFAULT 'DRAFT',
          published_at timestamptz,
          created_by varchar,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        )
      `);
      await this.blogRepo.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug) WHERE deleted_at IS NULL`,
      );
      await this.blogRepo.query(`CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status)`);
    } catch (e: any) {
      this.logger.warn(`Could not ensure blog_posts table exists: ${e?.message}`);
    }
    try {
      await this.blogRepo.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS document_settings jsonb`);
    } catch (e: any) {
      this.logger.warn(`Could not add blog document settings column: ${e?.message}`);
    }
    try {
      await this.blogRepo.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS cover_image_alt varchar`);
    } catch (e: any) {
      this.logger.warn(`Could not add blog cover image alt column: ${e?.message}`);
    }
    try {
      await this.blogRepo.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS locale varchar NOT NULL DEFAULT 'en'`);
      await this.blogRepo.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS translation_group varchar`);
      await this.blogRepo.query(`CREATE INDEX IF NOT EXISTS idx_blog_posts_locale ON blog_posts(locale)`);
      await this.blogRepo.query(
        `CREATE INDEX IF NOT EXISTS idx_blog_posts_translation_group ON blog_posts(translation_group)`,
      );
    } catch (e: any) {
      this.logger.warn(`Could not add blog locale columns: ${e?.message}`);
    }
    await this.refreshPublicCache();
  }

  // ── Public cache ─────────────────────────────────────────────────────────

  /** Rebuild the cache entry from the database (the only place public data is queried). */
  private loadPublished(): Promise<BlogPost[]> {
    // Concurrent misses share one query instead of each hitting the database.
    this.inflightLoad ??= this.blogRepo
      .find({ where: { status: BlogPostStatus.PUBLISHED }, order: { publishedAt: 'DESC' } })
      .then(async (posts) => {
        await this.cache.set(PUBLIC_CACHE_KEY, posts, FOREVER);
        return posts;
      })
      .finally(() => {
        this.inflightLoad = null;
      });
    return this.inflightLoad;
  }

  /** Drop the cached posts and cache the fresh set straight away. */
  async refreshPublicCache(): Promise<void> {
    try {
      await this.cache.del(PUBLIC_CACHE_KEY);
      await this.loadPublished();
    } catch (e: any) {
      this.logger.warn(`Could not refresh the public blog cache: ${e?.message}`);
    }
  }

  private async publishedPosts(): Promise<BlogPost[]> {
    const cached = await this.cache.get<BlogPost[]>(PUBLIC_CACHE_KEY);
    return cached ?? this.loadPublished();
  }

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base;
    let n = 2;
    // Small table, a handful of posts — a loop of point lookups is simpler
    // than a single query and cheap enough not to matter.
    while (true) {
      const existing = await this.blogRepo.findOne({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${base}-${n++}`;
    }
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async list(q: ListBlogPostsQueryDto): Promise<{ items: BlogPost[]; total: number; page: number; limit: number }> {
    const page = q.page || 1;
    const limit = q.limit || 50;
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.locale) where.locale = q.locale;
    if (q.category) where.category = q.category;

    const base = q.search
      ? [
          { ...where, title: ILike(`%${q.search}%`) },
          { ...where, excerpt: ILike(`%${q.search}%`) },
        ]
      : where;

    const [items, total] = await this.blogRepo.findAndCount({
      where: base,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<BlogPost> {
    const post = await this.blogRepo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Blog post not found');
    return post;
  }

  async create(dto: CreateBlogPostDto, createdBy?: string): Promise<BlogPost> {
    const slug = await this.uniqueSlug(slugify(dto.slug || dto.title));
    const publishedAt = dto.status === BlogPostStatus.PUBLISHED ? new Date() : null;
    const post = this.blogRepo.create({ ...dto, slug, publishedAt, createdBy });
    const saved = await this.blogRepo.save(post);
    await this.refreshPublicCache();
    return saved;
  }

  async update(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    const post = await this.findById(id);

    if (dto.slug !== undefined || dto.title !== undefined) {
      const base = slugify(dto.slug || dto.title || post.title);
      if (base !== post.slug) post.slug = await this.uniqueSlug(base, post.id);
    }
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.locale !== undefined) post.locale = dto.locale;
    if (dto.translationGroup !== undefined) post.translationGroup = dto.translationGroup;
    if (dto.category !== undefined) post.category = dto.category;
    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt;
    if (dto.author !== undefined) post.author = dto.author;
    if (dto.coverImage !== undefined) post.coverImage = dto.coverImage;
    if (dto.coverImageAlt !== undefined) post.coverImageAlt = dto.coverImageAlt;
    if (dto.readTime !== undefined) post.readTime = dto.readTime;
    if (dto.sections !== undefined) post.sections = dto.sections;
    if (dto.documentSettings !== undefined) post.documentSettings = dto.documentSettings;
    if (dto.status !== undefined) {
      if (dto.status === BlogPostStatus.PUBLISHED && post.status !== BlogPostStatus.PUBLISHED) {
        post.publishedAt = new Date();
      }
      post.status = dto.status;
    }

    const saved = await this.blogRepo.save(post);
    await this.refreshPublicCache();
    return saved;
  }

  async remove(id: string): Promise<{ message: string }> {
    const post = await this.findById(id);
    await this.blogRepo.softDelete(post.id);
    await this.refreshPublicCache();
    return { message: 'Blog post deleted successfully' };
  }

  // ── Public (served from the cache, no database queries) ──────────────────

  async listPublic(q: PublicBlogQueryDto): Promise<{ items: BlogPost[]; total: number; page: number; limit: number }> {
    const page = q.page || 1;
    const limit = q.limit || 50;
    const locale = q.locale || 'en';
    const search = q.search?.toLowerCase();

    const matches = (await this.publishedPosts()).filter(
      (p) =>
        (p.locale || 'en') === locale &&
        (!q.category || q.category === 'All' || p.category === q.category) &&
        (!search || p.title?.toLowerCase().includes(search) || p.excerpt?.toLowerCase().includes(search)),
    );
    return { items: matches.slice((page - 1) * limit, page * limit), total: matches.length, page, limit };
  }

  async findPublicBySlug(slug: string): Promise<PublicBlogPost> {
    const posts = await this.publishedPosts();
    const post = posts.find((p) => p.slug === slug);
    if (!post) throw new NotFoundException('Blog post not found');

    const translations = post.translationGroup
      ? posts
          .filter((p) => p.translationGroup === post.translationGroup && p.id !== post.id)
          .map((p) => ({ locale: p.locale, slug: p.slug }))
      : [];
    return { ...post, translations };
  }
}
