function replaceNewlinesOutsideMath(text) {
  const displayParts = text.split("$$");
  for (let i = 0; i < displayParts.length; i += 2) {
    const inlineParts = displayParts[i].split("$");
    for (let j = 0; j < inlineParts.length; j += 2) {
      const lines = inlineParts[j].split(/\r?\n/);
      let result = "";
      for (let k = 0; k < lines.length; k++) {
        const currentLine = lines[k].trim();
        const nextLine = (lines[k + 1] ?? "").trim();
        
        result += lines[k];
        if (k < lines.length - 1) {
          const endsWithOperator = /[+\-/=,\\&|]$/.test(currentLine);
          const startsWithOperator = /^[+\/=)\]},]/.test(nextLine) || /^-[^ ]/.test(nextLine) || /^\(\d+\)\s*[+\-/=]/.test(nextLine);
          const isContinuation = endsWithOperator || startsWithOperator;
          
          if (isContinuation) {
            result += " ";
          } else {
            result += "\n\n";
          }
        }
      }
      inlineParts[j] = result;
    }
    displayParts[i] = inlineParts.join("$");
  }
  return displayParts.join("$$");
}

function normalizeBrokenMathText(text) {
  return text
    // Adjacent inline-code math spans can arrive as `formula``next formula`.
    // Add a real separator before removing math-only backticks.
    .replace(/([A-Za-z0-9_{}^)\]])``(?=[A-Za-z])/g, "$1`\n\n`")
    // Some transcripts/LLM outputs split a fraction-like expression as:
    // S = k \ 
    // P
    // KaTeX treats the lone backslash as an invalid command, so convert it to division.
    .replace(/([A-Za-z0-9_{}^)\]])[ \t]*\\[ \t\r\n]+([A-Za-z0-9_{}^(])/g, "$1/$2")
    // Also handle the same artifact when the backslash was already collapsed onto one line.
    .replace(/([A-Za-z0-9_{}^)\]])\s+\\\s+([A-Za-z0-9_{}^(])/g, "$1/$2")
    // A common bad transcript form for multiplication is "\ *".
    .replace(/\\\s*\*\s*/g, "\\cdot ")
    // Raw generated equations often use programming multiplication. KaTeX accepts \cdot more reliably.
    .replace(/([A-Za-z0-9_{}^)\]])\s*\*\s*([A-Za-z0-9_{}^(])/g, "$1 \\cdot $2");
}

function unwrapMathCodeSpans(text) {
  return text.replace(/(`+)([\s\S]*?)\1/g, (match, _ticks, inner) => {
    const isLikelyCode = /\b(?:const|let|var|function|return|import|export|class|interface|type)\b/.test(inner);
    const isLikelyMath =
      /(?:^|[\s(])[A-Za-z]{1,3}\s*=/.test(inner) ||
      /[A-Za-z]{1,4}_[A-Za-z0-9]{1,4}/.test(inner) ||
      /[A-Za-z0-9_{}^)\]][ \t]*\\[ \t\r\n]+[A-Za-z0-9_{}^(]/.test(inner) ||
      /\\(frac|sqrt|cdot|times|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\b/.test(inner);

    return isLikelyMath && !isLikelyCode ? inner : match;
  });
}

function wrapStandaloneSubscriptVariables(text) {
  return text
    .split("$")
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(^|[^A-Za-z0-9$\\])([A-Za-z]{1,3}_[A-Za-z0-9]{1,3})(?![A-Za-z0-9$])/g,
        "$1$$$2$",
      );
    })
    .join("$");
}

function wrapFullEquationLines(text) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes("$")) return line;
      if (!/[=]/.test(trimmed)) return line;
      if (!/^[A-Za-z0-9_{}^()[\].=+\-*/\\\s]+$/.test(trimmed)) return line;

      const startsLikeEquation = /^[A-Za-z]{1,4}(?:_[A-Za-z0-9]{1,4})?\s*=/.test(trimmed);
      const hasRepeatedEquals = (trimmed.match(/=/g) ?? []).length >= 2;
      const hasMathOperator = /(?:\\cdot|[+\-*/^_])/.test(trimmed);
      if (!startsLikeEquation || (!hasRepeatedEquals && !hasMathOperator)) return line;

      const prefix = line.match(/^\s*/)?.[0] ?? "";
      const suffix = line.match(/\s*$/)?.[0] ?? "";
      return `${prefix}$${trimmed}$${suffix}`;
    })
    .join("\n");
}

/** Wrap structured, un-delimited LaTeX commands found inside prose. */
function wrapStructuredLatex(text) {
  let result = "";
  let position = 0;

  while (position < text.length) {
    const relativeStart = text.slice(position).search(/\\[A-Za-z]+/);
    if (relativeStart < 0) return result + text.slice(position);

    const start = position + relativeStart;
    result += text.slice(position, start);
    let cursor = start + text.slice(start).match(/^\\[A-Za-z]+/)[0].length;
    let end = cursor;
    let hasStructure = false;

    const consumeGroup = (at) => {
      if (text[at] !== "{") return at;
      let depth = 0;
      for (let i = at; i < text.length; i++) {
        if (/\r|\n/.test(text[i])) return at;
        if (text[i] === "{" && text[i - 1] !== "\\") depth++;
        if (text[i] === "}" && text[i - 1] !== "\\") {
          depth--;
          if (depth === 0) return i + 1;
        }
      }
      return at;
    };

    while (cursor < text.length) {
      const whitespaceStart = cursor;
      while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor++;

      if (text[cursor] === "{") {
        const groupEnd = consumeGroup(cursor);
        if (groupEnd === cursor) break;
        cursor = groupEnd;
        end = cursor;
        hasStructure = true;
        continue;
      }

      if (text[cursor] === "_" || text[cursor] === "^") {
        cursor++;
        while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor++;
        const groupEnd = consumeGroup(cursor);
        cursor = groupEnd > cursor ? groupEnd : Math.min(cursor + 1, text.length);
        end = cursor;
        hasStructure = true;
        continue;
      }

      cursor = whitespaceStart;
      break;
    }

    if (hasStructure) {
      result += `$${text.slice(start, end)}$`;
      position = end;
    } else {
      result += text.slice(start, cursor);
      position = cursor;
    }
  }

  return result;
}

const formatMarkdown = (text) => {
  if (!text) return "";
  
  let formatted = text
    // 1. Unescape double-escaped backslashes from JSON payloads
    .replace(/\\\\/g, "\\")
    // 2. Restore form feeds and other control characters that might be mangled backslash sequences
    .replace(/\x0C/g, "\\f")
    .replace(/\x0B/g, "\\v")
    .replace(/\x07/g, "\\a")
    .replace(/\x08/g, "\\b")
    // 3. Keep carriage returns as simple newlines
    .replace(/\\n(?![a-zA-Z])/g, "\n");

  // Remove redundant caption/figure lines that follow right after an image tag.
  // e.g. ![caption](url)\n*caption* or ![caption](url)\n*Figure: caption*
  formatted = formatted.replace(
    /(!\[([^\]]+?)\]\([^\)]+?\))[\s\r\n]*\*+(?:Figure:\s*)?([^\n*]+?)\*+/gi,
    (match, imgTag, altText, italicText) => {
      const cleanAlt = altText.split("<<NOTE_IMAGE_OVERLAY")[0].trim().toLowerCase();
      const cleanItalic = italicText.trim().toLowerCase();
      if (cleanAlt === cleanItalic || cleanAlt.includes(cleanItalic) || cleanItalic.includes(cleanAlt)) {
        return imgTag;
      }
      return match;
    }
  );

  formatted = normalizeBrokenMathText(formatted);
  formatted = unwrapMathCodeSpans(formatted);
  formatted = wrapFullEquationLines(formatted);

  // Split single $ blocks that span across newlines so they render correctly
  formatted = formatted.replace(/(^|[^$])\$([^$]+)\$(?!\$)/g, (match, prefix, p1) => {
    if (!p1.includes("\n")) return match;
    const transformed = p1.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const hasWordSpaces = /[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(trimmed);
      if (hasWordSpaces) return line;
      return `$${trimmed}$`;
    }).join("\n");
    return `${prefix}${transformed}`;
  });

  // Move exam/year into a dedicated badge marker. Accept common AI variants
  // while ensuring the year is not repeated in the visible question text.
  const examYearPattern = String.raw`(?:CBSE(?:\s+Class\s+\d+)?\s+\d{4}|CLASS\s+\d+\s+\d{4}|NEET(?:\s+UG)?\s+\d{4}|JEE(?:\s+(?:Main|Advanced))?\s+\d{4})`;
  formatted = formatted.replace(
    new RegExp(String.raw`(?:\r?\n|^)\s*(?:Q\s*)?(\d+)[.)]\s*(?:\*\*)?(?:\[|\()?\s*(${examYearPattern})\s*(?:\]|\))?(?:\*\*)?[ \t]*[:.\u2014\u2013-]?[ \t]*`, "gi"),
    (_match, num, tag) => `\n${num}. [EXAMTAG: ${tag}] `,
  );
  formatted = formatted.replace(
    new RegExp(String.raw`(?:\r?\n|^)\s*(?:Q\s*)?(\d+)[.)]\s*(.*?)(?:\[|\()\s*(${examYearPattern})\s*(?:\]|\))[ \t]*(?=\r?\n|$)`, "gi"),
    (_match, num, question, tag) => `\n${num}. [EXAMTAG: ${tag}] ${String(question).trim()}`,
  );
  formatted = formatted.replace(
    /^(\s*\d+\.\s*\[EXAMTAG:\s*([^\]]+)\]\s*)(.*)$/gim,
    (_match, prefix, tag, question) => {
      const escapedTag = String(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const duplicateTag = new RegExp(String.raw`\s*(?:\*\*)?(?:\[|\()?\s*${escapedTag}\s*(?:\]|\))?(?:\*\*)?\s*[:.\u2014\u2013-]?\s*`, "gi");
      return `${prefix}${String(question).replace(duplicateTag, " ").trim()}`;
    },
  );

  // If there's a newline after normalized EXAMTAG or question number, followed by the question text (not options/headers/bullet points), pull it to the same line
  const pullRegex = new RegExp(String.raw`(\d+[.)](?:\s*\[\s*EXAMTAG:\s*[^\]]+\s*\])?)\s*(?:\r?\n)+\s*(?!(?:[A-D][.):]\s*|\([A-D]\)\s*|\d+[.)]\s*|Q\d+\b|#{1,6}\s|[-*+]\s))`, "gi");
  formatted = formatted.replace(pullRegex, "$1 ");

  // Merge stacked option letters with their contents (e.g. A.\n0 -> A. 0)
  formatted = formatted.replace(
    /(?:\r?\n|^)\s*\b([A-D])\b[ \t.:\)]*\r?\n[ \t]*(?![A-D]\b|(?:Q\s*)?\d+[.)]\s|#{1,6}\s)([^\n]+)/gi,
    '\n$1. $2',
  );

  // Split inline options onto newlines (e.g. A. Opt1 B. Opt2 -> A. Opt1 \n B. Opt2)
  formatted = formatted.replace(/(?:\s+|\b)A[\s.:\)]+(.*?)\s+B[\s.:\)]+(.*?)\s+C[\s.:\)]+(.*?)\s+D[\s.:\)]+([^\n]*)/gi, '\n\nA. $1\n\nB. $2\n\nC. $3\n\nD. $4');

  // Split inline Q&A onto newlines
  formatted = formatted.replace(/(\*\*Q\d+\..*?\*\*)\s*(\*\*A\..*?)/gi, '$1\n\n$2');
  formatted = formatted.replace(/(Q\d+\..*?)\r?\n(A\..*?)/gi, '$1\n\n$2');

  formatted = replaceNewlinesOutsideMath(formatted);

  const mathCommandPattern = String.raw`(?:\\(frac|sqrt|int|sum|lim|sin|cos|tan|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)|\\frac|\\sqrt|√)`;
  const normalizeMathLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("$") || !new RegExp(mathCommandPattern).test(trimmed)) return line;
    const prefix = line.match(/^\s*(?:\d+[\).]\s*|[-*]\s*)?/)?.[0] ?? "";
    const body = line.slice(prefix.length).trim();
    if (!/[=+\-*/^_{}\\√]/.test(body)) return line;
    const sentenceLike = /[A-Za-z]{3,}\s+[a-zA-Z]{3,}/.test(body.replace(/\\[A-Za-z]+/g, ""));
    const standaloneMath =
      /^[a-zA-Z]\s*=/.test(body) ||
      /^(?:\\(frac|sqrt)|√|\d+\s*[+\-*/=]|\(?\s*[a-zA-Z0-9]+\s*[+\-*/=])/.test(body);
    if (sentenceLike && !standaloneMath) return line;
    return `${prefix}$${body}$`;
  };

  formatted = formatted
    .split("\n")
    .map(normalizeMathLine)
    .join("\n");

  // Step-based and final answer formatting
  formatted = formatted
    .replace(/(Step\s*\d+[^a-zA-Z0-9\s]?|Final\s*Answer\s*[:\u2014\u2013\u002D.]?)/gi, "\n\n$1")
    // Theory-specific 5-part numerical/theory headers
    .replace(/(\(\d\)\s*(?=[a-zA-Z])[a-zA-Z][a-zA-Z\s/-]*[:\u2014\u2013\u002D.]?)/gi, "\n\n$1")
    // Legacy sub-headers
    .replace(/(?:\r?\n|^)(\s*(?:[-*+]\s+)?(?:\*\*|__)?)(Reason\s*[:\u2014\u2013\u002D.]?|Explanation\s*[:\u2014\u2013\u002D.]?|Logic\s*[:\u2014\u2013\u002D.]?|Key\s*Concept\s*[:\u2014\u2013\u002D.]?|Verification\s*[:\u2014\u2013\u002D.]?)/gi, "\n\n$1$2");

  // 4. Convert LaTeX delimiters from \[ \] and \( \) to $$ and $ if remark-math needs them
  formatted = formatted
    .replace(/\\\[/g, "$$").replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$").replace(/\\\)/g, "$");

  // 5. Restore missing backslashes for common math symbols (e.g. frac, sqrt, pi, theta, etc.)
  formatted = formatted
    .replace(/(^|[^A-Za-z\\])(rac|frac|sqrt|int|sum|lim|sin|cos|tan|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\{/g, (_m, prefix, command) => `${prefix}\\${command === "rac" ? "frac" : command}{`)
    .replace(/(^|[^A-Za-z\\])(int_|sum_|lim_)/g, "$1\\$2")
    .replace(/√\s*\{([^{}]+)\}/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}")
    .replace(/x\s+\bo\b\s+(\d+|[a-z])/gi, "x \\to $1")
    .replace(/x\s*->\s*(\d+|[a-z])/gi, "x \\to $1");

  // 6. Pre-process fractions, limits, and exponents before math wrapping
  // Convert caret/subscript with parentheses to curly braces e.g. ^(n-1) -> ^{n-1}
  formatted = formatted
    .replace(/\^\(([^)]+)\)/g, "^{$1}")
    .replace(/_\(([^)]+)\)/g, "_{$1}");

  // Convert limits e.g. limh -> 0 to \lim_{h \to 0}
  formatted = formatted
    .replace(/\blim\s*([a-zA-Z0-9]+)\s*(?:->|\\to)\s*([a-zA-Z0-9]+)\b/gi, "\\lim_{$1 \\to $2}");

  // Convert division slashes to \frac{}{} where safe
  // 1. (num) / (den) or [num] / [den]
  formatted = formatted.replace(/(?:\(([^)]+)\)|\[([^\]]+)\])\s*\/\s*(?:\(([^)]+)\)|\[([^\]]+)\])/g, (match, p1, p2, p3, p4) => {
    const num = p1 || p2;
    const den = p3 || p4;
    return `\\frac{${num}}{${den}}`;
  });
  // 2. (num) / den_word or [num] / den_word
  formatted = formatted.replace(/(?:\(([^)]+)\)|\[([^\]]+)\])\s*\/\s*\b([a-zA-Z0-9]+)\b/g, (match, p1, p2, p3) => {
    const num = p1 || p2;
    return `\\frac{${num}}{${p3}}`;
  });
  // 3. num_word / (den) or num_word / [den]
  formatted = formatted.replace(/\b([a-zA-Z0-9]+)\b\s*\/\s*(?:\(([^)]+)\)|\[([^\]]+)\])/g, (match, p1, p2, p3) => {
    const den = p2 || p3;
    return `\\frac{${p1}}{${den}}`;
  });
  // 4. simple term / simple term (to catch dy/dx, 1/2, x^2/y^2, p^2/q^2 safely)
  // base variable length is limited to 1-3 characters to prevent matching URLs/paths.
  formatted = formatted.replace(/(^|[^a-zA-Z0-9_$])([a-zA-Z0-9]{1,3}(?:\^[{a-zA-Z0-9}-]+|_[{a-zA-Z0-9}-]+)?)\s*\/([ \t]*)([a-zA-Z0-9]{1,3}(?:\^[{a-zA-Z0-9}-]+|_[{a-zA-Z0-9}-]+)?)(?![\w$])/g, (match, prefix, num, space, den) => {
    return `${prefix}\\frac{${num}}{${den.trim()}}`;
  });

  // Wrap any balanced, structured LaTeX command embedded in prose. The generic
  // math detector below cannot reliably consume spaces inside command arguments
  // arguments (for example: "The value of \frac{sin 30°}{cos 60°} is").
  // Splitting on `$` keeps existing inline/display math untouched.
  formatted = formatted
    .split("$")
    .map((segment, index) => index % 2 === 0
      ? wrapStructuredLatex(segment)
      : segment)
    .join("$");

  formatted = wrapFullEquationLines(formatted);

  // 7. Tokenize to protect already-formatted math blocks ($...$ and $$...$$)
  const tokenize = (text) => {
    const tokens = [];
    let lastIndex = 0;
    const mathRegex = /(\$\$(?:[\s\S]*?)\$\$)|(\$(?:[^$]+?)\$)/g;
    let match;
    while ((match = mathRegex.exec(text)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        tokens.push({ type: 'prose', text: text.slice(lastIndex, matchIndex) });
      }
      tokens.push({ type: 'math', text: match[0] });
      lastIndex = mathRegex.lastIndex;
    }
    if (lastIndex < text.length) {
      tokens.push({ type: 'prose', text: text.slice(lastIndex) });
    }
    return tokens;
  };

  const tokens = tokenize(formatted);

  const englishWords = '(?:is|as|if|of|to|by|we|do|in|on|an|the|and|or|for|but|yet|so|at|then|with|from|into|over|under|above|below|between|among|through|during|before|after|against|about|like|throughout|upon|within|without|since|until|here|there|when|where|why|how|all|any|both|each|few|more|most|some|such|no|nor|not|only|own|same|than|too|very|can|will|should|would|could|may|might|must|shall|derivative|limit|function|chapter|topic|question|answer|solution|rule|power|quotient|product|sum|difference|value|rate|change|input|output|average|state|find|show|prove|calculate|determine|evaluate|solve|check|verify|logic|explanation|reason|key|concept|step|example)';
  const mathWord = `(?:\\b(?:sin|cos|tan|log|ln|lim|pi|theta|alpha|beta|gamma|delta|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\\b|\\b(?!${englishWords}\\b)[a-zA-Z]{1,2}\\b|\\d+)`;
  const opPattern = `[ \\t]*[()+\\-*\\/^=<>\'_\\-{}#][ \\t]*`;
  const commandPattern = `[ \\t]*\\\\[a-zA-Z]+[ \\t]*`;
  const mathToken = `(?:${mathWord}|${opPattern}|${commandPattern})`;

  const mathPattern = `(?:^|[^a-zA-Z0-9_$])(?:${mathToken}){0,10}\\^(?:${mathToken}){0,10}(?![\\w$])`;
  const subscriptPattern = `(?:^|[^a-zA-Z0-9_$])(?:${mathToken}){0,10}_(?:${mathToken}){0,10}(?![\\w$])`;
  const equationPattern = `(?:^|[^a-zA-Z0-9_$])(?:${mathToken}){0,10}=(?:${mathToken}){0,10}(?![\\w$])`;
  const latexPattern = `(?:^|[^a-zA-Z0-9_$])(?:${mathToken}){0,10}(?:${commandPattern})(?:${mathToken}){0,10}(?![\\w$])`;
  const functionPattern = `(?:^|[^a-zA-Z0-9_$])[a-zA-Z]'?\\(x\\)(?![\\w$])`;

  const combinedRegex = new RegExp(`${mathPattern}|${subscriptPattern}|${equationPattern}|${latexPattern}|${functionPattern}`, "gi");

  for (const token of tokens) {
    if (token.type === 'prose') {
      token.text = token.text.replace(combinedRegex, (match) => {
        const leadChar = /^[^\w$]/.test(match) ? match[0] : "";
        const body = leadChar ? match.slice(1) : match;
        return `${leadChar} $${body.trim()}$ `;
      });
    }
  }

  formatted = tokens.map(t => t.text).join("");
  formatted = wrapStandaloneSubscriptVariables(formatted);

  return formatted
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
};

module.exports = { formatMarkdown };
