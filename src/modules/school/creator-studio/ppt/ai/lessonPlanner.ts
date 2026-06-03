// @ts-nocheck
import Groq from "groq-sdk";
import { safeParseJSON } from "../utils/json.utils";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function generateLessonPlan(input) {
  const {
    topic,
    classLevel,
    subject,
    board,
    concepts = [],
    headings = [],
  } = input;

  const conceptListText = concepts.length > 0 
    ? concepts.map((c, i) => `${i + 1}. ${c.title || c}`).join("\n")
    : "No specific concepts provided";

  const headingListText = headings.length > 0
    ? headings.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "No headings provided";

  const prompt = `
You are an expert ${subject} teacher and curriculum designer for the ${board} board, teaching class ${classLevel}.

YOUR TASK:
Create a comprehensive lesson plan for the topic: "${topic}".

AVAILABLE CONCEPTS:
${conceptListText}

AVAILABLE HEADINGS:
${headingListText}

REQUIREMENTS:
1. Provide learningObjectives and prerequisites.
2. Order the conceptSequence by optimal TEACHING ORDER (pedagogical progression), not just importance.
3. Upgrade slideBlueprints into comprehensive Teaching Sections. Each section must include:
   - phase, title, purpose, recommendedLayout, learningGoal
   - teachingPoints: an array of objects with 'type' and 'content'.
4. Never output headings as teachingPoints.
   Bad:
   "Functions of carbohydrates"
   
   Good:
   "Carbohydrates provide energy to cells and are stored as starch in plants and glycogen in animals."
5. Every teachingPoint must be 1-3 complete educational sentences.
6. Every concept slide must contain:
   - Definition
   - Explanation
   - Example
7. Science subjects should additionally contain:
   - Real-world application OR significance
8. Mathematics should contain:
   - Formula
   - Variable meaning
   - Worked example
9. History should contain:
   - Event
   - Cause
   - Impact
10. Geography should contain:
   - Feature
   - Importance
   - Example
11. Chemistry should contain:
   - Concept
   - Explanation
   - Example
   - Application
12. Biology should contain:
   - Structure
   - Function
   - Example
   - Significance
13. Suggest classroom activities and assessment ideas.

RETURN STRICTLY VALID JSON ONLY, matching exactly this structure:
{
  "learningObjectives": ["objective 1", "objective 2"],
  "prerequisites": ["prereq 1", "prereq 2"],
  "conceptSequence": [
    { "conceptName": "Name", "teachingRationale": "Why teach this now" }
  ],
  "slideBlueprints": [
    { 
      "phase": "Introduction", 
      "title": "...", 
      "purpose": "...",
      "recommendedLayout": "bullets",
      "learningGoal": "...",
      "teachingPoints": [
        { "type": "Concept", "content": "..." }
      ]
    }
  ],
  "activities": [
    { "name": "Activity Name", "description": "..." }
  ],
  "assessmentIdeas": ["idea 1", "idea 2"]
}
`;

  try {
    const completion = await groq.chat.completions.create({
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

    const rawText = completion.choices[0].message.content;
    const parsed = safeParseJSON(rawText, null);

    if (!parsed || !Array.isArray(parsed.slideBlueprints)) {
      throw new Error("Invalid or incomplete JSON structure returned by AI");
    }

    return parsed;
  } catch (error) {
    console.error("❌ Lesson Plan generation failed:", error.message);

    // Fallback output if AI fails
    return {
      learningObjectives: [`Understand the fundamentals of ${topic}`],
      prerequisites: ["Basic understanding of related subjects"],
      conceptSequence: concepts.map(c => ({
        conceptName: c.title || c,
        teachingRationale: "Standard progression"
      })),
      slideBlueprints: [
        { 
          phase: "Introduction", 
          title: `Introduction to ${topic}`, 
          purpose: "Introduce topic",
          recommendedLayout: "bullets",
          learningGoal: "Understand the topic basics",
          teachingPoints: [{ type: "Concept", content: "Basic definition" }]
        },
        { 
          phase: "Core Concepts", 
          title: "Core Concepts", 
          purpose: "Explain main ideas",
          recommendedLayout: "bullets",
          learningGoal: "Master core principles",
          teachingPoints: [{ type: "Principle", content: "Main principle" }]
        },
        { 
          phase: "Examples", 
          title: "Examples", 
          purpose: "Provide examples",
          recommendedLayout: "bullets",
          learningGoal: "Apply concepts",
          teachingPoints: [{ type: "Example", content: "Key example" }]
        },
        { 
          phase: "Applications", 
          title: "Real-world Applications", 
          purpose: "Show applications",
          recommendedLayout: "bullets",
          learningGoal: "Connect to real world",
          teachingPoints: [{ type: "Application", content: "Practical application" }]
        },
        { 
          phase: "Quiz", 
          title: "Knowledge Check", 
          purpose: "Assess understanding",
          recommendedLayout: "quiz",
          learningGoal: "Check retention",
          teachingPoints: [{ type: "Question", content: "Check question" }]
        },
        { 
          phase: "Summary", 
          title: "Summary", 
          purpose: "Summarize key points",
          recommendedLayout: "summary",
          learningGoal: "Review learning",
          teachingPoints: [{ type: "Summary", content: "Final recap" }]
        }
      ],
      activities: [
        { name: "Group Discussion", description: `Discuss ${topic} in groups.` }
      ],
      assessmentIdeas: ["Short quiz", "Q&A session"]
    };
  }
}
