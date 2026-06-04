// @ts-nocheck
import Groq from "groq-sdk";
import { safeParseJSON } from "../utils/json.utils";
import { ALLOWED_LAYOUTS } from "./curriculumConfig";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const analyzePDF = async ({
  chunks,
  headings = [],
  subheadings = [],
  chapterTitle = "",
  detectedSubject,
  detectedClass,
  board = "CBSE",
}) => {

  /*
  ==========================================
  USE MUCH MORE OF THE PDF
  ==========================================
  */

  const analysisText = chunks
    .slice(0, 8)
    .join("\n\n--- PDF SECTION ---\n\n")
    .substring(0, 12000);

  const headingText = headings.length > 0
    ? headings.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "No headings detected";
    
  const subheadingText = subheadings.length > 0
    ? subheadings.slice(0, 20).map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "No subheadings detected";

  const prompt = `
You are an expert ${detectedSubject} teacher and curriculum analyst working for ${board} curriculum.

CLASS: ${detectedClass}
SUBJECT: ${detectedSubject}
CHAPTER TITLE: ${chapterTitle}

HEADINGS FOUND:
${headingText}

SUBHEADINGS FOUND:
${subheadingText}

CONTENT:
${analysisText}

YOUR TASK:
Extract the core educational concepts from the text.
Do NOT generate a slide plan or assign layouts yet.
Instead, extract the concepts hierarchically, grouped by their headings and subheadings.

Concept scoring rules:
10 = central chapter concept
8 = major concept
6 = supporting concept
4 = example
2 = minor detail

RETURN JSON ONLY.
{
  "topic": "${chapterTitle || "Educational Content"}",
  "sections": [
    {
      "heading": "",
      "subheading": "",
      "concepts": [
        {
          "title": "",
          "importance": 10,
          "content": "",
          "keywords": []
        }
      ]
    }
  ]
}
`;

  try {
    let parsed = null;
    let attempts = 0;

    while (attempts < 2 && (!parsed || !Array.isArray(parsed?.sections))) {
      attempts++;
      try {
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
            max_tokens: 4000,
          });

        const rawText =
          completion.choices[0].message.content;

        parsed = safeParseJSON(rawText, null);

        if (!parsed || !Array.isArray(parsed.sections)) {
          throw new Error("Invalid analysis structure from AI");
        }
      } catch (error) {
        console.warn(`⚠️ PDF analysis attempt ${attempts} failed: ${error.message}`);
      }
    }

    if (!parsed || !Array.isArray(parsed?.sections)) {
      console.error("❌ PDF analysis AI failed. Generating fallback analysis.");
      parsed = {
        topic: chapterTitle || "Educational Content",
        sections: []
      };

      const fallbackSection = {
        heading: chapterTitle || "Main Concepts",
        subheading: "Overview",
        concepts: []
      };

      if (headings.length > 0 || subheadings.length > 0) {
        const items = [...headings, ...subheadings].slice(0, 10);
        items.forEach((item, index) => {
          fallbackSection.concepts.push({
            title: item,
            importance: 10 - index >= 6 ? 10 - index : 6,
            content: `Key concept related to ${item}`,
            keywords: [item]
          });
        });
      } else {
        fallbackSection.concepts.push({
          title: "Key Concepts Overview",
          importance: 10,
          content: "Overview of the provided document.",
          keywords: ["overview"]
        });
      }
      parsed.sections.push(fallbackSection);
    }

    /*
    ==========================================
    BACKWARD COMPATIBILITY & CONSOLE LOGS
    ==========================================
    */
    
    let allConcepts = [];
    parsed.sections.forEach(section => {
      if (Array.isArray(section.concepts)) {
        allConcepts.push(...section.concepts);
      }
    });
    
    // Sort concepts by importance (descending)
    allConcepts.sort((a, b) => b.importance - a.importance);
    
    console.log("\n📊 --- PHASE 1 EXTRACTION REPORT ---");
    console.log(`📌 Detected Headings: ${headings.length}`);
    console.log(`📌 Detected Subheadings: ${subheadings.length}`);
    console.log(`📌 Total Concepts Extracted: ${allConcepts.length}`);
    console.log(`\n🏆 Top 10 Concepts:`);
    allConcepts.slice(0, 10).forEach((c, i) => {
      console.log(`   ${i + 1}. [Score: ${c.importance}] ${c.title}`);
    });
    console.log("------------------------------------\n");

    // Map concepts >= 6 to a fallback slidePlan to keep buildFromPDF() working
    const fallbackSlidePlan = allConcepts
      .filter(c => c.importance >= 6)
      .slice(0, 20)
      .map(concept => ({
        purpose: `Teach the concept of ${concept.title}`,
        layout: "bullets", // fallback layout, won't use layout engine yet
        title: concept.title.substring(0, 60),
        sourceContent: (concept.content || concept.title).substring(0, 1000)
      }));

    const normalized = fallbackSlidePlan;

    /*
    ==========================================
    ENSURE SUMMARY SLIDE
    ==========================================
    */

    const hasSummary =
      normalized.some(
        (s) =>
          s.layout === "summary"
      );

    if (
      !hasSummary &&
      normalized.length < 20
    ) {

      normalized.push({

        purpose:
          "Summarize the chapter",

        layout:
          "summary",

        title:
          "Key Takeaways",

        sourceContent:
          `Summary of ${
            parsed.topic ||
            "this topic"
          }`,

      });

    }

    return {

      detectedTopic:
        parsed.topic ||
        "Educational Content",

      detectedSubject:
        detectedSubject,

      suggestedClass:
        detectedClass,
        
      sections:
        parsed.sections,

      slidePlan:
        normalized,

    };

  }

  catch (error) {

    console.error(
      "❌ PDF analysis failed:",
      error.message
    );

    throw new Error(
      "Failed to analyze PDF content: " +
      error.message
    );

  }

};
