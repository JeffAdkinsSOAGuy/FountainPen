// Runs the conformance cases from the Fountain Cascade repository (copied into test/conformance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from '../dist/parser.mjs';
import { summarise } from '../dist/summary.mjs';

const dir = new URL('./conformance/', import.meta.url);
const read = p => readFileSync(new URL(p, dir), 'utf8');
const all = (n, type) => n.flatMap(c => [...(c.type === type ? [c] : []), ...(c.type === 'section' ? all(c.children, type) : [])]);

for (const f of readdirSync(new URL('format/', dir)).filter(f => f.endsWith('.fountain')).sort())
  test(`format: ${f}`, () => {
    assert.deepEqual(JSON.parse(JSON.stringify(summarise(parse(read('format/' + f))))), JSON.parse(read('format/' + f.replace('.fountain', '.json'))));
  });

test('analysis: every expected file is clean, and is its excerpt plus marks', () => {
  const strip = t => t.split('\n').filter(l => l !== '' && !/^(\[\[(id|beat|goal|status|resume|stage):.*\]\]|#+ .*|= .*|Structure: .*)$/.test(l)).join('\n');
  for (const f of readdirSync(new URL('analysis/', dir)).filter(f => f.endsWith('.expected.fountain'))) {
    const expected = read('analysis/' + f), given = read('analysis/' + f.replace('.expected', ''));
    assert.deepEqual(parse(expected).diagnostics, [], f);
    assert.equal(strip(expected), strip(given), f);
  }
});
test('analysis: the expected marks say what the cases claim', () => {
  const doc = n => parse(read(`analysis/${n}.expected.fountain`));
  const one = doc('01-beat-through-scenes'), beats = all(one.children, 'beat');
  assert.deepEqual([beats.length, beats[1].scenes.length], [2, 3]);
  assert.equal(all(doc('02-tactic-is-not-a-beat').children, 'beat').length, 2);
  const three = doc('03-secret-until-its-object-knows');
  assert.deepEqual(three.goals[0].history.map(h => h.status), ['secret', 'active']);
  const four = doc('04-a-goal-is-raised').goals;
  assert.deepEqual([four[2].from, four[2].for, four[1].status], ['use-tom', undefined, 'secret']);
  const five = doc('05-pause-and-resume');
  assert.deepEqual([five.stats.sequences, five.children.filter(c => c.type === 'section').map(s => s.resumes ?? s.id)], [2, ['offer', 'tape', 'offer']]);
});

// Recorded answers from a model given only the agent's instructions and each unmarked excerpt.
// This checks the whole path (instructions, reply checks, writing) against what each case says should match.
import { readReply } from '../dist/agent.mjs';
import { apply } from '../dist/edit.mjs';
test('analysis: the beat agent\'s recorded answers match all five cases', () => {
  const run = n => {
    const f = readdirSync(new URL('analysis/', dir)).find(x => x.startsWith(n) && !x.includes('.expected'));
    const text = read('analysis/' + f);
    const a = readReply(readFileSync(new URL(`./fixtures/analysis-replies/reply${n}.jsonl`, import.meta.url), 'utf8'), text, parse(text));
    const out = apply(text, a.proposals).text, doc = parse(out);
    assert.deepEqual(doc.diagnostics, [], n);
    return { doc, beats: all(doc.children, 'beat'), lines: out.split('\n') };
  };
  const one = run('01');
  assert.deepEqual([one.beats.length, one.beats[1].scenes.length], [2, 3]);
  const two = run('02'), after = b => two.lines.slice(b.line).find(l => l.trim() !== '' && !l.startsWith('[['));
  assert.equal(two.beats.length, 2);
  assert.ok(!two.beats.some(b => /^(WIFE|He sings louder|Louder still)/.test(after(b))));
  const divorce = run('03').doc.goals.find(g => g.id === 'divorce');
  assert.deepEqual(divorce.history.map(h => h.status), ['secret', 'active']);
  const four = run('04').doc.goals, raised = four.find(g => g.from === 'use-tom');
  assert.ok(raised && !raised.for && four.find(g => g.id === 'use-tom').status !== 'abandoned');
  const five = run('05').doc;
  assert.deepEqual([five.stats.sequences, five.children.filter(c => c.type === 'section' && c.resumes).length], [2, 1]);
});
