import { tokenizeText } from '../rag/pdfExtractor';

// Vocabulary of pure board manipulation. Stemmed through the same tokenizer used for
// retrieval so both sides agree on word forms.
const STRUCTURAL_TERMS = new Set(
  tokenizeText(
    'connect link join attach delete remove erase clear move drag shift add make create draw put place ' +
      'box circle ellipse arrow edge line node shape frame text label rename title color colour red green ' +
      'blue yellow orange purple grey gray primary success warning error align resize bigger smaller wider ' +
      'taller left right top bottom above below beside next between undo redo copy duplicate group ungroup ' +
      'change set update swap replace point pointing them these those thing stuff ' +
      // Plurals are listed explicitly: the stemmer maps "boxes" to "boxe", not "box", so a
      // plural shape word would otherwise count as unknown content and force a retrieval.
      'boxes circles ellipses arrows edges lines nodes shapes frames labels titles colors colours ' +
      'texts stickies notes groups'
  )
);

// Anything asking about content, or naming something from the notes, always retrieves.
const KNOWLEDGE_TRIGGER =
  /\b(explain|what|whats|why|how|describe|define|definition|derive|derivation|proof|prove|theorem|formula|equation|example|summar\w*|compare|difference|meaning|means|notes?|lecture|slide|book|chapter|table|figure|fig|diagram|chart|graph|exhibit|page|according|reference|source|cite|show|bring|fetch|pull|insert|import|steps?|process|algorithm|procedure|method)\b/i;

// A numbered reference IS the content word. The retrieval tokenizer drops digits and short
// tokens, so "now 3.4" and "figure 7" reduce to nothing and read as pure board manipulation —
// which is how a direct request for a numbered figure ended up retrieving no notes at all.
const NUMBERED_REFERENCE = /\b\d+\s*\.\s*\d+\b|\b(?:figure|fig|table|section|chapter|part|eq|equation|theorem|lemma|problem|exercise|question|q|slide|page|example|step)\s*\.?\s*\d+/i;

/**
 * Decides whether a command needs the teacher's notes at all.
 *
 * Roughly half of commands are pure board manipulation ("connect n1 to n2"), and
 * injecting unrelated excerpts into those turns actively fights the precision directive.
 * Retrieval is skipped only when the command is structural AND every content word it uses
 * is already a label on the board — anything else, including any knowledge-shaped
 * phrasing, still retrieves.
 */
export function commandNeedsNotes(queryText: string, boardLabels: string[]): boolean {
  const query = (queryText || '').trim();
  if (!query) return false;
  if (KNOWLEDGE_TRIGGER.test(query)) return true;
  if (NUMBERED_REFERENCE.test(query)) return true;

  const boardTerms = new Set(tokenizeText(boardLabels.join(' ')));
  const contentTerms = tokenizeText(query).filter(
    (term) => !STRUCTURAL_TERMS.has(term) && !boardTerms.has(term)
  );

  return contentTerms.length > 0;
}
