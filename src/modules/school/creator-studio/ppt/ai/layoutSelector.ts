// @ts-nocheck
export function selectLayout(input) {
  const title = input.title || "";
  const content = input.content || "";
  const conceptType = input.conceptType || "";
  const subject = input.subject || "";

  const textToAnalyze = `${title}\n${content}\n${conceptType}\n${subject}`.toLowerCase();
  const titleLower = title.toLowerCase();

  // 1. Mathematical formula detected -> formula
  if (
    textToAnalyze.match(/\b(formula|equation|theorem|calculate|math)\b/) ||
    textToAnalyze.match(/[∑∫√πθ]/) ||
    textToAnalyze.match(/\b[xy]\s*=\s*/)
  ) {
    return {
      layout: "formula",
      confidence: 0.85,
      reason: "Mathematical formula or keywords detected."
    };
  }

  // 2. Contains chronology/year/history sequence -> timeline
  if (
    textToAnalyze.match(/\b(chronology|history|sequence|timeline|dates)\b/) ||
    textToAnalyze.match(/\b(18|19|20)\d{2}\b/) // Matches years like 18xx, 19xx, 20xx
  ) {
    return {
      layout: "timeline",
      confidence: 0.8,
      reason: "Chronological sequence or historical years detected."
    };
  }

  // 3. Contains steps/process/workflow -> process
  if (
    textToAnalyze.match(/\b(step|steps|process|workflow|phase|phases|procedure|how to)\b/) ||
    textToAnalyze.match(/step\s+\d/i)
  ) {
    return {
      layout: "process",
      confidence: 0.8,
      reason: "Process, workflow, or step-by-step instructions detected."
    };
  }

  // 4. Contains compare/vs/difference -> comparison
  if (
    textToAnalyze.match(/\b(compare|comparison|vs\.?|versus|difference|differences|pros and cons|advantages)\b/)
  ) {
    return {
      layout: "comparison",
      confidence: 0.8,
      reason: "Comparison, differences, or versus keywords detected."
    };
  }

  // 5. Contains categories/types/classification -> cards
  if (
    textToAnalyze.match(/\b(category|categories|type|types|classification|classify|kinds of)\b/)
  ) {
    return {
      layout: "cards",
      confidence: 0.75,
      reason: "Categorization or classification keywords detected."
    };
  }

  // 6. Contains question/options/MCQ -> quiz
  if (
    textToAnalyze.match(/\b(question|questions|option|options|mcq|quiz|test)\b/) ||
    titleLower.includes("?")
  ) {
    return {
      layout: "quiz",
      confidence: 0.8,
      reason: "Quiz questions, options, or MCQ formats detected."
    };
  }

  // 7. Contains recap/key takeaways -> summary
  if (
    textToAnalyze.match(/\b(recap|takeaway|takeaways|summary|summarize|conclusion)\b/)
  ) {
    return {
      layout: "summary",
      confidence: 0.85,
      reason: "Summary, recap, or key takeaways detected."
    };
  }

  // Otherwise -> bullets
  return {
    layout: "bullets",
    confidence: 0.5,
    reason: "No specific layout pattern detected, defaulting to bullets."
  };
}
