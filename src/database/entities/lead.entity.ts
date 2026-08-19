import { Entity, Column, Index } from 'typeorm';
import { Base } from './base.entity';

export enum LeadVertical {
  SCHOOL = 'SCHOOL',
  COACHING = 'COACHING',
}

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  CONVERTED = 'CONVERTED',
  CLOSED = 'CLOSED',
}

/**
 * A "Request a Demo / Get Early Access" enquiry submitted from the public
 * marketing site. Captured so the team can follow up (see the super-admin
 * Leads dashboard) and track New → Contacted → Converted.
 */
@Entity('leads')
export class Lead extends Base {
  @Column()
  name: string;

  @Index()
  @Column()
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  organization: string;

  @Column({ nullable: true })
  role: string;

  // Stored as varchar (not a PG enum) since the coaching DataSource has
  // synchronize off and the table is created manually in onModuleInit.
  @Column({ type: 'varchar', nullable: true })
  vertical: LeadVertical;

  @Column({ name: 'interested_feature', nullable: true })
  interestedFeature: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Index()
  @Column({ type: 'varchar', default: LeadStatus.NEW })
  status: LeadStatus;

  /** Where the lead came from, e.g. 'landing-modal' | 'contact-page'. */
  @Column({ nullable: true })
  source: string;

  /** Internal follow-up notes added by staff from the dashboard. */
  @Column({ type: 'text', nullable: true })
  notes: string;
}
