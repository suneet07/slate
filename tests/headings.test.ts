/* @ts-nocheck */
import { extractHeadings, headingLabel, parseHeadingId } from '../src/lib/rag/headings';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const body = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// ---------------------------------------------------------------- Numbered headings
{
  const pages = {
    1: [
      '3.5 Ohm\'s Law',
      body(30),
      '3.6 Limitations of Ohm\'s Law',
      'Although Ohm\'s law has been found valid over a large class of materials,',
      body(30)
    ].join('\n'),
    2: [body(25), '3.7 Resistivity of Various Materials', body(30)].join('\n')
  };

  const headings = extractHeadings('doc_1', pages);
  const titles = headings.map(headingLabel);

  check('numbered headings detected', headings.length === 3, JSON.stringify(titles));
  check('section number preserved', headings[1].number === '3.6', headings[1].number);
  check('title preserved', headings[1].title === "Limitations of Ohm's Law", headings[1].title);
  check('level from the number', headings[1].level === 2, String(headings[1].level));
  check('page recorded from where the heading appears', headings[2].pageNumber === 2, String(headings[2].pageNumber));

  // The whole point: a half-page subsection is its own retrievable unit
  check('section text stops at the next heading',
    headings[1].text.includes('Although') && !headings[1].text.includes('Resistivity'),
    headings[1].text.slice(0, 60));
  check('section text excludes the previous section', !headings[1].text.includes("Ohm's Law\nword0"),
    headings[1].text.slice(0, 40));

  // A section that spans a page break must carry through, as the printed section does
  check('section continues across a page break', headings[2].text.split(/\s+/).length > 20,
    String(headings[2].text.split(/\s+/).length));

  check('ids are sequential and parseable',
    headings.every((h, i) => parseHeadingId(h.id)?.index === i + 1 && parseHeadingId(h.id)?.docId === 'doc_1'),
    JSON.stringify(headings.map((h) => h.id)));
}

// ---------------------------------------------------------------- False positives
{
  const pages = {
    1: [
      '2.1 Real Heading Here',
      body(30),
      'Figure 3.5 The dashed line shows the deviation',
      'Table 2 Resistivity values',
      'Example 4 A wire of length L',
      'The quick brown fox jumped over the lazy dog and kept running for a while.',
      body(20)
    ].join('\n')
  };

  const headings = extractHeadings('doc_2', pages);
  const titles = headings.map((h) => h.title);

  check('figure captions are not headings', !titles.some((t) => /dashed line/i.test(t)), JSON.stringify(titles));
  check('table captions are not headings', !titles.some((t) => /Resistivity values/i.test(t)), JSON.stringify(titles));
  check('example labels are not headings', !titles.some((t) => /wire of length/i.test(t)), JSON.stringify(titles));
  check('ordinary sentences are not headings', !titles.some((t) => /quick brown fox/i.test(t)), JSON.stringify(titles));
  check('the real heading survives', titles.includes('Real Heading Here'), JSON.stringify(titles));
}

// ---------------------------------------------------------------- All-caps headings
{
  const pages = { 1: ['ELECTRICAL ENERGY AND POWER', body(30), 'CELLS AND INTERNAL RESISTANCE', body(30)].join('\n') };
  const headings = extractHeadings('doc_3', pages);

  check('all-caps headings detected', headings.length === 2, JSON.stringify(headings.map((h) => h.title)));
  check('unnumbered heading has no number', headings[0].number === undefined);
  check('label falls back to the title', headingLabel(headings[0]) === 'ELECTRICAL ENERGY AND POWER',
    headingLabel(headings[0]));

  const single = extractHeadings('doc_4', { 1: ['VOLTAGE', body(30)].join('\n') });
  check('single capitalised word is not a heading', single.length === 0, JSON.stringify(single.map((h) => h.title)));
}

// ---------------------------------------------------------------- Thin sections dropped
{
  const pages = { 1: ['4.1 Too Short', 'only three words', '4.2 Proper Section', body(30)].join('\n') };
  const headings = extractHeadings('doc_5', pages);

  check('sections under the word floor are dropped', headings.length === 1, JSON.stringify(headings.map((h) => h.title)));
  check('surviving section is the substantial one', headings[0].title === 'Proper Section', headings[0].title);
  check('ids have no gaps after filtering', headings[0].id === 'head_doc_5_1', headings[0].id);
}

// ---------------------------------------------------------------- Unstructured documents
{
  const headings = extractHeadings('doc_6', { 1: body(200), 2: body(200) });
  check('prose with no headings yields none', headings.length === 0, String(headings.length));
  check('malformed heading id returns undefined', parseHeadingId('not-a-heading') === undefined);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
