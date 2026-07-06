import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { AnnouncementCategory, AnnouncementPriority } from '../../modules/super-admin/dto/announcement.enums';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';

@Entity('announcements')
export class Announcement extends Base {
  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'target_role', nullable: true })
  targetRole: string; // 'student' | 'teacher' | 'all' | null

  @Column({ type: 'enum', enum: AnnouncementCategory, default: AnnouncementCategory.GENERAL })
  category: AnnouncementCategory;

  @Column({ type: 'enum', enum: AnnouncementPriority, default: AnnouncementPriority.NORMAL })
  priority: AnnouncementPriority;

  @Column({ name: 'tenant_id', nullable: true })
  tenantId: string;

  @ManyToOne(() => Tenant, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  author: User;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date;

  @Column({ name: 'sent_count', default: 0 })
  sentCount: number;
}
