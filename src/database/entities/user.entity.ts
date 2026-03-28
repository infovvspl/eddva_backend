import { Entity, Column, ManyToOne, JoinColumn, BeforeInsert, BeforeUpdate, Unique } from 'typeorm';
import { Exclude } from 'class-transformer';
import * as bcrypt from 'bcryptjs';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  INSTITUTE_ADMIN = 'institute_admin',
  TEACHER = 'teacher',
  STUDENT = 'student',
  PARENT = 'parent',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  PENDING_VERIFICATION = 'pending_verification',
}

@Entity('users')
@Unique('UQ_user_phone_tenant', ['phoneNumber', 'tenantId'])
export class User extends Base {
  // ── Tenant (multi-tenancy) ───────────────────────────────────────────────
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // ── Identity ─────────────────────────────────────────────────────────────
  @Column({ name: 'phone_number' })
  phoneNumber: string;

  @Column({ nullable: true })
  email: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ name: 'profile_picture_url', nullable: true })
  profilePictureUrl: string;

  // ── Auth ──────────────────────────────────────────────────────────────────
  @Exclude()
  @Column({ nullable: true })
  password: string;

  @Column({ name: 'phone_verified', default: false })
  phoneVerified: boolean;

  @Column({ name: 'is_first_login', default: true })
  isFirstLogin: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date;

  // ── Role & Status ─────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: UserRole, default: UserRole.STUDENT })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING_VERIFICATION })
  status: UserStatus;

  // ── Refresh token (hashed) ────────────────────────────────────────────────
  @Exclude()
  @Column({ name: 'refresh_token', nullable: true })
  refreshToken: string;

  // ── Notification preferences ──────────────────────────────────────────────
  @Column({
    name: 'notification_prefs',
    type: 'jsonb',
    default: { push: true, whatsapp: true, email: false, sms: false },
  })
  notificationPrefs: {
    push: boolean;
    whatsapp: boolean;
    email: boolean;
    sms: boolean;
  };

  @Column({ name: 'fcm_token', nullable: true })
  fcmToken: string;

  // ── Hooks ─────────────────────────────────────────────────────────────────
  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password && !this.password.startsWith('$2')) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }

  async validatePassword(plain: string): Promise<boolean> {
    if (!this.password) return false;
    return bcrypt.compare(plain, this.password);
  }

  async hashRefreshToken(token: string) {
    this.refreshToken = await bcrypt.hash(token, 10);
  }

  async validateRefreshToken(token: string): Promise<boolean> {
    if (!this.refreshToken) return false;
    return bcrypt.compare(token, this.refreshToken);
  }
}
