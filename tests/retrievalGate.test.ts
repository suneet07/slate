/* @ts-nocheck */
import { commandNeedsNotes } from '../src/lib/ai/retrievalGate';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const BOARD = ['Load Balancer', 'Worker', 'Postgres', 'Queue', 'Photosynthesis'];

// Pure board manipulation -> must NOT retrieve
const skip: string[] = [
  'connect n1 to n2',
  'connect the load balancer to postgres',
  'delete n3',
  'remove the worker box',
  'make a box',
  'add a circle',
  'move the queue to the left',
  'make the postgres box red',
  'rename n1 to worker',
  'draw an arrow between the worker and the queue',
  'group these into a frame'
];

// Content questions -> must retrieve
const retrieve: string[] = [
  'explain photosynthesis',
  'what is a load balancer',
  'bring table 2 from my notes',
  'show me the diagram on page 4',
  'add a box about mitochondria',
  'draw the tcp handshake',
  'how does dijkstra work',
  'give me the formula for kinetic energy',
  'summarise chapter 3',
  'add a box labelled chloroplast',
  // Numbered references. These tokenize to nothing (digits are below the length floor and
  // "now" is a stopword), so before the numbered-reference rule they read as pure board
  // manipulation and a direct request for a figure retrieved no notes at all.
  'now 3.4',
  'now figure 7',
  '3.4',
  'put up fig 2.1',
  'the one in section 5',
  'example 12 please'
];

skip.forEach((q) => check(`skip: "${q}"`, commandNeedsNotes(q, BOARD) === false));
retrieve.forEach((q) => check(`retrieve: "${q}"`, commandNeedsNotes(q, BOARD) === true));

check('empty query does not retrieve', commandNeedsNotes('', BOARD) === false);
check('unknown content term retrieves even with no board', commandNeedsNotes('add a box about photosynthesis', []) === true);

// A bare count is not a reference to anything in the notes
check('plain integer does not retrieve', commandNeedsNotes('add 3 boxes', BOARD) === false);
check('node id does not retrieve', commandNeedsNotes('delete n4', BOARD) === false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
