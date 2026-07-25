const { formatMarkdown } = require('./markdown-impl');

const inputs = [
  `Formulas & Equations
Product of Powers Formula
$a^m \\cdot a^n = a^{m+n}$`,
  `Formulas & Equations
Product of Powers Formula
a^m \\cdot a^n = a^{m+n}`,
  `$$a^m * a^n = a^(m+n)$$`
];


inputs.forEach((input, index) => {
  console.log(`--- Test ${index + 1} ---`);
  console.log("Input:");
  console.log(input);
  console.log("Output:");
  console.log(formatMarkdown(input));
  console.log("");
});

