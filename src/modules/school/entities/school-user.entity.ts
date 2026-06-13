import { Entity, Column, BeforeInsert, BeforeUpdate } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SchoolBase } from './school-base.entity';

export enum SchoolUserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  INSTITUTE_ADMIN = 'INSTITUTE_ADMIN',
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT',
  PARENT = 'PARENT',
}

@Entity('users')
export class SchoolUser extends SchoolBase {
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column() name: string;
  @Column({ unique: true }) email: string;
  @Column({ select: false }) password: string;
  @Column({ type: 'varchar', default: SchoolUserRole.STUDENT }) role: string;
  @Column({ name: 'profile_image', nullable: true }) profileImage: string;
  @Column({ nullable: true }) phone: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password && !this.password.startsWith('$2')) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }

  async validatePassword(plain: string): Promise<boolean> {
    return bcrypt.compare(plain, this.password);
  }
}
