import { Entity, Column, Index } from 'typeorm';
import { Base } from './base.entity';

/**
 * A login for the blog admin panel only — deliberately not a row in `users`.
 * This account cannot access anything else on the platform: it is verified
 * by its own guard (BlogAdminGuard) against its own JWT secret, never by the
 * LMS's JwtAuthGuard/RolesGuard. See modules/blog-admin-auth.
 */
@Entity('blog_admins')
export class BlogAdmin extends Base {
  @Index({ unique: true })
  @Column()
  username: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ nullable: true })
  name: string;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date;
}
