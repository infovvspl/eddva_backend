export const AI_FEATURES = [
  { id: 'ai_lecture_processing',    label: 'AI Lecture Processing',    category: 'teacher' },
  { id: 'ai_doubt_solver',          label: 'AI Doubt Solver',          category: 'student' },
  { id: 'ai_learning_assistant',    label: 'AI Learning Assistant',    category: 'student' },
  { id: 'ai_student_insights',      label: 'AI Student Insights',      category: 'student' },
  { id: 'ai_assessment_grading',    label: 'AI Assessment Grading',    category: 'both' },
  { id: 'ai_content_generation',    label: 'AI Content Generation',    category: 'teacher' },
  { id: 'ai_battle_arena',          label: 'AI Battle Arena',          category: 'both' },
] as const;

export type AiFeatureId = typeof AI_FEATURES[number]['id'];
