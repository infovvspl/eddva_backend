/*
==========================================
JSON UTILITIES
Safe JSON parsing and cleaning for AI responses
==========================================
*/

/**
 * Cleans raw AI text to extract valid JSON.
 * Removes markdown wrappers, code fences, extra text.
 * @param {string} rawText
 * @returns {string} cleaned JSON string
 */
export const cleanJSON = (rawText) => {
  let text = rawText || "";

  // Remove ```json ... ``` and ``` ... ```
  text = text.replace(/```json\s*/gi, "");
  text = text.replace(/```\s*/gi, "");

  // Remove any leading/trailing non-JSON text
  // Extract first JSON object or array
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const arrayMatch = text.match(/\[[\s\S]*\]/);

  if (objectMatch && arrayMatch) {
    // Return whichever appears first
    return objectMatch.index < arrayMatch.index
      ? objectMatch[0]
      : arrayMatch[0];
  }

  if (objectMatch) return objectMatch[0];
  if (arrayMatch) return arrayMatch[0];

  return text.trim();
};

export const safeParseJSON = (rawText, fallback = null) => {
  try {
    const cleaned = cleanJSON(rawText);
    return JSON.parse(cleaned);
  } catch (error) {
    try {
      let hardened = cleanJSON(rawText);
      
      // Escape raw newlines inside strings
      hardened = hardened.replace(/"(?:\\.|[^"\\])*"/g, (match) => {
        return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
      });
      
      // Remove invalid control characters (including structural newlines)
      hardened = hardened.replace(/[\u0000-\u001F]+/g, "");
      
      return JSON.parse(hardened);
    } catch (hardenError) {
      console.warn("⚠️  JSON parse failed even after hardening, using fallback:", error.message);
      return fallback;
    }
  }
};

/**
 * Truncates a string to a maximum character length.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export const truncateText = (text, maxLen = 120) => {
  if (!text || typeof text !== "string") return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
};

/**
 * Ensures a value is a non-empty string.
 * @param {any} value
 * @param {string} fallback
 * @returns {string}
 */
export const ensureString = (value, fallback = "") => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
};

/**
 * Ensures a value is a non-empty array.
 * @param {any} value
 * @param {Array} fallback
 * @returns {Array}
 */
export const ensureArray = (value, fallback = []) => {
  if (Array.isArray(value) && value.length > 0) return value;
  return fallback;
};

/**
 * Normalizes bullets — handles string or object items, enforces max count and length.
 * @param {Array} bullets
 * @param {number} maxCount
 * @param {number} maxLen
 * @returns {string[]}
 */
export const normalizeBullets = (bullets, maxCount = 5, maxLen = 100) => {
  if (!Array.isArray(bullets)) return ["Key concept to be covered here"];

  return bullets
    .slice(0, maxCount)
    .map((item) => {
      if (typeof item === "string") return truncateText(item, maxLen);
      if (typeof item === "object" && item !== null) {
        return truncateText(Object.values(item).join(": "), maxLen);
      }
      return String(item);
    })
    .filter((b) => b.length > 0);
};

/**
 * Normalizes timeline events — handles string or object events.
 * @param {Array} events
 * @param {number} maxCount
 * @returns {Array}
 */
export const normalizeEvents = (events, maxCount = 6) => {
  if (!Array.isArray(events)) {
    return [{ year: "Step 1", description: "First event", imageQuery: "educational diagram" }];
  }

  return events.slice(0, maxCount).map((event) => {
    if (typeof event === "string") {
      return { year: "", description: truncateText(event, 100), imageQuery: event };
    }
    return {
      year: ensureString(event.year || event.date || event.period, ""),
      description: truncateText(
        ensureString(event.description || event.text || event.event, "Event description"),
        100
      ),
      imageQuery: ensureString(event.imageQuery || event.description, "educational diagram"),
    };
  });
};

/**
 * Validates and fills in defaults for a slide object based on its type.
 * @param {object} slide
 * @param {object} defaults - LAYOUT_DEFAULTS[type]
 * @returns {object} safe slide
 */
export const validateSlide = (slide, defaults) => {
  if (!slide || typeof slide !== "object") return defaults;
  return { ...defaults, ...slide, type: slide.type || defaults.type };
};
