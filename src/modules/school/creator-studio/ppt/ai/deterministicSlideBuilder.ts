// @ts-nocheck
export function buildSlide(slidePlan) {
  if (!slidePlan) return null;

  const layout = slidePlan.recommendedLayout || "bullets";
  const points = slidePlan.teachingPoints || [];

  const slide = {
    type: layout,
    title: slidePlan.title || "Key Concepts",
    sourceContent: "",
    imageQuery: `${slidePlan.title || "Educational"} diagram`
  };

  const contents = points.map(p => p.content || "");

  switch (layout) {
    case "formula":
      const def = points.find(p => p.type === "Definition" || p.type === "Principle");
      const math = points.find(p => p.type === "Mathematical Form");
      const example = points.find(p => p.type === "Worked Example");
      const app = points.find(p => p.type === "Application" || p.type === "Real-world Case");

      slide.conceptExplanation = def ? def.content : "";
      slide.formula = math ? math.content : "";
      slide.workedExample = example ? example.content : "";
      slide.realLifeExample = app ? app.content : "";
      slide.steps = [];
      break;

    case "process":
      slide.steps = contents;
      break;

    case "timeline":
      slide.events = points.map((p, i) => ({
        year: p.type || `Step ${i + 1}`,
        description: p.content,
        imageQuery: p.type || "diagram"
      }));
      break;

    case "summary":
      slide.points = contents;
      slide.remember = slidePlan.learningGoal || slidePlan.title || "Review the key concepts.";
      break;

    case "quiz":
      slide.question = `Knowledge Check regarding ${slidePlan.learningGoal || slidePlan.title}?`;
      slide.options = [
        contents[0] || "Correct Answer",
        "Incorrect Answer 1",
        "Incorrect Answer 2",
        "Incorrect Answer 3"
      ];
      slide.correctAnswer = contents[0] || "Correct Answer";
      break;

    case "cards":
      slide.cards = points.map(p => ({
        title: p.type || "Concept",
        text: p.content || "",
        imageQuery: p.type || "diagram"
      }));
      break;

    case "bullets":
    default:
      slide.type = "bullets";
      slide.bullets = contents;
      break;
  }

  return slide;
}
