// @ts-nocheck
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const checkCoverage = async (
  pdfText,
  slides
) => {

  const prompt = `
PDF CONTENT:

${pdfText.slice(0,12000)}

GENERATED SLIDES:

${JSON.stringify(slides)}

Compare them.

Return JSON:

{
  "coverage": 0,
  "missingTopics": [],
  "goodTopics": []
}
`;

  const completion =
    await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
    });

  return JSON.parse(
    completion.choices[0].message.content
  );

};
