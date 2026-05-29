import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('events')
export class SchoolEvent extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ name: 'start_date', type: 'timestamptz' }) startDate: Date;
  @Column({ name: 'end_date', type: 'timestamptz', nullable: true }) endDate: Date;
  @Column({ nullable: true }) location: string;
  @Column({ name: 'event_type', default: 'general' }) eventType: string;
  @Column({ name: 'created_by', nullable: true }) createdBy: string;
}
