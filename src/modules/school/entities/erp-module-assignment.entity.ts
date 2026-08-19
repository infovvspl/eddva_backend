import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { ErpModule } from './erp-module.entity';
import { SchoolInstitute } from './school-institute.entity';

@Entity('school_erp_module_assignments')
@Unique(['institute_id', 'module_id'])
export class ErpModuleAssignment extends SchoolBase {
  @Column()
  institute_id: string;

  @ManyToOne(() => SchoolInstitute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'institute_id' })
  institute: SchoolInstitute;

  @Column()
  module_id: string;

  @ManyToOne(() => ErpModule, (module) => module.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: ErpModule;

  @Column({ default: true })
  is_active: boolean;
}
