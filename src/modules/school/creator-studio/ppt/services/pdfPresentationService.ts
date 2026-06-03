// @ts-nocheck
import { extractFromPDF } from "./pdfService";
import { analyzePDF } from "../ai/pdfAnalyzer";
import { generateSlideContent } from "../ai/slideGenerator";
import { generateLessonPlan } from "../ai/lessonPlanner";
import { paginateTeachingSection } from "../ai/lessonPaginator";
import {
  buildSummaryFromSlides,
  validateSummaryContent,
} from "../ai/summaryBuilder";
import { buildSlide } from "../ai/deterministicSlideBuilder";

const USE_DETERMINISTIC_BUILDER = true;

export const buildFromPDF = async (
  fileBuffer,
  overrides = {}
) => {

  console.log("\n=== buildFromPDF CALLED ===");
  console.log("\n📄 Starting PDF extraction...");

  const pdfData = await extractFromPDF(fileBuffer, {
    classLevel: overrides.classLevel,
    subject: overrides.subject,
  });

  /*
  ==========================================
  CURRICULUM CONTEXT
  ==========================================
  */

  const classLevel =
    overrides.classLevel ||
    pdfData.detectedClass ||
    "9";

  const subject =
    (overrides.subject &&
      overrides.subject !== "General")
      ? overrides.subject
      : pdfData.detectedSubject || "General";

  const board =
    overrides.board || "CBSE";

  console.log(`   ✅ Extraction complete`);
  console.log(
    `   Subject: ${subject} | Class: ${classLevel} | Board: ${board}`
  );

  /*
  ==========================================
  PDF ANALYSIS
  ==========================================
  */

  console.log(
    "\n🧠 Step 2: Analyzing PDF structure..."
  );

  const analysis =
    await analyzePDF({

      chunks: pdfData.chunks,

      // NEW
      headings: pdfData.headings || [],
      subheadings: pdfData.subheadings || [],
      chapterTitle: pdfData.chapterTitle || "",

      detectedSubject: subject,

      detectedClass: classLevel,

      board,

    });

  const topic =
    analysis.detectedTopic ||
    "Educational Content";

  console.log(
    `   ✅ Topic detected: "${topic}"`
  );

  console.log(
    `   📋 Planned slides: ${analysis.slidePlan.length}`
  );

  const curriculumContext = {
    classLevel,
    subject,
    board,
    topic,
  };

  /*
  ==========================================
  LESSON PLANNING (NEW PEDAGOGY ENGINE)
  ==========================================
  */

  console.log("\n🧠 Step 2.5: Generating pedagogical lesson plan...");

  let expandedBlueprints = [];

  try {
    const lessonPlan = await generateLessonPlan({
      topic,
      classLevel,
      subject,
      board,
      concepts: analysis.slidePlan.map((s) => s.title || s.content),
      headings: pdfData.headings || []
    });

    if (lessonPlan && Array.isArray(lessonPlan.slideBlueprints)) {
      const expanded = [];
      for (const bp of lessonPlan.slideBlueprints) {
        const paginated = paginateTeachingSection(bp);
        expanded.push(...paginated);
      }
      expandedBlueprints = expanded;
      console.log(`   ✅ Pedagogy applied: ${lessonPlan.slideBlueprints.length} teaching sections expanded to ${expandedBlueprints.length} slide plans`);
    } else {
      throw new Error("Invalid lesson plan structure");
    }
  } catch (error) {
    console.warn("   ⚠️ Lesson planner failed, falling back to basic concept extraction:", error.message);
    expandedBlueprints = analysis.slidePlan;
  }

  /*
  ==========================================
  GENERATE SLIDES
  ==========================================
  */

  console.log(
    "\n📝 Step 3: Generating educational slides..."
  );

  const slides = [];

  for (
    let i = 0;
    i < expandedBlueprints.length;
    i++
  ) {

    const slidePlan =
      expandedBlueprints[i];

    // Ensure layout is mapped for the slideGenerator
    slidePlan.layout = slidePlan.recommendedLayout || slidePlan.layout || "bullets";

    console.log(
      `   🖼️ Slide ${i + 1}/${expandedBlueprints.length}: "${slidePlan.title}" [${slidePlan.layout}]`
    );

    try {

      /*
      IMPORTANT:
      slidePlan contains sourceContent
      which the slideGenerator prompt
      must use.
      */

      let slide;
      if (USE_DETERMINISTIC_BUILDER) {
        slide = buildSlide(slidePlan);
      } else {
        slide = await generateSlideContent(
          slidePlan,
          curriculumContext
        );
      }

      slides.push(slide);

    }

    catch (slideError) {

      console.warn(
        `⚠️ Slide ${i + 1} failed:`,
        slideError.message
      );

      slides.push({

        type: "bullets",

        title:
          slidePlan.title ||
          `Slide ${i + 1}`,

        bullets: [

          `Key concept: ${slidePlan.title || topic
          }`,

          `Based on extracted PDF content`,

          `Refer to source material for details`

        ],

      });

    }

  }

  /*
  ==========================================
  ISSUE 4: BUILD SUMMARY FROM SLIDES
  ==========================================
  
  Instead of hallucinating, extract concepts
  from all generated slides and build summary
  from actual content
  */

  const hasSummarySlide = slides.some(
    (s) => s.type === "summary"
  );

  if (!hasSummarySlide && slides.length > 0) {
    console.log("\n📌 Generating summary from slide content...");

    try {
      // Build summary from actual slide content
      const summaryContent = await buildSummaryFromSlides(
        slides,
        pdfData.cleanedText || ""
      );

      // Validate summary points exist in source
      const validated = validateSummaryContent(
        summaryContent,
        slides,
        pdfData.cleanedText || ""
      );

      const summarySlide = {
        type: "summary",
        title: "Key Takeaways",
        points: validated.points,
        remember: validated.remember,
        sourceContent: `Summary of ${topic}`,
      };

      slides.push(summarySlide);
      console.log("   ✅ Summary generated from slide content");
    } catch (summaryError) {
      console.warn(
        "⚠️ Summary generation failed:",
        summaryError.message
      );
      // Continue without summary - don't fail entire build
    }
  }

  /*
  ==========================================
  COVERAGE CHECKER (Future Enhancement)
  ==========================================

  const coverage =
    await checkCoverage(
      pdfData.cleanedText,
      slides
    );

  console.log(coverage);
  */

  console.log(
    `\n✅ PDF presentation built: ${slides.length} slides from ${pdfData.pageCount}-page PDF`
  );

  return {

    title:
      `${topic} — Class ${classLevel}`,

    tone: "Educational",

    theme: "Academic",

    targetAudience:
      `Class ${classLevel} ${subject} students`,

    classLevel,

    subject,

    board,

    topic,

    slides,

    sourceType: "pdf",

    pageCount:
      pdfData.pageCount,

  };

};
