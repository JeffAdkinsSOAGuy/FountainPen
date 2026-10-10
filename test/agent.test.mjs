import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../dist/parser.mjs';
import { readReply, insertionLines, numberedScript, jsonObjects, partsOf, startRun, partMessage, analyse } from '../dist/agent.mjs';
import { apply } from '../dist/edit.mjs';

const read = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const plain = read('moral-dilemma-plain.fountain');
const reply = read('agent-reply.jsonl');           // a real model reply to the agent's prompt
const strip = t => t.split('\n').filter(l => l !== '' && !/^(\[\[(id|beat|goal|status):.*\]\]|#+ .*|= .*|Structure: .*)$/.test(l)).join('\n');
const all = (n, type) => n.flatMap(c => [...(c.type === type ? [c] : []), ...(c.type === 'section' ? all(c.children, type) : [])]);

test('marks may only go before the start of a paragraph of script text', () => {
  const t = 'Title: T\n\nINT. A - DAY\n\n[[id: s1]]\n\nHe waits.\nAnd waits.\n\nBOB\n(quietly)\nHello.\n';
  assert.deepEqual([...insertionLines(t, parse(t))], [3, 7, 10]);
  assert.match(numberedScript(t, parse(t)), /\[10\] BOB\n\(quietly\)/);
});
test('a real reply is read, checked and written into the script cleanly', () => {
  const a = readReply(reply, plain, parse(plain));
  assert.equal(a.truncated, false);
  assert.ok(a.agents.length >= 5);
  const count = k => a.proposals.filter(p => p.kind === k).length;
  assert.deepEqual([count('sequence'), count('goal'), count('status')], [6, 8, 7]);
  assert.equal(count('beat'), 26);                                   // one was moved to the start of its speech
  assert.equal(a.dropped.filter(d => d.startsWith('Moved')).length, 1);
  const done = apply(plain, a.proposals);
  const doc = parse(done.text);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(doc.levels, ['sequence']);
  assert.deepEqual([doc.stats.sequences, doc.stats.goals, doc.stats.beats, doc.stats.scenes], [6, 8, 26, 13]);
  assert.equal(strip(done.text), strip(plain));                      // not one word of the script changed
});
test('accepting in two steps gives the same script as accepting at once', () => {
  const a = readReply(reply, plain, parse(plain)).proposals;
  const first = a.filter((_, i) => i % 2 === 0 && _.kind !== 'status'), rest = a.filter(p => !first.includes(p));
  const one = apply(plain, first);
  const two = apply(one.text, rest.map(p => ({ ...p, line: one.shift(p.line) })));
  assert.deepEqual(parse(two.text).diagnostics, []);
  assert.equal(strip(two.text), strip(plain));
  assert.equal(parse(two.text).stats.beats, 26);
});
test('bad proposals are dropped or repaired', () => {
  const t = 'INT. A - DAY\n\nBOB\nHello.\n\nAnn leaves.\n';
  const r = [
    '{"kind":"beat","line":4,"text":"Mid-speech","reason":""}',            // moved to the cue on line 3
    '{"kind":"beat","line":99,"text":"Nowhere","reason":""}',
    '{"kind":"status","line":6,"goal":"ghost","status":"won","reason":""}',
    '{"kind":"goal","line":3,"id":"Stay Put!","want":"stay","subject":"BOB","status":"secret","reason":""}',
    '{"kind":"status","line":6,"goal":"stay-put","status":"lost","reason":""}',
    '{"kind":"status","line":6,"goal":"stay-put","status":"won","reason":""}',
    '{"kind":"beat","line":6,"text":"Cut o',
  ].join('\n');
  const a = readReply(r, t, parse(t));
  assert.equal(a.truncated, true);
  assert.deepEqual(a.proposals.map(p => [p.kind, p.line]), [['beat', 3], ['goal', 3], ['status', 6]]);
  const g = a.proposals.find(p => p.kind === 'goal');
  assert.deepEqual([g.id, g.status, g.subject], ['stay-put', 'active', ['BOB']]);   // no object, so it cannot be secret
  assert.equal(a.dropped.length, 4);
});
test('a sequence adds a Structure line and new IDs never collide', () => {
  const t = 'Title: T\n\nINT. A - DAY\n\n[[id: s1]]\n\n[[beat: Old | id: b7]]\n\nHe waits.\n';
  const done = apply(t, [{ kind: 'sequence', line: 3, title: 'One', synopsis: 'It begins.', reason: '' }, { kind: 'beat', line: 9, text: 'New | turn', reason: '' }]);
  const doc = parse(done.text);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(doc.levels, ['sequence']);
  assert.deepEqual(all(doc.children, 'beat').map(b => [b.id, b.text]), [['b7', 'Old'], ['b8', 'New | turn']]);
  assert.equal(doc.children.find(c => c.type === 'section').synopsis, 'It begins.');
  assert.equal(done.text.split('\n')[done.shift(9) - 1], 'He waits.');
  const bare = apply('INT. A - DAY\n\nHe waits.\n', [{ kind: 'sequence', line: 1, title: 'One', synopsis: '', reason: '' }]);
  assert.deepEqual(parse(bare.text).levels, ['sequence']);
  assert.equal(parse(bare.text).stats.scenes, 1);
});
test('a reply is read whatever its layout', () => {
  const a = { kind: 'beat', line: 3, text: 'He says "no" {twice}', reason: 'a } brace' }, b = { kind: 'beat', line: 6, text: 'She leaves', reason: '' };
  const t = 'INT. A - DAY\n\nBOB\nNo.\n\nAnn leaves.\n';
  const shapes = {
    lines: JSON.stringify(a) + '\n' + JSON.stringify(b),
    oneLine: JSON.stringify(a) + ' ' + JSON.stringify(b),
    array: JSON.stringify([a, b]),
    pretty: JSON.stringify(a, null, 2) + '\n' + JSON.stringify(b, null, 2),
    fenced: 'Here you go:\n```json\n' + JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n```',
    literalNewline: JSON.stringify(a) + '\\n' + JSON.stringify(b),
  };
  for (const [name, raw] of Object.entries(shapes)) {
    const r = readReply(raw, t, parse(t));
    assert.deepEqual(r.proposals.map(p => p.text), ['He says "no" {twice}', 'She leaves'], name);
    assert.equal(r.truncated, false, name);
  }
  const cut = jsonObjects(JSON.stringify(a) + '\n{"kind":"beat","li');
  assert.deepEqual([cut.objects.length, cut.incomplete], [1, true]);
});
test('a script is cut into parts at scene boundaries', () => {
  const doc = parse(plain), L = plain.split('\n');
  const parts = partsOf(plain, doc, 1300);
  assert.equal(parts.length, 3);
  assert.equal(parts.reduce((n, p) => n + p.scenes, 0), 13);
  parts.forEach((p, i) => { if (i) assert.equal(p.from, parts[i - 1].to + 1); });       // nothing skipped, nothing twice
  assert.equal(parts[parts.length - 1].to, L.length);
  for (const p of parts.slice(1)) assert.match(L.slice(p.from - 1).find(l => l.trim() !== ''), /^\.?INT|^\.?EXT/);
  assert.equal(partsOf(plain, doc).length, 1);                                            // 4,000 words fits one part
  assert.match(partMessage(startRun(plain, doc, 1300)), /part 1 of 3[\s\S]*Story so far: Nothing yet/);
});
test('a part-by-part run carries the ledger forward and applies hindsight', async () => {
  const sse = text => new Response(new ReadableStream({ start(c) {
    const enc = new TextEncoder();
    for (const piece of text.match(/[\s\S]{1,200}/g)) c.enqueue(enc.encode('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: piece } }) + '\n\n'));
    c.enqueue(enc.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n')); c.close();
  } }), { status: 200 });
  const sent = [], real = globalThis.fetch, order = ['1', '2', '3', 'H'];
  globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body).messages[0].content); return sse(read(`parts/reply${order[sent.length - 1]}.jsonl`)); };
  const seen = [];
  let a;
  try { a = await analyse({ key: 'k', model: 'm', text: plain, doc: parse(plain), targetWords: 1300, onProgress: (p, n) => seen.push(`${p}/${n}`) }); }
  finally { globalThis.fetch = real; }
  assert.equal(sent.length, 4);
  assert.match(sent[1], /part 2 of 3[\s\S]*Goals:\n- warn-viewer:[\s\S]*Open sequence: Suzie Plays For Cash[\s\S]*Beat in progress: Archibald tempts her/);
  assert.match(sent[2], /the last part/);
  assert.match(sent[3], /hindsight question/);
  assert.ok(seen.includes('1/3') && seen.includes('3/3'));
  const nana = a.proposals.find(p => p.kind === 'goal' && p.id === 'nana-payout');
  assert.deepEqual([nana.status, nana.line < 744], ['secret', true]);                     // moved back from the reveal
  assert.deepEqual(a.dropped, []);
  const doc = parse(apply(plain, a.proposals).text);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual([doc.stats.sequences, doc.stats.goals, doc.stats.beats], [8, 14, 23]);
  assert.equal(strip(apply(plain, a.proposals).text), strip(plain));
});
test('a failure part-way keeps what was found', async () => {
  const real = globalThis.fetch; let n = 0;
  globalThis.fetch = async () => (++n === 1
    ? new Response('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: read('parts/reply1.jsonl') } }) + '\n\n', { status: 200 })
    : new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }));
  let a;
  try { a = await analyse({ key: 'k', model: 'm', text: plain, doc: parse(plain), targetWords: 1300 }); } finally { globalThis.fetch = real; }
  assert.ok(a.proposals.length > 5);
  assert.match(a.dropped.join(' '), /stopped at part 2 of 3: rate limited/);
});
