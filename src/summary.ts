// A plain summary of what a Cascade file means, in the shape used by the conformance cases in the
// Fountain Cascade repository (tests/format). Two tools that read a file the same way produce the same summary.
import { CascadeDoc, Item } from './parser';

const tidy = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));

function item(n: Item): Record<string, unknown> {
  switch (n.type) {
    case 'section': return tidy({ section: n.title, level: n.level, id: n.id, resumes: n.resumes, stages: n.stages, synopsis: n.synopsis, contains: n.children.map(item) });
    case 'scene': return tidy({ scene: n.heading, id: n.id, number: n.number });
    case 'beat': return tidy({ beat: n.text, id: n.id, ahead: n.ahead, stage: n.stage, scenes: n.scenes.length });
    case 'goal': return { goal: n.id };
    case 'status': return { status: n.status, goal: n.goal };
  }
}

export function summarise(doc: CascadeDoc): Record<string, unknown> {
  return {
    structure: doc.levels,
    spines: doc.spines.map(s => (s.id === 'custom' ? { custom: s.stages.map(st => st.id) } : s.id)),
    outline: doc.children.map(item),
    goals: doc.goals.map(g => tidy({ id: g.id, subject: g.subject, want: g.want, object: g.object, for: g.for, from: g.from, statuses: g.history.map(h => h.status) })),
    problems: [...new Set(doc.diagnostics.map(d => d.line))].sort((a, b) => a - b),
  };
}
