import { Column, Entity, Index } from 'typeorm';
import { Base } from './base.entity';

@Entity('exam_syllabus_cache')
@Index(['tenantId', 'examTarget', 'examYear'], { unique: true })
export class ExamSyllabusCache extends Base {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'exam_target', type: 'text' })
  examTarget: string;

  @Column({ name: 'exam_year', type: 'text' })
  examYear: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text', default: 'ai' })
  source: string;
}
