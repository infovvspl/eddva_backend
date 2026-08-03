const dbText = `# Math
Class 10
Maximum Marks: 100
Time Allowed: 120 minutes

## General Instructions
1. The question paper consists of five sections: A, B, C, D, and E.
2. Section A has multiple choice questions, Section B has true or false statements, Section C has fill in the blanks questions, Section D has short answer questions, and Section E has long answer questions.
3. Read each question carefully and follow the instructions.
4. Write your answers in the space provided.

## Section A — Multiple Choice Questions
1. What is the value of x in the equation 2x + 5 = 11?
(a) 2
(b) 3
(c) 4
(d) 5

## Section B — True or False
1. The sum of the interior angles of a triangle is 180°. 
2. The formula for the volume of a cube is $V = s^3.$
3. The number 0 is a real number. 
4. The equation x^2 + 4x + 4 = 0 has two distinct real roots. 
5. The sum of the exterior angles of a polygon is 360°.`;

function prepareAssessmentText(raw) {
  let text = raw.trim();
  if (!text) return text;

  // 1. Join any number followed by newlines with its statement text
  text = text.replace(
    /((?:^|\n)\s*(?:Q\s*)?\d{1,3}[.)])\s*(?:\r?\n)+\s*(?!(?:[A-E][.):]\s*|\([A-E]\)\s*|Q?\d{1,3}[.)]\s*|#{1,6}\s|[-*+]\s))/gi,
    "$1 "
  );

  // 2. Escape the dot after line-starting question numbers (1. -> 1\.)
  // so Markdown renders them as a single continuous paragraph instead of an <ol><li> list
  text = text.replace(/^(\s*(?:Q\s*)?\d{1,3})\./gm, "$1\\.");

  return text;
}

console.log(prepareAssessmentText(dbText));
