import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
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
