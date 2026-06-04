import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { Groq } from 'groq-sdk';
import { cleanJsonResponse } from './utils/mindmap.utils';

console.log(
  '[MindmapService] GROQ_API_KEY:',
  process.env.GROQ_API_KEY?.substring(0, 12)
);

const PROMPT_TEMPLATE = `
You are an expert educational curriculum designer.

Generate a COMPREHENSIVE educational mindmap for:

TOPIC: "{topic}"

==================================================
STRICT REQUIREMENTS
==================================================

The output MUST resemble:
- a textbook chapter structure
- a teacher-created study guide
- a complete educational concept map

NOT a short overview.

==================================================
MANDATORY STRUCTURE RULES
==================================================

You MUST generate:

- minimum 6 major branches
- each major branch MUST contain 3-5 subtopics
- each subtopic SHOULD contain nested educational details
- process topics MUST show chronological flow

==================================================
VERY IMPORTANT
==================================================

DO NOT generate tiny trees.

BAD OUTPUT:
- 3 branches only
- shallow nodes
- missing important concepts

GOOD OUTPUT:
- comprehensive educational hierarchy
- rich nested structure
- full topic coverage

==================================================
DIGESTION EXAMPLE
==================================================

For "Digestion", include branches such as:

- Mouth
- Esophagus
- Stomach
- Small Intestine
- Large Intestine
- Accessory Organs
- Digestive Enzymes
- Nutrient Absorption
- Waste Elimination

Each branch should contain:
- functions
- processes
- enzymes
- structures
- absorption
- movement
- educational details

==================================================
JSON STRUCTURE
==================================================

Return ONLY valid JSON.

Use EXACTLY this structure:

{
  "title": "Main Topic",
  "ordered": true,
  "children": [
    {
      "title": "Subtopic",
      "sequence": "1",
      "description": "Educational explanation.",
      "key_points": [
        "Important point 1",
        "Important point 2",
        "Important point 3"
      ],
      "next_process": "Next process",
      "children": [
        {
          "title": "Nested Topic",
          "sequence": "1.1",
          "description": "Educational explanation.",
          "key_points": [
            "Educational point",
            "Educational point"
          ],
          "next_process": null,
          "children": []
        }
      ]
    }
  ]
}

==================================================
DESCRIPTION RULES
==================================================

Descriptions MUST:
- explain concepts clearly
- contain meaningful educational detail
- contain 15-30 words
- help student understanding

==================================================
KEY POINT RULES
==================================================

Each node MUST contain:
- 3 educational key points

==================================================
PROCESS FLOW RULES
==================================================

For process-based topics:
- preserve exact order
- include transitions
- maintain chronology

==================================================
VERY IMPORTANT
==================================================

Return ONLY valid JSON.
No markdown.
No explanations.
No backticks.
`;

@Injectable()
export class MindmapService {
  private readonly logger = new Logger(MindmapService.name);
  private groqClient: Groq;

  constructor() {
    const key = process.env.GROQ_API_KEY || '';
    this.logger.log(`GROQ_API_KEY exists: ${!!key}`);
    if (key) {
      this.logger.log(`GROQ_API_KEY (first 8 chars): ${key.substring(0, 8)}...`);
    }

    this.groqClient = new Groq({
      apiKey: key,
    });
  }

  async generateMindmap(topic: string): Promise<any> {
    this.logger.log(`Generating mindmap for topic: ${topic}`);
    const prompt = PROMPT_TEMPLATE.replace('{topic}', topic);

    try {
      const response = await this.groqClient.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content || '';
      const cleanedContent = cleanJsonResponse(content);

      const mindmapJson = JSON.parse(cleanedContent);
      return mindmapJson;
    } catch (error: any) {
      this.logger.error(`Failed to generate mindmap: ${error.message}`);
      throw new InternalServerErrorException('Failed to generate mindmap');
    }
  }
}
