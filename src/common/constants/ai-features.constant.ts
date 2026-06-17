export const AI_FEATURES = [
  { id: 'lecture_transcription',    label: 'Lecture Transcription',      category: 'teacher' },
  { id: 'ai_lecture_notes',         label: 'AI Lecture Notes',           category: 'teacher' },
  { id: 'in_video_quiz_generator',  label: 'In-Video Quiz Generator',    category: 'teacher' },
  { id: 'notes_image_enrichment',   label: 'Notes Image Enrichment',     category: 'teacher' },
  { id: 'retranscribe_regenerate',  label: 'Retranscribe / Regenerate',  category: 'teacher' },
  { id: 'doubt_resolver',           label: 'Doubt Resolver',             category: 'student' },
  { id: 'topic_content_generation', label: 'Topic Content Generation',   category: 'student' },
  { id: 'personalised_study_plan',  label: 'Personalised Study Plan',    category: 'student' },
  { id: 'career_guidance_report',   label: 'Career Guidance Report',     category: 'student' },
  { id: 'resume_analyser',          label: 'Resume Analyser',            category: 'student' },
  { id: 'interview_prep',           label: 'Interview Prep',             category: 'student' },
  { id: 'multilingual_translation', label: 'Multilingual Translation',   category: 'shared'  },
  { id: 'image_ocr_handwriting',    label: 'Image OCR / Handwriting',    category: 'shared'  },
] as const;

export type AiFeatureId = typeof AI_FEATURES[number]['id'];
