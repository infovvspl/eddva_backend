/**
 * Lesson (AI notes) content helpers: subject-aware tutor prompts, quality
 * checks, and extraction of key concepts, formulas and common mistakes from
 * the generated markdown. Pure functions used by the learning path's notes
 * engine (originally written for the old study planner).
 */

export function extractAiText(response: any): string {
  if (!response) return '';
  if (typeof response === 'string') return response;
  const candidate =
    response.response
    ?? response.message
    ?? response.data?.response
    ?? response.data?.message
    ?? response.text
    ?? '';

  const unwrap = (v: any): string => {
    if (!v) return '';
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return unwrap(JSON.parse(trimmed));
        } catch {
          return v;
        }
      }
      return v;
    }
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) {
      return v.map((s) => String(s).trim()).filter(Boolean).join(' ');
    }
    if (typeof v === 'object' && v !== null) {
      const r =
        (typeof v.response === 'string' && v.response.trim() ? v.response : '') ||
        (typeof v.answer === 'string' && v.answer.trim() ? v.answer : '') ||
        (typeof v.message === 'string' && v.message.trim() ? v.message : '');
      if (r) return r;
      if (Array.isArray(v.hints) && v.hints.length) {
        const lines = v.hints.map((h: any) => String(h).trim()).filter(Boolean);
        return lines.join(' ');
      }
      return JSON.stringify(v);
    }
    return String(v);
  };

  return unwrap(candidate);
}

export function mapRawPracticeQuestion(q: any): { question: string; answer: string; explanation: string; options?: string[] } {
  const rawOptions = Array.isArray(q?.options) ? q.options : [];
  const options = rawOptions
    .map((o: any) => String(o?.content ?? o?.text ?? '').trim())
    .filter((v: string) => Boolean(v));
  const correctOption = rawOptions.find((o: any) => o?.isCorrect);
  const fallbackAnswer = String(q?.answer ?? '').trim();
  return {
    question: String(q?.content ?? q?.question ?? '').trim(),
    answer: String(correctOption?.content ?? fallbackAnswer).trim(),
    explanation: String(q?.explanation ?? '').trim(),
    options: options.length ? options : undefined,
  };
}

export function hasStructuredPracticeOptions(
  questions: Array<{ question: string; answer: string; explanation: string; options?: string[] }> | null | undefined,
): boolean {
  if (!Array.isArray(questions) || questions.length === 0) return false;
  return questions.some((q) => Array.isArray(q?.options) && q.options.length >= 2);
}

export function extractAiSessionRef(response: any): string | null {
  if (!response || typeof response !== 'object') return null;
  return response.sessionId ?? response.session_id ?? response.id ?? null;
}

export function normalizeSolvedExamplesFormatting(markdown: string | null | undefined): string {
  const text = String(markdown || '');
  if (!text) return text;
  return text
    .replace(/([^\n])\s*\*\*Solution:\*\*/g, '$1\n\n**Solution:**')
    .replace(/([^\n])\s*\*\*Answer:\*\*/g, '$1\n\n**Answer:**')
    .replace(/([^\n])\s*\*\*Key takeaway:\*\*/gi, '$1\n\n**Key takeaway:**')
    .replace(/([^\n])\s*\*\*Examiner's Trap:\*\*/gi, '$1\n\n**Examiner\'s Trap:**');
}

export function extractBulletSection(markdown: string, header: string): string[] {
  const regex = new RegExp(`#{2,4}\\s+[^\\n]*${header}[^\\n]*([^#]*)`, 'i');
  const match = markdown.match(regex);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
    .filter((l) => l.length > 3 && !l.startsWith('['));
}

export function buildLessonContextForPrompt(markdown: string | null | undefined): string {
  if (!markdown) return '';
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, 1200);
}

// ─── Subject classification ───────────────────────────────────────────────

export function isHumanitiesSubject(subjectName: string): boolean {
  const lower = (subjectName || '').toLowerCase().trim();
  return /history|geography|civics|political science|economics|sst|social studies|social science|english|hindi|sanskrit|urdu|language|literature|moral science|environmental studies/.test(lower);
}

export function isBiologySubject(subjectName: string): boolean {
  const lower = (subjectName || '').toLowerCase().trim();
  return /\bbiology\b|botany|zoology|life science|bioscience/.test(lower);
}

// ─── Subject-aware prompt builder ────────────────────────────────────────

export function buildSubjectPrompt(
  topic: { topic_name: string; chapter_name: string; subject_name: string },
  studentClass: string,
  targetLabel: string,
  tierCalibration: string,
): string {
  if (isBiologySubject(topic.subject_name)) {
    return buildBiologyPrompt(topic, studentClass, targetLabel, tierCalibration);
  }
  return isHumanitiesSubject(topic.subject_name)
    ? buildHumanitiesPrompt(topic, studentClass, targetLabel, tierCalibration)
    : buildSciencePrompt(topic, studentClass, targetLabel, tierCalibration);
}

export function buildBiologyPrompt(
  topic: { topic_name: string; chapter_name: string; subject_name: string },
  studentClass: string,
  targetLabel: string,
  tierCalibration: string,
): string {
  return `You are a master Biology teacher who creates clear, diagram-friendly, exam-focused school notes.

Generate a COMPLETE, THOROUGH self-study Biology lesson calibrated precisely for this student's goal. Do not use a mathematics problem-solving format.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topic.topic_name}
Chapter: ${topic.chapter_name}
Subject: ${topic.subject_name}
Class: ${studentClass}

IMPORTANT BIOLOGY STYLE RULES:
- Do NOT include algebraic derivations, numeric calculation problems, or step-by-step mathematical solutions unless the topic genuinely needs a simple percentage/ratio calculation.
- Do NOT create a "Derivations" section.
- Use biological explanations: structure, function, processes, flow, diagrams, comparisons, examples, diseases/adaptations where relevant.
- Equations are allowed only for real biological processes, such as photosynthesis or respiration. Explain them as biological process equations, not as math derivations.
- Prefer exam-style descriptive answers, labelled diagrams, flowcharts, tables, and cause-effect explanations.

---

Write the lesson using this EXACT structure. Each section must be detailed and specific to ${topic.topic_name}.

# ${topic.topic_name}

## What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters in living systems, and where students see it in real life or examinations.

## Introduction & Biological Background
Give the conceptual foundation. Explain where this topic fits in Biology, what prior ideas it builds on, and the biological intuition behind it. Minimum 150 words.

## Core Concepts (Explained in Depth)
For EACH major biological concept in this topic:
### Concept Name
- Clear definition
- Biological role or importance
- Structure/function relationship, mechanism, or example
- One quick exam tip

Cover ALL major concepts. Do not skip important terms.

## Key Structures / Processes
Use this section for organs, tissues, cells, molecules, pathways, life processes, or cycles.
For each important structure or process:
### Name
- Where it is found
- What it does
- How it works, step by step in biological language
- Why it matters

## Diagrams & Flowcharts to Practice
List labelled diagrams, flowcharts, cycles, or tables students should be able to draw for this topic.
For each one:
- **Diagram/flowchart:** name
- **Must-label parts:** important labels
- **Caption/explanation:** 2-3 lines students can write under it

## Important Terms & Definitions
Create a glossary of the key Biology terms from this topic.
- **Term:** concise exam-ready definition and one example if useful

## Comparisons & Tables
Include useful comparison tables where relevant, such as structure vs function, types, stages, kingdoms, systems, diseases, or processes.
If no comparison is relevant, include a short table of "Concept | Key point | Exam relevance".

## Biological Process Equations *(Only If Relevant)*
Include this section only when the topic has standard biological word equations or balanced equations.
Examples: photosynthesis, aerobic respiration, anaerobic respiration.
For each:
- Word equation
- Balanced equation if applicable
- Biological meaning of each reactant/product
- Conditions or location in the organism/cell
If no biological process equation applies, write: "No process equation is required for this topic."

## Exam-Style Questions & Model Answers
Provide 3 descriptive Biology questions with model answers.

### Example 1 - Basic
[Definition/short answer/diagram-based question]
**Model Answer:**
[Complete answer]
**Key points that earn marks:** ...

### Example 2 - Intermediate
[Process/comparison/function question]
**Model Answer:** ...

### Example 3 - Advanced
[Application, reasoning, diagram, disease, experiment, or HOTS-style question]
**Model Answer:** ...

## Connections to Other Topics
- How this topic links to related Biology chapters
- Any Chemistry/Physics/Environment/Health connections if genuinely relevant

## Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## Exam Strategy
- How this topic typically appears in school exams
- Diagrams, definitions, processes, and comparisons examiners expect
- How to write 2-mark, 3-mark, and 5-mark Biology answers
- Common traps in terminology and diagrams

## Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize.

## Self-Check Questions
5 questions the student should be able to answer after reading this lesson:
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete Biology content about ${topic.topic_name}.`;
}

export function buildSciencePrompt(
  topic: { topic_name: string; chapter_name: string; subject_name: string },
  studentClass: string,
  targetLabel: string,
  tierCalibration: string,
): string {
  return `You are a master teacher who has helped thousands of students crack school examinations. Your lessons are legendary for being crystal-clear, deeply comprehensive, and exam-focused.

Generate a COMPLETE, THOROUGH self-study lesson calibrated precisely for this student's goal. Do not cut corners — depth and clarity are the priority.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topic.topic_name}
Chapter: ${topic.chapter_name}
Subject: ${topic.subject_name}
Class: ${studentClass}

---

Write the lesson using this EXACT structure. Each section must be detailed — not a placeholder.

# ${topic.topic_name}

## 🎯 What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters, and what real-world phenomena it explains. Make it engaging.

## 📖 Introduction & Background
Give the conceptual foundation. Explain the "big picture" — where this topic fits in ${topic.subject_name}, what prior knowledge it builds on, and the intuition behind it. Use analogies to make abstract ideas concrete. Minimum 150 words.

## 🔑 Core Concepts (Explained in Depth)
For EACH major concept in this topic:
### Concept Name
- Clear definition
- Intuitive explanation with a relatable analogy or real-world example
- A short illustrative example

Cover ALL concepts — do not skip any.

## 📝 Formulas & Equations
INCLUDE THIS SECTION ONLY if this topic has mathematical formulas, physical laws, or chemical equations.
If this is a conceptual/descriptive chapter with no quantitative formulas (e.g. classification, ecology, cell biology, atomic structure theory), write: "No key formulas for this topic — focus is on conceptual understanding."
Otherwise, for EVERY formula or equation:
### Formula / Equation Name
$$formula or balanced chemical equation$$
- Variables / Species: define each symbol or reactant/product
- Units: state SI units (for physics/maths) or conditions (for chemistry)
- When it applies: assumptions or scope

## 📊 Derivations
INCLUDE THIS SECTION ONLY if there are standard step-by-step derivations for this topic (e.g. equations of motion, lens formula, gas laws).
For Biology chapters, use this section to write the word equation AND balanced chemical equation for key biological processes (e.g. photosynthesis, aerobic respiration, anaerobic respiration) with a brief explanation of each step.
If no derivations apply, omit this section entirely.
### Derivation of [Formula / Process Name]
Step-by-step with clear reasoning at each step.

## 💡 Solved Examples
For Maths / Physics / Chemistry: provide 3 numeric problems (Basic → Intermediate → Hard) with full step-by-step solutions.
For Biology / Computer Science: provide 3 exam-style descriptive questions with model answers (e.g. "Explain with a diagram...", "Compare and contrast...", "Trace the path of...").

### Example 1 — Basic
[Full question]
**Solution:**
Step 1: ...
Step 2: ...
**Answer:** ...
**Key takeaway:** ...

### Example 2 — Intermediate
[Full question]
**Solution:** (detailed)

### Example 3 — Advanced
[Tricky exam-style question]
**Solution:** (complete step-by-step)

## 🧠 Connections to Other Topics
- How this topic links to related topics in ${topic.subject_name}
- Topics that depend on understanding this one

## ⚠️ Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## 🏆 Exam Strategy
- How this topic typically appears in examinations
- For formula-heavy topics: which formulas are most tested and common calculation traps
- For conceptual topics: key definitions, diagrams, and comparisons examiners expect
- Marks distribution and time management tips

## 📋 Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize.

## ❓ Self-Check Questions
5 questions the student should be able to answer after reading this lesson:
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete content about ${topic.topic_name}.`;
}

export function buildHumanitiesPrompt(
  topic: { topic_name: string; chapter_name: string; subject_name: string },
  studentClass: string,
  targetLabel: string,
  tierCalibration: string,
): string {
  return `You are a master teacher who has helped thousands of students excel in school board examinations. Your notes are legendary for being comprehensive, exam-focused, and crystal-clear.

Generate a COMPLETE, THOROUGH self-study lesson for a humanities/theory subject. Do not cut corners — depth and clarity are the priority.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topic.topic_name}
Chapter: ${topic.chapter_name}
Subject: ${topic.subject_name}
Class: ${studentClass}

IMPORTANT: This is a humanities/theory subject. Do NOT include any mathematics formulas, algebraic derivations, or numeric calculation problems. Focus entirely on conceptual understanding, historical/geographical/economic analysis, and board-exam answer-writing skills.

---

Write the lesson using this EXACT structure. Each section must be detailed — not a placeholder.

# ${topic.topic_name}

## 🎯 What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters, and what it helps us understand about the world. Make it engaging.

## 📖 Introduction & Background
Give the conceptual foundation. Explain the "big picture" — the context of this topic in ${topic.subject_name}, what prior knowledge it builds on, and why it is significant. Use real-world connections to make it relatable. Minimum 150 words.

## 🔑 Core Concepts (Explained in Depth)
For EACH major concept, idea, movement, or theme in this topic:
### Concept / Term / Movement Name
- Clear definition or explanation
- Context: when, where, why it occurred or matters
- Real-world example or analogy to make it concrete

Cover ALL concepts — do not skip any.

## 🗓️ Key Events / Timeline
If this topic involves historical events, movements, policies, or chronological developments, list them:
- **[Year / Period]** — Event/development and its significance
(If this is a geography or economics topic with no timeline, replace this section with: "## 🌍 Key Facts & Data Points" listing the most important facts, statistics, or geographic features students must know.)

## 🔗 Cause & Effect / Analysis
For the major events, processes, or policies in this topic:
- **Cause / Factor:** What led to it?
- **Effect / Consequence:** What resulted from it?
- **Long-term Impact:** Why does it still matter today?

## 🌟 Important People / Places / Movements / Terms
For each key figure, place, movement, or term:
- **Name:** Who/what it is
- **Significance:** Why it matters to this topic
- **Exam relevance:** What type of question this typically appears in

## 📖 Exam-Style Questions & Model Answers
### Example 1 — Short Answer (3 marks)
[Typical board-exam question on this topic]
**Model Answer:**
[Well-structured 3-4 sentence answer hitting the key points]
**Key points that earn marks:** ...

### Example 2 — Long Answer (5 marks)
[Typical board-exam question on this topic]
**Model Answer Structure:**
- Introduction: ...
- Point 1 (with explanation): ...
- Point 2 (with explanation): ...
- Point 3 (with explanation): ...
- Conclusion: ...

### Example 3 — Source-Based / Map / Case Study Question *(if applicable)*
[A source-based or application question typical of board exams]
**How to approach and answer it:** ...

## 🧠 Connections to Other Topics
- How this topic links to other chapters in ${topic.subject_name}
- Cross-subject connections (e.g. how history links to economics or geography)

## ⚠️ Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## 🏆 Exam Strategy
- Types of questions asked from this topic (MCQ, 1-mark, 3-mark, 5-mark, source-based)
- Key names, dates, terms, and definitions to memorise
- How to structure a board-exam answer for 3-mark and 5-mark questions
- Common traps and what examiners specifically look for

## 📋 Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize for this topic.

## ❓ Self-Check Questions
5 questions the student should be able to answer after reading this lesson:
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete content about ${topic.topic_name}.`;
}

// ─── Lesson quality check ────────────────────────────────────────────────

export function shouldRegenerateLesson(markdown: string | null | undefined, subjectName?: string): boolean {
  const text = String(markdown || '');
  if (!text.trim()) return true;
  if (text.length < 4500) return true;

  const isHumanities = isHumanitiesSubject(subjectName || '');
  const isBiology = isBiologySubject(subjectName || '');

  // Humanities: only require core structural sections — no formula checks
  // Science: require solved examples and exam strategy (formulas are now optional per topic)
  const required = isHumanities || isBiology
    ? ['Core Concepts', 'Exam Strategy']
    : ['Core Concepts', 'Solved Examples', 'Exam Strategy'];

  const missingCount = required.filter((k) => !new RegExp(k, 'i').test(text)).length;
  if (missingCount >= 1) return true;

  // Check for obviously incomplete formula lines — science subjects only
  if (!isHumanities && !isBiology) {
    if (/\$[^$\n]{0,25}=\s*(?:\n|$)/m.test(text)) return true;
    if (/Derivation[\s\S]{0,120}:\s*(?:\n|$)/i.test(text)) return true;
  }

  if (/[=:]\s*$/.test(text.trim())) return true;
  return false;
}

export function extractFormulaCandidates(markdown: string): string[] {
  const lines = String(markdown || '')
    .split('\n')
    .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
    .filter(Boolean);
  const candidates = lines.filter((l) =>
    /[=∑√Δπ]/.test(l) ||
    /\b(sin|cos|tan|log|ln|velocity|acceleration|force|energy|mole|concentration|probability)\b/i.test(l),
  );
  const unique = Array.from(new Set(candidates.map((c) => c.replace(/\s+/g, ' ').trim())));
  return unique.slice(0, 10);
}
