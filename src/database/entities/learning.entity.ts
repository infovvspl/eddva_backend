import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { Student } from './student.entity';
import { Topic } from './subject.entity';
import { Batch } from './batch.entity';
import { User } from './user.entity';

// ─── Doubt ────────────────────────────────────────────────────────────────────
export enum DoubtSource {
  IN_LECTURE = 'lecture',
  POST_QUESTION = 'question',
  POST_BATTLE = 'battle',
  MANUAL = 'manual',
}

export enum DoubtStatus {
  OPEN = 'open',
  AI_RESOLVED = 'ai_resolved',
  ESCALATED = 'escalated',
  TEACHER_RESOLVED = 'teacher_resolved',
}

export enum ExplanationMode {
  SHORT = 'short',
  DETAILED = 'detailed',
}

@Entity('doubts')
export class Doubt extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'topic_id', nullable: true })
  topicId: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  // ── Input ─────────────────────────────────────────────────────────────────
  @Column({ name: 'question_text', type: 'text', nullable: true })
  questionText: string;

  @Column({ name: 'question_image_url', nullable: true })
  questionImageUrl: string;

  @Column({ name: 'ocr_extracted_text', type: 'text', nullable: true })
  ocrExtractedText: string;

  @Column({ type: 'enum', enum: DoubtSource, default: DoubtSource.MANUAL })
  source: DoubtSource;

  @Column({ name: 'source_ref_id', nullable: true })
  sourceRefId: string; // lecture_id or question_id

  @Column({ name: 'explanation_mode', type: 'enum', enum: ExplanationMode, default: ExplanationMode.SHORT })
  explanationMode: ExplanationMode;

  // ── Resolution ────────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: DoubtStatus, default: DoubtStatus.OPEN })
  status: DoubtStatus;

  @Column({ name: 'ai_explanation', type: 'text', nullable: true })
  aiExplanation: string;

  @Column({ name: 'ai_concept_links', type: 'jsonb', default: [] })
  aiConceptLinks: string[];

  @Column({ name: 'ai_similar_question_ids', type: 'jsonb', default: [] })
  aiSimilarQuestionIds: string[];

  @Column({ name: 'teacher_id', nullable: true })
  teacherId: string;

  @Column({ name: 'teacher_response', type: 'text', nullable: true })
  teacherResponse: string;

  @Column({ name: 'is_helpful', nullable: true })
  isHelpful: boolean;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  // ── Teacher enriched response ─────────────────────────────────────────────
  @Column({ name: 'ai_quality_rating', nullable: true })
  aiQualityRating: string; // 'correct' | 'partial' | 'wrong'

  @Column({ name: 'teacher_lecture_ref', nullable: true })
  teacherLectureRef: string; // e.g. "Lecture 3 at 12:30"

  @Column({ name: 'teacher_response_image_url', nullable: true })
  teacherResponseImageUrl: string;

  @Column({ name: 'is_teacher_response_helpful', nullable: true })
  isTeacherResponseHelpful: boolean;

  @Column({ name: 'teacher_reviewed_at', type: 'timestamptz', nullable: true })
  teacherReviewedAt: Date;
}

// ─── Lecture ──────────────────────────────────────────────────────────────────
export enum LectureType {
  RECORDED = 'recorded',
  LIVE = 'live',
}

export enum LectureStatus {
  PROCESSING = 'processing',
  PUBLISHED = 'published',
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  ENDED = 'ended',
  DRAFT = 'draft',
}

@Entity('lectures')
export class Lecture extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'batch_id' })
  batchId: string;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @Column({ name: 'teacher_id' })
  teacherId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'teacher_id' })
  teacher: User;

  @Column({ name: 'topic_id', nullable: true })
  topicId: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column()
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  @Column({ type: 'enum', enum: LectureType })
  type: LectureType;

  @Column({ type: 'enum', enum: LectureStatus, default: LectureStatus.PROCESSING })
  status: LectureStatus;

  // ── Media ─────────────────────────────────────────────────────────────────
  @Column({ name: 'video_url', nullable: true })
  videoUrl: string;

  @Column({ name: 'video_duration_seconds', nullable: true })
  videoDurationSeconds: number;

  @Column({ name: 'thumbnail_url', nullable: true })
  thumbnailUrl: string;

  // ── AI Generated Content ──────────────────────────────────────────────────
  @Column({ name: 'ai_notes_markdown', type: 'text', nullable: true })
  aiNotesMarkdown: string;

  @Column({ name: 'ai_key_concepts', type: 'jsonb', default: [] })
  aiKeyConcepts: string[];

  @Column({ name: 'ai_formulas', type: 'jsonb', default: [] })
  aiFormulas: string[];

  @Column({ name: 'transcript', type: 'text', nullable: true })
  transcript: string;

  // ── Quiz checkpoints — full MCQ data stored in JSONB ─────────────────────
  @Column({ name: 'quiz_checkpoints', type: 'jsonb', default: [] })
  quizCheckpoints: Array<{
    id: string;
    questionText: string;
    options: { label: string; text: string }[];
    correctOption: string;
    triggerAtPercent: number;
    segmentTitle: string;
    explanation?: string;
  }>;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date;

  @Column({ name: 'live_meeting_url', nullable: true })
  liveMeetingUrl: string;
}

@Entity('lecture_progress')
export class LectureProgress extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'lecture_id' })
  lectureId: string;

  @ManyToOne(() => Lecture, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lecture_id' })
  lecture: Lecture;

  @Column({ name: 'watch_percentage', type: 'float', default: 0 })
  watchPercentage: number;

  @Column({ name: 'last_position_seconds', default: 0 })
  lastPositionSeconds: number;

  @Column({ name: 'rewind_count', default: 0 })
  rewindCount: number;

  @Column({ name: 'is_completed', default: false })
  isCompleted: boolean;

  @Column({ name: 'confusion_flags', type: 'jsonb', default: [] })
  confusionFlags: Array<{ timestampSeconds: number; rewindCount: number }>;

  @Column({ name: 'quiz_responses', type: 'jsonb', default: [] })
  quizResponses: Array<{
    questionId: string;
    selectedOption: string;
    isCorrect: boolean;
    answeredAt: string;
    timeTakenSeconds?: number;
  }>;
}

// ─── Study Plan ───────────────────────────────────────────────────────────────
@Entity('study_plans')
export class StudyPlan extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'student_id', unique: true })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'generated_at', type: 'timestamptz', default: () => 'NOW()' })
  generatedAt: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date;

  @Column({ name: 'ai_version', nullable: true })
  aiVersion: string;
}

export enum PlanItemType {
  LECTURE = 'lecture',
  PRACTICE = 'practice',
  REVISION = 'revision',
  MOCK_TEST = 'mock_test',
  DOUBT_SESSION = 'doubt_session',
  BATTLE = 'battle',
}

export enum PlanItemStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
  RESCHEDULED = 'rescheduled',
}

@Entity('plan_items')
export class PlanItem extends Base {
  @Column({ name: 'study_plan_id' })
  studyPlanId: string;

  @ManyToOne(() => StudyPlan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'study_plan_id' })
  studyPlan: StudyPlan;

  @Column({ name: 'scheduled_date', type: 'date' })
  scheduledDate: string;

  @Column({ type: 'enum', enum: PlanItemType })
  type: PlanItemType;

  @Column({ name: 'ref_id', nullable: true })
  refId: string; // lecture_id, topic_id, mock_test_id

  @Column({ name: 'title' })
  title: string;

  @Column({ name: 'estimated_minutes', default: 30 })
  estimatedMinutes: number;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'enum', enum: PlanItemStatus, default: PlanItemStatus.PENDING })
  status: PlanItemStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;
}

// ─── AI Study Session ─────────────────────────────────────────────────────────

@Entity('ai_study_sessions')
export class AiStudySession extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'topic_id' })
  topicId: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ name: 'lesson_markdown', type: 'text', nullable: true })
  lessonMarkdown: string;

  @Column({ name: 'key_concepts', type: 'jsonb', default: [] })
  keyConcepts: string[];

  @Column({ name: 'formulas', type: 'jsonb', default: [] })
  formulas: string[];

  @Column({ name: 'practice_questions', type: 'jsonb', default: [] })
  practiceQuestions: Array<{ question: string; answer: string; explanation: string }>;

  @Column({ name: 'common_mistakes', type: 'jsonb', default: [] })
  commonMistakes: string[];

  @Column({ name: 'conversation', type: 'jsonb', default: [] })
  conversation: Array<{ role: 'student' | 'ai'; message: string; timestamp: string }>;

  @Column({ name: 'is_completed', default: false })
  isCompleted: boolean;

  @Column({ name: 'time_spent_seconds', default: 0 })
  timeSpentSeconds: number;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  @Column({ name: 'ai_session_ref', nullable: true })
  aiSessionRef: string;
}
