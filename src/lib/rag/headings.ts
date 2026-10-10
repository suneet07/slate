/**
 * Heading detection — the document's own structure, taken from the document.
 *
 * Page-granular indexing was the reason a request for "3.6 Limitations of Ohm's Law"
 * returned a whole page: §3.6 is half a page, and a page was the smallest thing that could
 * be fetched. Splitting on real headings makes the retrievable unit the section the author
 * actually wrote, which is the entire premise of tree-based retrieval.
 *
 * Deliberately conservative. A missed heading costs precision; a false one invents a
 * section boundary that does not exist and splits a derivation in half.
 */

export interface DocHeading {
  id: string;
  docId: string;
  /** Section number as printed, e.g. "3.6". Absent for unnumbered headings. */
  number?: string;
  title: string;
  /** Nesting depth taken from the number: "3" is 1, "3.6" is 2, "3.6.1" is 3. */
  level: number;
  pageNumber: number;
  /** Body text from this heading up to the next one, across page breaks. */
  text: string;
}

// A numbered heading: "3.6 Limitations of Ohm's Law", "2.1.4 Drift Velocity".
// The title must start with a letter and stay short — this is a heading, not a sentence
// that happens to begin with a figure reference.
const NUMBERED_HEADING = /^(\d+(?:\.\d+){0,2})\s+([A-Z][^.!?]{2,80})$/;

// An all-caps or title-case standalone line: "LIMITATIONS OF OHM'S LAW".
const CAPS_HEADING = /^([A-Z][A-Z\s'’&\-:]{4,60})$/;

// Lines that look like headings but are references to something else, not section starts.
const NOT_A_HEADING = /^(figure|fig|table|chart|graph|example|exercise|problem|question|note|eq|equation|appendix)\b/i;

/** Minimum words a section must have before it is worth being its own retrievable node. */
const MIN_SECTION_WORDS = 12;

function classify(line: string): { number?: string; title: string; level: number } | undefined {
  const trimmed = line.trim();
  if (trimmed.length < 4 || trimmed.length > 90) return undefined;
  if (NOT_A_HEADING.test(trimmed)) return undefined;

  const numbered = trimmed.match(NUMBERED_HEADING);
  if (numbered) {
    const number = numbered[1];
    return {
      number,
      title: numbered[2].trim(),
      level: number.split('.').length
    };
  }

  const caps = trimmed.match(CAPS_HEADING);
  if (caps) {
    // Require at least two words: a lone capitalised word is as likely to be a label,
    // an axis title or an orphaned word from a figure as it is a heading.
    const title = caps[1].trim();
    if (title.split(/\s+/).length < 2) return undefined;
    return { title, level: 1 };
  }

  return undefined;
}

/**
 * Walks the document page by page and cuts it at headings.
 *
 * A section runs from its heading to the next one, so it crosses page boundaries the way
 * the printed section does. The page recorded is where the heading itself appears.
 */
export function extractHeadings(docId: string, pageTexts: Record<number, string>): DocHeading[] {
  const pages = Object.keys(pageTexts)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);

  const headings: DocHeading[] = [];
  let current: DocHeading | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (!current) return;
    current.text = buffer.join('\n').trim();
    if (current.text.split(/\s+/).filter(Boolean).length >= MIN_SECTION_WORDS) {
      headings.push(current);
    }
    current = undefined;
    buffer = [];
  };

  pages.forEach((pageNumber) => {
    const lines = (pageTexts[pageNumber] || '').split(/\r?\n/);

    lines.forEach((line) => {
      const heading = classify(line);

      if (heading) {
        flush();
        current = {
          id: `head_${docId}_${headings.length + 1}`,
          docId,
          number: heading.number,
          title: heading.title,
          level: heading.level,
          pageNumber,
          text: ''
        };
        buffer = [];
        return;
      }

      if (current) buffer.push(line);
    });
  });

  flush();

  // Re-id after filtering so the numbering has no gaps — a gap reads to the model like a
  // section it is not allowed to see.
  return headings.map((h, idx) => ({ ...h, id: `head_${docId}_${idx + 1}` }));
}

/** Display label: "3.6 Limitations of Ohm's Law", or just the title when unnumbered. */
export function headingLabel(heading: DocHeading): string {
  return heading.number ? `${heading.number} ${heading.title}` : heading.title;
}

export function parseHeadingId(id: string): { docId: string; index: number } | undefined {
  const match = (id || '').match(/^head_(.+)_(\d+)$/);
  return match ? { docId: match[1], index: parseInt(match[2], 10) } : undefined;
}
