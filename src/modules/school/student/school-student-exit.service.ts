import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolStudentExitService implements OnModuleInit {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async onModuleInit() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS student_exit_records (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          institute_id UUID,
          admission_no VARCHAR(100),
          student_name VARCHAR(255),
          class_and_section VARCHAR(100),
          academic_session VARCHAR(50),
          admission_date DATE,
          leaving_date DATE,
          last_class_attended VARCHAR(100),
          reason_for_leaving TEXT,
          destination_school VARCHAR(255),
          tc_number VARCHAR(100),
          tc_issue_date DATE,
          exam_result_status VARCHAR(50) DEFAULT 'PASSED',
          conduct_remarks TEXT DEFAULT 'Good',
          fee_clearance_status VARCHAR(50) DEFAULT 'CLEARED',
          library_clearance_status VARCHAR(50) DEFAULT 'CLEARED',
          hostel_clearance_status VARCHAR(50) DEFAULT 'NOT_APPLICABLE',
          transport_clearance_status VARCHAR(50) DEFAULT 'NOT_APPLICABLE',
          documents_issued JSONB DEFAULT '[]',
          authorized_signatory_name VARCHAR(255) DEFAULT 'Principal',
          authorized_signatory_role VARCHAR(100) DEFAULT 'Principal',
          parent_acknowledgement BOOLEAN DEFAULT FALSE,
          parent_acknowledged_at TIMESTAMP WITH TIME ZONE,
          status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
    } catch (e) {
      console.error('[SchoolStudentExitService] Table auto-creation error:', e);
    }
  }

  private async generateTcNumber(instituteId: string): Promise<string> {
    const year = new Date().getFullYear();
    const rows: any[] = await this.ds.query(
      `SELECT COUNT(*)::int as count FROM student_exit_records WHERE institute_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
      [instituteId, year]
    );
    const count = (rows[0]?.count || 0) + 1;
    return `TC/${year}/${String(count).padStart(3, '0')}`;
  }

  async getExitRecord(user: any, studentId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT e.*, COALESCE(u.name, s.father_name, 'Student') as student_name, s.enrollment_no
       FROM student_exit_records e
       LEFT JOIN students s ON e.student_id = s.id OR e.student_id = s.user_id
       LEFT JOIN users u ON s.user_id = u.id OR e.student_id = u.id
       WHERE (e.student_id = $1 OR s.id = $1 OR s.user_id = $1 OR u.id = $1)
       ORDER BY e.created_at DESC LIMIT 1`,
      [studentId]
    );

    if (!rows.length) {
      // Check if student exists and generate a default exit draft
      const studentRows: any[] = await this.ds.query(
        `SELECT COALESCE(u.id, s.user_id, s.id) as user_id,
                COALESCE(u.name, s.father_name, 'Student') as name,
                COALESCE(u.institute_id, s.institute_id) as institute_id,
                s.id as student_id, s.enrollment_no, s.admission_date,
                sec.name as section_name, c.name as class_name, c.academic_year
         FROM students s
         LEFT JOIN users u ON s.user_id = u.id OR s.id = u.id
         LEFT JOIN sections sec ON s.section_id = sec.id
         LEFT JOIN classes c ON sec.class_id = c.id
         WHERE s.id = $1 OR s.user_id = $1 OR u.id = $1
         LIMIT 1`,
        [studentId]
      );
      
      const st = studentRows[0] || {
        student_id: studentId,
        user_id: studentId,
        enrollment_no: '',
        name: 'Student',
        class_name: '',
        section_name: '',
        academic_year: String(new Date().getFullYear()),
        admission_date: null,
        institute_id: user?.instituteId || null
      };

      // Auto-check fee clearance from fees table if available
      const feeDuesRows = await this.ds.query(
        `SELECT COUNT(*)::int as unpaid FROM fees WHERE student_id = $1 AND LOWER(status) <> 'paid'`,
        [st.student_id]
      ).catch(() => [{ unpaid: 0 }]);
      const feeStatus = (feeDuesRows[0]?.unpaid || 0) === 0 ? 'CLEARED' : 'PENDING';

      return {
        success: true,
        data: {
          studentId: st.student_id,
          userId: st.user_id,
          admissionNo: st.enrollment_no,
          studentName: st.name,
          classAndSection: st.class_name ? `${st.class_name}${st.section_name ? ` - ${st.section_name}` : ''}` : '',
          academicSession: st.academic_year || String(new Date().getFullYear()),
          admissionDate: st.admission_date,
          leavingDate: new Date().toISOString().split('T')[0],
          lastClassAttended: st.class_name ? `${st.class_name}${st.section_name ? ` - ${st.section_name}` : ''}` : '',
          reasonForLeaving: '',
          destinationSchool: '',
          tcNumber: '',
          tcIssueDate: null,
          examResultStatus: 'PASSED',
          conductRemarks: 'Good',
          feeClearanceStatus: feeStatus,
          libraryClearanceStatus: 'CLEARED',
          hostelClearanceStatus: 'NOT_APPLICABLE',
          transportClearanceStatus: 'NOT_APPLICABLE',
          documentsIssued: ['Transfer Certificate', 'Character Certificate', 'Report Card'],
          authorizedSignatoryName: 'Principal / Admin',
          authorizedSignatoryRole: 'Principal',
          parentAcknowledgement: false,
          status: 'NOT_STARTED'
        }
      };
    }

    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        studentId: r.student_id,
        instituteId: r.institute_id,
        admissionNo: r.admission_no,
        studentName: r.student_name,
        classAndSection: r.class_and_section,
        academicSession: r.academic_session,
        admissionDate: r.admission_date,
        leavingDate: r.leaving_date,
        lastClassAttended: r.last_class_attended,
        reasonForLeaving: r.reason_for_leaving,
        destinationSchool: r.destination_school,
        tcNumber: r.tc_number,
        tcIssueDate: r.tc_issue_date,
        examResultStatus: r.exam_result_status,
        conductRemarks: r.conduct_remarks,
        feeClearanceStatus: r.fee_clearance_status,
        libraryClearanceStatus: r.library_clearance_status,
        hostelClearanceStatus: r.hostel_clearance_status,
        transportClearanceStatus: r.transport_clearance_status,
        documentsIssued: typeof r.documents_issued === 'string' ? JSON.parse(r.documents_issued) : (r.documents_issued || []),
        authorizedSignatoryName: r.authorized_signatory_name,
        authorizedSignatoryRole: r.authorized_signatory_role,
        parentAcknowledgement: r.parent_acknowledgement,
        parentAcknowledgedAt: r.parent_acknowledged_at,
        status: r.status
      }
    };
  }

  async createOrUpdateExitRecord(user: any, studentId: string, body: any) {
    const studentRows: any[] = await this.ds.query(
      `SELECT COALESCE(u.id, s.user_id, s.id) as user_id,
              COALESCE(u.name, s.father_name, 'Student') as name,
              COALESCE(u.institute_id, s.institute_id) as institute_id,
              s.id as student_id, s.enrollment_no, s.admission_date,
              sec.name as section_name, c.name as class_name, c.academic_year
       FROM students s
       LEFT JOIN users u ON s.user_id = u.id OR s.id = u.id
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       WHERE s.id = $1 OR s.user_id = $1 OR u.id = $1
       LIMIT 1`,
      [studentId]
    );
    const st = studentRows[0] || {
      student_id: studentId,
      user_id: studentId,
      enrollment_no: body.admissionNo || '',
      name: body.studentName || 'Student',
      institute_id: user?.instituteId || null,
      class_name: '',
      section_name: '',
      academic_year: String(new Date().getFullYear()),
      admission_date: null
    };

    const existing: any[] = await this.ds.query(
      `SELECT id, tc_number FROM student_exit_records WHERE student_id = $1 OR student_id = $2`,
      [st.student_id, st.user_id]
    );

    let tcNumber = body.tcNumber;
    if (body.issueTc && (!tcNumber || tcNumber === '')) {
      tcNumber = await this.generateTcNumber(st.institute_id);
    }

    const tcIssueDate = body.issueTc ? (body.tcIssueDate || new Date().toISOString().split('T')[0]) : (body.tcIssueDate || null);
    const newStatus = body.issueTc ? 'TC_ISSUED' : (body.status || 'PENDING_APPROVAL');

    if (existing.length > 0) {
      const recordId = existing[0].id;
      await this.ds.query(
        `UPDATE student_exit_records SET
           admission_no = COALESCE($1, admission_no),
           student_name = COALESCE($2, student_name),
           class_and_section = COALESCE($3, class_and_section),
           academic_session = COALESCE($4, academic_session),
           admission_date = COALESCE($5, admission_date),
           leaving_date = COALESCE($6, leaving_date),
           last_class_attended = COALESCE($7, last_class_attended),
           reason_for_leaving = COALESCE($8, reason_for_leaving),
           destination_school = COALESCE($9, destination_school),
           tc_number = COALESCE($10, tc_number),
           tc_issue_date = COALESCE($11, tc_issue_date),
           exam_result_status = COALESCE($12, exam_result_status),
           conduct_remarks = COALESCE($13, conduct_remarks),
           fee_clearance_status = COALESCE($14, fee_clearance_status),
           library_clearance_status = COALESCE($15, library_clearance_status),
           hostel_clearance_status = COALESCE($16, hostel_clearance_status),
           transport_clearance_status = COALESCE($17, transport_clearance_status),
           documents_issued = COALESCE($18, documents_issued),
           authorized_signatory_name = COALESCE($19, authorized_signatory_name),
           authorized_signatory_role = COALESCE($20, authorized_signatory_role),
           parent_acknowledgement = COALESCE($21, parent_acknowledgement),
           status = $22,
           updated_at = NOW()
         WHERE id = $23`,
        [
          body.admissionNo || st.enrollment_no,
          body.studentName || st.name,
          body.classAndSection || `${st.class_name || ''} - ${st.section_name || ''}`,
          body.academicSession || st.academic_year,
          body.admissionDate ? new Date(body.admissionDate) : st.admission_date,
          body.leavingDate ? new Date(body.leavingDate) : null,
          body.lastClassAttended || st.class_name,
          body.reasonForLeaving || null,
          body.destinationSchool || null,
          tcNumber || null,
          tcIssueDate ? new Date(tcIssueDate) : null,
          body.examResultStatus || 'PASSED',
          body.conductRemarks || 'Good',
          body.feeClearanceStatus || 'PENDING',
          body.libraryClearanceStatus || 'CLEARED',
          body.hostelClearanceStatus || 'NOT_APPLICABLE',
          body.transportClearanceStatus || 'NOT_APPLICABLE',
          JSON.stringify(body.documentsIssued || ['Transfer Certificate', 'Character Certificate', 'Report Card']),
          body.authorizedSignatoryName || 'Principal',
          body.authorizedSignatoryRole || 'Principal',
          body.parentAcknowledgement ?? false,
          newStatus,
          recordId
        ]
      );
    } else {
      await this.ds.query(
        `INSERT INTO student_exit_records (
           student_id, institute_id, admission_no, student_name, class_and_section, academic_session,
           admission_date, leaving_date, last_class_attended, reason_for_leaving, destination_school,
           tc_number, tc_issue_date, exam_result_status, conduct_remarks,
           fee_clearance_status, library_clearance_status, hostel_clearance_status, transport_clearance_status,
           documents_issued, authorized_signatory_name, authorized_signatory_role, parent_acknowledgement, status
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18, $19,
           $20, $21, $22, $23, $24
         )`,
        [
          st.student_id,
          st.institute_id,
          body.admissionNo || st.enrollment_no,
          body.studentName || st.name,
          body.classAndSection || `${st.class_name || ''} - ${st.section_name || ''}`,
          body.academicSession || st.academic_year,
          body.admissionDate ? new Date(body.admissionDate) : st.admission_date,
          body.leavingDate ? new Date(body.leavingDate) : new Date(),
          body.lastClassAttended || st.class_name,
          body.reasonForLeaving || null,
          body.destinationSchool || null,
          tcNumber || null,
          tcIssueDate ? new Date(tcIssueDate) : null,
          body.examResultStatus || 'PASSED',
          body.conductRemarks || 'Good',
          body.feeClearanceStatus || 'PENDING',
          body.libraryClearanceStatus || 'CLEARED',
          body.hostelClearanceStatus || 'NOT_APPLICABLE',
          body.transportClearanceStatus || 'NOT_APPLICABLE',
          JSON.stringify(body.documentsIssued || ['Transfer Certificate', 'Character Certificate', 'Report Card']),
          body.authorizedSignatoryName || 'Principal',
          body.authorizedSignatoryRole || 'Principal',
          body.parentAcknowledgement ?? false,
          newStatus
        ]
      );
    }

    // Update student status to TRANSFERRED_LEFT if TC is issued
    if (body.issueTc) {
      await this.ds.query(`UPDATE students SET status = 'TRANSFERRED_LEFT' WHERE id = $1 OR user_id = $1`, [st.student_id]);
      await this.ds.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [st.user_id]);
    }

    return this.getExitRecord(user, st.student_id);
  }
}
