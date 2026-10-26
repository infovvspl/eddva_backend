/** Test fixtures for chapter lesson plans (excluded from the build by tsconfig.build `test-*.ts`). */

/**
 * A minimal, valid one-page PDF whose text layer holds `lines` (Helvetica),
 * with a correct cross-reference table, so real PDF parsing can be tested.
 * Pass `withText: false` for an image-only style page with no text.
 */
export function minimalPdf(lines: string[], withText = true): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = withText
    ? `BT /F1 11 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
    : '0 0 1 rg 50 50 100 100 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Text of a typical teacher's plan, long enough to pass the "readable text" check. */
export const SAMPLE_UPLOADED_PLAN = [
  'Lesson Plan - Real Numbers - Class 10 Mathematics',
  'Objectives: students state Euclid\'s division lemma and find the HCF of two numbers.',
  'Period 1 (45 min): recall division with remainder (5 min); explain the lemma a = bq + r (25 min);',
  'board practice with 455 and 42 (10 min); exit question (5 min).',
  'Period 2 (45 min): HCF by repeated division (20 min); worked examples from the textbook (15 min);',
  'pair practice on Exercise 1.1 (5 min); summary and homework Exercise 1.1 Q1 and Q2 (5 min).',
  'Assessment: oral questions, two board problems, homework check next day.',
];

/** A structurally valid v2 plan: `periods` periods of `minutes` minutes, citing pages 3 and 4. */
export function goodPlan(periods = 2, minutes = 45): any {
  return {
    schemaVersion: 2,
    title: 'Real Numbers — Lesson Plan',
    objectives: [
      { id: 'O1', text: 'State Euclid\'s division lemma', bloom: 'Remember', assessment: 'Oral recall', source: { type: 'textbook', pages: [3] } },
      { id: 'O2', text: 'Find the HCF of two numbers using the lemma', bloom: 'Apply', assessment: 'Two worked problems', source: { type: 'textbook', pages: [4] } },
    ],
    outcomes: ['Students find the HCF of two positive integers'],
    prerequisites: ['Division with remainder'],
    keyConcepts: [{ term: 'Lemma', meaning: 'A proven statement used to prove others', pages: [3] }],
    resources: ['Textbook', 'Board'],
    misconceptions: [{ misconception: 'The remainder can equal the divisor', correction: 'Show 0 <= r < b with examples' }],
    differentiation: { support: ['Number line'], onLevel: ['Textbook exercise 1.1'], challenge: ['Prove the lemma for negatives'], accessibility: ['Large-print worksheet'] },
    groundingNotes: '',
    periods: Array.from({ length: periods }, (_, i) => ({
      number: i + 1,
      topic: i === 0 ? 'Euclid\'s division lemma' : 'HCF by repeated division',
      objectiveIds: [i === 0 ? 'O1' : 'O2'],
      sequence: [
        { phase: 'introduction', minutes: 5, teacher: 'Recall division', students: 'Answer orally' },
        { phase: 'explanation', minutes: minutes - 15, teacher: 'Explain the lemma', students: 'Take notes' },
        { phase: 'check', minutes: 10, teacher: 'Ask questions', students: 'Answer' },
      ],
      examples: ['17 = 5 × 3 + 2'],
      resources: ['Board'],
      checks: ['What is r when a = 17, b = 5?'],
      questions: [{ question: 'Divide 455 by 42 with remainder', answer: '455 = 42 × 10 + 35', objectiveIds: [i === 0 ? 'O1' : 'O2'] }],
      homework: 'Exercise 1.1 Q1',
      exitTicket: 'Write the lemma in your own words',
      pages: [3, 4],
    })),
  };
}
