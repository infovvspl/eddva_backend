// @ts-nocheck
/*
==========================================
SUMMARY LAYOUT
For key takeaways and lesson summaries
Shows checkmarked key points + "Remember" callout
==========================================
*/

export const renderSummarySlide = (pptx, slide, slideData, COLORS, FONTS) => {

  const points = Array.isArray(slideData.points) ? slideData.points.slice(0, 6) : [];
  const remember = slideData.remember || "";

  /*
  ==========================================
  SUMMARY HEADER BADGE
  ==========================================
  */

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.55,
    w: 3.2,
    h: 0.5,
    rectRadius: 0.08,
    fill: { color: COLORS.primary },
    line: { color: COLORS.primary, pt: 0 },
  });

  slide.addText("📋  Key Takeaways", {
    x: 0.7,
    y: 1.6,
    w: 3.0,
    h: 0.4,
    fontSize: 13,
    bold: true,
    color: "FFFFFF",
    fontFace: FONTS.heading,
  });

  /*
  ==========================================
  KEY POINTS (with check icons)
  ==========================================
  */

  const useColumns = points.length > 3;
  const col1 = useColumns ? points.slice(0, Math.ceil(points.length / 2)) : points;
  const col2 = useColumns ? points.slice(Math.ceil(points.length / 2)) : [];

  const renderColumn = (items, startX, startY, colW) => {
    let currentY = startY;

    items.forEach((point) => {
      // Card background
      slide.addShape(pptx.ShapeType.roundRect, {
        x: startX,
        y: currentY,
        w: colW,
        h: 0.65,
        rectRadius: 0.06,
        fill: { color: "FFFFFF" },
        line: { color: COLORS.border || "DCE3F1", pt: 1 },
        shadow: {
          type: "outer",
          color: "999999",
          blur: 2,
          angle: 45,
          distance: 1,
          opacity: 0.07,
        },
      });

      // Check icon background
      slide.addShape(pptx.ShapeType.ellipse, {
        x: startX + 0.1,
        y: currentY + 0.15,
        w: 0.35,
        h: 0.35,
        fill: { color: "DCFCE7" },
        line: { color: "86EFAC", pt: 1 },
      });

      // Check mark
      slide.addText("✓", {
        x: startX + 0.1,
        y: currentY + 0.16,
        w: 0.35,
        h: 0.33,
        fontSize: 12,
        bold: true,
        align: "center",
        color: "166534",
        fontFace: FONTS.body,
      });

      // Point text
      slide.addText(typeof point === "string" ? point : String(point), {
        x: startX + 0.55,
        y: currentY + 0.13,
        w: colW - 0.65,
        h: 0.4,
        fontSize: 12,
        color: COLORS.text || "1E293B",
        fontFace: FONTS.body,
        wrap: true,
        valign: "middle",
      });

      currentY += 0.8;
    });
  };

  if (useColumns) {
    renderColumn(col1, 0.6, 2.2, 6.0);
    renderColumn(col2, 6.9, 2.2, 5.9);
  } else {
    renderColumn(col1, 0.6, 2.2, 12.1);
  }

  /*
  ==========================================
  "REMEMBER THIS" CALLOUT BOX
  ==========================================
  */

  if (remember) {

    const rememberY = useColumns
      ? 2.2 + col1.length * 0.8 + 0.3
      : 2.2 + col1.length * 0.8 + 0.3;

    const clampedY = Math.min(rememberY, 6.0);

    // Gradient-like background
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: clampedY,
      w: 12.1,
      h: 0.85,
      rectRadius: 0.08,
      fill: { color: COLORS.badge || "DBEAFE" },
      line: { color: COLORS.accent || "38BDF8", pt: 1.5 },
      shadow: {
        type: "outer",
        color: "000000",
        blur: 3,
        angle: 45,
        distance: 1,
        opacity: 0.08,
      },
    });

    // Star icon
    slide.addText("⭐", {
      x: 0.75,
      y: clampedY + 0.1,
      w: 0.5,
      h: 0.5,
      fontSize: 18,
      align: "center",
    });

    // Label
    slide.addText("Remember:", {
      x: 1.3,
      y: clampedY + 0.08,
      w: 1.5,
      h: 0.35,
      fontSize: 12,
      bold: true,
      color: COLORS.primary,
      fontFace: FONTS.heading,
    });

    // Remember text
    slide.addText(remember, {
      x: 1.3,
      y: clampedY + 0.4,
      w: 11.0,
      h: 0.38,
      fontSize: 12,
      color: COLORS.text || "1E293B",
      fontFace: FONTS.body,
      italic: true,
      wrap: true,
    });

  }

};
