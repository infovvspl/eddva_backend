import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';
import { DocumentTemplateType } from './school-document-template.entity';

export enum DocumentGenerationTarget {
  CLASS = 'CLASS',
  INDIVIDUAL = 'INDIVIDUAL',
  STAFF = 'STAFF',
  STAFF_INDIVIDUAL = 'STAFF_INDIVIDUAL',
}

@Entity('school_document_generation_history')
export class SchoolDocumentGenerationHistory extends SchoolBase {
  @Column({ type: 'varchar', name: 'document_type' })
  documentType: DocumentTemplateType;

  @Column({ type: 'varchar', name: 'generated_for' })
  generatedFor: DocumentGenerationTarget;

  @Column({ type: 'uuid', name: 'target_id' })
  targetId: string; // e.g., Class ID or Student ID

  @Column({ type: 'uuid', name: 'generated_by' })
  generatedBy: string; // Admin ID

  @Column({ type: 'varchar', length: 1024, name: 'file_url', nullable: true })
  fileUrl: string; // URL to the generated PDF/ZIP
}
