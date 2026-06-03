// @ts-nocheck
/*
==========================================
FORMULA LAYOUT
For mathematics, physics, chemistry slides
Shows: formula box, explanation, steps, worked example
==========================================
*/

export const renderFormulaSlide = (pptx, slide, slideData, COLORS, FONTS) => {

  const formula = slideData.formula || "Formula";
  const explanation = slideData.explanation || "";
  const steps = Array.isArray(slideData.steps) ? slideData.steps : [];
  const example = slideData.example || "";

  /*
  ==========================================
  FORMULA BOX (prominent center display)
  ==========================================
  */

  // Formula container background
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1,
    y: 1.7,
    w: 11.3,
    h: 1.3,
    rectRadius: 0.08,
    fill: { color: COLORS.primary },
    line: { color: COLORS.primary, pt: 0 },
    shadow: {
      type: "outer",
      color: "000000",
      blur: 6,
      angle: 45,
      distance: 2,
      opacity: 0.15,
    },
  });

  // Formula text
  slide.addText(formula, {
    x: 1.2,
    y: 1.8,
    w: 10.9,
    h: 1.0,
    fontSize: 28,
    bold: true,
    align: "center",
    color: "FFFFFF",
    fontFace: FONTS.heading,
  });

  /*
  ==========================================
  EXPLANATION BOX
  ==========================================
  */

  if (explanation) {

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1,
      y: 3.2,
      w: 5.4,
      h: 0.7,
      rectRadius: 0.05,
      fill: { color: COLORS.badge || "EFF6FF" },
      line: { color: COLORS.accent, pt: 1 },
    });

    slide.addText("📖  " + explanation, {
      x: 1.2,
      y: 3.3,
      w: 5.2,
      h: 0.5,
      fontSize: 11,
      color: COLORS.text,
      fontFace: FONTS.body,
      wrap: true,
    });

  }

  /*
  ==========================================
  STEP-BY-STEP SOLVING (left column)
  ==========================================
  */

  slide.addText("Steps to Solve:", {
    x: 1,
    y: 4.1,
    w: 5.4,
    h: 0.3,
    fontSize: 13,
    bold: true,
    color: COLORS.primary,
    fontFace: FONTS.heading,
  });

  let stepY = 4.5;

  steps.slice(0, 4).forEach((step, i) => {

    // Step number circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 1,
      y: stepY,
      w: 0.3,
      h: 0.3,
      fill: { color: COLORS.primary },
      line: { color: COLORS.primary, pt: 0 },
    });

    slide.addText(String(i + 1), {
      x: 1,
      y: stepY + 0.03,
      w: 0.3,
      h: 0.24,
      fontSize: 10,
      bold: true,
      align: "center",
      color: "FFFFFF",
      fontFace: FONTS.body,
    });

    // Step text
    slide.addText(typeof step === "string" ? step : step.title || String(step), {
      x: 1.45,
      y: stepY + 0.02,
      w: 4.8,
      h: 0.28,
      fontSize: 11,
      color: COLORS.text,
      fontFace: FONTS.body,
    });

    stepY += 0.5;

  });

  /*
  ==========================================
  WORKED EXAMPLE BOX (right column)
  ==========================================
  */

  if (example) {

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.9,
      y: 3.2,
      w: 5.4,
      h: 3.6,
      rectRadius: 0.08,
      fill: { color: "F8FAFC" },
      line: { color: COLORS.border || "DCE3F1", pt: 1 },
      shadow: {
        type: "outer",
        color: "999999",
        blur: 2,
        angle: 45,
        distance: 1,
        opacity: 0.08,
      },
    });

    // Example label
    slide.addShape(pptx.ShapeType.rect, {
      x: 6.9,
      y: 3.2,
      w: 5.4,
      h: 0.4,
      fill: { color: COLORS.accent },
      line: { color: COLORS.accent, pt: 0 },
    });

    slide.addText("✏️  Worked Example", {
      x: 7.1,
      y: 3.25,
      w: 5.0,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: "FFFFFF",
      fontFace: FONTS.heading,
    });

    slide.addText(example, {
      x: 7.1,
      y: 3.75,
      w: 5.0,
      h: 2.8,
      fontSize: 12,
      color: COLORS.text,
      fontFace: FONTS.body,
      wrap: true,
      valign: "top",
    });

  }

};
