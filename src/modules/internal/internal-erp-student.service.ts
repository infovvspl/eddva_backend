import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { SchoolStudentService } from '../school/student/school-student.service';
import { MailService } from '../mail/mail.service';
import { ErpStudentDto } from './dto/erp-student.dto';

@Injectable()
export class InternalErpStudentService implements OnModuleInit {
  private readonly logger = new Logger('InternalErpStudent');

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly students: SchoolStudentService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit() {
    try {
      await this.ds.query(`
        ALTER TABLE institutes ADD COLUMN IF NOT EXISTS erp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE students ADD COLUMN IF NOT EXISTS erp_enrollment_number TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_students_erp_enrollment
          ON students (institute_id, erp_enrollment_number) WHERE erp_enrollment_number IS NOT NULL;
      `);
    } catch (e) {
      this.logger.error(`Column auto-creation error: ${e instanceof Error ? e.message : e}`);
    }
  }

  private fail(code: string, message: string): { code: string; message: string } {
    return { code, message };
  }

  /** Creates (or returns the existing) LMS student for a confirmed ERP admission. */
  async upsert(dto: ErpStudentDto): Promise<{ studentId: string; userId: string; created: boolean }> {
    if (!dto?.instituteId || !dto.enrollmentNumber || !dto.name) {
      throw new BadRequestException(this.fail('INVALID_PAYLOAD', 'instituteId, enrollmentNumber and name are required'));
    }

    const inst: any[] = await this.ds.query(`SELECT id, name, erp_enabled FROM institutes WHERE id=$1`, [dto.instituteId]);
    if (!inst.length) throw new NotFoundException(this.fail('INSTITUTE_NOT_FOUND', 'Institute not found in LMS'));
    if (!inst[0].erp_enabled) throw new ForbiddenException(this.fail('ERP_NOT_ENABLED', 'ERP integration is not enabled for this institute'));

    const found: any[] = await this.ds.query(
      `SELECT id, user_id FROM students WHERE institute_id=$1 AND erp_enrollment_number=$2`,
      [dto.instituteId, dto.enrollmentNumber],
    );
    if (found.length) return { studentId: found[0].id, userId: found[0].user_id, created: false };

    if (!dto.email) throw new UnprocessableEntityException(this.fail('EMAIL_REQUIRED', 'Applicant email is required to create the LMS login'));

    const sectionId = await this.resolveSection(dto);
    const tempPassword = randomBytes(6).toString('base64url');

    let result: any;
    try {
      // A synthetic institute-admin actor: scopes the create to this institute only.
      result = await this.students.create(
        { role: 'ADMIN', instituteId: dto.instituteId },
        {
          instituteId: dto.instituteId,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          password: tempPassword,
          enrollmentNo: dto.enrollmentNumber,
          sectionId,
          dob: dto.dob,
          gender: dto.gender,
          fatherName: dto.fatherName,
          motherName: dto.motherName,
          parentPhone: dto.parentPhone,
          parentEmail: dto.parentEmail,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pinCode: dto.pinCode,
          admissionDate: dto.admissionDate,
          status: 'ACTIVE',
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already/i.test(msg)) throw new ConflictException(this.fail('STUDENT_CONFLICT', msg));
      throw e;
    }

    const profile = result.data.studentProfile;
    await this.ds.query(`UPDATE students SET erp_enrollment_number=$1 WHERE id=$2`, [dto.enrollmentNumber, profile.id]);

    this.mail
      .sendCredentials(dto.email, dto.name, dto.email, tempPassword, inst[0].name)
      .catch((err) => this.logger.error(`Credential email failed for ${dto.email}: ${err?.message ?? err}`));

    return { studentId: profile.id, userId: result.data.id, created: true };
  }

  private async resolveSection(dto: ErpStudentDto): Promise<string | null> {
    if (dto.sectionId) {
      const rows: any[] = await this.ds.query(
        `SELECT s.id FROM sections s JOIN classes c ON c.id=s.class_id WHERE s.id=$1 AND c.institute_id=$2`,
        [dto.sectionId, dto.instituteId],
      );
      if (!rows.length) throw new UnprocessableEntityException(this.fail('SECTION_NOT_FOUND', 'sectionId does not belong to this institute'));
      return rows[0].id;
    }
    if (!dto.className) return null; // admitted but not yet placed in a class
    const rows: any[] = await this.ds.query(
      `SELECT s.id FROM sections s JOIN classes c ON c.id=s.class_id
       WHERE c.institute_id=$1 AND LOWER(c.name)=LOWER($2) AND ($3::text IS NULL OR LOWER(s.name)=LOWER($3))
       ORDER BY s.name LIMIT 1`,
      [dto.instituteId, dto.className, dto.sectionName ?? null],
    );
    if (!rows.length) {
      throw new UnprocessableEntityException(this.fail('CLASS_NOT_FOUND', `No LMS class/section matches "${dto.className}${dto.sectionName ? ' / ' + dto.sectionName : ''}"`));
    }
    return rows[0].id;
  }
}
