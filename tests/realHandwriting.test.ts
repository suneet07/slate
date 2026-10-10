/* @ts-nocheck */
/**
 * Handwriting captured off the real board, stroke for stroke.
 *
 * A lowercase "hi" written with the pen: one stroke for the h (down, back up, over the
 * arch), a stem and a looped dot for the i, plus a stray tap of the pen mid-board. The
 * first version merged all three letter strokes into one "character" — the h and i sit
 * 11px apart under a 96px ascender, and the letter-split threshold scaled with height —
 * then rejected that single character as not-writing, and the serializer told the model
 * the board was empty.
 */
import { readInkLocally } from '../src/lib/ocr/localInkReader';
import { serializeSceneGraph } from '../src/lib/graph/serializer';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const HI = [[[130,80],[130,81],[132,84],[132,87],[132,90],[132,96],[133,101],[133,107],[134,112],[134,118],[134,124],[134,130],[134,136],[134,142],[134,148],[134,152],[134,156],[134,160],[134,162],[134,163],[134,164],[135,164],[135,165],[135,164],[136,161],[136,158],[137,156],[138,154],[138,154],[138,154],[138,153],[138,152],[139,152],[139,149],[139,147],[139,146],[139,144],[139,142],[140,138],[140,136],[140,135],[140,134],[140,133],[140,132],[141,132],[141,132],[142,132],[142,130],[144,130],[144,130],[145,128],[146,128],[146,128],[146,127],[147,127],[148,126],[148,126],[149,126],[150,126],[150,126],[152,126],[153,129],[154,130],[156,132],[156,133],[156,134],[156,134],[157,134],[157,136],[157,136],[158,138],[158,140],[159,143],[160,145],[161,147],[161,149],[161,152],[162,153],[162,154],[162,156],[162,158],[162,159],[162,160],[162,162],[162,163],[162,164],[162,164],[162,166],[162,166],[163,167],[163,168],[163,168],[163,169],[163,170],[163,170],[163,171],[163,172],[163,172],[163,173],[163,174],[163,174],[163,175],[163,176]],[[181,122],[182,124],[182,126],[182,128],[182,131],[182,134],[182,136],[182,139],[182,142],[182,145],[182,147],[182,150],[182,151],[182,153],[182,154],[182,156],[182,157],[182,158],[182,159],[182,160],[182,161],[183,162],[183,162],[183,163],[183,164],[183,164],[183,165],[183,166],[183,166],[183,167],[183,168],[183,168],[183,169]],[[176,90],[177,89],[178,89],[178,89],[179,89],[180,89],[180,89],[181,89],[181,90],[181,90],[182,92],[182,92],[182,93],[182,94],[182,94],[182,95],[182,96],[182,96],[182,97],[182,98],[182,99],[182,100],[182,100],[182,101],[181,101],[180,101],[180,101],[179,101],[178,100],[178,100],[178,99],[178,99],[177,99],[176,99],[176,98],[176,98],[176,97],[176,97],[175,97],[175,96],[175,96],[174,96],[174,95],[174,94],[174,94],[174,93],[174,92],[174,92],[174,91],[174,90],[174,90],[174,89],[174,88]],[[527,484],[527,484]]];
const ink = HI.map((points, i) => ({ id: `ink${i}`, points }));

const lines = readInkLocally(ink);
check('handwritten "hi" is found as writing', lines.length === 1, `${lines.length} line(s)`);
const text = lines[0]?.text ?? '';
check('it is split into two letters, not merged into one', /^\[?[a-zA-Z]/.test(text) && text.replace(/\[[^\]]*\]/g, 'X').length === 2, text);
check('the h is read as h (n offered as its twin)', /^(h|\[h\|)/.test(text), text);
check('the dotted letter is read as i, not I or l', /\]\[?i/.test(text) || /^\[?h[^\[]*\]?i/.test(text) || /\[i\|/.test(text), text);
check('the stray tap is not part of the word', !(lines[0]?.strokeIds ?? []).includes('ink3'), `${lines[0]?.strokeIds}`);

// The serializer must never call a board with ink on it "empty".
const graph = { nodes: {}, edges: {}, ink: Object.fromEntries(ink.map((s) => [s.id, { ...s, color: '#000', strokeWidth: 3 }])) };
const unreadOnly = serializeSceneGraph(graph, []);
check('ink nobody read is not reported as an empty board', !/currently empty/.test(unreadOnly), unreadOnly.split('\n')[0]);
check('it is reported as unread pen strokes', /UNREAD PEN STROKES/.test(unreadOnly));
check('a stray tap does not count as content', /^3 stroke/m.test(unreadOnly), unreadOnly.split('\n').find((l) => /stroke\(s\)/.test(l)) ?? '');

const withReading = serializeSceneGraph(graph, [{ text: lines[0]?.text ?? '', gridPos: 'A1', strokeIds: lines[0]?.strokeIds }]);
check('once read, the writing is listed as handwriting', /HANDWRITTEN NOTES/.test(withReading));
check('and is not also listed as unread', !/UNREAD PEN STROKES/.test(withReading), withReading);
check('a board with no ink at all is still empty', serializeSceneGraph({ nodes: {}, edges: {}, ink: {} }, []) === '# Board is currently empty');

console.log(failures === 0 ? '\nALL PASS' : `\nFAILURE: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
