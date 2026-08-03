export const AI_FEATURES_REGISTRY = [
  { key: 'ai_doubt_solver', name: 'AI Doubt Solver', defaultEnabled: true },
  { key: 'ai_study_planner', name: 'AI Study Planner', defaultEnabled: true },
  { key: 'ai_career_guidance', name: 'AI Career Guidance', defaultEnabled: true },
  { key: 'ai_notes_generator', name: 'AI Notes Generator', defaultEnabled: true },
  { key: 'ai_quiz_generator', name: 'AI Quiz Generator', defaultEnabled: true },
  { key: 'ai_game_quizzes', name: 'AI Game Quizzes', defaultEnabled: true },
  { key: 'ai_content_generator_assessments', name: 'AI Content Generator (Assessments)', defaultEnabled: true },
  { key: 'ai_content_generator_materials', name: 'AI Content Generator (Materials)', defaultEnabled: true },
  { key: 'ai_ppt_generator', name: 'AI PPT Generator', defaultEnabled: true },
  { key: 'ai_translation', name: 'AI Translation', defaultEnabled: true },
  { key: 'ai_ocr_handwriting', name: 'AI OCR & Handwriting Recognition', defaultEnabled: true },
  { key: 'ai_subjective_grading', name: 'AI Subjective Answer Grading (rubric + auto-grading)', defaultEnabled: true },
];

export const AI_FEATURE_DEFAULT_ON = new Set<string>(
  AI_FEATURES_REGISTRY.filter(f => f.defaultEnabled).map(f => f.key)
);

/**
 * Same enable/disable resolution SchoolFeatureGuard uses for `@SchoolFeature('ai', key)`,
 * exposed for services that need to check an AI feature inline (not at the route level) —
 * keeps the guard and inline checks from drifting apart.
 */
export function isSchoolAiFeatureEnabled(user: any, key: string): boolean {
  if (user?.role === 'SUPER_ADMIN') return true;
  if (user?.inst_ai_enabled === false) return false;
  const aiFeatures = user?.inst_ai_features || {};
  const val = aiFeatures[key];
  const defaultOn = AI_FEATURE_DEFAULT_ON.has(key);
  return val === undefined ? defaultOn : val !== false;
}
