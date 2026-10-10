import { TeacherDocument, DocumentChunk, tokenizeText } from './pdfExtractor';
import { NoteTreeNode, collectLeaves, findTreeNode, parseLeafNoteId, parseSectionNoteId, renderNoteTree } from './noteTree';
import { headingLabel, parseHeadingId } from './headings';

export interface RetrievedExcerpt {
  docId: string;
  filename: string;
  pageNumber: number;
  score: number;
  text: string;
}

// The user's own words decide relevance; board labels and handwriting only disambiguate.
// Weighting them equally lets a busy board outvote the question entirely.
const WEIGHT_QUERY = 1.0;
const WEIGHT_BOARD_LABEL = 0.35;
const WEIGHT_HANDWRITING = 0.2; // TrOCR output is noisy — never let it drive retrieval

// Domain terms appear in most chunks of a single-topic lecture PDF, so their raw IDF
// collapses to ~0 — the term the teacher actually asked about ends up counting least.
const MIN_IDF = 0.3;

// Keep the ranking from being dominated by one dense page
const MAX_CHUNKS_PER_PAGE = 2;

// Budget for a single fetched note, so one dense page can't swallow the context window
const MAX_NOTE_WORDS = 1200;

// A section is several pages by definition, so the page budget would cut most of one off.
// Larger, and truncation reports which pages survived rather than trailing off mid-sentence.
const MAX_SECTION_WORDS = 3000;

// A page whose LLM-written title or topics match the query is about that subject, whereas a
// body match may be one passing mention. The tree earns its keep here as well as in the index.
const TITLE_MATCH_BOOST = 2.2;
const TOPIC_MATCH_BOOST = 1.6;

/**
 * Pure client-side Vectorless RAG Engine using BM25 lexical ranking & entity co-occurrence
 */
export class VectorlessRagEngine {
  private k1 = 1.5;
  private b = 0.75;

  /**
   * Builds the weighted query term map. Each term keeps its single strongest weight
   * rather than accumulating one per occurrence, so a word repeated across four board
   * nodes doesn't silently count four times.
   */
  private buildWeightedQuery(
    queryText: string,
    boardLabels: string[],
    handwrittenNotes: string[]
  ): { weights: Map<string, number>; userTerms: Set<string> } {
    const weights = new Map<string, number>();

    const add = (text: string, weight: number) => {
      tokenizeText(text).forEach((term) => {
        weights.set(term, Math.max(weights.get(term) || 0, weight));
      });
    };

    add(queryText, WEIGHT_QUERY);
    add(boardLabels.join(' '), WEIGHT_BOARD_LABEL);
    add(handwrittenNotes.join(' '), WEIGHT_HANDWRITING);

    return { weights, userTerms: new Set(tokenizeText(queryText)) };
  }

  /**
   * Performs BM25 relevance scoring over document chunks using query + board context
   */
  public retrieveExcerpts(
    queryText: string,
    boardLabels: string[],
    handwrittenNotes: string[],
    documents: TeacherDocument[],
    topK: number = 5
  ): RetrievedExcerpt[] {
    // 1. Flatten all chunks from all documents
    const allChunks: DocumentChunk[] = [];
    documents.forEach((doc) => allChunks.push(...doc.chunks));

    if (allChunks.length === 0) return [];

    // 2. Build weighted query terms (spoken query + board labels + handwriting)
    const { weights, userTerms } = this.buildWeightedQuery(queryText, boardLabels, handwrittenNotes);
    if (weights.size === 0) return [];

    // 3. Compute Corpus Statistics
    const totalDocs = allChunks.length;
    const avgDocLength = allChunks.reduce((sum, c) => sum + c.tokens.length, 0) / totalDocs || 1;

    // Document Frequency (DF) map
    const dfMap: Record<string, number> = {};
    allChunks.forEach((chunk) => {
      const uniqueTokens = new Set(chunk.tokens);
      uniqueTokens.forEach((token) => {
        dfMap[token] = (dfMap[token] || 0) + 1;
      });
    });

    // 3b. Page-level metadata from the note tree, keyed by docId_page
    const pageMeta = buildPageMetaIndex(documents);

    // 4. Calculate BM25 score for each chunk
    const scoredChunks: RetrievedExcerpt[] = allChunks.map((chunk) => {
      const docLen = chunk.tokens.length;
      const termFreqs: Record<string, number> = {};

      chunk.tokens.forEach((token) => {
        termFreqs[token] = (termFreqs[token] || 0) + 1;
      });

      let score = 0;
      let userTermsMatched = 0;

      weights.forEach((weight, token) => {
        const tf = termFreqs[token] || 0;
        if (tf > 0) {
          if (userTerms.has(token)) userTermsMatched += 1;

          const df = dfMap[token] || 1;
          // Inverse Document Frequency (IDF), floored so single-topic corpora still rank
          const idf = Math.max(MIN_IDF, Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1));
          // BM25 Term Weight
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / avgDocLength));
          score += weight * idf * (numerator / denominator);
        }
      });

      // Reward covering more of what was actually asked, not just matching it often
      const coverage = userTerms.size > 0 ? userTermsMatched / userTerms.size : 0;
      score *= 1 + coverage;

      // Lift chunks whose page the indexer titled or tagged with the query's own terms.
      // Purely lexical scoring cannot tell "the page on gradient descent" from "a page that
      // says gradient descent once"; the tree can.
      const meta = pageMeta.get(`${chunk.docId}_${chunk.pageNumber}`);
      if (meta && score > 0) {
        let metaBoost = 1;
        weights.forEach((weight, token) => {
          if (meta.titleTokens.has(token)) metaBoost += weight * (TITLE_MATCH_BOOST - 1) * 0.5;
          else if (meta.topicTokens.has(token)) metaBoost += weight * (TOPIC_MATCH_BOOST - 1) * 0.5;
        });
        score *= Math.min(metaBoost, TITLE_MATCH_BOOST);
      }

      return {
        docId: chunk.docId,
        filename: chunk.filename,
        pageNumber: chunk.pageNumber,
        score,
        text: chunk.text
      };
    });

    // 5. Rank, then cut relative to the best hit — BM25 scores are unnormalized, so any
    //    fixed threshold is meaningless across different corpora and query lengths.
    const ranked = scoredChunks.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
    if (ranked.length === 0) return [];

    const cutoff = ranked[0].score * 0.35;
    const survivors = ranked.filter((c) => c.score >= cutoff);

    // 6. Enforce page diversity so top-K isn't three slices of the same page
    const perPage: Record<string, number> = {};
    const selected: RetrievedExcerpt[] = [];

    for (const excerpt of survivors) {
      const pageKey = `${excerpt.docId}_${excerpt.pageNumber}`;
      const used = perPage[pageKey] || 0;
      if (used >= MAX_CHUNKS_PER_PAGE) continue;
      perPage[pageKey] = used + 1;
      selected.push(excerpt);
      if (selected.length >= topK) break;
    }

    return selected;
  }

  /**
   * Formats retrieved excerpts into a clean Markdown section for LLM system prompt context.
   * States how much of the corpus was NOT shown, so the model knows retrieval is a sample
   * it can extend with a fetch rather than the whole of the teacher's notes.
   */
  public formatExcerptsForPrompt(excerpts: RetrievedExcerpt[], documents: TeacherDocument[] = []): string {
    if (excerpts.length === 0) return '';

    const totalChunks = documents.reduce((sum, doc) => sum + doc.chunks.length, 0);
    const lines: string[] = ['# TEACHER REFERENCE NOTES (via Vectorless RAG):'];

    if (totalChunks > excerpts.length) {
      lines.push(
        `(Showing the ${excerpts.length} best-matching passages out of ${totalChunks} in the notes. ` +
          `If none of them answers the command, fetch a note from the index below instead of guessing.)`
      );
    }

    excerpts.forEach((ex, idx) => {
      lines.push(`[Excerpt #${idx + 1} | File: ${ex.filename} | Page ${ex.pageNumber}]:`);
      lines.push(`"${ex.text}"\n`);
    });

    return lines.join('\n');
  }

  /**
   * Builds the persistent note index the model navigates: one line per page, with the ID
   * it can fetch. This is the "vectorless" half of the design — the model decides what to
   * read, rather than being handed whatever BM25 guessed at.
   */
  public buildNoteIndex(documents: TeacherDocument[]): string {
    const lines: string[] = [];

    documents.forEach((doc) => {
      lines.push(`## ${doc.filename} (${doc.totalPages} pages)`);

      if (doc.tree && doc.tree.nodes.length > 0) {
        if (doc.tree.degraded) {
          lines.push('(Index not fully built for this document — titles below are raw text, not summaries.)');
        }
        lines.push(renderNoteTree(doc.tree));
      } else {
        // Un-indexed document: raw previews, which is all there is to show.
        lines.push('(Not indexed yet — showing raw page openings.)');
        Object.keys(doc.pageTexts || {})
          .map(Number)
          .sort((a, b) => a - b)
          .forEach((pageNumber) => {
            const preview = (doc.pageTexts[pageNumber] || '').split(/\s+/).slice(0, 18).join(' ');
            lines.push(`- ${noteId(doc.id, pageNumber)} | p.${pageNumber} | ${preview}...`);
          });
      }

      lines.push('');
    });

    return lines.join('\n').trim();
  }

  /**
   * Returns the full text of one indexed note, trimmed to a sane budget.
   * Accepts a page ID (`note_<doc>_p<n>`) or a section ID (`sec_<doc>_<n>`); a section
   * returns its pages joined, because a model that asks for a section means all of it.
   */
  public getNote(id: string, documents: TeacherDocument[]): string | undefined {
    // Heading sections come first: they are the precise unit, and a page ID for the same
    // content would drag in whatever else shares that page.
    const heading = parseHeadingId(id);
    if (heading) {
      const doc = documents.find((d) => d.id === heading.docId);
      const section = doc?.headings?.[heading.index - 1];
      if (!section) return undefined;
      return `[${headingLabel(section)} — p.${section.pageNumber}]\n${trimToBudget(section.text) || ''}`;
    }

    const leaf = parseLeafNoteId(id);
    if (leaf) {
      const doc = documents.find((d) => d.id === leaf.docId);
      if (!doc) return undefined;
      return trimToBudget((doc.pageTexts || {})[leaf.pageNumber]);
    }

    const section = parseSectionNoteId(id);
    if (section) {
      const doc = documents.find((d) => d.id === section.docId);
      if (!doc || !doc.tree) return undefined;

      const node = findTreeNode(doc.tree, id);
      if (!node) return undefined;

      // Whole pages are kept or dropped, never cut mid-page: a section truncated in the
      // middle of a sentence reads as if the notes simply end there, and the model builds
      // the board from a half-read section without knowing anything is missing.
      const included: string[] = [];
      const omitted: number[] = [];
      let budget = MAX_SECTION_WORDS;

      for (let p = node.pageStart; p <= node.pageEnd; p++) {
        const text = (doc.pageTexts || {})[p];
        if (!text) continue;

        const cost = text.split(/\s+/).length;
        if (cost > budget && included.length > 0) {
          omitted.push(p);
          continue;
        }

        included.push(`[p.${p}]\n${text}`);
        budget -= cost;
      }

      if (included.length === 0) return undefined;

      const body = included.join('\n\n');
      return omitted.length > 0
        ? `${body}\n\n[Section continues on page(s) ${omitted.join(', ')} — not shown. Fetch them individually if you need them.]`
        : body;
    }

    return undefined;
  }
}

function trimToBudget(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const words = text.split(/\s+/);
  return words.length > MAX_NOTE_WORDS
    ? `${words.slice(0, MAX_NOTE_WORDS).join(' ')} … [truncated]`
    : text;
}

function noteId(docId: string, pageNumber: number): string {
  return `note_${docId}_p${pageNumber}`;
}

interface PageMeta {
  titleTokens: Set<string>;
  topicTokens: Set<string>;
}

/**
 * Flattens every indexed document's tree into per-page title/topic token sets, so scoring
 * can consult the indexer's judgement without walking the tree per chunk.
 */
function buildPageMetaIndex(documents: TeacherDocument[]): Map<string, PageMeta> {
  const index = new Map<string, PageMeta>();

  documents.forEach((doc) => {
    if (!doc.tree) return;

    // With heading-based indexing a page can hold several sections, so their terms are
    // merged rather than the last one overwriting the rest.
    collectLeaves(doc.tree).forEach((leaf: NoteTreeNode) => {
      const key = `${doc.id}_${leaf.pageStart}`;
      const existing = index.get(key) || { titleTokens: new Set<string>(), topicTokens: new Set<string>() };

      tokenizeText(leaf.title).forEach((t) => existing.titleTokens.add(t));
      tokenizeText(leaf.topics.join(' ')).forEach((t) => existing.topicTokens.add(t));

      index.set(key, existing);
    });
  });

  return index;
}

export const vectorlessRag = new VectorlessRagEngine();
