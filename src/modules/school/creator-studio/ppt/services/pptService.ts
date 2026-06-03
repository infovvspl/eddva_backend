// @ts-nocheck
import pptxgen from "pptxgenjs";

import { layoutRegistry } from "../layouts/layoutRegistry";
import { getSubjectTheme } from "../ai/curriculumConfig";

/*
==========================================
CREATE PPT
Main PPT generation function.
Accepts curriculum context for theming.
==========================================
*/

export const createPPT = async (slidesData, outputPath, context) => {

  /*
  ==========================================
  NORMALIZE CONTEXT — backward compatible
  ==========================================
  */

  let classLevel, subject, board, topic;

  if (typeof context === "string") {
    topic = context;
    classLevel = "9";
    subject = "General";
    board = "CBSE";
  } else {
    classLevel = context.classLevel || "9";
    subject = context.subject || "General";
    board = context.board || "CBSE";
    topic = context.topic || "Presentation";
  }

  /*
  ==========================================
  SUBJECT THEME
  ==========================================
  */

  const theme = getSubjectTheme(subject);

  const COLORS = {
    primary: theme.primary,
    secondary: theme.secondary,
    accent: theme.accent,
    background: "F8FAFC",
    text: "1E293B",
    muted: "64748B",
    border: "DCE3F1",
    success: "DCFCE7",
    info: "DBEAFE",
    badge: theme.badge,
    cardBg: theme.cardBg,
  };

  const FONTS = {
    heading: "Aptos Display",
    body: "Aptos",
  };

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";

  /*
  ==========================================
  TITLE SLIDE — Educational cover
  ==========================================
  */

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: COLORS.secondary };

  // Full background gradient strip (top area)
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 5.2,
    fill: { color: theme.primary },
    line: { color: theme.primary },
  });

  // Decorative circles (visual depth)
  titleSlide.addShape(pptx.ShapeType.ellipse, {
    x: -0.8, y: -0.8, w: 3.5, h: 3.5,
    fill: { color: "FFFFFF", transparency: 90 },
    line: { color: "FFFFFF", transparency: 90 },
  });

  titleSlide.addShape(pptx.ShapeType.ellipse, {
    x: 10.5, y: 2.5, w: 4, h: 4,
    fill: { color: "FFFFFF", transparency: 90 },
    line: { color: "FFFFFF", transparency: 90 },
  });

  titleSlide.addShape(pptx.ShapeType.ellipse, {
    x: 5.5, y: -1.5, w: 2.5, h: 2.5,
    fill: { color: "FFFFFF", transparency: 92 },
    line: { color: "FFFFFF", transparency: 92 },
  });

  // Board + Class badge (top-left)
  titleSlide.addShape(pptx.ShapeType.roundRect, {
    x: 0.7, y: 0.5, w: 3.2, h: 0.5,
    rectRadius: 0.06,
    fill: { color: "FFFFFF", transparency: 80 },
    line: { color: "FFFFFF", transparency: 70 },
  });

  titleSlide.addText(`${board}  ·  Class ${classLevel}`, {
    x: 0.75, y: 0.55, w: 3.1, h: 0.4,
    fontSize: 12, bold: true,
    color: "FFFFFF",
    fontFace: FONTS.body,
    align: "center",
  });

  // Subject pill (top-right)
  titleSlide.addShape(pptx.ShapeType.roundRect, {
    x: 9.4, y: 0.5, w: 3.2, h: 0.5,
    rectRadius: 0.06,
    fill: { color: "FFFFFF", transparency: 80 },
    line: { color: "FFFFFF", transparency: 70 },
  });

  titleSlide.addText(`📚  ${subject}`, {
    x: 9.45, y: 0.55, w: 3.1, h: 0.4,
    fontSize: 12, bold: true,
    color: "FFFFFF",
    fontFace: FONTS.body,
    align: "center",
  });

  // Horizontal rule
  titleSlide.addShape(pptx.ShapeType.line, {
    x: 0.7, y: 1.3, w: 11.9, h: 0,
    line: { color: "FFFFFF", transparency: 60, pt: 1 },
  });

  // Main topic title
  titleSlide.addText(topic, {
    x: 0.6, y: 1.55, w: 12.1, h: 1.8,
    fontSize: 36,
    bold: true,
    align: "center",
    color: "FFFFFF",
    fontFace: FONTS.heading,
    wrap: true,
    valign: "middle",
  });

  // Subtitle line
  titleSlide.addText("An Educational Presentation", {
    x: 0.6, y: 3.45, w: 12.1, h: 0.4,
    fontSize: 14,
    align: "center",
    color: "FFFFFF",
    fontFace: FONTS.body,
    transparency: 20,
    italic: true,
  });

  // Bottom info bar
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 5.2, w: 13.33, h: 2.38,
    fill: { color: COLORS.secondary },
    line: { color: COLORS.secondary },
  });

  // Slide count info
  titleSlide.addText(`${slidesData.length + 1} Slides`, {
    x: 0.7, y: 5.5, w: 2.5, h: 0.5,
    fontSize: 13,
    color: theme.accent,
    bold: true,
    fontFace: FONTS.body,
  });

  // AI badge
  titleSlide.addShape(pptx.ShapeType.roundRect, {
    x: 3.5, y: 5.5, w: 6.3, h: 0.5,
    rectRadius: 0.05,
    fill: { color: "FFFFFF", transparency: 90 },
    line: { color: "FFFFFF", transparency: 80 },
  });

  titleSlide.addText("🎓  AI Educational Classroom Presentation Generator", {
    x: 3.5, y: 5.52, w: 6.3, h: 0.46,
    fontSize: 11,
    align: "center",
    color: "FFFFFF",
    fontFace: FONTS.body,
    transparency: 10,
  });

  // Slide number (white top bar slide)
  titleSlide.addText("1", {
    x: 12.4, y: 5.5,
    w: 0.6, h: 0.4,
    fontSize: 12, bold: true,
    color: COLORS.muted,
    align: "center",
    fontFace: FONTS.body,
  });

  /*
  ==========================================
  CONTENT SLIDES
  ==========================================
  */

  slidesData.forEach((slideData, index) => {

    const slide = pptx.addSlide();
    slide.background = { color: COLORS.background };

    /*
    TOP HEADER BAR
    */

    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.55,
      fill: { color: COLORS.primary },
      line: { color: COLORS.primary },
    });

    // Subject + Board label in header
    slide.addText(`${subject}  ·  Class ${classLevel}  ·  ${board}`, {
      x: 0.3, y: 0.08, w: 7, h: 0.38,
      fontSize: 10,
      color: "FFFFFF",
      fontFace: FONTS.body,
      transparency: 20,
    });

    // Slide number (top right)
    slide.addText(`${index + 2} / ${slidesData.length + 1}`, {
      x: 11.5, y: 0.1, w: 1.6, h: 0.35,
      fontSize: 10, bold: true,
      color: "FFFFFF",
      align: "right",
      fontFace: FONTS.body,
    });

    /*
    SLIDE TITLE
    */

    slide.addText(slideData.title || "Untitled", {
      x: 0.6, y: 0.75,
      w: 11.5, h: 0.65,
      fontSize: 22, bold: true,
      color: COLORS.secondary,
      fontFace: FONTS.heading,
      wrap: true,
    });

    // Title underline accent
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6, y: 1.45,
      w: 2.5, h: 0.045,
      fill: { color: COLORS.accent },
      line: { color: COLORS.accent },
    });

    /*
    LAYOUT RENDERING
    */

    const renderLayout = layoutRegistry[slideData.type];

    if (renderLayout) {
      try {
        renderLayout(pptx, slide, slideData, COLORS, FONTS);
      } catch (layoutError) {
        console.warn(`⚠️  Layout render failed for "${slideData.title}":`, layoutError.message);
        // Fallback: render as bullets
        if (layoutRegistry.bullets && slideData.type !== "bullets") {
          const safeFallback = {
            ...slideData,
            type: "bullets",
            bullets: slideData.bullets ||
              slideData.points ||
              (slideData.steps || []).map((s) => `${s.title || ""}: ${s.description || ""}`).filter(Boolean) ||
              ["Content from " + (slideData.title || "this slide")],
          };
          try {
            layoutRegistry.bullets(pptx, slide, safeFallback, COLORS, FONTS);
          } catch (_) {
            // Silent failsafe
          }
        }
      }
    } else {
      // Unknown layout → fallback bullets
      const bullets = slideData.bullets || slideData.points || ["Content for this slide"];
      const fallbackSlide = { ...slideData, type: "bullets", bullets };
      try {
        layoutRegistry.bullets && layoutRegistry.bullets(pptx, slide, fallbackSlide, COLORS, FONTS);
      } catch (_) {
        // Silent failsafe
      }
    }

    /*
    FOOTER
    */

    slide.addShape(pptx.ShapeType.line, {
      x: 0.6, y: 7.05, w: 12.1, h: 0,
      line: { color: COLORS.border, pt: 0.5 },
    });

    slide.addText(`${topic}  ·  ${subject}  ·  Class ${classLevel}`, {
      x: 0.6, y: 7.1, w: 9, h: 0.25,
      fontSize: 8,
      color: COLORS.muted,
      fontFace: FONTS.body,
    });

    slide.addText("AI Educational PPT", {
      x: 10.0, y: 7.1, w: 3.1, h: 0.25,
      fontSize: 8,
      color: COLORS.muted,
      align: "right",
      fontFace: FONTS.body,
    });

  });

  /*
  ==========================================
  WRITE FILE
  ==========================================
  */

  return await pptx.write({ outputType: 'nodebuffer' });
};
