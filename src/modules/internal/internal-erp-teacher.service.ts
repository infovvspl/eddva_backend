import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { SchoolTeacherService } from '../school/teacher/school-teacher.service';
import { MailService } from '../mail/mail.service';
import { ErpTeacherDto } from './dto/erp-teacher.dto';
import { ErpTeacherStatusDto } from './dto/erp-teacher-status.dto';
import { ErpTeacherDepartmentDto } from './dto/erp-teacher-department.dto';

@Injectable()
export class InternalErpTeacherService {
  private readonly logger = new Logger('InternalErpTeacher');

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly teachers: SchoolTeacherService,
    private readonly mail: MailService,
  ) {}

  private fail(code: string, message: string): { code: string; message: string } {
    return { code, message };
  }

  /** Creates (or returns the existing) LMS teacher for an ERP teaching-staff member. */
  async upsert(dto: ErpTeacherDto): Promise<{ teacherId: string; userId: string; created: boolean }> {
    if (!dto?.instituteId || !dto.employeeId || !dto.name || !dto.email) {
      throw new BadRequestException(this.fail('INVALID_PAYLOAD', 'instituteId, employeeId, name and email are required'));
    }

    const inst: any[] = await this.ds.query(`SELECT id, name, erp_enabled FROM institutes WHERE id=$1`, [dto.instituteId]);
    if (!inst.length) throw new NotFoundException(this.fail('INSTITUTE_NOT_FOUND', 'Institute not found in LMS'));
    if (!inst[0].erp_enabled) throw new ForbiddenException(this.fail('ERP_NOT_ENABLED', 'ERP integration is not enabled for this institute'));

    const found: any[] = await this.ds.query(
      `SELECT id, user_id FROM teachers WHERE institute_id=$1 AND employee_id=$2`,
      [dto.instituteId, dto.employeeId],
    );
    if (found.length) return { teacherId: found[0].id, userId: found[0].user_id, created: false };

    const tempPassword = randomBytes(6).toString('base64url');

    let result: any;
    try {
      // A synthetic institute-admin actor: scopes the create to this institute only.
      result = await this.teachers.create(
        { role: 'ADMIN', instituteId: dto.instituteId },
        {
          instituteId: dto.instituteId,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          password: tempPassword,
          employeeId: dto.employeeId,
          department: dto.department,
          role: dto.designation,
          qualifications: dto.qualification,
          joiningDate: dto.joiningDate,
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already/i.test(msg)) throw new ConflictException(this.fail('TEACHER_CONFLICT', msg));
      throw e;
    }

    const teacherProfile = result.data.teacherProfile;

    this.mail
      .sendCredentials(dto.email, dto.name, dto.email, tempPassword, inst[0].name)
      .catch((err) => this.logger.error(`Credential email failed for ${dto.email}: ${err?.message ?? err}`));

    return { teacherId: teacherProfile.id, userId: result.data.id, created: true };
  }

  /** Updates a teacher's LMS login status (ACTIVE/INACTIVE) — e.g. relieved from the ERP. */
  async updateStatus(dto: ErpTeacherStatusDto): Promise<{ teacherId: string; updated: boolean }> {
    if (!dto?.instituteId || !dto.employeeId || !dto.status) {
      throw new BadRequestException(this.fail('INVALID_PAYLOAD', 'instituteId, employeeId and status are required'));
    }

    const inst: any[] = await this.ds.query(`SELECT id, erp_enabled FROM institutes WHERE id=$1`, [dto.instituteId]);
    if (!inst.length) throw new NotFoundException(this.fail('INSTITUTE_NOT_FOUND', 'Institute not found in LMS'));
    if (!inst[0].erp_enabled) throw new ForbiddenException(this.fail('ERP_NOT_ENABLED', 'ERP integration is not enabled for this institute'));

    const found: any[] = await this.ds.query(
      `SELECT id, user_id FROM teachers WHERE institute_id=$1 AND employee_id=$2`,
      [dto.instituteId, dto.employeeId],
    );
    if (!found.length) throw new NotFoundException(this.fail('TEACHER_NOT_FOUND', 'No LMS teacher matches this institute/employee id'));

    const { id: teacherId, user_id: userId } = found[0];
    await this.ds.query(`UPDATE users SET is_active=$1 WHERE id=$2`, [dto.status === 'ACTIVE', userId]);

    return { teacherId, updated: true };
  }

  /** Updates a teacher's department on the LMS side — e.g. reassigned from the ERP. */
  async updateDepartment(dto: ErpTeacherDepartmentDto): Promise<{ teacherId: string; updated: boolean }> {
    if (!dto?.instituteId || !dto.employeeId || !dto.department) {
      throw new BadRequestException(this.fail('INVALID_PAYLOAD', 'instituteId, employeeId and department are required'));
    }

    const inst: any[] = await this.ds.query(`SELECT id, erp_enabled FROM institutes WHERE id=$1`, [dto.instituteId]);
    if (!inst.length) throw new NotFoundException(this.fail('INSTITUTE_NOT_FOUND', 'Institute not found in LMS'));
    if (!inst[0].erp_enabled) throw new ForbiddenException(this.fail('ERP_NOT_ENABLED', 'ERP integration is not enabled for this institute'));

    const found: any[] = await this.ds.query(
      `SELECT id FROM teachers WHERE institute_id=$1 AND employee_id=$2`,
      [dto.instituteId, dto.employeeId],
    );
    if (!found.length) throw new NotFoundException(this.fail('TEACHER_NOT_FOUND', 'No LMS teacher matches this institute/employee id'));

    const { id: teacherId } = found[0];
    await this.ds.query(`UPDATE teachers SET department=$1, updated_at=NOW() WHERE id=$2`, [dto.department, teacherId]);

    return { teacherId, updated: true };
  }

  /** Resolves a teacher's own LMS user id to their teacherId/employeeId — used by the ERP's teacher self-service SSO exchange. */
  async resolveByUserId(instituteId: string, userId: string): Promise<{ teacherId: string; employeeId: string | null; name: string; email: string }> {
    if (!instituteId || !userId) {
      throw new BadRequestException(this.fail('INVALID_PAYLOAD', 'instituteId and userId are required'));
    }

    const found: any[] = await this.ds.query(
      `SELECT t.id AS teacher_id, t.employee_id, u.name, u.email
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.institute_id=$1 AND t.user_id=$2`,
      [instituteId, userId],
    );
    if (!found.length) throw new NotFoundException(this.fail('TEACHER_NOT_FOUND', 'No LMS teacher profile matches this user'));

    return { teacherId: found[0].teacher_id, employeeId: found[0].employee_id, name: found[0].name, email: found[0].email };
  }

  /** Read-only list of every LMS teacher for an institute — for the ERP to show which ones it already has a matching staff record for. */
  async listForInstitute(instituteId: string): Promise<
    Array<{
      teacherId: string;
      employeeId: string | null;
      name: string;
      email: string;
      department: string | null;
      designation: string | null;
      joiningDate: string | null;
      isActive: boolean;
    }>
  > {
    if (!instituteId) {
      throw new BadRequestException(this.fail('INVALID_PAYLOAD', 'instituteId is required'));
    }

    const inst: any[] = await this.ds.query(`SELECT id, erp_enabled FROM institutes WHERE id=$1`, [instituteId]);
    if (!inst.length) throw new NotFoundException(this.fail('INSTITUTE_NOT_FOUND', 'Institute not found in LMS'));
    if (!inst[0].erp_enabled) throw new ForbiddenException(this.fail('ERP_NOT_ENABLED', 'ERP integration is not enabled for this institute'));

    const rows: any[] = await this.ds.query(
      `SELECT t.id AS teacher_id, t.employee_id, t.department, t.designation, t.joining_date, u.name, u.email, u.is_active
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1
       ORDER BY u.name ASC`,
      [instituteId],
    );

    return rows.map((r) => ({
      teacherId: r.teacher_id,
      employeeId: r.employee_id,
      name: r.name,
      email: r.email,
      department: r.department,
      designation: r.designation,
      joiningDate: r.joining_date,
      isActive: r.is_active,
    }));
  }
}
