import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('student_exit_records')
export class SchoolStudentExit extends SchoolBase {
  @Column({ name: 'student_id', type: 'uuid' }) studentId: string;
  @Column({ name: 'institute_id' }) instituteId: string;

  // Basic Information
  @Column({ name: 'admission_no' }) admissionNo: string;
  @Column({ name: 'student_name' }) studentName: string;
  @Column({ name: 'class_and_section', nullable: true }) classAndSection: string;
  @Column({ name: 'academic_session', nullable: true }) academicSession: string;
  @Column({ name: 'admission_date', type: 'date', nullable: true }) admissionDate: Date;
  @Column({ name: 'leaving_date', type: 'date', nullable: true }) leavingDate: Date;
  @Column({ name: 'last_class_attended', nullable: true }) lastClassAttended: string;

  // Exit Reasons & Destination
  @Column({ name: 'reason_for_leaving', nullable: true }) reasonForLeaving: string;
  @Column({ name: 'destination_school', nullable: true }) destinationSchool: string;

  // Transfer Certificate Details
  @Column({ name: 'tc_number', nullable: true }) tcNumber: string;
  @Column({ name: 'tc_issue_date', type: 'date', nullable: true }) tcIssueDate: Date;
  @Column({ name: 'exam_result_status', nullable: true }) examResultStatus: string;
  @Column({ name: 'conduct_remarks', nullable: true }) conductRemarks: string;

  // Department Clearances
  @Column({ name: 'fee_clearance_status', default: 'PENDING' }) feeClearanceStatus: string;
  @Column({ name: 'library_clearance_status', default: 'PENDING' }) libraryClearanceStatus: string;
  @Column({ name: 'hostel_clearance_status', default: 'NOT_APPLICABLE' }) hostelClearanceStatus: string;
  @Column({ name: 'transport_clearance_status', default: 'NOT_APPLICABLE' }) transportClearanceStatus: string;

  // Documents Issued JSON List
  @Column({ name: 'documents_issued', type: 'json', nullable: true }) documentsIssued: string[];

  // Signatory & Acknowledgements
  @Column({ name: 'authorized_signatory_name', nullable: true }) authorizedSignatoryName: string;
  @Column({ name: 'authorized_signatory_role', nullable: true }) authorizedSignatoryRole: string;
  @Column({ name: 'parent_acknowledgement', default: false }) parentAcknowledgement: boolean;
  @Column({ name: 'parent_acknowledged_at', type: 'timestamp', nullable: true }) parentAcknowledgedAt: Date;

  // Workflow Status: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, TC_ISSUED
  @Column({ default: 'PENDING_APPROVAL' }) status: string;
}
