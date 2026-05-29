import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('notifications')
export class SchoolNotification extends SchoolBase {
  @Column({ name: 'user_id' }) userId: string;
  @Column() type: string;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) message: string;
  @Column({ name: 'is_read', default: false }) isRead: boolean;
}
