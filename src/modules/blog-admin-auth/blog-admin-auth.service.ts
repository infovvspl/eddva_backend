import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { BlogAdmin } from '../../database/entities/blog-admin.entity';
import { BlogAdminChangePasswordDto, BlogAdminLoginDto } from './dto/blog-admin-auth.dto';

export interface BlogAdminJwtPayload {
  sub: string;
  username: string;
  scope: 'blog-admin';
}

const TOKEN_TTL = '12h';

@Injectable()
export class BlogAdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(BlogAdminAuthService.name);

  constructor(
    @InjectRepository(BlogAdmin, 'coaching')
    private readonly adminRepo: Repository<BlogAdmin>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Generated once per process if BLOG_ADMIN_JWT_SECRET is unset — never a
  // fixed literal. Dev-only: every restart invalidates existing sessions, and
  // production refuses to boot without a configured secret (see below).
  private readonly fallbackSecret = randomBytes(32).toString('hex');

  /** Deliberately separate from the LMS's JWT_SECRET — a blog-admin token
   *  must never verify against, or be verifiable by, the LMS's own guard. */
  private get secret(): string {
    const configured = this.config.get<string>('BLOG_ADMIN_JWT_SECRET');
    if (configured) return configured;

    if (this.config.get<string>('app.nodeEnv') === 'production') {
      throw new Error('BLOG_ADMIN_JWT_SECRET environment variable is required in production');
    }
    return this.fallbackSecret;
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

  /** Ensures the account named by BLOG_ADMIN_DEFAULT_USERNAME/PASSWORD exists
   *  with that exact password, every boot — never a guessable built-in
   *  default, and never silently skipped just because some other account
   *  already exists in the table. If the env vars aren't set, this is a
   *  no-op (other accounts, e.g. ones created and rotated by hand, are left
   *  untouched either way). */
  private async seedDefaultAdmin() {
    const username = this.config.get<string>('BLOG_ADMIN_DEFAULT_USERNAME');
    const password = this.config.get<string>('BLOG_ADMIN_DEFAULT_PASSWORD');

    if (!username || !password) {
      const existing = await this.adminRepo.count();
      if (existing === 0) {
        this.logger.warn(
          'No blog admin account exists and BLOG_ADMIN_DEFAULT_USERNAME / ' +
            'BLOG_ADMIN_DEFAULT_PASSWORD are not set — set both in .env and restart to create one.',
        );
      }
      return;
    }

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
