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
          const isLoneNumberOrMarker = /^(?:Q\s*)?\d{1,3}[.)]\s*$/i.test(currentLine) || /^\([a-zA-Z0-9]{1,3}\)\s*$/.test(currentLine);
          const isContinuation = endsWithOperator || startsWithOperator || isLoneNumberOrMarker;
          
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
  let formatted = text.replace(/\\\\/g, "\\");

  formatted = formatted.replace(
    /(?:\r?\n|^)\s*\b([A-D])\b[ \t.:\)]*\r?\n[ \t]*(?![A-D]\b|(?:Q\s*)?\d+[.)]\s|#{1,6}\s)([^\n]+)/gi,
    '\n$1. $2',
  );

  formatted = formatted.replace(
    /(?<!\b(?:Section|Part|Group|Class|Grade|Chapter|Unit)\s+)(?:\s+|^)\b([A-D])\s*[:.)]\s+([^A-D\n]+?)\s+\bB\s*[:.)]\s+([^A-D\n]+?)\s+\bC\s*[:.)]\s+([^A-D\n]+?)\s+\bD\s*[:.)]\s+([^\n]+)/gi,
    (match, aLabel, optA, optB, optC, optD) => {
      if (/\b(?:Section|Part|Group|Class|Grade|Chapter|Unit|consists|questions)\b/i.test(match)) {
        return match;
      }
      return `\n\n${aLabel}. ${optA.trim()}\n\nB. ${optB.trim()}\n\nC. ${optC.trim()}\n\nD. ${optD.trim()}`;
    }
  );

  formatted = replaceNewlinesOutsideMath(formatted);

  const pullRegex = /([\d]+[.)](?:\s*\[\s*EXAMTAG:\s*[^\]]+\s*\])?)\s*(?:\r?\n)+\s*(?!(?:[A-D][.):]\s*|\([A-D]\)\s*|[\d]+[.)]\s*|Q\d+\b|#{1,6}\s|[-*+]\s))/gi;
  formatted = formatted.replace(pullRegex, "$1 ");

  return formatted;
}

module.exports = { formatMarkdown };
