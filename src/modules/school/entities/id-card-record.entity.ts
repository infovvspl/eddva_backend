import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { DocumentTemplateType } from './school-document-template.entity';

export enum IdCardTargetType {
  STUDENT = 'STUDENT',
  STAFF = 'STAFF',
}

export enum IdCardStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  LOST = 'LOST',
}

@Entity('id_card_records')
export class IdCardRecord extends SchoolBase {
  @Column({ name: 'target_type', type: 'enum', enum: IdCardTargetType })
  targetType: IdCardTargetType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string; // Refers to Student or TeacherProfile ID

  @Column({ name: 'document_type', type: 'enum', enum: DocumentTemplateType })
  documentType: DocumentTemplateType; // Usually ID_CARD_STUDENT or ID_CARD_STAFF

  @Column({ name: 'qr_code_hash', type: 'varchar', length: 128, unique: true })
  qrCodeHash: string; // The unique hash embedded in the QR Code URL

  @Column({ type: 'enum', enum: IdCardStatus, default: IdCardStatus.ACTIVE })
  status: IdCardStatus;

  @Column({ name: 'issued_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  issuedAt: Date;

  @Column({ name: 'reissued_at', type: 'timestamptz', nullable: true })
  reissuedAt: Date;
  
  @Column({ name: 'file_url', type: 'varchar', length: 1024, nullable: true })
  fileUrl: string; // Optional link to the generated PDF just for this card
}
