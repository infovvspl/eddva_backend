// @ts-nocheck
import {
  generatePresentationPlan,
} from "./plannerService";

import {
  generateSlideContent,
} from "../ai/slideGenerator";

import {
  generateLessonPlan,
} from "../ai/lessonPlanner";

import { paginateTeachingSection } from "../ai/lessonPaginator";
import { buildSlide } from "../ai/deterministicSlideBuilder";

const USE_DETERMINISTIC_BUILDER = true;

/**
 * Builds a complete curriculum-aware presentation.
 * Accepts full curriculum context or legacy topic string.
 *
 * @param {object|string} context - { classLevel, subject, board, topic } or topic string
 * @returns {object} complete presentation data
 */
export const buildPresentation = async (context) => {

  /*
  ==========================================
  NORMALIZE INPUT — backward compatible
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
    topic = context.topic || "Introduction";
  }

  const curriculumContext = { classLevel, subject, board, topic };

  console.log(`\n📚 Building presentation:`);
  console.log(`   Class: ${classLevel} | Subject: ${subject} | Board: ${board}`);
  console.log(`   Topic: ${topic}\n`);

  /*
  ==========================================
  STEP 1: GENERATE PRESENTATION PLAN
  ==========================================
  */

  console.log("🗺️  Step 1: Planning presentation...");

  const plan = await generatePresentationPlan(curriculumContext);

  console.log(`   ✅ Plan created: ${plan.slides.length} slides planned`);

  try {
    console.log("   🧠 Enhancing with educational Lesson Planner...");
    const lessonPlan = await generateLessonPlan({
      topic,
      classLevel,
      subject,
      board,
      concepts: plan.slides.map(s => s.title),
      headings: plan.slides.map(s => s.title)
    });

    if (lessonPlan && Array.isArray(lessonPlan.slideBlueprints)) {
      let expandedBlueprints = lessonPlan.slideBlueprints;
      try {
        const expanded = [];
        for (const bp of lessonPlan.slideBlueprints) {
          const paginated = paginateTeachingSection(bp);
          expanded.push(...paginated);
        }
        console.log(`   Original Teaching Sections: ${lessonPlan.slideBlueprints.length}`);
        console.log(`   Expanded Slide Plans: ${expanded.length}`);
        expandedBlueprints = expanded;
      } catch (err) {
        console.warn("   ⚠️ Paginator failed, falling back to original blueprint array.", err.message);
        expandedBlueprints = lessonPlan.slideBlueprints;
      }

      const originalCount = plan.slides.length;

      const enhancedSlides = expandedBlueprints.map((bp, index) => {
        const originalLayout = plan.slides[index]?.layout;
        return {
          ...bp,
          title: bp.title,
          purpose: bp.purpose,
          layout: bp.recommendedLayout || originalLayout
        };
      });

      // Preserve current slide count rules
      if (enhancedSlides.length > originalCount) {
        plan.slides = enhancedSlides.slice(0, originalCount);
      } else if (enhancedSlides.length < originalCount) {
        plan.slides = [
          ...enhancedSlides,
          ...plan.slides.slice(enhancedSlides.length)
        ];
      } else {
        plan.slides = enhancedSlides;
      }

      console.log(`   ✅ Lesson plan applied successfully`);
    }
  } catch (error) {
    console.warn("   ⚠️ Lesson planner failed, continuing with existing plan:", error.message);
  }

  /*
  ==========================================
  STEP 2: GENERATE ALL SLIDES SEQUENTIALLY
  ==========================================
  */

  console.log("📝 Step 2: Generating slides...");

  const slides = [];

  for (let i = 0; i < plan.slides.length; i++) {

    const slidePlan = plan.slides[i];

    console.log(`   🖼️  Slide ${i + 1}/${plan.slides.length}: "${slidePlan.title}" [${slidePlan.layout}]`);

    try {

      let slide;
      if (USE_DETERMINISTIC_BUILDER) {
        slide = buildSlide(slidePlan);
      } else {
        slide = await generateSlideContent(slidePlan, curriculumContext);
      }
      slides.push(slide);

    } catch (slideError) {

      // Individual slide failure should NOT stop the whole presentation
      console.warn(`   ⚠️  Slide ${i + 1} failed, using safe fallback`);

      slides.push({
        type: "bullets",
        title: slidePlan.title || `Slide ${i + 1}`,
        bullets: [
          "Key concept from " + topic,
          "Important term related to " + subject,
          "Refer to textbook for details",
        ],
      });

    }

  }

  console.log(`\n✅ All ${slides.length} slides generated`);

  /*
  ==========================================
  STEP 3: RETURN COMPLETE PRESENTATION
  ==========================================
  */

  return {
    title: plan.presentationTitle || `${topic} — Class ${classLevel}`,
    tone: plan.tone || "Educational",
    theme: plan.theme || "Academic",
    targetAudience: plan.targetAudience || `Class ${classLevel} ${subject} students`,
    classLevel,
    subject,
    board,
    topic,
    slides,
  };

};
