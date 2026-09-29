import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { BlogAdmin } from '../../database/entities/blog-admin.entity';
import { BlogAdminChangePasswordDto, BlogAdminLoginDto } from './dto/blog-admin-auth.dto';

export interface BlogAdminJwtPayload {
  sub: string;
  username: string;
  scope: 'blog-admin';
}

const TOKEN_TTL = '12h';

// Hardcoded so the panel works the same on every deployment regardless of
// that server's own environment config — BLOG_ADMIN_JWT_SECRET /
// BLOG_ADMIN_DEFAULT_USERNAME / BLOG_ADMIN_DEFAULT_PASSWORD in .env still
// override these if set, but nothing needs to be configured for this to work.
const HARDCODED_JWT_SECRET = 'eddva-blog-admin-2026-do-not-share';
const HARDCODED_USERNAME = 'eddva@gmail.com';
const HARDCODED_PASSWORD = 'Eddva@123';

@Injectable()
export class BlogAdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(BlogAdminAuthService.name);

  constructor(
    @InjectRepository(BlogAdmin, 'coaching')
    private readonly adminRepo: Repository<BlogAdmin>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Deliberately separate from the LMS's JWT_SECRET — a blog-admin token
   *  must never verify against, or be verifiable by, the LMS's own guard. */
  private get secret(): string {
    return this.config.get<string>('BLOG_ADMIN_JWT_SECRET') || HARDCODED_JWT_SECRET;
  }

  async onModuleInit() {
    try {
      await this.adminRepo.query(`
        CREATE TABLE IF NOT EXISTS blog_admins (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          username varchar NOT NULL,
          password_hash varchar NOT NULL,
          name varchar,
          last_login_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        )
      `);
      await this.adminRepo.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_admins_username ON blog_admins(username) WHERE deleted_at IS NULL`,
      );
    } catch (e: any) {
      this.logger.warn(`Could not ensure blog_admins table exists: ${e?.message}`);
      return;
    }

    await this.seedDefaultAdmin();
  }

  /** Ensures this account exists with this exact password, every boot —
   *  BLOG_ADMIN_DEFAULT_USERNAME/PASSWORD in .env override the hardcoded
   *  values below if set, but nothing needs to be configured for login to
   *  work on a fresh deployment. */
  private async seedDefaultAdmin() {
    const username = this.config.get<string>('BLOG_ADMIN_DEFAULT_USERNAME') || HARDCODED_USERNAME;
    const password = this.config.get<string>('BLOG_ADMIN_DEFAULT_PASSWORD') || HARDCODED_PASSWORD;

    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await this.adminRepo.findOne({ where: { username } });
    if (existing) {
      existing.passwordHash = passwordHash;
      await this.adminRepo.save(existing);
    } else {
      await this.adminRepo.save(this.adminRepo.create({ username, passwordHash, name: 'Blog Admin' }));
    }
    this.logger.log(`Blog admin account "${username}" is set from BLOG_ADMIN_DEFAULT_USERNAME/PASSWORD.`);
  }

  async login(dto: BlogAdminLoginDto): Promise<{ token: string; admin: { id: string; username: string; name: string | null } }> {
    const admin = await this.adminRepo.findOne({ where: { username: dto.username } });
    if (!admin) throw new UnauthorizedException('Invalid username or password');

    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid username or password');

    admin.lastLoginAt = new Date();
    await this.adminRepo.save(admin);

    const payload: BlogAdminJwtPayload = { sub: admin.id, username: admin.username, scope: 'blog-admin' };
    const token = await this.jwt.signAsync(payload, { secret: this.secret, expiresIn: TOKEN_TTL });

    return { token, admin: { id: admin.id, username: admin.username, name: admin.name } };
  }

  async verify(token: string): Promise<BlogAdminJwtPayload> {
    try {
      const payload = await this.jwt.verifyAsync<BlogAdminJwtPayload>(token, { secret: this.secret });
      if (payload.scope !== 'blog-admin') throw new UnauthorizedException('Invalid token');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  async me(adminId: string) {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException('Account no longer exists');
    return { id: admin.id, username: admin.username, name: admin.name };
  }

  async changePassword(adminId: string, dto: BlogAdminChangePasswordDto): Promise<{ message: string }> {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException('Account no longer exists');

    const valid = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    admin.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.adminRepo.save(admin);
    return { message: 'Password updated' };
  }
}
