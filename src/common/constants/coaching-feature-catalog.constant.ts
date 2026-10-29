import { AI_FEATURES, COACHING_LANGUAGES } from '../../database/entities/tenant.entity';

export type FeatureCategory = 'ai' | 'non_ai' | 'language';

export interface CoachingFeatureCatalogEntry {
  key: string;
  label: string;
  description: string;
  category: FeatureCategory;
}

/**
 * Single source of truth for every coaching-side, per-institute toggle shown
 * in the super-admin feature-control UI. Keys here are the only ones the
 * backend actually enforces (see ai-feature.guard.ts for AI, SchoolFeatureGuard
 * has a separate school-side registry — this one is coaching-only).
 */
export const COACHING_FEATURE_CATALOG: CoachingFeatureCatalogEntry[] = [
  // ── AI features — keys match AI_FEATURES in tenant.entity.ts exactly ──────
  { key: 'ai_lecture_processing', label: 'Lecture Processing', description: 'Transcription, AI notes, and in-video quiz generation for lectures', category: 'ai' },
  { key: 'ai_doubt_solver', label: 'Doubt Solver', description: 'Automated AI answers for student doubts, with teacher escalation', category: 'ai' },
  { key: 'ai_learning_assistant', label: 'Learning Assistant', description: 'AI self-study sessions and personalised study plans', category: 'ai' },
  { key: 'ai_student_insights', label: 'Student Insights', description: 'AI-driven performance analytics and progress tracking', category: 'ai' },
  { key: 'ai_assessment_grading', label: 'Assessment Grading', description: 'AI-assisted grading for subjective/mock test answers', category: 'ai' },
  { key: 'ai_content_generation', label: 'Content Generation', description: 'Auto-generate DPPs, mindmaps, flashcards, and other study material', category: 'ai' },
  { key: 'ai_battle_arena', label: 'AI Battle Arena', description: 'AI-generated bot opponents for competitive quiz battles', category: 'ai' },

  // ── Non-AI / platform modules — keys match Tenant.metadata.modulesPermissions ──
  { key: 'live_lectures', label: 'Live Lectures', description: 'Teachers can host and students can join live classes', category: 'non_ai' },
  { key: 'recorded_lectures', label: 'Recorded Lectures', description: 'Upload, manage, and process recorded classes', category: 'non_ai' },
  { key: 'mock_tests', label: 'Mock Tests', description: 'Create and assign full-length mock tests', category: 'non_ai' },
  { key: 'doubt_queue', label: 'Doubt Queue', description: 'Students can raise doubts for teachers to answer', category: 'non_ai' },
  { key: 'leaderboard', label: 'Leaderboard', description: 'Peer rankings and gamified performance', category: 'non_ai' },
  { key: 'calendar', label: 'Calendar', description: 'Institute-wide event and class scheduling', category: 'non_ai' },
  { key: 'pyq_bank', label: 'PYQ Bank', description: 'Previous year question bank for exam prep', category: 'non_ai' },
  { key: 'content_library', label: 'Content Library', description: 'Central repository for study materials', category: 'non_ai' },
  { key: 'notifications', label: 'Notifications', description: 'Push and email announcements to students', category: 'non_ai' },

  // ── Languages — keys match COACHING_LANGUAGES in tenant.entity.ts ────────
  { key: 'en', label: 'English', description: 'Content and notifications in English', category: 'language' },
  { key: 'hi', label: 'Hindi', description: 'Content and notifications in Hindi', category: 'language' },
  { key: 'or', label: 'Odia', description: 'Content and notifications in Odia', category: 'language' },
];

// Fails fast at startup if this catalog ever drifts from the enforced key sets.
const catalogAiKeys = COACHING_FEATURE_CATALOG.filter((f) => f.category === 'ai').map((f) => f.key).sort();
const catalogLanguageKeys = COACHING_FEATURE_CATALOG.filter((f) => f.category === 'language').map((f) => f.key).sort();
if (JSON.stringify(catalogAiKeys) !== JSON.stringify([...AI_FEATURES].sort())) {
  throw new Error('COACHING_FEATURE_CATALOG AI keys have drifted from AI_FEATURES in tenant.entity.ts');
}
if (JSON.stringify(catalogLanguageKeys) !== JSON.stringify([...COACHING_LANGUAGES].sort())) {
  throw new Error('COACHING_FEATURE_CATALOG language keys have drifted from COACHING_LANGUAGES in tenant.entity.ts');
}
