// @ts-nocheck
/*
==========================================
PROCESS LAYOUT
For step-by-step educational processes
Shows numbered steps in a visual flow
==========================================
*/

export const renderProcessSlide = (pptx, slide, slideData, COLORS, FONTS) => {

  const steps = Array.isArray(slideData.steps) ? slideData.steps.slice(0, 5) : [];

  if (steps.length === 0) return;

  /*
  ==========================================
  LAYOUT: up to 5 steps in a row or 2-row grid
  ==========================================
  */

  const count = steps.length;
  const isNarrow = count <= 3;

  // Card width / positions
  const cardW = isNarrow ? 3.6 : 2.4;
  const cardH = 3.2;
  const startX = isNarrow
    ? (13.33 - count * (cardW + 0.4) + 0.4) / 2
    : 0.5;
  const startY = 1.9;
  const gap = isNarrow ? 0.4 : 0.35;

  // Connector line (horizontal) between cards
  if (count > 1) {
    const lineY = startY + cardH / 2;
    const lineX1 = startX + cardW;
    const lineX2 = startX + (cardW + gap) * (count - 1);

    slide.addShape(pptx.ShapeType.line, {
      x: lineX1,
      y: lineY,
      w: lineX2 - lineX1,
      h: 0,
      line: {
        color: COLORS.accent || "38BDF8",
        pt: 2,
        dashType: "dash",
      },
    });
  }

  steps.forEach((step, i) => {

    const x = startX + i * (cardW + gap);
    const stepNum = step.number || (i + 1);
    const stepTitle = step.title || `Step ${stepNum}`;
    const stepDesc = step.description || step.text || "";

    /*
    CARD BACKGROUND
    */

    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: startY,
      w: cardW,
      h: cardH,
      rectRadius: 0.1,
      fill: { color: "FFFFFF" },
      line: { color: COLORS.border || "DCE3F1", pt: 1 },
      shadow: {
        type: "outer",
        color: "999999",
        blur: 3,
        angle: 45,
        distance: 1,
        opacity: 0.1,
      },
    });

    /*
    TOP ACCENT BAR
    */

    slide.addShape(pptx.ShapeType.roundRect, {
      x: x,
      y: startY,
      w: cardW,
      h: 0.5,
      rectRadius: 0.1,
      fill: { color: COLORS.primary },
      line: { color: COLORS.primary, pt: 0 },
    });

    /*
    STEP NUMBER CIRCLE
    */

    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + cardW / 2 - 0.35,
      y: startY + 0.55,
      w: 0.7,
      h: 0.7,
      fill: { color: COLORS.accent || "38BDF8" },
      line: { color: COLORS.accent || "38BDF8", pt: 0 },
    });

    slide.addText(String(stepNum), {
      x: x + cardW / 2 - 0.35,
      y: startY + 0.58,
      w: 0.7,
      h: 0.6,
      fontSize: 18,
      bold: true,
      align: "center",
      color: "FFFFFF",
      fontFace: FONTS.heading,
    });

    /*
    STEP TITLE
    */

    slide.addText(stepTitle, {
      x: x + 0.15,
      y: startY + 1.4,
      w: cardW - 0.3,
      h: 0.5,
      fontSize: isNarrow ? 14 : 12,
      bold: true,
      align: "center",
      color: COLORS.primary,
      fontFace: FONTS.heading,
      wrap: true,
    });

    /*
    STEP DESCRIPTION
    */

    slide.addText(stepDesc, {
      x: x + 0.15,
      y: startY + 1.95,
      w: cardW - 0.3,
      h: cardH - 2.1,
      fontSize: isNarrow ? 12 : 10,
      align: "center",
      color: COLORS.text || "1E293B",
      fontFace: FONTS.body,
      wrap: true,
      valign: "top",
    });

  });

  /*
  ARROW INDICATORS BETWEEN CARDS
  */

  for (let i = 0; i < steps.length - 1; i++) {
    const arrowX = startX + (i + 1) * (cardW + gap) - gap / 2 - 0.12;
    const arrowY = startY + cardH / 2 - 0.15;

    slide.addShape(pptx.ShapeType.rightArrow, {
      x: arrowX,
      y: arrowY,
      w: 0.25,
      h: 0.3,
      fill: { color: COLORS.accent || "38BDF8" },
      line: { color: COLORS.accent || "38BDF8", pt: 0 },
    });
  }

};
