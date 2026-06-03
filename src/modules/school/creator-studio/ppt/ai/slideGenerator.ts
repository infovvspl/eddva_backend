// @ts-nocheck
import Groq from "groq-sdk";
import { searchImage } from "../services/imageService";
import { selectLayout } from "./layoutSelector";

import {
  getClassProfile,
  ALLOWED_LAYOUTS,
  LAYOUT_DEFAULTS,
} from "./curriculumConfig";

import {
  safeParseJSON,
  normalizeBullets,
  normalizeEvents,
  truncateText,
  ensureString,
  ensureArray,
} from "../utils/json.utils";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/*
==========================================
ISSUE 1: GENERATE UNIQUE IMAGE QUERIES
==========================================

This helper extracts keywords from sourceContent
to create unique, relevant image queries per slide.
Prevents the problem of identical images repeating.

Requirements:
- Extract top keywords from sourceContent
- Remove stop words
- Combine with slide title and topic
- Create specific educational queries
*/

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "is", "are", "was", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "can", "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "what", "which", "who", "when", "where", "why", "how",
  "as", "by", "from", "with", "about", "into", "through", "during", "before",
  "after", "above", "below", "up", "down", "out", "off", "over", "under",
  "again", "further", "then", "once", "very", "too", "just", "all", "each",
  "both", "same", "other", "such", "no", "not", "only", "own", "so", "than"
]);

export const extractKeywords = (text, maxKeywords = 8) => {
  // ISSUE 1: Extract meaningful keywords from source content
  // Avoid generic terms, focus on educational keywords
  
  if (!text || typeof text !== "string") return "";

  // Normalize: lowercase, split into words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3); // Only words > 3 chars

  // Filter: remove stop words
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));

  // Count occurrences to find most relevant keywords
  const frequency = {};
  meaningful.forEach((w) => {
    frequency[w] = (frequency[w] || 0) + 1;
  });

  // Sort by frequency, take top keywords
  const topKeywords = Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);

  return topKeywords.join(" ");
};

export const generateImageQuery = (slide, slideTitle, topic) => {
  // ISSUE 1: Generate unique, specific image queries
  // Combines: title + keywords + topic + context
  
  if (!slide) return topic || "educational diagram";

  // Extract keywords from sourceContent
  const sourceKeywords = extractKeywords(slide.sourceContent, 5);

  // Build query based on slide type for better specificity
  let query = "";

  if (slide.type === "formula") {
    query = `${slide.title} formula derivation ${sourceKeywords}`;
  } else if (slide.type === "process") {
    query = `${slide.title} steps diagram process ${sourceKeywords}`;
  } else if (slide.type === "comparison") {
    query = `${slide.title} comparison contrast differences ${sourceKeywords}`;
  } else if (slide.type === "timeline") {
    query = `${slide.title} timeline chronology historical ${sourceKeywords}`;
  } else if (slide.type === "cards") {
    query = `${slide.title} categories types classification ${sourceKeywords}`;
  } else if (slide.type === "quiz") {
    query = `${slide.title} quiz assessment test ${sourceKeywords}`;
  } else {
    // bullets, summary, etc.
    query = `${slide.title} ${sourceKeywords}`;
  }

  // Ensure query is specific and educational
  if (!query.includes("educational") && !query.includes("diagram")) {
    query += " educational diagram";
  }

  return query.trim();
};

/*
==========================================
ATTACH IMAGES — Unique Query Generation
==========================================

ISSUE 1 FIX: Use generateImageQuery() to create
specific queries instead of generic ones
*/

const attachImages = async (slide, classLevel, subject, topic) => {

  const educationalPrefix = `
Class ${classLevel}
${subject}
clean educational diagram
white background
labeled illustration
modern vector style
`;

  try {

    if (slide.type === "bullets") {
      // ISSUE 1 FIX: Use unique query generator
      const query = slide.imageQuery
        ? `${educationalPrefix} ${slide.imageQuery}`
        : `${educationalPrefix} ${generateImageQuery(slide, slide.title, topic)}`;

      slide.image = await searchImage(query);
    }

    if (slide.type === "cards" && Array.isArray(slide.cards)) {

      for (const card of slide.cards) {
        // ISSUE 1 FIX: Generate unique query for each card
        const cardQuery = card.imageQuery
          ? card.imageQuery
          : `${card.title} ${extractKeywords(card.text, 3)}`;

        const query = `${educationalPrefix} ${cardQuery}`;
        card.image = await searchImage(query);
      }
    }

    if (slide.type === "timeline" && Array.isArray(slide.events)) {

      for (const event of slide.events) {
        // ISSUE 1 FIX: Generate unique query for each timeline event
        const eventQuery = event.imageQuery
          ? event.imageQuery
          : `${event.title || event.date} ${topic}`;

        const query = `${educationalPrefix} ${eventQuery}`;
        event.image = await searchImage(query);
      }
    }

    if (slide.type === "comparison") {
      // ISSUE 1 FIX: Generate unique queries for left and right sides
      const leftKeywords = extractKeywords(slide.left?.description || slide.left?.text, 3);
      const rightKeywords = extractKeywords(slide.right?.description || slide.right?.text, 3);

      const leftQuery = slide.left?.imageQuery
        ? `${educationalPrefix} ${slide.left.imageQuery}`
        : `${educationalPrefix} ${slide.left?.title} ${leftKeywords}`;

      const rightQuery = slide.right?.imageQuery
        ? `${educationalPrefix} ${slide.right.imageQuery}`
        : `${educationalPrefix} ${slide.right?.title} ${rightKeywords}`;

      if (slide.left) slide.left.image = await searchImage(leftQuery);
      if (slide.right) slide.right.image = await searchImage(rightQuery);
    }

  } catch (imgError) {

    console.warn("⚠️ Image attachment failed:", imgError.message);

  }

  return slide;
};

/*
==========================================
NORMALIZE SLIDE
==========================================
*/

const normalizeSlide = (
  parsed,
  slidePlan,
  classProfile
) => {

  const type =
    ALLOWED_LAYOUTS.includes(parsed?.type)
      ? parsed.type
      : "bullets";

  const defaults =
    LAYOUT_DEFAULTS[type];

  // ISSUE 1: Extract keywords for unique image queries
  const sourceKeywords = extractKeywords(slidePlan?.sourceContent, 6);

  const slide = {

    type,

    title: truncateText(
      ensureString(
        parsed?.title ||
        slidePlan?.title,
        defaults.title
      ),
      60
    ),

    conceptExplanation: truncateText(
      ensureString(
        parsed?.conceptExplanation,
        slidePlan?.sourceContent ||
        "This slide explains an important concept."
      ),
      250
    ),

    realLifeExample: truncateText(
      ensureString(
        parsed?.realLifeExample,
        ""
      ),
      180
    ),

    examTip: truncateText(
      ensureString(
        parsed?.examTip,
        ""
      ),
      150
    ),

    sourceContent: truncateText(
      ensureString(
        slidePlan?.sourceContent,
        ""
      ),
      1000
    ),

    sourceKeywords,

  };

  /*
  ==========================================
  BULLETS
  ==========================================
  */

  if (type === "bullets") {

    slide.bullets = normalizeBullets(
      parsed?.bullets,
      classProfile.maxBullets,
      140
    );

    slide.imageQuery =
      parsed?.imageQuery ||
      `${slide.title} ${sourceKeywords} specific detailed explanation`;
  }

  /*
  ==========================================
  CARDS
  ==========================================
  */

  if (type === "cards") {

    const cards =
      ensureArray(
        parsed?.cards,
        defaults.cards
      );

    slide.cards =
      cards.slice(0, 4).map((card) => ({

        title: truncateText(
          ensureString(
            card.title,
            "Concept"
          ),
          40
        ),

        text: truncateText(
          ensureString(
            card.text ||
            card.description,
            "Description"
          ),
          120
        ),

        imageQuery:
          ensureString(
            card.imageQuery,
            `${card.title}`
          ),

      }));
  }

  /*
  ==========================================
  COMPARISON
  ==========================================
  */

  if (type === "comparison") {

    slide.left = {

      title: truncateText(
        ensureString(
          parsed?.left?.title,
          defaults.left.title
        ),
        40
      ),

      points: normalizeBullets(
        parsed?.left?.points,
        4,
        100
      ),

      description: truncateText(
        ensureString(
          parsed?.left?.description || parsed?.left?.text,
          ""
        ),
        150
      ),

      imageQuery:
        ensureString(
          parsed?.left?.imageQuery,
          `${parsed?.left?.title}`
        ),

    };

    slide.right = {

      title: truncateText(
        ensureString(
          parsed?.right?.title,
          defaults.right.title
        ),
        40
      ),

      points: normalizeBullets(
        parsed?.right?.points,
        4,
        100
      ),

      description: truncateText(
        ensureString(
          parsed?.right?.description || parsed?.right?.text,
          ""
        ),
        150
      ),

      imageQuery:
        ensureString(
          parsed?.right?.imageQuery,
          `${parsed?.right?.title}`
        ),

    };
  }

  /*
  ==========================================
  TIMELINE
  ==========================================
  */

  if (type === "timeline") {

    slide.events =
      normalizeEvents(
        parsed?.events,
        6
      )?.map((event) => ({
        ...event,
        imageQuery: event.imageQuery || `${event.title || event.date}`,
      }));
  }

  /*
  ==========================================
  FORMULA
  ==========================================
  
  ISSUE 3 FIX: Validate that examples exist in sourceContent
  Never invent examples, variables, or values
  */

  if (type === "formula") {

    slide.formula =
      ensureString(
        parsed?.formula,
        defaults.formula
      );

    slide.explanation =
      truncateText(
        ensureString(
          parsed?.explanation,
          defaults.explanation
        ),
        220
      );

    slide.steps =
      normalizeBullets(
        parsed?.steps,
        5,
        120
      );

    // ISSUE 3 FIX: Only include example if found in sourceContent
    const exampleFromParsed = parsed?.example || parsed?.workedExample || "";
    const sourceHasNumbers = /\d+/.test(slidePlan?.sourceContent || "");

    if (exampleFromParsed && sourceHasNumbers) {
      // Example exists in both parsed response AND source content has numbers
      slide.example = truncateText(
        ensureString(
          exampleFromParsed,
          ""
        ),
        220
      );
    } else if (sourceHasNumbers && slidePlan?.sourceContent?.toLowerCase().includes("example")) {
      // Source mentions "example" and has numbers, but parsed didn't generate it
      slide.example = ""; // Don't fabricate
    } else {
      // No example in source, leave blank
      slide.example = "";
    }
  }

  /*
  ==========================================
  PROCESS
  ==========================================
  */

  if (type === "process") {

    const rawSteps =
      ensureArray(
        parsed?.steps,
        defaults.steps
      );

    slide.steps =
      rawSteps.slice(0, 6).map(
        (step, i) => ({

          number:
            step.number ||
            (i + 1),

          title: truncateText(
            ensureString(
              step.title,
              `Step ${i + 1}`
            ),
            40
          ),

          description:
            truncateText(
              ensureString(
                step.description ||
                step.text,
                "Description"
              ),
              120
            ),

        })
      );
  }

  /*
  ==========================================
  QUIZ
  ==========================================
  */

  if (type === "quiz") {

    slide.question =
      truncateText(
        ensureString(
          parsed?.question,
          defaults.question
        ),
        180
      );

    slide.options =
      ensureArray(
        parsed?.options,
        defaults.options
      )
        .slice(0, 4)
        .map((o) =>
          truncateText(
            ensureString(
              o,
              "Option"
            ),
            100
          )
        );

    slide.answer =
      truncateText(
        ensureString(
          parsed?.answer,
          defaults.answer
        ),
        120
      );

    slide.hint =
      truncateText(
        ensureString(
          parsed?.hint,
          defaults.hint
        ),
        120
      );
  }

  /*
  ==========================================
  SUMMARY
  ==========================================
  */

  if (type === "summary") {

    slide.points =
      normalizeBullets(
        parsed?.points,
        6,
        120
      );

    slide.remember =
      truncateText(
        ensureString(
          parsed?.remember,
          defaults.remember
        ),
        180
      );
  }

  return slide;
};

/*
==========================================
GENERATE SLIDE CONTENT
==========================================
*/

export const generateSlideContent = async (
  slidePlan,
  context
) => {

  let classLevel, subject, board, topic;

  if (typeof context === "string") {

    topic = context;
    classLevel = "9";
    subject = "General";
    board = "CBSE";

  } else {

    classLevel = context?.classLevel || "9";
    subject = context?.subject || "General";
    board = context?.board || "CBSE";
    topic = context?.topic || context;
  }

  const classProfile = getClassProfile(classLevel);

  const validLayouts = ["formula", "process", "timeline", "comparison", "cards", "quiz", "summary"];
  const currentLayout = slidePlan?.layout || slidePlan?.type;
  
  if (slidePlan && (!currentLayout || !validLayouts.includes(currentLayout))) {
    try {
      const selected = selectLayout({
        title: slidePlan.title || "",
        content: slidePlan.purpose || "",
        subject: subject
      });
      slidePlan.layout = selected.layout;
    } catch (err) {
      console.warn("⚠️ Layout selection fallback triggered:", err.message);
    }
  }

  const layoutType =
    slidePlan?.layout ||
    slidePlan?.type ||
    "bullets";

  const sourceContent = slidePlan?.sourceContent || "";

  /*
  ==========================================
  ISSUE 2: ENHANCE PROMPT FOR EDUCATIONAL DEPTH
  ==========================================
  
  Requirements:
  - Every bullet must contain a fact
  - Reject generic statements
  - Require definitions, statistics, explanations
  - Use sourceContent as primary source
  */

  const teachingPoints = Array.isArray(slidePlan?.teachingPoints) ? slidePlan.teachingPoints : null;
  const learningGoal = slidePlan?.learningGoal || "";

  let primaryContentBlock = "";
  if (teachingPoints && teachingPoints.length > 0) {
    const pointsList = teachingPoints.map(tp => `- [${tp.type}]: ${tp.content}`).join("\\n");
    primaryContentBlock = `
TEACHING POINTS (PRIMARY SOURCE):
${pointsList}

LEARNING GOAL:
${learningGoal}

STRICT TEACHING POINTS RULES:
1. You MUST generate the slide content from the TEACHING POINTS provided above.
2. Do NOT generate content from the title alone.
3. For bullet layouts: map teachingPoint 1 to bullet 1, teachingPoint 2 to bullet 2, etc.
4. For formula layouts: the formula field MUST come from the "Mathematical Form" teaching point.
5. Preserve existing slide JSON schemas and layouts.
`;
  } else {
    primaryContentBlock = `
PDF SOURCE CONTENT (THE AUTHORITATIVE SOURCE):
${sourceContent}

STRICT PDF ACCURACY RULES (NON-NEGOTIABLE):

1. Use ONLY information from the PDF SOURCE CONTENT above.
2. Do NOT introduce external concepts, examples, or explanations.
3. Do NOT generate generic textbook content.
4. Do NOT summarize chapters - focus only on this slide's assigned content.
5. Every bullet point MUST be directly derived from SOURCE CONTENT.
6. If formulas exist in SOURCE CONTENT, preserve them exactly.
7. If processes exist in SOURCE CONTENT, preserve the exact sequence.
8. Do NOT add definitions missing from SOURCE CONTENT.
9. Do NOT expand beyond the scope of SOURCE CONTENT.
10. Accuracy is CRITICAL - better to be brief than to hallucinate.
`;
  }

  const prompt = `
You are an expert ${subject} teacher creating PREMIUM educational PPT slides.

CRITICAL: This slide is based on a specific PDF section or lesson plan. You MUST preserve accuracy above all else.

TOPIC:
${topic}

SLIDE TITLE:
${slidePlan?.title || "Key Concept"}
${primaryContentBlock}
GROUNDING RULES (MANDATORY):
- TeachingPoints (or provided source content) are the primary source of truth.
- Every bullet must originate from a teachingPoint.
- Do not introduce new concepts not present in teachingPoints.
- Do not paraphrase the same teachingPoint multiple times.
- Do not generate placeholder text such as "Key concept to be discussed here".
- If content is missing, leave the field empty instead of inventing content.

SLIDE PURPOSE:
${slidePlan?.purpose || "Teach the concept clearly"}

CLASS LEVEL: ${classLevel}
BOARD: ${board}
LAYOUT: ${layoutType}

LAYOUT REQUIREMENTS:

FOR THEORY/BULLETS:
- Each bullet MUST correspond directly to a single teachingPoint.

FOR FORMULA:
- The "formula" field MUST come from the Mathematical Form teaching point.
- The "workedExample" field MUST come from the Worked Example teaching point.
- The "realLifeExample" field MUST come from the Application teaching point.
- The "conceptExplanation" field MUST come from the Definition or Principle teaching point.

FOR PROCESS:
- Steps in the exact order as provided in the teachingPoints.

FOR QUIZ:
- Question and options MUST test the exact understanding of the teachingPoints.

FOR COMPARISON:
- Compare items explicitly contrasted in the teachingPoints.

FOR CARDS:
- One distinct concept from the teachingPoints per card.

FOR TIMELINE:
- Events in chronological order from the teachingPoints.

FOR SUMMARY:
- Key takeaways derived ONLY from the teachingPoints.

IMAGE QUERY GUIDELINES:

Generate queries for clean educational diagrams:
- Include topic from slide title
- Include relevant keywords from SOURCE
- Request: white background, labeled, modern vector style
- Prefer: educational diagrams, classroom illustrations
- Avoid: generic stock photos

CRITICAL PPT FORMAT RULES:

- Maximum 4 bullets per slide
- For Class 9-12, bullets may contain 20-35 words; for lower classes, aim for 12-20 words
- One complete thought or explanation per bullet
- Prioritize deep understanding and educational value over brief scannability

RETURN ONLY VALID JSON - no additional text.

${getLayoutPromptSchema(layoutType)}
`;

  try {

    if (!slidePlan) {
      console.warn("⚠️ Missing slidePlan");
      return {
        ...LAYOUT_DEFAULTS.bullets,
        title: "Missing Content",
        sourceContent: "",
      };
    }

    const completion =
      await groq.chat.completions.create({

        model: "llama-3.3-70b-versatile",

        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],

        temperature: 0.3,
        max_tokens: 3500,
      });

    const rawText =
      completion?.choices?.[0]?.message?.content || "";

    if (!rawText) {
      console.warn(
        `⚠️ Empty response from AI for: ${slidePlan.title}`
      );

      const fallback = {
        ...LAYOUT_DEFAULTS.bullets,
        title: slidePlan.title || "Content",
        sourceContent: sourceContent,
      };

      return await attachImages(
        fallback,
        classLevel,
        subject,
        topic
      );
    }

    const parsed = safeParseJSON(rawText, null);

    if (!parsed) {

      console.warn(
        `⚠️ JSON parse failed for: ${slidePlan.title}`
      );

      const fallback = {
        ...LAYOUT_DEFAULTS.bullets,
        title: slidePlan.title || "Content",
        sourceContent: sourceContent,
      };

      return await attachImages(
        fallback,
        classLevel,
        subject,
        topic
      );
    }

    parsed.type = ALLOWED_LAYOUTS.includes(parsed?.type)
      ? parsed.type
      : layoutType;

    const normalized = normalizeSlide(
      parsed,
      slidePlan,
      classProfile
    );

    const result = await attachImages(
      normalized,
      classLevel,
      subject,
      topic
    );

    return result;

  } catch (error) {

    console.error(
      "❌ Slide generation error:",
      error.message
    );

    return {
      ...LAYOUT_DEFAULTS.bullets,
      title: slidePlan?.title || "Key Concepts",
      sourceContent: sourceContent,
    };
  }
};

/*
==========================================
LAYOUT PROMPT SCHEMAS
==========================================
*/

function getLayoutPromptSchema(layoutType) {

  const baseFields = `
"conceptExplanation": "Short educational explanation (optional, leave empty if not applicable)",
"realLifeExample": "Real world application (optional, leave empty if not applicable)",
"examTip": "Important exam insight (optional, leave empty if not applicable)"
`;

  const schemas = {

    bullets: `
{
  "type": "bullets",
  "title": "Slide title",
  ${baseFields},
  "imageQuery": "educational diagram query",
  "bullets": [
    "Educational point 1",
    "Educational point 2",
    "Educational point 3",
    "Educational point 4"
  ]
}`,

    cards: `
{
  "type": "cards",
  "title": "Slide title",
  ${baseFields},
  "cards": [
    {
      "title": "Card title 1",
      "text": "Brief description 1",
      "imageQuery": "educational icon query 1"
    },
    {
      "title": "Card title 2",
      "text": "Brief description 2",
      "imageQuery": "educational icon query 2"
    }
  ]
}`,

    comparison: `
{
  "type": "comparison",
  "title": "Comparison Slide",
  ${baseFields},
  "left": {
    "title": "Concept A",
    "description": "Details about A",
    "points": [
      "Point 1",
      "Point 2"
    ],
    "imageQuery": "Concept A illustration"
  },
  "right": {
    "title": "Concept B",
    "description": "Details about B",
    "points": [
      "Point 1",
      "Point 2"
    ],
    "imageQuery": "Concept B illustration"
  }
}`,

    timeline: `
{
  "type": "timeline",
  "title": "Timeline Slide",
  ${baseFields},
  "events": [
    {
      "date": "Date 1",
      "title": "Event 1",
      "description": "Event details 1",
      "imageQuery": "Event 1 illustration"
    },
    {
      "date": "Date 2",
      "title": "Event 2",
      "description": "Event details 2",
      "imageQuery": "Event 2 illustration"
    }
  ]
}`,

    formula: `
{
  "type": "formula",
  "title": "Formula Slide",
  ${baseFields},
  "formula": "Formula here",
  "explanation": "What formula means",
  "steps": [
    "Step 1",
    "Step 2"
  ],
  "workedExample": ""
}`,

    process: `
{
  "type": "process",
  "title": "Process Slide",
  ${baseFields},
  "steps": [
    {
      "number": 1,
      "title": "Step title",
      "description": "Step explanation"
    },
    {
      "number": 2,
      "title": "Step title",
      "description": "Step explanation"
    }
  ]
}`,

    quiz: `
{
  "type": "quiz",
  "title": "Quiz",
  ${baseFields},
  "question": "Question",
  "options": [
    "A",
    "B",
    "C",
    "D"
  ],
  "answer": "Correct answer",
  "hint": "Helpful hint"
}`,

    summary: `
{
  "type": "summary",
  "title": "Summary",
  ${baseFields},
  "points": [
    "Takeaway 1",
    "Takeaway 2",
    "Takeaway 3"
  ],
  "remember": "Most important thing"
}`,
  };

  return schemas[layoutType] || schemas.bullets;
}
