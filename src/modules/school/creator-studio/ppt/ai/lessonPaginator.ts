// @ts-nocheck
export function paginateTeachingSection(section) {
  if (!section) return [];

  const points = Array.isArray(section.teachingPoints) ? section.teachingPoints : [];

  // If missing or small enough, return as-is
  if (!section.teachingPoints || points.length <= 3) {
    return [section];
  }

  const result = [];
  const chunkSize = 3;
  let part = 1;

  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    
    // Copy the section completely to preserve phase, purpose, recommendedLayout, learningGoal
    const newSection = { ...section };
    newSection.teachingPoints = chunk;
    
    // Add (Part N) to title if it's the second or subsequent slide
    if (part > 1) {
      newSection.title = `${section.title || "Slide"} (Part ${part})`;
    }
    
    result.push(newSection);
    part++;
  }

  return result;
}
