import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { User } from './user.entity';

@Entity('teacher_profiles')
export class TeacherProfile extends Base {
  @Column({ name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ nullable: true })
  qualification: string; // 'B.Tech', 'M.Sc', 'B.Ed', 'PhD', 'Other'

  @Column({ name: 'subject_expertise', type: 'jsonb', default: [] })
  subjectExpertise: string[];

  @Column({ name: 'classes_teach', type: 'jsonb', default: [] })
  classesTeach: string[];

  @Column({ name: 'years_of_experience', nullable: true })
  yearsOfExperience: number;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ nullable: true })
  gender: string;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string;

  @Column({ name: 'profile_photo_url', nullable: true })
  profilePhotoUrl: string;

  @Column({ name: 'teaching_mode', nullable: true })
  teachingMode: string; // 'online', 'offline', 'hybrid'

  @Column({ name: 'previous_institute', nullable: true })
  previousInstitute: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  state: string;

  @Column({ name: 'onboarding_complete', default: false })
  onboardingComplete: boolean;
}
