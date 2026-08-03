const sampleWithDoubleNewlines = `GENERAL INSTRUCTIONS
1.

The question paper consists of five sections: A, B, C, D, and E.

2.

Section A has multiple choice questions, Section B has true or false statements.

## Section B — True or False
1.

The sum of the interior angles of a triangle is 180°.

2.

The formula for the volume of a cube is $V = s^3.$`;

function fixQuestionNumbers(text) {
  return text.replace(
    /((?:^|\n)\s*(?:Q\s*)?\d{1,3}[.)])\s*(?:\r?\n)+\s*(?!(?:[A-E][.):]\s*|\([A-E]\)\s*|Q?\d{1,3}[.)]\s*|#{1,6}\s|[-*+]\s))/gi,
    "$1 "
  );
}

console.log(fixQuestionNumbers(sampleWithDoubleNewlines));
