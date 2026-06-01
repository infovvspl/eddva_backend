import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('study_materials')
export class SchoolStudyMaterial extends SchoolBase {
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column() exam: string;
  @Column() type: string;
  @Column() title: string;
  @Column({ nullable: true }) subject: string;
  @Column({ nullable: true }) chapter: string;
  @Column({ nullable: true }) description: string;
  @Column({ name: 's3_key' }) s3Key: string;
  @Column({ name: 'file_size_kb', nullable: true }) fileSizeKb: number;
  @Column({ name: 'total_pages', nullable: true }) totalPages: number;
  @Column({ name: 'preview_pages', default: 2 }) previewPages: number;
  @Column({ name: 'uploaded_by', nullable: true }) uploadedBy: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ name: 'sort_order', default: 0 }) sortOrder: number;
}

@Entity('presentations')
export class SchoolPresentation extends SchoolBase {
  @Column() title: string;
  @Column({ nullable: true }) subject: string;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ nullable: true }) template: string;
  @Column({ name: 'ppt_file', nullable: true }) pptFile: string;
  @Column({ name: 'slides_count', default: 0 }) slidesCount: number;
  @Column({ default: 'draft' }) status: string;
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
}

@Entity('mind_maps')
export class SchoolMindMap extends SchoolBase {
  @Column() title: string;
  @Column({ name: 'central_topic', nullable: true }) centralTopic: string;
  @Column({ type: 'text', array: true, nullable: true }) branches: string[];
  @Column({ default: 0 }) nodes: number;
  @Column({ default: 'active' }) status: string;
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
}
