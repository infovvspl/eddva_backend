export const AI_FEATURES_REGISTRY = [
  { key: 'ai_doubt_solver', name: 'AI Doubt Solver', defaultEnabled: true },
  { key: 'ai_study_planner', name: 'AI Study Planner', defaultEnabled: true },
  { key: 'ai_career_guidance', name: 'AI Career Guidance', defaultEnabled: true },
  { key: 'ai_notes_generator', name: 'AI Notes Generator', defaultEnabled: false },
  { key: 'ai_quiz_generator', name: 'AI Quiz Generator', defaultEnabled: false },
  { key: 'ai_game_quizzes', name: 'AI Game Quizzes', defaultEnabled: false },
  { key: 'ai_content_generator_assessments', name: 'AI Content Generator (Assessments)', defaultEnabled: false },
  { key: 'ai_content_generator_materials', name: 'AI Content Generator (Materials)', defaultEnabled: false },
  { key: 'ai_ppt_generator', name: 'AI PPT Generator', defaultEnabled: false },
  { key: 'ai_translation', name: 'AI Translation', defaultEnabled: false },
  { key: 'ai_ocr_handwriting', name: 'AI OCR & Handwriting Recognition', defaultEnabled: false },
];

export const AI_FEATURE_DEFAULT_ON = new Set<string>(
  AI_FEATURES_REGISTRY.filter(f => f.defaultEnabled).map(f => f.key)
);
