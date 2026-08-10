import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('syllabus_plans')
export class SchoolSyllabusPlan extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'academic_year' }) academicYear: string;
  @Column({ name: 'class_id' }) classId: string;
  @Column({ name: 'section_id', nullable: true }) sectionId: string;
  @Column({ name: 'subject_id' }) subjectId: string;
  @Column({ name: 'chapter_id', nullable: true }) chapterId: string;
  @Column({ name: 'topic_id', nullable: true }) topicId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column({ name: 'planned_start_date', type: 'date' }) plannedStartDate: Date;
  @Column({ name: 'planned_completion_date', type: 'date' }) plannedCompletionDate: Date;
  @Column({ name: 'planned_periods', type: 'int', default: 1 }) plannedPeriods: number;
  @Column({ default: 'NORMAL' }) priority: string;
  @Column({ nullable: true }) term: string;
  @Column({ default: 'PLANNED' }) status: string;
}

@Entity('lesson_plans')
export class SchoolLessonPlan extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'academic_year' }) academicYear: string;
  @Column({ name: 'class_id' }) classId: string;
  @Column({ name: 'section_id' }) sectionId: string;
  @Column({ name: 'subject_id' }) subjectId: string;
  @Column({ name: 'chapter_id', nullable: true }) chapterId: string;
  @Column({ name: 'topic_id', nullable: true }) topicId: string;
  @Column({ name: 'teacher_id' }) teacherId: string;
  @Column({ type: 'date' }) date: Date;
  @Column({ name: 'duration_periods', type: 'int', default: 1 }) durationPeriods: number;
  @Column({ name: 'learning_objectives', type: 'text', nullable: true }) learningObjectives: string;
  @Column({ name: 'previous_knowledge', type: 'text', nullable: true }) previousKnowledge: string;
  @Column({ name: 'teaching_methodology', type: 'text', nullable: true }) teachingMethodology: string;
  @Column({ name: 'teaching_activities', type: 'text', nullable: true }) teachingActivities: string;
  @Column({ name: 'teaching_resources', type: 'text', nullable: true }) teachingResources: string;
  @Column({ name: 'digital_resources', type: 'text', nullable: true }) digitalResources: string;
  @Column({ name: 'classroom_activities', type: 'text', nullable: true }) classroomActivities: string;
  @Column({ name: 'assessment_method', type: 'text', nullable: true }) assessmentMethod: string;
  @Column({ type: 'text', nullable: true }) homework: string;
  @Column({ name: 'expected_learning_outcomes', type: 'text', nullable: true }) expectedLearningOutcomes: string;
  @Column({ name: 'teacher_notes', type: 'text', nullable: true }) teacherNotes: string;
  @Column({ name: 'timetable_id', nullable: true }) timetableId: string;
  @Column({ default: 'DRAFT' }) status: string;
}

@Entity('lesson_completions')
export class SchoolLessonCompletion extends SchoolBase {
  @Column({ name: 'lesson_plan_id' }) lessonPlanId: string;
  @Column({ name: 'actual_date', type: 'date' }) actualDate: Date;
  @Column({ name: 'actual_duration_periods', type: 'int', default: 1 }) actualDurationPeriods: number;
  @Column({ name: 'topics_covered', type: 'text', nullable: true }) topicsCovered: string;
  @Column({ name: 'learning_objectives_achieved', type: 'text', nullable: true }) learningObjectivesAchieved: string;
  @Column({ name: 'student_understanding_rating', type: 'int', default: 4 }) studentUnderstandingRating: number;
  @Column({ name: 'homework_assigned', type: 'text', nullable: true }) homeworkAssigned: string;
  @Column({ name: 'assessment_conducted', type: 'text', nullable: true }) assessmentConducted: string;
  @Column({ name: 'teacher_reflection', type: 'text', nullable: true }) teacherReflection: string;
  @Column({ name: 'completion_type', default: 'FULLY' }) completionType: string;
  @Column({ name: 'delay_reason', type: 'text', nullable: true }) delayReason: string;
  @Column({ name: 'carry_forward_date', type: 'date', nullable: true }) carryForwardDate: Date;
}

@Entity('lesson_templates')
export class SchoolLessonTemplate extends SchoolBase {
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column() title: string;
  @Column({ default: 'Standard' }) category: string;
  @Column({ name: 'content_json', type: 'jsonb' }) contentJson: any;
  @Column({ name: 'is_global', default: false }) isGlobal: boolean;
}

@Entity('lesson_audit_logs')
export class SchoolLessonAuditLog extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'entity_type' }) entityType: string;
  @Column({ name: 'entity_id' }) entityId: string;
  @Column() action: string;
  @Column({ name: 'changed_by_user_id' }) changedByUserId: string;
  @Column({ name: 'old_values', type: 'jsonb', nullable: true }) oldValues: any;
  @Column({ name: 'new_values', type: 'jsonb', nullable: true }) newValues: any;
}
