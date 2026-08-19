import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { ErpRole } from './erp-role.entity';
import { SchoolUser } from './school-user.entity';
import { SchoolInstitute } from './school-institute.entity';

@Entity('erp_user_roles')
@Unique(['user_id', 'role'])
export class ErpUserRole extends SchoolBase {
  @Column()
  user_id: string;

  @ManyToOne(() => SchoolUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: SchoolUser;

  @ManyToOne(() => ErpRole, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: ErpRole;

  @Column()
  institute_id: string;

  @ManyToOne(() => SchoolInstitute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'institute_id' })
  institute: SchoolInstitute;

  @Column({ default: true })
  is_active: boolean;
}
