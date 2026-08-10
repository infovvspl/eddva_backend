/**
 * Content pools for the AI Astro Profile (Demo).
 *
 * Kept separate from the generator so the wording can be expanded, translated or
 * tuned by someone who is not touching the selection logic. Every list here is
 * safe to grow: the generator indexes into these arrays by a hash-derived
 * cursor, so adding entries changes which profile a given student gets but never
 * breaks generation.
 *
 * Everything is phrased as possibility rather than prediction — "may enjoy",
 * "appears to", "suggests" — because this is an illustrative demo, not an
 * assessment.
 */

export interface TraitDef {
  key: string;
  label: string;
  /** Shown under the score. Written to be true of a high score. */
  blurb: string;
}

export interface CareerDef {
  key: string;
  label: string;
  /** Why this profile might suit the career. Never states it will happen. */
  rationale: string;
}

/** Section 2 — Personality Profile. */
export const PERSONALITY_TRAITS: TraitDef[] = [
  { key: 'leadership',   label: 'Leadership',             blurb: 'You appear comfortable taking initiative when a group needs direction.' },
  { key: 'creativity',   label: 'Creativity',             blurb: 'This profile suggests you enjoy finding your own way to a solution.' },
  { key: 'curiosity',    label: 'Curiosity',              blurb: 'You may be drawn to questions that go beyond what was asked.' },
  { key: 'discipline',   label: 'Discipline',             blurb: 'You appear able to keep going once you have committed to something.' },
  { key: 'communication',label: 'Communication',          blurb: 'You may find it natural to explain your thinking to others.' },
  { key: 'confidence',   label: 'Confidence',             blurb: 'This profile suggests you are willing to attempt unfamiliar work.' },
  { key: 'empathy',      label: 'Emotional Intelligence', blurb: 'You appear to notice how others in a group are feeling.' },
  { key: 'logic',        label: 'Logical Thinking',       blurb: 'You may enjoy breaking a problem into orderly steps.' },
];

/** Section 3 — Learning Style. */
export const LEARNING_TRAITS: TraitDef[] = [
  { key: 'visual',     label: 'Visual Learner',    blurb: 'Diagrams and colour-coded notes may help ideas stay with you.' },
  { key: 'practical',  label: 'Practical Learner', blurb: 'You may understand a concept best once you have tried it yourself.' },
  { key: 'reading',    label: 'Reading Learner',   blurb: 'Written explanations may suit you more than spoken ones.' },
  { key: 'auditory',   label: 'Auditory Learner',  blurb: 'Discussing a topic aloud may help it settle in your mind.' },
  { key: 'retention',  label: 'Memory Retention',  blurb: 'You appear to hold on to material once you have revised it properly.' },
  { key: 'problem',    label: 'Problem Solving',   blurb: 'You may enjoy questions that do not have an obvious first step.' },
  { key: 'creative',   label: 'Creative Thinking', blurb: 'You appear willing to try an unusual approach before a standard one.' },
  { key: 'focus',      label: 'Focus',             blurb: 'You may work well in longer, uninterrupted stretches.' },
  { key: 'attention',  label: 'Attention Span',    blurb: 'This profile suggests you can stay with a task once you begin.' },
];

/** Section 4 — Academic Potential. */
export const ACADEMIC_SUBJECTS: TraitDef[] = [
  { key: 'mathematics', label: 'Mathematics', blurb: 'Patterns and structured reasoning may appeal to you.' },
  { key: 'science',     label: 'Science',     blurb: 'You may enjoy testing an idea rather than accepting it.' },
  { key: 'languages',   label: 'Languages',   blurb: 'Expression and nuance may come naturally to you.' },
  { key: 'arts',        label: 'Arts',        blurb: 'You appear to enjoy work with room for personal interpretation.' },
  { key: 'commerce',    label: 'Commerce',    blurb: 'You may find real-world systems and decisions interesting.' },
  { key: 'technology',  label: 'Technology',  blurb: 'Building something that works may be satisfying for you.' },
];

/** Section 5 — Career Compatibility. */
export const CAREERS: CareerDef[] = [
  { key: 'ai_engineer',   label: 'AI Engineer',        rationale: 'Blends logical structure with room to invent — a combination this profile leans toward.' },
  { key: 'software_eng',  label: 'Software Engineer',  rationale: 'Rewards patient problem-solving and steady practice.' },
  { key: 'doctor',        label: 'Doctor',             rationale: 'Suits sustained discipline paired with genuine concern for people.' },
  { key: 'scientist',     label: 'Scientist',          rationale: 'Built around curiosity and a willingness to be proved wrong.' },
  { key: 'entrepreneur',  label: 'Entrepreneur',       rationale: 'Favours initiative and comfort with uncertainty.' },
  { key: 'professor',     label: 'Professor',          rationale: 'Combines deep subject interest with explaining it clearly.' },
  { key: 'ias_officer',   label: 'IAS Officer',        rationale: 'Asks for broad reading, composure and long-term consistency.' },
  { key: 'researcher',    label: 'Researcher',         rationale: 'Rewards patience with detail and following a question a long way.' },
  { key: 'business_owner',label: 'Business Owner',     rationale: 'Draws on decision-making and reading a situation quickly.' },
  { key: 'teacher',       label: 'Teacher',            rationale: 'Rests on patience and making a hard idea feel simple.' },
  { key: 'psychologist',  label: 'Psychologist',       rationale: 'Suits careful listening and interest in why people act as they do.' },
  { key: 'designer',      label: 'Designer',           rationale: 'Balances creative instinct with solving a practical problem.' },
];

/** Section 6 — Strength Analysis. */
export const STRENGTHS: TraitDef[] = [
  { key: 'leadership',  label: 'Leadership',          blurb: 'Others may look to you when a group needs a decision.' },
  { key: 'confidence',  label: 'Confidence',          blurb: 'You appear willing to speak up for an idea you believe in.' },
  { key: 'communication', label: 'Communication',     blurb: 'You may put things in a way that others follow easily.' },
  { key: 'discipline',  label: 'Discipline',          blurb: 'You appear to finish what you start.' },
  { key: 'innovation',  label: 'Innovation',          blurb: 'You may look for a better way rather than the usual way.' },
  { key: 'decision',    label: 'Decision Making',     blurb: 'You appear able to choose without over-thinking it.' },
  { key: 'teamwork',    label: 'Teamwork',            blurb: 'You may bring out steadier work from the people around you.' },
  { key: 'analytical',  label: 'Analytical Thinking', blurb: 'You appear to separate what matters from what does not.' },
];

/** Section 7 — Growth Areas. Always framed as an opportunity, never a deficit. */
export const GROWTH_AREAS: TraitDef[] = [
  { key: 'time',        label: 'Time Management',    blurb: 'Planning the week in advance could make your study feel lighter.' },
  { key: 'concentration', label: 'Concentration',    blurb: 'Shorter, fully focused sessions could get you further than long ones.' },
  { key: 'revision',    label: 'Revision Habits',    blurb: 'Revisiting a topic a few days later could lock it in.' },
  { key: 'speaking',    label: 'Public Speaking',    blurb: 'Small chances to present could build this quickly.' },
  { key: 'stress',      label: 'Stress Management',  blurb: 'A steady routine before exams could keep you at your best.' },
  { key: 'consistency', label: 'Consistency',        blurb: 'A little every day could outperform occasional long sessions.' },
  { key: 'selfbelief',  label: 'Confidence Building',blurb: 'Noting what went well each week could build momentum.' },
];

/** Section 8 — Future Growth Timeline. Order is fixed; the copy varies. */
export const TIMELINE_STAGES = [
  { key: 'current',    label: 'Current Stage',       lines: [
    'You are building the habits the next stage will rest on.',
    'This is the point where curiosity matters more than results.',
    'Foundations are forming — steadiness counts more than speed here.',
  ]},
  { key: 'learning',   label: 'Learning Growth',     lines: [
    'Topics that felt difficult may start to connect.',
    'Understanding tends to deepen once revision becomes routine.',
    'This is usually where effort begins to show its return.',
  ]},
  { key: 'skills',     label: 'Skill Development',   lines: [
    'Strengths become recognisable, to you and to others.',
    'Practice starts turning into something you can rely on.',
    'You may find a subject or skill you want to go further with.',
  ]},
  { key: 'confidence', label: 'Academic Confidence', lines: [
    'Familiar work stops feeling like a test.',
    'You may begin helping others with what you have understood.',
    'Confidence usually follows competence, in that order.',
  ]},
  { key: 'readiness',  label: 'Career Readiness',    lines: [
    'Interests start pointing in a clearer direction.',
    'Choices narrow — not because options close, but because preferences sharpen.',
    'This is where earlier consistency tends to pay off.',
  ]},
  { key: 'success',    label: 'Future Success',      lines: [
    'Whatever you choose, the habits built now travel with you.',
    'Success here means steady progress in a direction you chose.',
    'The path stays yours to shape.',
  ]},
];

/** Section 9 — Study Suggestions. */
export const STUDY_SESSIONS = [
  'Early morning (6:00 – 8:00 AM)',
  'Late morning (9:00 – 11:00 AM)',
  'Afternoon (3:00 – 5:00 PM)',
  'Early evening (5:00 – 7:00 PM)',
  'Night (8:00 – 10:00 PM)',
];

export const DAILY_DURATIONS = [
  '1.5 – 2 hours, split into focused blocks',
  '2 – 2.5 hours across two sittings',
  '2.5 – 3 hours with proper breaks',
  '3 hours, ideally not in one stretch',
];

export const BREAK_PATTERNS = [
  '25 minutes of study, 5 minutes away from the desk',
  '40 minutes of study, 10 minutes to reset',
  '50 minutes of study, 10 minutes of movement',
];

export const REVISION_ADVICE = [
  'Revisit a new topic the next day, then again after a week.',
  'Close the book and write what you remember before checking.',
  'Explain the topic aloud as if teaching a classmate.',
  'Turn each chapter into five questions and answer them from memory.',
];

export const WEEKLY_GOALS = [
  'Finish one chapter properly rather than three partly.',
  'Attempt one past paper under timed conditions.',
  'Clear every doubt from the week before the weekend ends.',
  'Teach one topic to someone else — it shows what you actually know.',
];

export const QUOTES = [
  { text: 'Small steps, taken daily, go further than big steps taken rarely.', author: 'Study wisdom' },
  { text: 'The expert in anything was once a beginner who kept going.', author: 'Helen Hayes' },
  { text: 'You do not have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'Effort compounds quietly, then all at once.', author: 'Study wisdom' },
  { text: 'Curiosity is the engine; discipline is the steering.', author: 'Study wisdom' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
];

/** Phrases woven into the AI Summary. Deliberately non-deterministic in tone. */
export const SUMMARY_OPENERS = [
  'This profile suggests a learner who',
  'The pattern here points to someone who',
  'Taken together, these signals describe a student who',
];

export const SUMMARY_CLOSERS = [
  'With continued effort, this is a profile that could go a long way.',
  'None of this is fixed — it is a starting point, not a verdict.',
  'What matters most from here is consistency, not any single strength.',
];

/** Shown on every report. Required, never optional. */
export const DEMO_DISCLAIMER =
  'AI-generated illustrative insights for demonstration purposes only. ' +
  'This report should not be treated as scientific, educational, psychological, ' +
  'medical, or astrological advice.';
