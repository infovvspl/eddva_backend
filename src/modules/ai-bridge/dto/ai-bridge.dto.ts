import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsObject,
  IsEnum,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';

// ── AI #1 — Doubt Clearing ──────────────────────────────────────────────────
// (Already handled by doubt module — kept here for direct testing)

// ── AI #2 — AI Tutor ────────────────────────────────────────────────────────
export class StartTutorSessionDto {
  @IsString()
  @IsNotEmpty()
  topicId: string;

  @IsString()
  @IsOptional()
  context?: string;
}

export class ContinueTutorSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  studentMessage: string;
}

// ── AI #3 — Performance Analysis ─────────────────────────────────────────────
export class AnalyzePerformanceDto {
  @IsString()
  @IsNotEmpty()
  testSessionId: string;

  @IsString()
  @IsOptional()
  examTarget?: string;

  @IsArray()
  attempts: Array<{
    questionId: string;
    topic: string;
    correct: boolean;
    timeTaken: number;
  }>;
}

// ── AI #4 — Assessment Grading ──────────────────────────────────────────────
export class GradeSubjectiveDto {
  @IsString()
  @IsNotEmpty()
  questionText: string;

  @IsString()
  @IsNotEmpty()
  studentAnswer: string;

  @IsString()
  @IsNotEmpty()
  expectedAnswer: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  maxMarks: number;
}

// ── AI #5 — Engagement Detection ─────────────────────────────────────────────
export class DetectEngagementDto {
  @IsString()
  @IsNotEmpty()
  context: string;

  @IsObject()
  signals: {
    rewindCount?: number;
    pauseCount?: number;
    answersPerMinute?: number;
    accuracy?: number;
    idleSeconds?: number;
  };
}

// ── AI #6 — Content Recommendation ──────────────────────────────────────────
export class RecommendContentDto {
  @IsEnum(['post_test', 'post_wrong_answer', 'dashboard'])
  context: 'post_test' | 'post_wrong_answer' | 'dashboard';

  @IsArray()
  @IsOptional()
  weakTopics?: string[];

  @IsObject()
  @IsOptional()
  recentPerformance?: any;
}

// ── AI #7 — Speech-to-Text Notes ─────────────────────────────────────────────
export class GenerateLectureNotesDto {
  @IsString()
  @IsNotEmpty()
  audioUrl: string;

  @IsString()
  @IsOptional()
  topicId?: string;

  @IsEnum(['en', 'hi'])
  @IsOptional()
  language?: 'en' | 'hi';

  @IsString()
  @IsOptional()
  transcript?: string;
}

// ── AI #8 — Student Feedback ─────────────────────────────────────────────────
export class GenerateFeedbackDto {
  @IsEnum(['post_test', 'weekly_summary', 'battle_result'])
  context: 'post_test' | 'weekly_summary' | 'battle_result';

  @IsObject()
  data: any;
}

// ── AI #9 — Notes Analysis ──────────────────────────────────────────────────
export class AnalyzeNotesDto {
  @IsString()
  @IsNotEmpty()
  notesContent: string;

  @IsString()
  @IsOptional()
  topicId?: string;
}

// ── AI #10 — Resume Analyzer ─────────────────────────────────────────────────
export class AnalyzeResumeDto {
  @IsString()
  @IsNotEmpty()
  resumeText: string;

  @IsString()
  @IsOptional()
  targetRole?: string;
}

// ── AI #11 — Interview Prep ──────────────────────────────────────────────────
export class StartInterviewPrepDto {
  @IsString()
  @IsOptional()
  targetCollege?: string;
}

// ── AI #12 — Study Plan ──────────────────────────────────────────────────────
// (Already handled by study-plan module — kept here for direct testing)
export class GenerateStudyPlanDto {
  @IsString()
  @IsNotEmpty()
  examTarget: string;

  @IsString()
  @IsNotEmpty()
  examYear: string;

  @IsNumber()
  @Min(1)
  @Max(16)
  dailyHours: number;

  @IsArray()
  @IsOptional()
  weakTopics?: string[];

  @IsString()
  @IsOptional()
  targetCollege?: string;

  @IsObject()
  @IsOptional()
  academicCalendar?: any;
}
