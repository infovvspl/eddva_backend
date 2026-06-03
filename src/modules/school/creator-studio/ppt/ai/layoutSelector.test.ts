// @ts-nocheck
import { selectLayout } from "./layoutSelector";

function runTest(name, input, expectedLayout) {
  const result = selectLayout(input);
  const passed = result.layout === expectedLayout;
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) {
    console.log(`  Expected: ${expectedLayout}`);
    console.log(`  Got: ${result.layout} (Reason: ${result.reason})`);
  } else {
    console.log(`  Selected: ${result.layout} (Reason: ${result.reason})`);
  }
  console.log('---');
}

console.log("Running Layout Selector Tests...\n");

runTest("Formula Detection - Title keyword", {
  title: "Pythagorean Theorem",
  content: "The equation is a^2 + b^2 = c^2",
}, "formula");

runTest("Formula Detection - Equation characters", {
  title: "Simple Math",
  content: "x = y + 5",
}, "formula");

runTest("Timeline Detection - Keywords", {
  title: "World War II",
  content: "It started in 1939 and ended in 1945.",
}, "timeline");

runTest("Timeline Detection - Sequence", {
  title: "Project Plan",
  content: "The chronological sequence of events is as follows.",
}, "timeline");

runTest("Process Detection - Steps", {
  title: "Photosynthesis Process",
  content: "Step 1: Sunlight is absorbed. Step 2: Water is split.",
}, "process");

runTest("Comparison Detection - VS", {
  title: "Plant vs Animal Cells",
  content: "The main difference is the cell wall.",
}, "comparison");

runTest("Comparison Detection - Pros & Cons", {
  title: "Electric Cars",
  content: "Let's look at the advantages and differences.",
}, "comparison");

runTest("Cards Detection - Categories", {
  title: "Types of Rocks",
  content: "There are three main categories: Igneous, Sedimentary, Metamorphic.",
}, "cards");

runTest("Quiz Detection - Question Mark", {
  title: "Knowledge Check?",
  content: "Let's see what you learned.",
}, "quiz");

runTest("Quiz Detection - MCQ Keyword", {
  title: "Final Test",
  content: "Which of the following is an option for this MCQ?",
}, "quiz");

runTest("Summary Detection - Recap", {
  title: "Key Takeaways",
  content: "To recap, here is a summary of the lesson.",
}, "summary");

runTest("Default Bullets - Generic Text", {
  title: "General Information",
  content: "The sky is blue. Grass is green.",
}, "bullets");
