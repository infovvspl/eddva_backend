import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('topics')
export class SchoolTopic extends SchoolBase {
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column({ name: 'chapter_id' }) chapterId: string;
  @Column() name: string;
  @Column({ default: 0 }) progress: number;
  @Column({ default: 'pending' }) status: string;
}

@Entity('chapters')
export class SchoolChapter extends SchoolBase {
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column({ name: 'subject_id' }) subjectId: string;
  @Column() name: string;
  @Column({ default: 0 }) order: number;
  @Column({ default: 0 }) progress: number;
  @Column({ default: 'pending' }) status: string;
}
