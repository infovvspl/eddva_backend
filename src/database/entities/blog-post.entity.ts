import { Entity, Column, Index } from 'typeorm';
import { Base } from './base.entity';

export enum BlogPostStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export interface BlogPostSection {
  heading: string;
  body: string;
}

/**
 * A marketing-site blog post, managed from the super-admin dashboard and
 * read by the public /blog and /blog/:slug pages. Stored as varchar (not a
 * PG enum) since the coaching DataSource has synchronize off and the table
 * is created manually in BlogService.onModuleInit — see modules/leads for
 * the same pattern.
 */
@Entity('blog_posts')
export class BlogPost extends Base {
  @Column()
  title: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: 'text', nullable: true })
  excerpt: string;

  @Column({ nullable: true })
  author: string;

  @Column({ name: 'cover_image', nullable: true })
  coverImage: string;

  @Column({ name: 'read_time', type: 'int', nullable: true })
  readTime: number;

  /** Ordered body sections, each with its own heading — matches the public page layout. */
  @Column({ type: 'jsonb', nullable: true })
  sections: BlogPostSection[];

  @Index()
  @Column({ type: 'varchar', default: BlogPostStatus.DRAFT })
  status: BlogPostStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;
}
