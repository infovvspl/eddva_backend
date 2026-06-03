/*
==========================================
PDF UTILITIES
Text cleaning, chunking, subject & class detection
==========================================
*/

/**
 * Cleans raw PDF-extracted text.
 * Removes page numbers, excessive whitespace, control characters.
 * @param {string} rawText
 * @returns {string}
 */
export const cleanPDFText = (rawText) => {
  if (!rawText || typeof rawText !== "string") return "";

  let text = rawText;

  // Remove null bytes and control chars (except newlines/tabs)
  text = text.replace(/\x00/g, "");
  text = text.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Remove standalone page numbers (lines that are ONLY a number)
  text = text.replace(/^\s*\d+\s*$/gm, "");

  // Remove "Page X of Y" patterns
  text = text.replace(/\bPage\s+\d+\s*(of\s*\d+)?\b/gi, "");

  // Remove dashed page separators like "- 3 -"
  text = text.replace(/^\s*[-–]\s*\d+\s*[-–]\s*$/gm, "");

  // Remove repeated dashes/underscores (horizontal rules from PDF)
  text = text.replace(/^[-_=]{5,}\s*$/gm, "");

  // Collapse 4+ consecutive newlines into 2
  text = text.replace(/\n{4,}/g, "\n\n\n");

  // Collapse 3+ spaces into a single space
  text = text.replace(/[ \t]{3,}/g, " ");

  return text.trim();
};

/**
 * Splits cleaned text into semantic chunks for AI processing.
 * Respects sentence boundaries and avoids mid-sentence cuts.
 * @param {string} text
 * @param {number} maxChars - max characters per chunk (default 7500 for Groq safety)
 * @returns {string[]}
 */
export const chunkText = (text, maxChars = 7500) => {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks = [];

  // Split on sentence-ending punctuation
  const sentences = text.split(/(?<=[.!?।])\s+/);

  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Sentence is too long — split it at paragraph breaks
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      // Hard split the giant sentence
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.substring(i, i + maxChars));
      }
      continue;
    }

    if ((current + " " + sentence).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
};

/**
 * Auto-detects the academic subject from PDF text using keyword scoring.
 * @param {string} text
 * @returns {string} subject name
 */
export const detectSubjectFromText = (text) => {
  if (!text) return "General";

  const lower = text.toLowerCase();

  const subjectKeywords = [
    {
      subject: "Mathematics",
      keywords: [
        "theorem", "equation", "algebra", "geometry", "trigonometry",
        "calculus", "polynomial", "rational number", "integer", "fraction",
        "quadratic", "coordinate", "proof", "matrix", "determinant",
        "permutation", "combination", "probability", "statistics",
      ],
    },
    {
      subject: "Physics",
      keywords: [
        "velocity", "acceleration", "force", "newton", "momentum",
        "kinetic energy", "potential energy", "wave", "optics", "electricity",
        "magnetism", "gravitation", "thermodynamics", "ohm", "circuit",
        "refraction", "reflection", "nucleus", "radiation",
      ],
    },
    {
      subject: "Chemistry",
      keywords: [
        "molecule", "atom", "reaction", "element", "compound",
        "periodic table", "acid", "base", "oxidation", "ionic", "covalent",
        "valence", "bond", "electrolysis", "equilibrium", "mole",
        "solution", "solute", "solvent", "ph",
      ],
    },
    {
      subject: "Biology",
      keywords: [
        "cell", "organism", "photosynthesis", "respiration", "dna",
        "chromosome", "ecosystem", "evolution", "mitosis", "meiosis",
        "protein", "enzyme", "tissue", "organ", "nucleus", "membrane",
        "heredity", "genetics", "biodiversity", "nervous system",
      ],
    },
    {
      subject: "History",
      keywords: [
        "emperor", "revolution", "war", "century", "civilization",
        "colonialism", "independence", "dynasty", "king", "battle",
        "empire", "republic", "nationalism", "treaty", "rebellion",
        "movement", "freedom", "colonial", "reign", "conquest",
      ],
    },
    {
      subject: "Geography",
      keywords: [
        "latitude", "longitude", "climate", "landform", "continent",
        "ocean", "river", "mountain", "erosion", "vegetation",
        "plateau", "delta", "watershed", "monsoon", "tectonic",
        "deforestation", "mineral", "soil", "biome", "map",
      ],
    },
    {
      subject: "Computer Science",
      keywords: [
        "algorithm", "programming", "variable", "loop", "function",
        "array", "database", "network", "binary", "software",
        "hardware", "operating system", "compiler", "recursion",
        "class", "object", "inheritance", "html", "python", "java",
      ],
    },
    {
      subject: "English",
      keywords: [
        "grammar", "literature", "poem", "prose", "noun",
        "verb", "adjective", "metaphor", "simile", "narrative",
        "character", "plot", "theme", "tense", "clause",
        "paragraph", "essay", "comprehension", "vocabulary", "syntax",
      ],
    },
    {
      subject: "Science",
      keywords: [
        "experiment", "observation", "hypothesis", "laboratory",
        "force", "energy", "matter", "chemical", "physical",
        "natural", "scientific", "data", "result", "conclusion",
      ],
    },
  ];

  const scores = subjectKeywords.map(({ subject, keywords }) => ({
    subject,
    score: keywords.filter((k) => lower.includes(k)).length,
  }));

  scores.sort((a, b) => b.score - a.score);

  return scores[0].score >= 2 ? scores[0].subject : "General";
};

/**
 * Auto-detects the class/grade level from PDF text.
 * Looks for patterns like "Class 9", "Grade 10", "Class XII".
 * @param {string} text
 * @returns {string} class level as a numeric string, e.g. "9"
 */
export const detectClassFromText = (text) => {
  if (!text) return "9";

  const romanToNum = {
    VI: "6", VII: "7", VIII: "8", IX: "9",
    X: "10", XI: "11", XII: "12",
  };

  const patterns = [
    /\bClass\s+([6-9]|1[0-2]|XII|XI|X|IX|VIII|VII|VI)\b/i,
    /\bGrade\s+([6-9]|1[0-2])\b/i,
    /\bSTD\.?\s+([6-9]|1[0-2])\b/i,
    /\bForm\s+([1-6])\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].toUpperCase();
      return romanToNum[raw] || match[1];
    }
  }

  return "9"; // Safe default
};
