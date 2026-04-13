import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';

export enum ResourceType {
  PDF      = 'pdf',
  DPP      = 'dpp',
  QUIZ     = 'quiz',
  NOTES    = 'notes',
  VIDEO    = 'video',
}
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { ExamTarget } from './student.entity';

// ─── Subject ─────────────────────────────────────────────────────────────────
@Entity('subjects')
export class Subject extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  name: string; // Physics, Chemistry, Mathematics, Biology

  @Column({ name: 'exam_target', type: 'enum', enum: ExamTarget })
  examTarget: ExamTarget;

  @Column({ nullable: true })
  icon: string;

  @Column({ name: 'color_code', nullable: true })
  colorCode: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => Chapter, (c) => c.subject)
  chapters: Chapter[];
}

// ─── Chapter ──────────────────────────────────────────────────────────────────
@Entity('chapters')
export class Chapter extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'subject_id' })
  subjectId: string;

  @ManyToOne(() => Subject, (s) => s.chapters)
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column()
  name: string; // e.g. "Thermodynamics"

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'jee_weightage', type: 'float', default: 0 })
  jeeWeightage: number; // % of marks in JEE historically

  @Column({ name: 'neet_weightage', type: 'float', default: 0 })
  neetWeightage: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => Topic, (t) => t.chapter)
  topics: Topic[];
}

// ─── Topic ────────────────────────────────────────────────────────────────────
@Entity('topics')
export class Topic extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'chapter_id' })
  chapterId: string;

  @ManyToOne(() => Chapter, (c) => c.topics)
  @JoinColumn({ name: 'chapter_id' })
  chapter: Chapter;

  @Column()
  name: string; // e.g. "Carnot Engine"

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'gate_pass_percentage', type: 'float', default: 70 })
  gatePassPercentage: number; // default 70% to unlock next topic

  @Column({ name: 'estimated_study_minutes', default: 60 })
  estimatedStudyMinutes: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // ── Prerequisites ──────────────────────────────────────────────────────────
  @Column({ name: 'prerequisite_topic_ids', type: 'jsonb', default: [] })
  prerequisiteTopicIds: string[];

  @OneToMany(() => TopicResource, (r) => r.topic)
  resources: TopicResource[];
}

// ─── TopicResource ────────────────────────────────────────────────────────────
@Entity('topic_resources')
export class TopicResource extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'topic_id' })
  topicId: string;

  @ManyToOne(() => Topic, (t) => t.resources, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ name: 'uploaded_by' })
  uploadedBy: string; // userId of institute admin

  @Column({ type: 'enum', enum: ResourceType })
  type: ResourceType; // pdf | dpp | quiz | notes | video

  @Column()
  title: string; // e.g. "DPP - Newton's Laws Set 1"

  @Column({ name: 'file_url' })
  fileUrl: string; // S3 / local path

  @Column({ name: 'file_size_kb', nullable: true })
  fileSizeKb: number;

  @Column({ name: 'description', nullable: true })
  description: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
