import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { BlogPost, BlogPostStatus } from '../../database/entities/blog-post.entity';
import { CreateBlogPostDto, ListBlogPostsQueryDto, PublicBlogQueryDto, UpdateBlogPostDto } from './dto/blog.dto';

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'post';

@Injectable()
export class BlogService implements OnModuleInit {
  private readonly logger = new Logger(BlogService.name);

  constructor(
    @InjectRepository(BlogPost, 'coaching')
    private readonly blogRepo: Repository<BlogPost>,
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
          read_time int,
          sections jsonb,
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
    return this.blogRepo.save(post);
  }

  async update(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    const post = await this.findById(id);

    if (dto.slug !== undefined || dto.title !== undefined) {
      const base = slugify(dto.slug || dto.title || post.title);
      if (base !== post.slug) post.slug = await this.uniqueSlug(base, post.id);
    }
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.category !== undefined) post.category = dto.category;
    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt;
    if (dto.author !== undefined) post.author = dto.author;
    if (dto.coverImage !== undefined) post.coverImage = dto.coverImage;
    if (dto.readTime !== undefined) post.readTime = dto.readTime;
    if (dto.sections !== undefined) post.sections = dto.sections;
    if (dto.status !== undefined) {
      if (dto.status === BlogPostStatus.PUBLISHED && post.status !== BlogPostStatus.PUBLISHED) {
        post.publishedAt = new Date();
      }
      post.status = dto.status;
    }

    return this.blogRepo.save(post);
  }

  async remove(id: string): Promise<{ message: string }> {
    const post = await this.findById(id);
    await this.blogRepo.softDelete(post.id);
    return { message: 'Blog post deleted successfully' };
  }

  // ── Public ───────────────────────────────────────────────────────────────

  async listPublic(q: PublicBlogQueryDto): Promise<{ items: BlogPost[]; total: number; page: number; limit: number }> {
    const page = q.page || 1;
    const limit = q.limit || 50;
    const where: any = { status: BlogPostStatus.PUBLISHED };
    if (q.category && q.category !== 'All') where.category = q.category;

    const base = q.search
      ? [
          { ...where, title: ILike(`%${q.search}%`) },
          { ...where, excerpt: ILike(`%${q.search}%`) },
        ]
      : where;

    const [items, total] = await this.blogRepo.findAndCount({
      where: base,
      order: { publishedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async findPublicBySlug(slug: string): Promise<BlogPost> {
    const post = await this.blogRepo.findOne({ where: { slug, status: BlogPostStatus.PUBLISHED } });
    if (!post) throw new NotFoundException('Blog post not found');
    return post;
  }
}
