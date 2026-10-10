import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, parseStructuredNote } from '../dist/parser.mjs';

const md = parse(readFileSync(new URL('./fixtures/moral-dilemma.fountain', import.meta.url), 'utf8'));
const all = (n, type) => n.flatMap(c => [...(c.type === type ? [c] : []), ...(c.type === 'section' ? all(c.children, type) : [])]);
const goal = id => md.goals.find(g => g.id === id);

test('Moral Dilemma: counts', () => {
  assert.deepEqual(md.levels, ['sequence']);
  assert.deepEqual(md.stats, { sections: 5, sequences: 5, scenes: 13, beats: 22, goals: 8, ids: 5 + 13 + 22 + 8 });
  assert.deepEqual(md.diagnostics, []);
});
test('Moral Dilemma: sequences', () => {
  assert.deepEqual(md.children.filter(c => c.type === 'section').map(s => [s.id, s.title, all(s.children, 'scene').length, all(s.children, 'beat').length]), [
    ['q1', 'The Warning', 2, 2], ['q3', 'The Boyfriend', 7, 9], ['q4', 'A Word from Our Sponsor', 1, 1],
    ['q5', 'Nana', 1, 7], ['q6', 'The Turn', 2, 3]]);
  assert.equal(md.children.find(c => c.type === 'section').synopsis, 'A narrator from one possible future sets out to warn us.');
});
test('a beat runs across scene headings', () => {
  const beats = all(md.children, 'beat');
  const arrival = beats.find(b => b.id === 'b6');
  assert.equal(arrival.scenes.length, 3);                         // car, entrance, set
  assert.equal(arrival.endLine, beats.find(b => b.id === 'b8').line - 1);
  const p = parse('INT. A - DAY\n\n[[beat: One]]\n\nHe runs.\n\nINT. B - DAY\n\nHe hides.\n\n[[beat: Two]]\n\nShe finds him.');
  assert.deepEqual(all(p.children, 'beat').map(b => [b.text, b.line, b.endLine, b.scenes.length]), [['One', 3, 10, 2], ['Two', 11, 13, 1]]);
});
test('a beat ends with its sequence', () => {
  const p = parse('Title: T\nStructure: sequence\n\n# One\n\n[[beat: A]]\n\nINT. A - DAY\n\nHe waits.\n\n# Two\n\nINT. B - DAY\n\nNobody.');
  const b = all(p.children, 'beat')[0];
  assert.equal(b.endLine, 11);
  assert.equal(all(p.children, 'beat').length, 1);
});
test('goals: subject, object, for, and status history', () => {
  assert.deepEqual([goal('durand').subject, goal('durand').object, goal('durand').for], [['SUZIE'], 'DURAND', 'money']);
  assert.deepEqual(goal('scheme').history.map(h => h.status), ['secret', 'active', 'lost']);
  assert.deepEqual(goal('payout').history.map(h => h.status), ['secret', 'active', 'lost']);
  assert.equal(goal('cure').status, 'abandoned');
  assert.equal(goal('corrupt').status, 'won');
  assert.equal(goal('warn').status, 'active');                     // never resolved
  const p = parse('[[goal: sex | id: sex | subject: WIFE, GIRLFRIEND]]\n');
  assert.deepEqual(p.goals[0].subject, ['WIFE', 'GIRLFRIEND']);
});
test('goal and status problems are reported', () => {
  const src = ['[[goal: divorce | subject: WIFE]]', '[[goal: divorce | id: d | subject: WIFE | for: nope]]', '[[status: won | goal: d]]',
    '[[status: lost | goal: d]]', '[[status: happy | goal: d]]', '[[status: won | goal: zz]]'].join('\n\n');
  assert.deepEqual(parse(src).diagnostics.map(x => x.line), [1, 3, 7, 9, 11]);
});
test('first colon separates key from value', () => {
  const n = parseStructuredNote('[[beat: The offer: 45,000 or risk the video | id: b15]]');
  assert.equal(n.value, 'The offer: 45,000 or risk the video');
  assert.equal(n.fields.id, 'b15');
});
test('ordinary notes are left alone', () => {
  assert.equal(parseStructuredNote('[[just a thought]]'), null);
  assert.equal(parse('INT. ROOM - DAY\n\n[[todo: fix this]]\n\nHe waits.').diagnostics.length, 0);
});
test('placement and ID problems are reported', () => {
  const d = parse('Title: T\nStructure: sequence\n\n# One\n\nINT. ROOM - DAY\n\n[[id: s1]]\n\n[[beat: A | id: s1]]\nHe waits.\n\n[[id: zz]]\n').diagnostics.map(x => x.line);
  assert.deepEqual(d, [10, 10, 13]);   // beat lacks blank line below; duplicate ID; orphan id
});
test('plain Fountain parses with scenes only', () => {
  const p = parse('INT. ROOM - DAY\n\nHe waits.\n\nEXT. STREET - NIGHT\n\nRain.');
  assert.equal(p.stats.scenes, 2); assert.equal(p.stats.beats, 0); assert.equal(p.children.length, 2);
});
