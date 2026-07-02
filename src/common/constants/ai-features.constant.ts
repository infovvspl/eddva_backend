export const AI_FEATURES = [
  // ── Teacher features ─────────────────────────────────────────────────────
  { id: 'lecture_transcription',      label: 'Lecture Transcription',      category: 'teacher' },
  { id: 'ai_lecture_notes',           label: 'AI Lecture Notes',           category: 'teacher' },
  { id: 'in_video_quiz_generator',    label: 'In-Video Quiz Generator',    category: 'teacher' },
  { id: 'notes_image_enrichment',     label: 'Notes Image Enrichment',     category: 'teacher' },
  { id: 'retranscribe_regenerate',    label: 'Retranscribe / Regenerate',  category: 'teacher' },

  // ── Content generation ────────────────────────────────────────────────────
  { id: 'content_dpp',                label: 'Daily Assessment (DPP)',      category: 'content' },
  { id: 'content_mindmap',            label: 'Mindmap',                    category: 'content' },
  { id: 'content_pyq',                label: 'PYQ Practice',               category: 'content' },
  { id: 'content_study_guide',        label: 'Study Guide',                category: 'content' },
  { id: 'content_key_concepts',       label: 'Key Concepts',               category: 'content' },
  { id: 'content_flashcard',          label: 'Flashcards',                 category: 'content' },
  { id: 'content_revision_checklist', label: 'Revision Checklist',         category: 'content' },
  { id: 'content_faq',                label: 'FAQ',                        category: 'content' },

  // ── Student features ──────────────────────────────────────────────────────
  { id: 'doubt_resolver',             label: 'Doubt Resolver',             category: 'student' },
  { id: 'personalised_study_plan',    label: 'Personalised Study Plan',    category: 'student' },
  { id: 'career_guidance_report',     label: 'Career Guidance Report',     category: 'student' },
  { id: 'resume_analyser',            label: 'Resume Analyser',            category: 'student' },
  { id: 'interview_prep',             label: 'Interview Prep',             category: 'student' },

  // ── Shared features ───────────────────────────────────────────────────────
  { id: 'multilingual_translation',   label: 'Multilingual Translation',   category: 'shared' },
  { id: 'image_ocr_handwriting',      label: 'Image OCR / Handwriting',    category: 'shared' },
] as const;

export type AiFeatureId = typeof AI_FEATURES[number]['id'];
