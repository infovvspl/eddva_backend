import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SchoolTeacherService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private async resolveInstituteId(user: any, bodyId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') { if (!bodyId) throw new BadRequestException('instituteId required'); return bodyId; }
    return user.instituteId;
  }

  private async generateEmployeeId(instituteId: string): Promise<string> {
    const rows: any[] = await this.ds.query(`SELECT name FROM institutes WHERE id=$1`, [instituteId]);
    const name = rows[0]?.name || 'EDDVA';
    const words = name.replace(/[^a-zA-Z0-9\s]/g,' ').trim().split(/\s+/).filter(Boolean);
    const code = words.length>1?words.map((w:string)=>w[0]).join(''):(words[0]||'EDDVA').slice(0,3);
    const prefix = `${code.toUpperCase().slice(0,6)}-${new Date().getFullYear()}-`;
    const existing: any[] = await this.ds.query(`SELECT employee_id FROM teachers WHERE institute_id=$1 AND employee_id LIKE $2`, [instituteId,`${prefix}%`]);
    const max = existing.reduce((h:number,r:any)=>{ const n=Number(String(r.employee_id||'').replace(prefix,'')); return Number.isFinite(n)?Math.max(h,n):h; },0);
    return `${prefix}${String(max+1).padStart(3,'0')}`;
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    if (!body.name || !body.email) throw new BadRequestException('Name and email are required');
    if (!body.password) throw new BadRequestException('Password is required');
    const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [body.email]);
    if (existing.length) throw new BadRequestException('Email already exists');
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=$1 AND phone=$2`, [instituteId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    const employeeId = body.employeeId || await this.generateEmployeeId(instituteId);
    const hashed = await bcrypt.hash(body.password, 10);
    
    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const uRows: any[] = await queryRunner.query(
        `INSERT INTO users (institute_id,name,email,password,role,photo,phone,is_active) VALUES ($1,$2,$3,$4,'TEACHER',$5,$6,TRUE) RETURNING *`,
        [instituteId, body.name, body.email, hashed, body.photo || null, body.phone || null],
      );
      const u = uRows[0];
      
      const tRows: any[] = await queryRunner.query(
        `INSERT INTO teachers (user_id,institute_id,employee_id,blood_group,marital_status,department,joining_date,qualifications,education_details,experience_details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [u.id, instituteId, employeeId, body.bloodGroup || null, body.maritalStatus || null, body.department || null, body.joiningDate ? new Date(body.joiningDate) : null, body.qualifications || null, JSON.stringify(body.educationDetails || []), JSON.stringify(body.experienceDetails || [])],
      );
      
      for (const sid of (body.subjectIds || [])) {
        await queryRunner.query(`INSERT INTO teacher_subjects (teacher_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tRows[0].id, sid]);
      }
      
      await queryRunner.commitTransaction();

      const { password: _p, ...safeUser } = u;
      return { success: true, message: 'Teacher created successfully', data: { ...safeUser, teacherProfile: tRows[0] } };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err instanceof Error ? err.message : 'Error creating teacher profile');
    } finally {
      await queryRunner.release();
    }
  }

  async list(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,u.created_at,t.id AS profile_id,t.employee_id,t.blood_group,t.marital_status,t.department,t.joining_date,t.qualifications
       FROM users u JOIN teachers t ON t.user_id=u.id WHERE u.institute_id=$1 AND u.role='TEACHER' ORDER BY u.name`,
      [instituteId],
    );
    return { success: true, data: rows };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT u.*,t.id AS teacher_profile_id,t.employee_id,t.blood_group,t.marital_status,t.department,t.joining_date,t.qualifications FROM users u LEFT JOIN teachers t ON t.user_id=u.id WHERE (u.id=$1 OR t.id=$1) AND u.role='TEACHER'`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Teacher not found');
    const { password: _p, ...rest } = rows[0];
    return { success: true, data: rest };
  }

  async update(id: string, body: any) {
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=(SELECT institute_id FROM users WHERE id=$1) AND phone=$2 AND id<>$1`, [id, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    await this.ds.query(
      `UPDATE users SET name=COALESCE($2,name),is_active=COALESCE($3,is_active),photo=COALESCE($4,photo),phone=COALESCE($5,phone),updated_at=NOW() WHERE id=$1`,
      [id,body.name,body.isActive,body.photo,body.phone],
    );
    await this.ds.query(
      `UPDATE teachers SET employee_id=COALESCE($2,employee_id),blood_group=COALESCE($3,blood_group),marital_status=COALESCE($4,marital_status),department=COALESCE($5,department),joining_date=COALESCE($6,joining_date),qualifications=COALESCE($7,qualifications),updated_at=NOW() WHERE user_id=$1`,
      [id,body.employeeId||body.employeeCode,body.bloodGroup,body.maritalStatus,body.department,body.joiningDate?new Date(body.joiningDate):null,body.qualifications],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM users WHERE id=$1`, [id]);
    return { success: true };
  }
}
