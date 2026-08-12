import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

export enum DocumentTemplateType {
  ID_CARD_STUDENT = 'ID_CARD_STUDENT',
  ID_CARD_STAFF = 'ID_CARD_STAFF',
  ADMIT_CARD = 'ADMIT_CARD',
}

@Entity('school_document_templates')
export class SchoolDocumentTemplate extends SchoolBase {
  @Column({ type: 'varchar', length: 255 })
  type: DocumentTemplateType;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', name: 'html_content' })
  htmlContent: string;

  @Column({ type: 'jsonb', nullable: true })
  dimensions: { width: number; height: number }; // In mm

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;
}
