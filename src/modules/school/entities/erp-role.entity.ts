import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { SchoolInstitute } from './school-institute.entity';
import { ErpModule } from './erp-module.entity';

@Entity('erp_roles')
@Unique(['institute_id', 'module_id', 'name'])
export class ErpRole extends SchoolBase {
  @Column()
  institute_id: string;

  @ManyToOne(() => SchoolInstitute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'institute_id' })
  institute: SchoolInstitute;

  @Column()
  module_id: string; 

  @ManyToOne(() => ErpModule, (module) => module.roles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: ErpModule;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: true })
  is_active: boolean;
}
