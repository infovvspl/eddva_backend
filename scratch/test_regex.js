function cleanAnswer(raw) {
  const trimmed = raw
    .replace(/^(?:answer|ans|correct)\s*[:\-]\s*/i, '')
    .replace(/^[=:–—-]\s*/, '')
    .trim();
  const option = trimmed.match(/^\(?([a-dA-D])\)?(?:[.)\s]|$)/)?.[1];
  if (option) return option.toLowerCase();
  const tf = trimmed.match(/^(true|false|t|f)\b/i)?.[1]?.toLowerCase();
  if (tf) return tf === 't' ? 'true' : tf === 'f' ? 'false' : tf;
  return trimmed;
}

const answerKeyText = `## Answer Key

### Section A
Q1. Answer: a
Explanation: To solve the equation 2x + 5 = 11, we need to isolate x by subtracting 5 from both sides and then dividing by 2, which gives x = 3.
Q2. Answer: a
Explanation: A linear equation in two variables is of the form ax + by = c, where a, b, and c are constants. The equation x + y = 5 is a linear equation in two variables.
Q3. Answer: a
Explanation: The formula for the area of a triangle is given by A = 1/2 * base * height.
Q4. Answer: c
Explanation: To evaluate the expression (3^2 + 4^2) / (3 + 4), we need to follow the order of operations (PEMDAS), which gives (9 + 16) / 7 = 25 / 7 = 3.57 (approximately), but the closest option is 7, however, (3^2 + 4^2) = 25 and (3 + 4) = 7, so (25) / (7) is approximately 3.57.
Q5. Answer: d
Explanation: A quadratic equation is of the form ax^2 + bx + c = 0, where a, b, and c are constants. All the given options are quadratic equations.

### Section B
Q6. Answer: false
Explanation: The equation x + y = 5 has infinitely many solutions, as it represents a line in the coordinate plane.
Q7. Answer: true
Explanation: The graph of a linear equation in two variables is indeed a straight line.
Q8. Answer: true
Explanation: The equation x^2 + y^2 = 25 represents a circle with center (0, 0) and radius 5.
Q9. Answer: true
Explanation: The formula for the area of a circle is indeed A = πr^2.
Q10. Answer: false
Explanation: The equation 2x + 5 = 11 is a linear equation, not a quadratic equation.`;

const answerMap = new Map();
const explanationMap = new Map();

const lines = answerKeyText.split(/\n+/);
let sequence = 0;
let currentSequence = 0;

for (const line of lines) {
  const match = line.match(/^\s*(?:[-*]\s*)?(?:(?:Section\s+[A-E])\s*[-:–—]?\s*)?(?:(?:(?:Q|Question)\.?\s*(\d{1,2}))|(\d{1,2})[.)]?\s*(?:answer|ans)\b)[.)]?\s*(?:answer|ans)?\s*[:\-]?\s*(.+)$/i);
  if (match) {
    sequence += 1;
    currentSequence = sequence;
    const displayNumber = Number(match[1] || match[2]);
    const rawAnswer = match[3].replace(/\b(?:explanation|reason)\s*[:\-].*$/i, '').trim();
    const answer = cleanAnswer(rawAnswer);
    answerMap.set(sequence, answer);
    if (!answerMap.has(displayNumber)) answerMap.set(displayNumber, answer);
    
    console.log(`Matched: Q${displayNumber} -> ${answer} (sequence ${sequence})`);
  } else {
    const explanation = line.match(/^\s*(?:explanation|reason)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
    if (explanation && currentSequence) {
      explanationMap.set(currentSequence, explanation);
      console.log(`Explanation for Q${currentSequence}: ${explanation.slice(0, 40)}...`);
    }
  }
}

console.log("FINAL ANSWER MAP:", Object.fromEntries(answerMap));
