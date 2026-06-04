// @ts-nocheck
import { paginateTeachingSection } from "./lessonPaginator";

function runTest(name, input, expectedLength, expectedTitleOfLast = null) {
  const result = paginateTeachingSection(input);
  const passed = result.length === expectedLength && (!expectedTitleOfLast || result[result.length - 1].title === expectedTitleOfLast);
  
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) {
    console.log(`  Expected length: ${expectedLength}, Title of last: ${expectedTitleOfLast}`);
    console.log(`  Got length: ${result.length}, Title of last: ${result.length > 0 ? result[result.length - 1].title : 'none'}`);
  }
}

console.log("Running Lesson Paginator Tests...\n");

const baseSection = {
  phase: "Core Concepts",
  title: "Maxwell's Equations",
  purpose: "Teach electromagnetism",
  recommendedLayout: "bullets",
  learningGoal: "Understand equations"
};

runTest("missing teachingPoints field", { ...baseSection }, 1);

runTest("empty teachingPoints", { ...baseSection, teachingPoints: [] }, 1);

runTest("1 teachingPoint", { ...baseSection, teachingPoints: [1] }, 1);

runTest("3 teachingPoints", { ...baseSection, teachingPoints: [1, 2, 3] }, 1);

runTest("4 teachingPoints", { ...baseSection, teachingPoints: [1, 2, 3, 4] }, 2, "Maxwell's Equations (Part 2)");

runTest("7 teachingPoints", { ...baseSection, teachingPoints: [1, 2, 3, 4, 5, 6, 7] }, 3, "Maxwell's Equations (Part 3)");

console.log("\nSample Output for 7 teachingPoints:");
console.log(JSON.stringify(paginateTeachingSection({ ...baseSection, teachingPoints: [1, 2, 3, 4, 5, 6, 7] }), null, 2));
