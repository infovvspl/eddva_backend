import { Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ErpRole } from './erp-role.entity';
import { ErpPermission } from './erp-permission.entity';

@Entity('erp_role_permissions')
@Unique(['role', 'permission'])
export class ErpRolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ErpRole, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: ErpRole;

  @ManyToOne(() => ErpPermission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id' })
  permission: ErpPermission;
}
