import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('complaints')
export class SchoolComplaint extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ default: 'OPEN' }) status: string;
}

@Entity('grievances')
export class SchoolGrievance extends SchoolBase {
  @Column({ name: 'raised_by' }) raisedBy: string;
  @Column() title: string;
  @Column({ nullable: true }) category: string;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ default: 'OPEN' }) status: string;
}

@Entity('activity_logs')
export class SchoolActivityLog extends SchoolBase {
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column({ name: 'user_id', nullable: true }) userId: string;
  @Column() action: string;
  @Column({ nullable: true }) details: string;
}
