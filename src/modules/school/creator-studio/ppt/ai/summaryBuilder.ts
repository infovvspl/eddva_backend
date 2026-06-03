// @ts-nocheck
import Groq from "groq-sdk";
import { safeParseJSON, ensureString } from "../utils/json.utils";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/*
==========================================
ISSUE 4: GENERATE SUMMARY FROM SLIDES
==========================================

This module builds summaries from actual slide content.
Prevents hallucination by extracting key concepts from
all generated slides and building the summary from them.

Requirements:
1. Read all generated slides
2. Extract key concepts
3. Build summary from slide content only
4. Never introduce new facts
5. Validate against sourceContent
*/

export const extractKeyConceptsFromSlide = (slide) => {
  // Extract main concepts from each slide type
  
  const concepts = [];

  if (!slide) return concepts;

  // Title is always a concept
  if (slide.title) {
    concepts.push(slide.title);
  }

  // Extract from bullets
  if (Array.isArray(slide.bullets)) {
    concepts.push(...slide.bullets.slice(0, 2));
  }

  // Extract from cards
  if (Array.isArray(slide.cards)) {
    slide.cards.forEach((card) => {
      if (card.title) concepts.push(card.title);
      if (card.text) concepts.push(card.text);
    });
  }

  // Extract from comparison
  if (slide.left) {
    if (slide.left.title) concepts.push(slide.left.title);
    if (slide.left.points) concepts.push(...slide.left.points.slice(0, 1));
  }
  if (slide.right) {
    if (slide.right.title) concepts.push(slide.right.title);
    if (slide.right.points) concepts.push(...slide.right.points.slice(0, 1));
  }

  // Extract from timeline
  if (Array.isArray(slide.events)) {
    slide.events.forEach((event) => {
      if (event.title) concepts.push(event.title);
    });
  }

  // Extract from formula
  if (slide.formula) {
    concepts.push(`Formula: ${slide.formula}`);
  }
  if (slide.explanation) {
    concepts.push(slide.explanation);
  }

  // Extract from process
  if (Array.isArray(slide.steps)) {
    slide.steps.forEach((step) => {
      if (step.title) concepts.push(step.title);
    });
  }

  // Extract from quiz
  if (slide.question) {
    concepts.push(slide.question);
  }

  return concepts.filter((c) => c && typeof c === "string");
};

export const buildSummaryFromSlides = async (
  slides,
  sourceMaterial = ""
) => {
  /*
  ISSUE 4 FIX: Build summary from actual slide content
  Extract key concepts and validate them
  */

  try {
    // Extract all key concepts from slides
    const allConcepts = [];
    const slideContents = [];

    slides.forEach((slide, index) => {
      if (slide && slide.type !== "summary") {
        // Skip existing summary slide
        const concepts = extractKeyConceptsFromSlide(slide);
        allConcepts.push(...concepts);

        // Collect slide content for context
        slideContents.push({
          slideNum: index + 1,
          title: slide.title,
          type: slide.type,
          sourceContent: slide.sourceContent || "",
          bullets: slide.bullets || [],
        });
      }
    });

    // Build context from slide contents
    const slideContext = slideContents
      .map(
        (s) =>
          `Slide ${s.slideNum}: ${s.title} (${s.type})\n` +
          `Content: ${s.sourceContent.substring(0, 150)}\n` +
          `Bullets: ${s.bullets.join("; ")}`
      )
      .join("\n\n");

    // Use AI to synthesize summary from slides
    const prompt = `
You are an expert educator creating a summary slide from a presentation.

CRITICAL: The summary MUST be built ONLY from the slides provided.

SOURCE MATERIAL FOR REFERENCE:
${sourceMaterial.substring(0, 1000)}

SLIDE CONTENTS:
${slideContext}

TASK:

Create a concise summary that:

1. Extracts the most important takeaways from the slides above
2. Uses ONLY concepts mentioned in the slides
3. Never introduces facts not in the slides
4. Summarizes in 4-6 bullet points
5. Each point should be traceable to a slide

VALIDATION:

Every summary point must match content from the slides.
If you're unsure if a point is in the slides, omit it.

Return ONLY this JSON:

{
  "points": [
    "Key takeaway 1",
    "Key takeaway 2",
    "Key takeaway 3",
    "Key takeaway 4"
  ],
  "remember": "The single most important concept from all slides"
}
`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const rawText = completion?.choices?.[0]?.message?.content || "";
    const parsed = safeParseJSON(rawText, null);

    if (!parsed || !Array.isArray(parsed.points)) {
      // Fallback: Use extracted concepts
      return {
        points: allConcepts
          .slice(0, 4)
          .filter((c) => c.length > 5),
        remember: allConcepts[0] || "Key concepts from presentation",
      };
    }

    return parsed;
  } catch (error) {
    console.warn("⚠️ Summary generation failed:", error.message);

    // Fallback: Return simple summary from concepts
    return {
      points: extractKeyConceptsFromSlide(slides[0])
        .slice(0, 4)
        .filter((c) => c.length > 5),
      remember:
        slides[0]?.title ||
        "Key concepts from presentation",
    };
  }
};

/*
==========================================
VALIDATE SUMMARY AGAINST SOURCE
==========================================

This validates that summary points exist in
either slide content or source material
*/

export const validateSummaryContent = (summary, slides, sourceContent) => {
  if (!summary || !summary.points) {
    return summary;
  }

  const sourceText = (sourceContent || "").toLowerCase();
  const slidesText = slides
    .map(
      (s) =>
        (s.title || "") +
        " " +
        (s.sourceContent || "") +
        " " +
        (Array.isArray(s.bullets) ? s.bullets.join(" ") : "")
    )
    .join(" ")
    .toLowerCase();

  const validated = {
    points: summary.points
      .filter((point) => {
        // Check if point exists in slides or source
        const lowerPoint = point.toLowerCase();
        const keywords = lowerPoint
          .split(/\s+/)
          .filter((w) => w.length > 3);

        // At least 2 keywords should appear in slides or source
        const matchCount = keywords.filter(
          (kw) =>
            slidesText.includes(kw) ||
            sourceText.includes(kw)
        ).length;

        return matchCount >= 2;
      })
      .slice(0, 6),

    remember:
      summary.remember &&
      (slidesText.includes(summary.remember.toLowerCase()) ||
        sourceText.includes(summary.remember.toLowerCase()))
        ? summary.remember
        : slides[0]?.title || "Key concepts",
  };

  // Ensure we have at least some points
  if (validated.points.length === 0) {
    validated.points = [
      slides[0]?.title || "Important concept",
    ];
  }

  return validated;
};
