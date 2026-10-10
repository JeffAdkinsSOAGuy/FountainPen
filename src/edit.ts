// Writes accepted proposals into the script as Cascade notes. Script text is never changed:
// notes are only inserted, each as its own paragraph (spec 4.7).
import { parse } from './parser';
import type { Proposal } from './agent';

export interface Applied { text: string; shift: (line: number) => number }

const nextId = (used: Set<string>, prefix: string) => {
  let n = 1;
  for (const id of used) { const m = new RegExp(`^${prefix}(\\d+)$`).exec(id); if (m) n = Math.max(n, Number(m[1]) + 1); }
  const id = prefix + n; used.add(id); return id;
};
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/\]\]/g, ']').trim();

export function noteFor(p: Proposal, used: Set<string>, hashes: string): string[] {
  switch (p.kind) {
    case 'sequence': {
      const id = p.id && !used.has(p.id) ? (used.add(p.id), p.id) : nextId(used, 'q');
      return [`${hashes} ${clean(p.title).replace(/\\\|/g, '|')}`, `[[id: ${id}]]`, ...(p.stage ? [`[[stage: ${p.stage}]]`] : []), ...(p.synopsis ? [`= ${p.synopsis.replace(/\s+/g, ' ').trim()}`] : [])];
    }
    case 'resume':
      // resume an earlier sequence if it is in the script; otherwise this stretch has to stand as a sequence of its own
      return used.has(p.sequence) ? [`${hashes} ${clean(p.title).replace(/\\\|/g, '|')}`, `[[resume: ${p.sequence}]]`]
        : [`${hashes} ${clean(p.title).replace(/\\\|/g, '|')}`, `[[id: ${nextId(used, 'q')}]]`];
    case 'goal':
      return [`[[goal: ${clean(p.want)} | id: ${p.id} | subject: ${p.subject.map(clean).join(', ')}${p.object ? ` | object: ${clean(p.object)}` : ''}${p.for && used.has(p.for) ? ` | for: ${p.for}` : ''}${p.from && used.has(p.from) ? ` | from: ${p.from}` : ''}${p.status === 'secret' ? ' | status: secret' : ''}]]`];
    case 'status':
      return [`[[status: ${p.status} | goal: ${p.goal}]]`];
    case 'beat':
      return [`[[beat: ${clean(p.text)} | id: ${nextId(used, 'b')}${p.ahead ? ` | ahead: ${clean(p.ahead)}` : ''}${p.stage ? ` | stage: ${p.stage}` : ''}]]`];
  }
}

/** Insert the given proposals. Returns the new text and a function mapping old line numbers to new ones. */
export function apply(text: string, proposals: Proposal[]): Applied {
  let L = text.replace(/\r\n?/g, '\n').split('\n');
  const doc = parse(text);
  const used = new Set<string>();
  const collect = (n: any[]) => n.forEach(c => { if (c.id) used.add(c.id); if (c.type === 'section') collect(c.children); });
  collect(doc.children as any[]);

  // A sequence needs a level to live at. Declare one in the title page if the script has none.
  let levels = [...doc.levels], headShift = 0;
  if (proposals.some(p => p.kind === 'sequence' || p.kind === 'resume') && !levels.includes('sequence')) {
    levels.push('sequence');
    const value = `Structure: ${levels.join(', ')}`;
    const at = L.findIndex((l, i) => i < doc.bodyStart - 1 && /^structure\s*:/i.test(l));
    if (at >= 0) L[at] = value;
    else if (doc.bodyStart > 1) { L.splice(doc.bodyStart - 2, 0, value); headShift = 1; }
    else { L.unshift(value, ''); headShift = 2; }
  }
  const hashes = '#'.repeat(Math.max(1, levels.indexOf('sequence') + 1));

  const order = { sequence: 0, resume: 0, beat: 1, status: 2, goal: 3 };
  const sorted = [...proposals].sort((a, b) => a.line - b.line || order[a.kind] - order[b.kind]);
  const at = new Map<number, string[]>();
  for (const p of sorted) if (p.kind === 'goal') used.add(p.id);        // so goals in this batch can name each other
  for (const p of sorted) {
    const block = at.get(p.line) ?? [];
    for (const n of noteFor(p, used, hashes)) block.push(n, '');
    at.set(p.line, block);
  }
  const points = [...at.keys()].sort((a, b) => a - b);
  for (const line of [...points].reverse()) L.splice(line - 1 + headShift, 0, ...at.get(line)!);
  const shift = (line: number) => line + headShift + points.filter(p => p <= line).reduce((s, p) => s + at.get(p)!.length, 0);
  return { text: L.join('\n'), shift };
}
