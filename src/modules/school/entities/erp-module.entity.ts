import { Column, Entity, OneToMany, Unique } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { ErpModuleAssignment } from './erp-module-assignment.entity';
import { ErpRole } from './erp-role.entity';

@Entity('school_erp_modules')
export class ErpModule extends SchoolBase {
  @Column()
  name: string;

  @Column({ unique: true })
  key: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  path: string;

  @Column({ nullable: true })
  icon: string;

  @Column({ nullable: true })
  color: string;

  @Column({ nullable: true })
  bg: string;

  @Column({ default: true })
  is_active: boolean;

  @OneToMany(() => ErpModuleAssignment, (assignment) => assignment.module)
  assignments: ErpModuleAssignment[];

  @OneToMany(() => ErpRole, (role) => role.module)
  roles: ErpRole[];
}
