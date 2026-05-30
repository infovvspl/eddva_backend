import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('timetables')
export class SchoolTimetable extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'section_id' }) sectionId: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column({ name: 'day_of_week' }) dayOfWeek: string;
  @Column({ name: 'start_time', type: 'time' }) startTime: string;
  @Column({ name: 'end_time', type: 'time' }) endTime: string;
  @Column({ nullable: true }) room: string;
}

@Entity('schedules')
export class SchoolSchedule extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column({ name: 'class_id', nullable: true }) classId: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'start_time', type: 'timestamptz' }) startTime: Date;
  @Column({ name: 'end_time', type: 'timestamptz', nullable: true }) endTime: Date;
  @Column({ nullable: true }) title: string;
  @Column({ default: 'scheduled' }) status: string;
}
