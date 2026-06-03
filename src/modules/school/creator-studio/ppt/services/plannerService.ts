// @ts-nocheck
import dotenv from "dotenv";
import Groq from "groq-sdk";

import {
  getSlideCountForClass,
  getClassProfile,
  getSubjectRules,
  EDUCATIONAL_SLIDE_SEQUENCE,
  ALLOWED_LAYOUTS,
} from "../ai/curriculumConfig";

import { safeParseJSON } from "../utils/json.utils";

dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Generates a curriculum-aware presentation plan.
 * Accepts full curriculum context: classLevel, subject, board, topic.
 * Falls back gracefully to topic-only mode.
 *
 * @param {object|string} context - { classLevel, subject, board, topic } or topic string
 * @returns {object} presentation plan with slides array
 */
export const generatePresentationPlan = async (context) => {

  /*
  ==========================================
  NORMALIZE INPUT — backward compatible
  ==========================================
  */

  let classLevel, subject, board, topic;

  if (typeof context === "string") {
    // Legacy topic-only mode
    topic = context;
    classLevel = "9";
    subject = "General";
    board = "CBSE";
  } else {
    classLevel = context.classLevel || "9";
    subject = context.subject || "General";
    board = context.board || "CBSE";
    topic = context.topic || "Introduction";
  }

  /*
  ==========================================
  CURRICULUM PROFILE
  ==========================================
  */

  const slideCount = getSlideCountForClass(classLevel);
  const classProfile = getClassProfile(classLevel);
  const subjectRules = getSubjectRules(subject);

  const allowedLayouts = subjectRules.preferredLayouts.filter((l) =>
    ALLOWED_LAYOUTS.includes(l)
  );

  const educationalFlow = EDUCATIONAL_SLIDE_SEQUENCE
    .map((s) => s.replace("{topic}", topic))
    .slice(0, slideCount.target)
    .join("\n");

  /*
  ==========================================
  BUILD CURRICULUM-AWARE PROMPT
  ==========================================
  */

  const prompt = `
You are an expert educational presentation strategist working for a school.

Create a CURRICULUM-AWARE presentation plan for:

CLASS: ${classLevel}
SUBJECT: ${subject}
BOARD: ${board}
TOPIC: ${topic}

EDUCATIONAL PROFILE:
- Vocabulary level: ${classProfile.vocabularyLevel}
- Style: ${classProfile.style}
- Visual emphasis: ${classProfile.visualEmphasis}

SLIDE COUNT: Generate exactly ${slideCount.target} slides.

EDUCATIONAL SEQUENCING (follow this order):
${educationalFlow}

SUBJECT-SPECIFIC RULES:
${subjectRules.specialInstructions}

ALLOWED LAYOUTS (use intelligently based on content type):
${allowedLayouts.join(", ")}

RULES:
- Follow educational sequencing strictly
- Use different layouts intelligently — avoid repeating the same layout consecutively
- Keep slide titles concise (max 6 words)
- Make the presentation feel like a real classroom lesson
- The tone should match ${board} curriculum standards for Class ${classLevel}

Return ONLY valid JSON. No markdown. No explanation.

JSON FORMAT:
{
  "presentationTitle": "",
  "tone": "",
  "theme": "",
  "targetAudience": "Class ${classLevel} ${subject} students",
  "board": "${board}",
  "classLevel": "${classLevel}",
  "subject": "${subject}",
  "slides": [
    {
      "purpose": "",
      "layout": "",
      "title": ""
    }
  ]
}
`;

  try {

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.65,
      max_tokens: 2000,
    });

    const rawText = completion.choices[0].message.content;

    const parsed = safeParseJSON(rawText, null);

    if (!parsed || !Array.isArray(parsed.slides)) {
      throw new Error("Invalid plan structure from AI");
    }

    // Normalize layouts to only allowed types, fallback to bullets
    parsed.slides = parsed.slides.map((slide) => ({
      ...slide,
      layout: ALLOWED_LAYOUTS.includes(slide.layout) ? slide.layout : "bullets",
    }));

    // Attach curriculum context to plan
    parsed.classLevel = classLevel;
    parsed.subject = subject;
    parsed.board = board;
    parsed.topic = topic;

    return parsed;

  } catch (error) {
    console.error("❌ Presentation planning failed:", error.message);
    throw new Error("Presentation planning failed");
  }

};
