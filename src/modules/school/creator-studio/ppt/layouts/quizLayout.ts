// @ts-nocheck
/*
==========================================
QUIZ LAYOUT
For revision and quiz slides
Shows a question with 4 MCQ options + answer reveal + hint
==========================================
*/

export const renderQuizSlide = (pptx, slide, slideData, COLORS, FONTS) => {

  const question = slideData.question || "What is the key concept from this topic?";
  const options = Array.isArray(slideData.options)
    ? slideData.options.slice(0, 4)
    : ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"];
  const answer = slideData.answer || "";
  const hint = slideData.hint || "";

  /*
  ==========================================
  QUESTION BOX
  ==========================================
  */

  // Question background
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.6,
    w: 12.1,
    h: 1.3,
    rectRadius: 0.08,
    fill: { color: COLORS.primary },
    line: { color: COLORS.primary, pt: 0 },
    shadow: {
      type: "outer",
      color: "000000",
      blur: 4,
      angle: 45,
      distance: 2,
      opacity: 0.12,
    },
  });

  // "Q." badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.75,
    y: 1.75,
    w: 0.5,
    h: 0.5,
    rectRadius: 0.04,
    fill: { color: "FFFFFF" },
    line: { color: "FFFFFF", pt: 0 },
  });

  slide.addText("Q.", {
    x: 0.75,
    y: 1.8,
    w: 0.5,
    h: 0.4,
    fontSize: 14,
    bold: true,
    align: "center",
    color: COLORS.primary,
    fontFace: FONTS.heading,
  });

  // Question text
  slide.addText(question, {
    x: 1.4,
    y: 1.7,
    w: 11.0,
    h: 1.1,
    fontSize: 16,
    bold: true,
    color: "FFFFFF",
    fontFace: FONTS.heading,
    wrap: true,
    valign: "middle",
  });

  /*
  ==========================================
  OPTIONS (2 per row)
  ==========================================
  */

  const optionColors = ["DBEAFE", "FEF3C7", "DCFCE7", "FCE7F3"];
  const optionBorders = ["93C5FD", "FCD34D", "86EFAC", "F9A8D4"];
  const optionLetters = ["A", "B", "C", "D"];

  const positions = [
    { x: 0.6, y: 3.15 },
    { x: 6.9, y: 3.15 },
    { x: 0.6, y: 4.35 },
    { x: 6.9, y: 4.35 },
  ];

  options.forEach((option, i) => {
    const pos = positions[i];
    if (!pos) return;

    // Option card
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pos.x,
      y: pos.y,
      w: 5.9,
      h: 0.9,
      rectRadius: 0.07,
      fill: { color: optionColors[i] || "F1F5F9" },
      line: { color: optionBorders[i] || "CBD5E1", pt: 1 },
      shadow: {
        type: "outer",
        color: "999999",
        blur: 2,
        angle: 45,
        distance: 1,
        opacity: 0.07,
      },
    });

    // Letter badge
    slide.addShape(pptx.ShapeType.ellipse, {
      x: pos.x + 0.15,
      y: pos.y + 0.2,
      w: 0.5,
      h: 0.5,
      fill: { color: COLORS.primary },
      line: { color: COLORS.primary, pt: 0 },
    });

    slide.addText(optionLetters[i], {
      x: pos.x + 0.15,
      y: pos.y + 0.22,
      w: 0.5,
      h: 0.46,
      fontSize: 13,
      bold: true,
      align: "center",
      color: "FFFFFF",
      fontFace: FONTS.heading,
    });

    // Option text (strip leading "A) " if already there)
    const optionText = option.replace(/^[A-D]\)\s*/i, "");

    slide.addText(optionText, {
      x: pos.x + 0.8,
      y: pos.y + 0.2,
      w: 4.9,
      h: 0.5,
      fontSize: 13,
      color: COLORS.text || "1E293B",
      fontFace: FONTS.body,
      wrap: true,
      valign: "middle",
    });

  });

  /*
  ==========================================
  ANSWER + HINT ROW
  ==========================================
  */

  let bottomY = 5.5;

  // Answer box
  if (answer) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: bottomY,
      w: 6.1,
      h: 0.7,
      rectRadius: 0.05,
      fill: { color: "DCFCE7" },
      line: { color: "86EFAC", pt: 1 },
    });

    slide.addText(`✅  Answer: ${answer}`, {
      x: 0.8,
      y: bottomY + 0.12,
      w: 5.7,
      h: 0.46,
      fontSize: 12,
      bold: true,
      color: "166534",
      fontFace: FONTS.body,
      wrap: true,
    });
  }

  // Hint box
  if (hint) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.9,
      y: bottomY,
      w: 5.9,
      h: 0.7,
      rectRadius: 0.05,
      fill: { color: "FEF9C3" },
      line: { color: "FDE047", pt: 1 },
    });

    slide.addText(`💡  Hint: ${hint}`, {
      x: 7.1,
      y: bottomY + 0.12,
      w: 5.5,
      h: 0.46,
      fontSize: 11,
      color: "713F12",
      fontFace: FONTS.body,
      wrap: true,
    });
  }

};
