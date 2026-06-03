// @ts-nocheck
/*
==========================================
CURRICULUM CONFIG
Central educational configuration
==========================================
*/

/**
 * Returns the appropriate slide count range based on class level.
 * @param {string|number} classLevel
 * @returns {{ min: number, max: number, target: number }}
 */
export const getSlideCountForClass = (classLevel) => {
  const level = parseInt(classLevel, 10);

  if (level >= 6 && level <= 7) {
    return { min: 5, max: 6, target: 6 };
  }

  if (level >= 8 && level <= 10) {
    return { min: 7, max: 9, target: 8 };
  }

  if (level >= 11 && level <= 12) {
    return { min: 10, max: 14, target: 12 };
  }

  // Default (unknown class)
  return { min: 6, max: 8, target: 7 };
};

/**
 * Returns vocabulary and explanation depth guidance for a class level.
 * @param {string|number} classLevel
 * @returns {object}
 */
export const getClassProfile = (classLevel) => {
  const level = parseInt(classLevel, 10);

  if (level >= 6 && level <= 7) {
    return {
      vocabularyLevel: "simple",
      explanation: "Use very simple language, short sentences, relatable examples from daily life. Avoid jargon.",
      bulletLength: "max 8 words per bullet",
      maxBullets: 4,
      visualEmphasis: "high",
      style: "colorful and engaging, large visuals, minimal text",
    };
  }

  if (level >= 8 && level <= 10) {
    return {
      vocabularyLevel: "intermediate",
      explanation: "Use clear language with proper terminology. Include worked examples. Balance text and visuals.",
      bulletLength: "max 12 words per bullet",
      maxBullets: 5,
      visualEmphasis: "medium",
      style: "classroom-quality, professional, examples-driven",
    };
  }

  if (level >= 11 && level <= 12) {
    return {
      vocabularyLevel: "advanced",
      explanation: "Use academic language. Include derivations, proofs, formulas, and detailed explanations. Exam-oriented.",
      bulletLength: "max 18 words per bullet",
      maxBullets: 6,
      visualEmphasis: "low-medium",
      style: "academic, detailed, formula-heavy, exam-ready",
    };
  }

  return {
    vocabularyLevel: "intermediate",
    explanation: "Use clear, balanced language with examples.",
    bulletLength: "max 12 words per bullet",
    maxBullets: 5,
    visualEmphasis: "medium",
    style: "classroom-quality",
  };
};

/**
 * Returns subject-specific slide generation rules for AI prompts.
 * @param {string} subject
 * @returns {object}
 */
export const getSubjectRules = (subject) => {
  const normalized = subject.toLowerCase();

  if (normalized.includes("math")) {
    return {
      preferredLayouts: ["bullets", "formula", "comparison", "process", "quiz", "summary"],
      specialInstructions: `
- Include mathematical formulas using clear notation
- Always add at least one worked/solved example
- Use step-by-step solving for problems
- Include number line or graph references where applicable
- Add theorem statements clearly
- Include a formula recap slide
`,
      imageKeywords: "mathematical diagram, number line, graph, formula illustration",
    };
  }

  if (normalized.includes("physics")) {
    return {
      preferredLayouts: ["bullets", "formula", "process", "comparison", "diagram", "summary"],
      specialInstructions: `
- Include laws and their mathematical forms
- Add derivation steps where needed
- Include SI units for all quantities
- Reference real-world applications
- Include diagram descriptions for scientific setups
`,
      imageKeywords: "physics diagram, scientific illustration, force diagram, physics experiment",
    };
  }

  if (normalized.includes("chemistry")) {
    return {
      preferredLayouts: ["bullets", "formula", "process", "comparison", "summary"],
      specialInstructions: `
- Include chemical equations and reactions
- Add molecular structure references
- Show balancing equations step-by-step
- Include periodic table references
- Mention reaction conditions
`,
      imageKeywords: "chemistry diagram, molecular structure, chemical reaction, periodic table",
    };
  }

  if (normalized.includes("biology")) {
    return {
      preferredLayouts: ["bullets", "process", "comparison", "cards", "summary"],
      specialInstructions: `
- Reference labeled diagrams (even as text descriptions)
- Explain life processes step by step
- Include classification where relevant
- Add body system references
- Include life cycle descriptions
`,
      imageKeywords: "biology diagram, labeled anatomy, life cycle, cell diagram, ecosystem",
    };
  }

  if (normalized.includes("science")) {
    return {
      preferredLayouts: ["bullets", "process", "cards", "comparison", "summary"],
      specialInstructions: `
- Include experiments and observations
- Add cause-and-effect relationships
- Reference real-world applications
- Include process flows for natural phenomena
`,
      imageKeywords: "science diagram, educational experiment, natural process, scientific illustration",
    };
  }

  if (normalized.includes("history")) {
    return {
      preferredLayouts: ["timeline", "bullets", "comparison", "cards", "summary"],
      specialInstructions: `
- Use timeline layouts for chronological events
- Include key dates and figures
- Add cause and effect analysis
- Reference maps and historical locations
`,
      imageKeywords: "historical map, timeline, historical event, ancient civilization illustration",
    };
  }

  if (normalized.includes("geography")) {
    return {
      preferredLayouts: ["bullets", "comparison", "cards", "process", "summary"],
      specialInstructions: `
- Include map references and coordinates
- Add climate and physical feature descriptions
- Reference natural processes
- Include charts and environmental data
`,
      imageKeywords: "geography map, climate diagram, physical map, landform diagram",
    };
  }

  // Default (English, Computer Science, etc.)
  return {
    preferredLayouts: ["bullets", "cards", "comparison", "timeline", "summary"],
    specialInstructions: `
- Keep explanations clear and structured
- Include real-world examples
- Add key terms and definitions
`,
    imageKeywords: "educational diagram, classroom visual, learning illustration",
  };
};

/**
 * Returns subject-based color theme for the PPT.
 * @param {string} subject
 * @returns {{ primary: string, secondary: string, accent: string, cardBg: string }}
 */
export const getSubjectTheme = (subject) => {
  const normalized = subject.toLowerCase();

  if (normalized.includes("math")) {
    return {
      primary: "1D4ED8",      // deep blue
      secondary: "1E3A5F",
      accent: "3B82F6",
      cardBg: "EFF6FF",
      headerText: "FFFFFF",
      badge: "DBEAFE",
    };
  }

  if (normalized.includes("physics")) {
    return {
      primary: "6D28D9",      // violet
      secondary: "2E1065",
      accent: "8B5CF6",
      cardBg: "F5F3FF",
      headerText: "FFFFFF",
      badge: "EDE9FE",
    };
  }

  if (normalized.includes("chemistry")) {
    return {
      primary: "B45309",      // amber
      secondary: "451A03",
      accent: "F59E0B",
      cardBg: "FFFBEB",
      headerText: "FFFFFF",
      badge: "FEF3C7",
    };
  }

  if (normalized.includes("biology")) {
    return {
      primary: "15803D",      // emerald green
      secondary: "052E16",
      accent: "22C55E",
      cardBg: "F0FDF4",
      headerText: "FFFFFF",
      badge: "DCFCE7",
    };
  }

  if (normalized.includes("science")) {
    return {
      primary: "0F766E",      // teal
      secondary: "042F2E",
      accent: "14B8A6",
      cardBg: "F0FDFA",
      headerText: "FFFFFF",
      badge: "CCFBF1",
    };
  }

  if (normalized.includes("history")) {
    return {
      primary: "92400E",      // brown/amber
      secondary: "2C1704",
      accent: "D97706",
      cardBg: "FEFCE8",
      headerText: "FFFFFF",
      badge: "FEF9C3",
    };
  }

  if (normalized.includes("geography")) {
    return {
      primary: "065F46",      // earth green
      secondary: "022C22",
      accent: "059669",
      cardBg: "ECFDF5",
      headerText: "FFFFFF",
      badge: "D1FAE5",
    };
  }

  if (normalized.includes("english")) {
    return {
      primary: "BE185D",      // rose/pink
      secondary: "500724",
      accent: "EC4899",
      cardBg: "FDF2F8",
      headerText: "FFFFFF",
      badge: "FCE7F3",
    };
  }

  if (normalized.includes("computer")) {
    return {
      primary: "1E40AF",      // indigo blue
      secondary: "1E1B4B",
      accent: "6366F1",
      cardBg: "EEF2FF",
      headerText: "FFFFFF",
      badge: "E0E7FF",
    };
  }

  // Default
  return {
    primary: "2563EB",
    secondary: "0F172A",
    accent: "38BDF8",
    cardBg: "F0F9FF",
    headerText: "FFFFFF",
    badge: "DBEAFE",
  };
};

/**
 * Standard educational slide sequencing for a presentation.
 * Used as a reference for the AI planner to produce proper flow.
 */
export const EDUCATIONAL_SLIDE_SEQUENCE = [
  "Introduction / What is {topic}?",
  "Core Concepts / Key Definitions",
  "Detailed Explanation / Formula / Process",
  "Worked Examples / Diagrams",
  "Real-World Applications",
  "Quick Quiz / Revision Questions",
  "Summary / Key Takeaways",
];

/**
 * Allowed layout types for educational presentations.
 */
export const ALLOWED_LAYOUTS = [
  "bullets",
  "cards",
  "comparison",
  "timeline",
  "formula",
  "process",
  "quiz",
  "summary",
];

/**
 * Safe defaults if AI omits required fields.
 */
export const LAYOUT_DEFAULTS = {
  bullets: {
    type: "bullets",
    title: "Key Points",
    bullets: ["Key concept to be discussed here"],
    imageQuery: "educational diagram",
  },
  cards: {
    type: "cards",
    title: "Key Concepts",
    cards: [
      { title: "Concept 1", text: "Description of concept 1", imageQuery: "educational diagram" },
      { title: "Concept 2", text: "Description of concept 2", imageQuery: "educational diagram" },
    ],
  },
  comparison: {
    type: "comparison",
    title: "Comparison",
    left: { title: "Concept A", points: ["Point 1", "Point 2"], imageQuery: "educational diagram" },
    right: { title: "Concept B", points: ["Point 1", "Point 2"], imageQuery: "educational diagram" },
  },
  timeline: {
    type: "timeline",
    title: "Timeline",
    events: [
      { year: "Step 1", description: "First event", imageQuery: "educational diagram" },
      { year: "Step 2", description: "Second event", imageQuery: "educational diagram" },
    ],
  },
  formula: {
    type: "formula",
    title: "Formula",
    formula: "y = mx + c",
    explanation: "This formula represents a key relationship",
    steps: ["Step 1: Identify variables", "Step 2: Substitute values", "Step 3: Solve"],
    example: "Example: When m=2, x=3, c=1 → y = 7",
  },
  process: {
    type: "process",
    title: "Process",
    steps: [
      { number: 1, title: "Step 1", description: "Description of step 1" },
      { number: 2, title: "Step 2", description: "Description of step 2" },
      { number: 3, title: "Step 3", description: "Description of step 3" },
    ],
  },
  quiz: {
    type: "quiz",
    title: "Quick Quiz",
    question: "What is the key concept discussed in this topic?",
    options: ["Option A", "Option B", "Option C", "Option D"],
    answer: "Option A",
    hint: "Think about the definition from slide 2",
  },
  summary: {
    type: "summary",
    title: "Summary",
    points: ["Key point 1 from this lesson", "Key point 2 from this lesson", "Key point 3 from this lesson"],
    remember: "The most important thing to remember from this lesson",
  },
};
