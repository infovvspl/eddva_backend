import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export enum StudyMaterialExam {
  JEE   = 'jee',
  NEET  = 'neet',
}

export enum StudyMaterialType {
  NOTES         = 'notes',
  PYQ           = 'pyq',
  FORMULA_SHEET = 'formula_sheet',
  DPP           = 'dpp',
  MINDMAP       = 'mindmap',
}

@Entity('study_materials')
@Index(['exam', 'type'])
@Index(['tenantId', 'exam'])
export class StudyMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'enum', enum: StudyMaterialExam })
  exam: StudyMaterialExam;

  @Column({ type: 'enum', enum: StudyMaterialType })
  type: StudyMaterialType;

  @Column()
  title: string;

  @Column({ nullable: true })
  subject: string; // Physics | Chemistry | Biology | Mathematics

  @Column({ nullable: true })
  chapter: string;

  @Column({ nullable: true })
  description: string;

  /** Private S3 key (NOT a public URL — fetch via presigned GET or buffer). */
  @Column({ name: 's3_key' })
  s3Key: string;

  @Column({ name: 'file_size_kb', nullable: true })
  fileSizeKb: number;

  @Column({ name: 'total_pages', nullable: true })
  totalPages: number;

  @Column({ name: 'preview_pages', default: 2 })
  previewPages: number;

  @Column({ name: 'uploaded_by' })
  uploadedBy: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
