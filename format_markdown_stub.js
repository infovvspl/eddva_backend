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

function formatMarkdown(text) {
  if (!text) return "";
  
  let formatted = text
    .replace(/\\\\/g, "\\")
    .replace(/\x0C/g, "\\f")
    .replace(/\x0B/g, "\\v")
    .replace(/\x07/g, "\\a")
    .replace(/\x08/g, "\\b")
    .replace(/\\n(?![a-zA-Z])/g, "\n");

  formatted = formatted.replace(/(?<!\$)\$([^$]+)\$(?!\$)/g, (match, p1) => {
    if (!p1.includes("\n")) return match;
    return p1.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const hasWordSpaces = /[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(trimmed);
      if (hasWordSpaces) return line;
      return `$${trimmed}$`;
    }).join("\n");
  });

  const examYearPattern = String.raw`(?:CBSE(?:\s+Class\s+\d+)?\s+\d{4}|CLASS\s+\d+\s+\d{4}|NEET(?:\s+UG)?\s+\d{4}|JEE(?:\s+(?:Main|Advanced))?\s+\d{4})`;
  formatted = formatted.replace(
    new RegExp(String.raw`(?:\r?\n|^)\s*(?:Q\s*)?(\d+)[.)]\s*(?:\*\*)?(?:\[|\()?\s*(${examYearPattern})\s*(?:\]|\))?(?:\*\*)?\s*[:.\u2014\u2013-]?\s*`, "gi"),
    (_match, num, tag) => `\n${num}. [EXAMTAG: ${tag}] `,
  );
  formatted = formatted.replace(
    new RegExp(String.raw`(?:\r?\n|^)\s*(?:Q\s*)?(\d+)[.)]\s*(.*?)(?:\[|\()\s*(${examYearPattern})\s*(?:\]|\))\s*(?=\r?\n|$)`, "gi"),
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

  formatted = formatted.replace(
    /(?:\r?\n|^)\s*\b([A-D])\b[ \t.:\)]*\r?\n[ \t]*(?![A-D]\b|(?:Q\s*)?\d+[.)]\s|#{1,6}\s)([^\n]+)/gi,
    '\n$1. $2',
  );

  formatted = formatted.replace(/(?:\s+|\b)A[\s.:\)]+(.*?)\s+B[\s.:\)]+(.*?)\s+C[\s.:\)]+(.*?)\s+D[\s.:\)]+([^\n]*)/gi, '\n\nA. $1\n\nB. $2\n\nC. $3\n\nD. $4');

  formatted = formatted.replace(/(\*\*Q\d+\..*?\*\*)\s*(\*\*A\..*?)/gi, '$1\n\n$2');
  formatted = formatted.replace(/(Q\d+\..*?)\r?\n(A\..*?)/gi, '$1\n\n$2');

  formatted = replaceNewlinesOutsideMath(formatted);

  const mathCommandPattern = String.raw`(?:\\(?:frac|sqrt|int|sum|lim|sin|cos|tan|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)|\\frac|\\sqrt|√)`;
  const normalizeMathLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("$") || !new RegExp(mathCommandPattern).test(trimmed)) return line;
    const prefix = line.match(/^\s*(?:\d+[\).]\s*|[-*]\s*)?/)?.[0] ?? "";
    const body = line.slice(prefix.length).trim();
    if (!/[=+\-*/^_{}\\√]/.test(body)) return line;
    const sentenceLike = /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(body.replace(/\\[A-Za-z]+/g, ""));
    const standaloneMath =
      /^[a-zA-Z]\s*=/.test(body) ||
      /^(?:\\(?:frac|sqrt)|√|\d+\s*[+\-*/=]|\(?\s*[a-zA-Z0-9]+\s*[+\-*/=])/.test(body);
    if (sentenceLike && !standaloneMath) return line;
    return `${prefix}$${body}$`;
  };

  formatted = formatted
    .split("\n")
    .map(normalizeMathLine)
    .join("\n");

  formatted = formatted
    .replace(/(Step\s*\d+[^a-zA-Z0-9\s]?|Final\s*Answer\s*[:\u2014\u2013\u002D.]?)/gi, "\n\n$1")
    .replace(/(\(\d\)\s*(?=[a-zA-Z])[a-zA-Z][a-zA-Z\s/-]*[:\u2014\u2013\u002D.]?)/gi, "\n\n$1")
    .replace(/(?:\r?\n|^)(\s*(?:[-*+]\s+)?(?:\*\*|__)?)(Reason\s*[:\u2014\u2013\u002D.]?|Explanation\s*[:\u2014\u2013\u002D.]?|Logic\s*[:\u2014\u2013\u002D.]?|Key\s*Concept\s*[:\u2014\u2013\u002D.]?|Verification\s*[:\u2014\u2013\u002D.]?)/gi, "\n\n$1$2");

  formatted = formatted
    .replace(/\\\[/g, "$$").replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$").replace(/\\\)/g, "$");

  formatted = formatted
    .replace(/(^|[^A-Za-z\\])(rac|frac|sqrt|int|sum|lim|sin|cos|tan|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\{/g, (_m, prefix, command) => `${prefix}\\${command === "rac" ? "frac" : command}{`)
    .replace(/(^|[^A-Za-z\\])(int_|sum_|lim_)/g, "$1\\$2")
    .replace(/√\s*\{([^{}]+)\}/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}")
    .replace(/x\s+\bo\b\s+(\d+|[a-z])/gi, "x \\to $1")
    .replace(/x\s*->\s*(\d+|[a-z])/gi, "x \\to $1");

  formatted = formatted
    .replace(/\^\(([^)]+)\)/g, "^{$1}")
    .replace(/_\(([^)]+)\)/g, "_{$1}");

  formatted = formatted
    .replace(/\blim\s*([a-zA-Z0-9]+)\s*(?:->|\\to)\s*([a-zA-Z0-9]+)\b/gi, "\\lim_{$1 \\to $2}");

  formatted = formatted.replace(/(?:\(([^)]+)\)|\[([^\]]+)\])\s*\/\s*(?:\(([^)]+)\)|\[([^\]]+)\])/g, (match, p1, p2, p3, p4) => {
    const num = p1 || p2;
    const den = p3 || p4;
    return `\\frac{${num}}{${den}}`;
  });
  formatted = formatted.replace(/(?:\(([^)]+)\)|\[([^\]]+)\])\s*\/\s*\b([a-zA-Z0-9]+)\b/g, (match, p1, p2, p3) => {
    const num = p1 || p2;
    return `\\frac{${num}}{${p3}}`;
  });
  formatted = formatted.replace(/\b([a-zA-Z0-9]+)\b\s*\/\s*(?:\(([^)]+)\)|\[([^\]]+)\])/g, (match, p1, p2, p3) => {
    const den = p2 || p3;
    return `\\frac{${p1}}{${den}}`;
  });

  formatted = formatted.replace(/(?![\w$])([a-zA-Z0-9]{1,3}(?:\^[{a-zA-Z0-9}-]+|_[{a-zA-Z0-9}-]+)?)\s*\/([ \t]*)([a-zA-Z0-9]{1,3}(?:\^[{a-zA-Z0-9}-]+|_[{a-zA-Z0-9}-]+)?)(?![\w$])/g, (match, num, space, den) => {
    return `\\frac{${num}}{${den.trim()}}`;
  });

  const parts = formatted.split("$");
  for (let i = 0; i < parts.length; i += 2) {
    let segment = parts[i];

    const englishWords = '(?:is|as|if|of|to|by|we|do|in|on|an|the|and|or|for|but|yet|so|at|then|with|from|into|over|under|above|below|between|among|through|during|before|after|against|about|like|throughout|upon|within|without|since|until|here|there|when|where|why|how|all|any|both|each|few|more|most|some|such|no|nor|not|only|own|same|than|too|very|can|will|should|would|could|may|might|must|shall|derivative|limit|function|chapter|topic|question|answer|solution|rule|power|quotient|product|sum|difference|value|rate|change|input|output|average|state|find|show|prove|calculate|determine|evaluate|solve|check|verify|logic|explanation|reason|key|concept|step|example)';
    const mathWord = `(?:\\b(?:sin|cos|tan|log|ln|lim|pi|theta|alpha|beta|gamma|delta|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\\b|(?<![a-zA-Z])(?!${englishWords}(?![a-zA-Z]))[a-zA-Z]{1,2}(?![a-zA-Z])|\\d+)`;
    const opPattern = `[ \\t]*[()+\\-*\\/^=<>\'_\\-{}#][ \\t]*`;
    const commandPattern = `[ \\t]*\\\\[a-zA-Z]+[ \\t]*`;

    const mathToken = `(?:${mathWord}|${opPattern}|${commandPattern})`;

    // Replace * with {0,10} to restrict backtracking search space
    const mathPattern = `(?<![\\w$])(?:${mathToken}){0,10}\\^(?:${mathToken}){0,10}(?![\\w$])`;
    const subscriptPattern = `(?<![\\w$])(?:${mathToken}){0,10}_(?:${mathToken}){0,10}(?![\\w$])`;
    const equationPattern = `(?<![\\w$])(?:${mathToken}){0,10}=(?:${mathToken}){0,10}(?![\\w$])`;
    const latexPattern = `(?<![\\w$])(?:${mathToken}){0,10}(?:${commandPattern})(?:${mathToken}){0,10}(?![\\w$])`;
    const functionPattern = `(?<![\\w$])[a-zA-Z]'?\\(x\\)(?![\\w$])`;

    const combinedRegex = new RegExp(`${mathPattern}|${subscriptPattern}|${equationPattern}|${latexPattern}|${functionPattern}`, "gi");

    segment = segment.replace(combinedRegex, (match) => {
      return ` $${match.trim()}$ `;
    });

    parts[i] = segment;
  }

  formatted = parts.join("$");

  return formatted
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

module.exports = { formatMarkdown };
