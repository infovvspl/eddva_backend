import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('study_materials')
export class SchoolStudyMaterial extends SchoolBase {
  @Column({ name: 'chapter_id', nullable: true }) chapterId: string;
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column() title: string;
  @Column({ name: 'file_name', nullable: true }) fileName: string;
  @Column({ name: 'file_url', nullable: true }) fileUrl: string;
  @Column({ name: 'file_type', nullable: true }) fileType: string;
  @Column({ name: 'file_size', nullable: true }) fileSize: number;
  @Column({ name: 'uploaded_by', nullable: true }) uploadedBy: string;
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
