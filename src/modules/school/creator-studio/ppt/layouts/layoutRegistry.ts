// @ts-nocheck
import {
  renderComparisonSlide,
} from "./comparisonLayout";

import {
  renderCardsSlide,
} from "./cardsLayout";

import {
  renderBulletSlide,
} from "./bulletLayout";

import {
  renderTimelineLayout,
} from "./timelineLayout";

import {
  renderFormulaSlide,
} from "./formulaLayout";

import {
  renderProcessSlide,
} from "./processLayout";

import {
  renderQuizSlide,
} from "./quizLayout";

import {
  renderSummarySlide,
} from "./summaryLayout";

export const layoutRegistry = {

  // Existing layouts
  comparison: renderComparisonSlide,
  cards: renderCardsSlide,
  bullets: renderBulletSlide,
  timeline: renderTimelineLayout,

  // New educational layouts
  formula: renderFormulaSlide,
  process: renderProcessSlide,
  quiz: renderQuizSlide,
  summary: renderSummarySlide,

};
