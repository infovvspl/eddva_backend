// @ts-nocheck
import { generateLessonPlan } from "./lessonPlanner";
import 'dotenv/config';

async function testLessonPlanner() {
  console.log("Starting Lesson Planner Test...\n");

  const mockInput = {
    topic: "Photosynthesis",
    classLevel: "10",
    subject: "Biology",
    board: "CBSE",
    concepts: [
      { title: "Light-dependent reactions" },
      { title: "Calvin cycle" },
      { title: "Chlorophyll and Chloroplasts" }
    ],
    headings: [
      "Introduction to Photosynthesis", 
      "The Process", 
      "Importance in Ecosystem"
    ]
  };

  try {
    const result = await generateLessonPlan(mockInput);
    console.log("✅ Lesson Plan Generated Successfully!\n");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testLessonPlanner();
