import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('notices')
export class SchoolNotice extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'created_by', nullable: true }) createdBy: string;
  @Column() title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'target_role', nullable: true }) targetRole: string;
  @Column({ name: 'is_published', default: true }) isPublished: boolean;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true }) publishedAt: Date;
}
