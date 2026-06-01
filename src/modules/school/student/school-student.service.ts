import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SchoolStudentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private async resolveInstituteId(user: any, bodyInstituteId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!bodyInstituteId) throw new BadRequestException('instituteId is required for SUPER_ADMIN');
      return bodyInstituteId;
    }
    return user.instituteId;
  }

  private async generateEnrollmentNo(instituteId: string): Promise<string> {
    const rows: any[] = await this.ds.query(`SELECT name FROM institutes WHERE id=$1`, [instituteId]);
    const name = rows[0]?.name || 'EDDVA';
    const words = name.replace(/[^a-zA-Z0-9\s]/g,' ').trim().split(/\s+/).filter(Boolean);
    const code = words.length > 1 ? words.map((w:string) => w[0]).join('') : (words[0]||'EDDVA').slice(0,3);
    const prefix = `${code.toUpperCase().slice(0,6)}-${new Date().getFullYear()}-`;
    const existing: any[] = await this.ds.query(
      `SELECT enrollment_no FROM students WHERE institute_id=$1 AND enrollment_no LIKE $2`,
      [instituteId, `${prefix}%`],
    );
    const max = existing.reduce((h:number, r:any) => { const n=Number(String(r.enrollment_no||'').replace(prefix,'')); return Number.isFinite(n)?Math.max(h,n):h; }, 0);
    return `${prefix}${String(max+1).padStart(3,'0')}`;
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    if (!body.name || !body.email) throw new BadRequestException('Name and email are required');
    if (!body.password) throw new BadRequestException('Password is required for student login');

    const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [body.email]);
    if (existing.length) throw new BadRequestException('Email already exists');
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=$1 AND phone=$2`, [instituteId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }

    const enrollmentNo = body.enrollmentNo || await this.generateEnrollmentNo(instituteId);
    const hashed = await bcrypt.hash(body.password, 10);
    const sectionId = body.sectionId || null;

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRows: any[] = await queryRunner.query(
        `INSERT INTO users (institute_id,name,email,password,role,photo,phone,is_active) VALUES ($1,$2,$3,$4,'STUDENT',$5,$6,TRUE) RETURNING *`,
        [instituteId, body.name, body.email, hashed, body.photo || null, body.phone || null],
      );
      const u = userRows[0];
      
      const sRows: any[] = await queryRunner.query(
        `INSERT INTO students (user_id,institute_id,enrollment_no,roll_no,section_id,dob,gender,blood_group,marital_status,national_id,father_name,mother_name,parent_phone,parent_email,parent_occupation,address,city,state,pin_code,admission_date,medical_conditions,allergies,documents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
        [u.id, instituteId, enrollmentNo, body.rollNo || null, sectionId, body.dob ? new Date(body.dob) : null, body.gender || null, body.bloodGroup || null, body.maritalStatus || null, body.nationalId || null, body.fatherName || null, body.motherName || null, body.parentPhone || null, body.parentEmail || null, body.parentOccupation || null, body.address || null, body.city || null, body.state || null, body.pinCode || null, body.admissionDate ? new Date(body.admissionDate) : null, body.medicalConditions || null, body.allergies || null, JSON.stringify(body.documents || {})],
      );

      await queryRunner.commitTransaction();

      const { password: _p, ...safeUser } = u;
      return { success: true, message: 'Student created successfully', data: { ...safeUser, studentProfile: sRows[0] } };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err instanceof Error ? err.message : 'Error creating student profile');
    } finally {
      await queryRunner.release();
    }
  }

  async list(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,u.photo,u.created_at,
              s.id AS profile_id,s.enrollment_no,s.roll_no,s.section_id,s.dob,s.gender,s.blood_group,
              s.father_name,s.mother_name,s.parent_phone,s.admission_date,
              sec.name AS section_name,c.name AS class_name
       FROM users u JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       WHERE u.institute_id=$1 AND u.role='STUDENT' ORDER BY u.name`,
      [instituteId],
    );
    const mapped = rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      isActive: r.is_active,
      photo: r.photo,
      createdAt: r.created_at,
      studentProfile: {
        id: r.profile_id,
        enrollmentNo: r.enrollment_no,
        rollNo: r.roll_no,
        sectionId: r.section_id,
        dob: r.dob,
        gender: r.gender,
        bloodGroup: r.blood_group,
        fatherName: r.father_name,
        motherName: r.mother_name,
        parentPhone: r.parent_phone,
        admissionDate: r.admission_date,
        section: r.section_id ? {
          id: r.section_id,
          name: r.section_name,
          class: {
            name: r.class_name
          }
        } : null
      }
    }));
    return { success: true, data: mapped };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT u.*,s.*,sec.name AS section_name,c.name AS class_name FROM users u
       LEFT JOIN students s ON s.user_id=u.id LEFT JOIN sections sec ON s.section_id=sec.id LEFT JOIN classes c ON sec.class_id=c.id
       WHERE (u.id=$1 OR s.id=$1) AND u.role='STUDENT'`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Student not found');
    const { password: _p, ...rest } = rows[0];
    return { success: true, data: rest };
  }

  async update(id: string, body: any) {
    let userRows: any[] = await this.ds.query(`SELECT * FROM users WHERE id=$1`, [id]);
    if (!userRows.length) {
      userRows = await this.ds.query(`SELECT u.* FROM users u JOIN students s ON s.user_id=u.id WHERE s.id=$1`, [id]);
    }
    if (!userRows.length) throw new NotFoundException('Student not found');
    const userId = userRows[0].id;
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=(SELECT institute_id FROM users WHERE id=$1) AND phone=$2 AND id<>$1`, [userId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    await this.ds.query(
      `UPDATE users SET name=COALESCE($2,name),is_active=COALESCE($3,is_active),photo=COALESCE($4,photo),phone=COALESCE($5,phone),updated_at=NOW() WHERE id=$1`,
      [userId, body.name, body.isActive, body.photo, body.phone],
    );
    await this.ds.query(
      `UPDATE students SET enrollment_no=COALESCE($2,enrollment_no),roll_no=COALESCE($3,roll_no),section_id=COALESCE($4,section_id),dob=COALESCE($5,dob),gender=COALESCE($6,gender),blood_group=COALESCE($7,blood_group),father_name=COALESCE($8,father_name),mother_name=COALESCE($9,mother_name),parent_phone=COALESCE($10,parent_phone),updated_at=NOW() WHERE user_id=$1`,
      [userId, body.enrollmentNo, body.rollNo, body.sectionId, body.dob?new Date(body.dob):null, body.gender, body.bloodGroup, body.fatherName, body.motherName, body.parentPhone],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM users WHERE id=$1`, [id]);
    return { success: true };
  }
}
