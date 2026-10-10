/* @ts-nocheck */
import './browser-globals';
import { MULTI_PAGE_REQUEST } from '../src/lib/ai/orchestrator';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// Only an explicit ask for several pages lifts the one-scan cap. Everything else is a
// request for content, and answering it with a stack of page photographs is the bug.
const allowMany = [
  'put up pages 9 to 12',
  'show pages 3-5',
  'bring pages 2 through 4',
  'put up all the pages',
  'add every page'
];

const capped = [
  'the whole section please',
  'bring the limitations of ohms law',
  'show me that section',
  'now 3.4',
  'put up figure 3.5',
  'show me page 9',
  'add a box'
];

allowMany.forEach((q) => check(`explicit multi-page: "${q}"`, MULTI_PAGE_REQUEST.test(q) === true));
capped.forEach((q) => check(`capped: "${q}"`, MULTI_PAGE_REQUEST.test(q) === false));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
