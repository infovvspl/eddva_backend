// @ts-nocheck
export function checkCoverage(input) {
  const { sourceHeadings = [], sourceConcepts = [], generatedSlides = [] } = input;

  // Extract string values from inputs, handling objects if they have a 'title' or 'name' property
  const extractString = (item) => {
    if (typeof item === 'string') return item.trim();
    if (typeof item === 'object' && item !== null) {
      return (item.title || item.name || item.conceptName || "").trim();
    }
    return "";
  };

  const allTopics = [...sourceHeadings, ...sourceConcepts]
    .map(extractString)
    .filter(t => t.length > 0);

  // If there are no topics, we can't measure coverage, so assume 100%
  if (allTopics.length === 0) {
    return {
      coverage: 100,
      coveredTopics: [],
      missingTopics: [],
      recommendations: ["No source topics provided."]
    };
  }

  // Combine all slide content into one normalized searchable string
  const allSlideText = generatedSlides.map(slide => {
    const title = slide.title || "";
    const content = slide.content || slide.sourceContent || slide.bulletPoints?.join(" ") || "";
    return `${title} ${content}`.toLowerCase();
  }).join(" ");

  const coveredTopics = [];
  const missingTopics = [];

  // Stop words to ignore during token overlap matching
  const stopWords = new Set(["the", "and", "a", "to", "of", "in", "i", "is", "that", "it", "on", "you", "this", "for", "are"]);

  allTopics.forEach(topic => {
    const topicLower = topic.toLowerCase();
    let isCovered = false;

    // 1. Check for exact substring match
    if (allSlideText.includes(topicLower)) {
      isCovered = true;
    } else {
      // 2. Check for significant keyword overlap (>= 50% of meaningful words)
      const topicWords = topicLower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      
      if (topicWords.length > 0) {
        let matchedWords = 0;
        for (const word of topicWords) {
          if (allSlideText.includes(word)) {
            matchedWords++;
          }
        }
        
        if (matchedWords / topicWords.length >= 0.5) {
          isCovered = true;
        }
      }
    }

    if (isCovered) {
      coveredTopics.push(topic);
    } else {
      missingTopics.push(topic);
    }
  });

  // Calculate coverage score
  const total = coveredTopics.length + missingTopics.length;
  const coverage = total === 0 ? 100 : Math.round((coveredTopics.length / total) * 100);

  // Generate recommendations for missing topics
  const recommendations = missingTopics.map(topic => 
    `Consider adding content or a new slide to cover: "${topic}"`
  );

  return {
    coverage,
    coveredTopics,
    missingTopics,
    recommendations
  };
}
