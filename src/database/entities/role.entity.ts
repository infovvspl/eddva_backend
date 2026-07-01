import { Entity, Column } from 'typeorm';
import { Base } from './base.entity';

@Entity('roles')
export class Role extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'jsonb', default: [] })
  permissions: string[];
}
