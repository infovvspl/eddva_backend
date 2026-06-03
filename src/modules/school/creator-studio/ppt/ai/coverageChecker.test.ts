// @ts-nocheck
import { checkCoverage } from "./coverageChecker";

function runTest(testName, input, expectedMissingCount) {
  const result = checkCoverage(input);
  console.log(`\n--- Test: ${testName} ---`);
  console.log(`Coverage: ${result.coverage}%`);
  console.log(`Covered: ${result.coveredTopics.length > 0 ? result.coveredTopics.join(", ") : "None"}`);
  console.log(`Missing: ${result.missingTopics.length > 0 ? result.missingTopics.join(", ") : "None"}`);
  console.log(`Recommendations:\n  ${result.recommendations.join("\n  ") || "None"}`);
  
  if (result.missingTopics.length === expectedMissingCount) {
    console.log("✅ PASS");
  } else {
    console.log(`❌ FAIL (Expected ${expectedMissingCount} missing topics, got ${result.missingTopics.length})`);
  }
}

console.log("Starting Coverage Checker Tests...");

// Test 1: Example from the prompt
runTest(
  "Prompt Example (75% Coverage)", 
  {
    sourceHeadings: ["Motion", "Distance", "Speed", "Graphs"],
    sourceConcepts: [],
    generatedSlides: [
      { title: "Introduction to Motion", content: "Motion is movement." },
      { title: "Distance and Speed", content: "Speed is distance over time." }
    ]
  },
  1 // "Graphs" is missing
);

// Test 2: 100% Coverage with objects and string properties
runTest(
  "Perfect Coverage with Object Concepts",
  {
    sourceHeadings: ["Photosynthesis"],
    sourceConcepts: [{ title: "Light Reactions" }, { title: "Calvin Cycle" }],
    generatedSlides: [
      { title: "Photosynthesis Overview", content: "Light reactions happen first." },
      { title: "The Calvin Cycle", content: "This is the dark reaction." }
    ]
  },
  0 // All covered
);

// Test 3: 0% Coverage
runTest(
  "Zero Coverage",
  {
    sourceHeadings: ["Quantum Physics", "String Theory"],
    sourceConcepts: [],
    generatedSlides: [
      { title: "Biology 101", content: "Let's talk about cells." }
    ]
  },
  2 // Both missing
);

// Test 4: Keyword Overlap Matching
runTest(
  "Keyword Overlap Match",
  {
    sourceHeadings: ["History of the Roman Empire"],
    sourceConcepts: [],
    generatedSlides: [
      { title: "Rome", content: "The Roman Empire was vast and historical." }
    ]
  },
  0 // Should match because "Roman" and "Empire" overlap
);

// Test 5: Empty Input
runTest(
  "Empty Inputs",
  {
    sourceHeadings: [],
    sourceConcepts: [],
    generatedSlides: []
  },
  0
);
