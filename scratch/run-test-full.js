const { formatMarkdown } = require('./test-markdown.js');

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

2. Which of the following is a quadratic equation?
$(a) x^2 + 3x - 2 = 0$
$(b) x^2 - 4x + 4 = 0$
$(c) x^2 + 2x + 1 = 0$
(d) All of the above

3. What is the formula for the area of a circle?
$(a) A = πr^2$
$(b) A = 2πr$
$(c) A = πd$
$(d) A = 1/2 πr^2$

4. What is the value of sin 30°?
$(a) 1/2$
$(b) 1/3$
$(c) 2/3$
$(d) 3/4$

5. Which of the following is a type of polygon?
(a) Triangle
(b) Quadrilateral
(c) Pentagon
(d) All of the above

## Section B — True or False
1. The sum of the interior angles of a triangle is 180°. 
2. The formula for the volume of a cube is $V = s^3.$
3. The number 0 is a real number. 
4. The equation x^2 + 4x + 4 = 0 has two distinct real roots. 
5. The sum of the exterior angles of a polygon is 360°.

## Section C — Fill in the Blanks
1. The ________ of a number is the value that is multiplied by itself to give the original number.
2. The formula for the perimeter of a rectangle is $P = ________.$
3. The ________ of a circle is the distance from the center to any point on the circle.
4. The equation of a straight line is ________.
5. The ________ of a triangle is the line segment that connects two vertices.

## Section D — Short Answer
1. Find the value of x in the equation x/4 + 2 = 5. (3 marks)
2. Prove that the sum of the interior angles of a triangle is 180°. (3 marks)
3. Find the area of a circle with radius 4 cm. (3 marks)

## Section E — Long Answer
1. Prove that the equation x^2 + 5x + 6 = 0 has two distinct real roots. (5 marks)
2. Find the volume of a cube with side length 6 cm. (5 marks)`;

console.log(formatMarkdown(dbText));
