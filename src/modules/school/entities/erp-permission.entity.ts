import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { ErpModule } from './erp-module.entity';

@Entity('erp_permissions')
export class ErpPermission extends SchoolBase {
  @Column()
  module_id: string;

  @ManyToOne(() => ErpModule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: ErpModule;

  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;
}
