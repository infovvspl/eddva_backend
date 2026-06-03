// @ts-nocheck
import { buildSlide } from "./deterministicSlideBuilder";

function runTest(name, input, expectedType, validateFn) {
  const result = buildSlide(input);
  const passed = result && result.type === expectedType && validateFn(result);
  
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) {
    console.log(`  Input: ${JSON.stringify(input.teachingPoints)}`);
    console.log(`  Output: ${JSON.stringify(result)}`);
  }
}

console.log("Running Deterministic Slide Builder Tests...\n");

const baseInput = {
  title: "Electric Current",
  phase: "Core Concepts",
  purpose: "Understand current",
  learningGoal: "Students understand electric current",
  teachingPoints: [
    { type: "Definition", content: "Electric current is the flow of charge." },
    { type: "Unit", content: "SI unit is ampere." }
  ]
};

// 1. Bullets
runTest("Bullets mapping", { ...baseInput, recommendedLayout: "bullets" }, "bullets", (res) => {
  return res.bullets.length === 2 && res.bullets[0] === "Electric current is the flow of charge.";
});

// 2. Formula
runTest("Formula mapping", {
  ...baseInput,
  recommendedLayout: "formula",
  teachingPoints: [
    { type: "Definition", content: "Current formula" },
    { type: "Mathematical Form", content: "I = Q/t" },
    { type: "Worked Example", content: "10C in 2s = 5A" },
    { type: "Application", content: "Phone charger" }
  ]
}, "formula", (res) => {
  return res.conceptExplanation === "Current formula" &&
         res.formula === "I = Q/t" &&
         res.workedExample === "10C in 2s = 5A" &&
         res.realLifeExample === "Phone charger";
});

// 3. Process
runTest("Process mapping", { ...baseInput, recommendedLayout: "process" }, "process", (res) => {
  return res.steps.length === 2 && res.steps[1] === "SI unit is ampere.";
});

// 4. Timeline
runTest("Timeline mapping", { ...baseInput, recommendedLayout: "timeline" }, "timeline", (res) => {
  return res.events.length === 2 && res.events[0].description === "Electric current is the flow of charge.";
});

// 5. Summary
runTest("Summary mapping", { ...baseInput, recommendedLayout: "summary" }, "summary", (res) => {
  return res.points.length === 2 && res.remember === "Students understand electric current";
});

// 6. Quiz
runTest("Quiz mapping", { ...baseInput, recommendedLayout: "quiz" }, "quiz", (res) => {
  return res.question.includes("Students understand electric current") && res.correctAnswer === "Electric current is the flow of charge.";
});

console.log("\nSample Output for Formula Layout:");
console.log(JSON.stringify(buildSlide({
  title: "Ohm's Law",
  recommendedLayout: "formula",
  teachingPoints: [
    { type: "Definition", content: "Voltage is proportional to current." },
    { type: "Mathematical Form", content: "V = IR" }
  ]
}), null, 2));
