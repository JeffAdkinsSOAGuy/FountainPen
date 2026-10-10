import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, parseStructuredNote } from '../dist/parser.mjs';

const md = parse(readFileSync(new URL('./fixtures/moral-dilemma.fountain', import.meta.url), 'utf8'));
const scenes = n => n.flatMap(c => (c.type === 'scene' ? [c] : scenes(c.children)));

test('Moral Dilemma: counts', () => {
  assert.deepEqual(md.levels, ['sequence']);
  assert.equal(md.stats.sequences, 6);
  assert.equal(md.stats.scenes, 13);
  assert.equal(md.stats.beats, 41);
  assert.equal(md.stats.ids, 6 + 13 + 41);
  assert.deepEqual(md.diagnostics, []);
});
test('Moral Dilemma: structure', () => {
  assert.deepEqual(md.children.map(s => [s.id, s.title, scenes(s.children).length]), [
    ['q1', 'The Warning', 2], ['q2', 'The Host', 2], ['q3', 'The Boyfriend', 5],
    ['q4', 'A Word from Our Sponsor', 1], ['q5', 'Nana', 1], ['q6', 'The Turn', 2]]);
  assert.equal(md.children[0].synopsis, 'A narrator warns that this broadcast comes from one possible future.');
  const all = scenes(md.children);
  assert.deepEqual(all.map(s => s.id), Array.from({ length: 13 }, (_, i) => 's' + (i + 1)));
  assert.equal(all[0].beats.length, 0);                       // a scene may have no beats
  assert.equal(all[0].heading, 'INT. GAME SHOW SET - DAY');   // forced "." is stripped
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
