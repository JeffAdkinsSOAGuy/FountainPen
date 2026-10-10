// Fountain Cascade parser (spec v0.3).
// Reads a .fountain file and returns its Cascade structure.
//   Physical cut: scenes (place and time).
//   Dramatic cut: sequences, goals, and beats. Beats may cross scene headings.
// It does not classify dialogue or action; see render.ts for display.
// Line numbers are 1-based.

import { LIBRARY, Spine } from './spines';

export interface Diagnostic { line: number; message: string }

export type GoalStatus = 'secret' | 'active' | 'won' | 'lost' | 'abandoned';
export interface Goal {
  type: 'goal'; id: string; want: string; subject: string[]; object?: string;
  /** The goal this one serves: its parent in the goal tree. */ for?: string;
  /** The goal this one grew out of (raised from it, or replacing it). */ from?: string;
  line: number; history: Array<{ status: GoalStatus; line: number }>; status: GoalStatus;
}
export interface StatusChange { type: 'status'; goal: string; status: GoalStatus; line: number }
export interface Beat {
  type: 'beat'; text: string; id?: string; ahead?: string; stage?: string; line: number; endLine: number;
  /** Heading lines of the scenes this beat runs through, in order. */
  scenes: number[];
  fields: Record<string, string>;
}
export interface Scene { type: 'scene'; heading: string; number?: string; id?: string; line: number; endLine: number }
export type Item = Section | Scene | Beat | Goal | StatusChange;
export interface Section {
  type: 'section'; depth: number; level?: string; title: string; id?: string;
  synopsis?: string; line: number; endLine: number;
  /** Set when this section continues an earlier sequence: that sequence's ID. */ resumes?: string;
  /** Stages of the script's spine attached to this sequence. */ stages: string[];
  /** Everything inside the section, in script order. */
  children: Item[];
}
export interface StructuredNote { type: string; value: string; fields: Record<string, string> }
export interface CascadeDoc {
  titlePage: Record<string, string>;
  levels: string[];
  /** The spines the script names, with their stages in order. */ spines: Spine[];
  bodyStart: number;
  lineCount: number;
  children: Item[];
  goals: Goal[];
  diagnostics: Diagnostic[];
  stats: { sections: number; sequences: number; scenes: number; beats: number; goals: number; ids: number };
}

const ID_RE = /^[a-z0-9-]{1,32}$/;
const SCENE_RE = /^(INT\.?\/EXT|INT|EXT|EST|I\/E)[.\s]/i;
const TYPES = new Set(['id', 'resume', 'stage', 'goal', 'status', 'beat']);
const STATUSES = new Set(['secret', 'active', 'won', 'lost', 'abandoned']);
const CLOSED = new Set(['won', 'lost', 'abandoned']);

/** Parse a line that is exactly one note with key: value fields (spec section 4). */
export function parseStructuredNote(line: string): StructuredNote | null {
  const m = /^\s*\[\[(.*)\]\]\s*$/.exec(line);
  if (!m || m[1].includes(']]')) return null;
  const parts = m[1].split(/(?<!\\)\|/);
  const fields: Record<string, string> = {};
  let type = '', value = '';
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const c = part.indexOf(':');               // 4.4: only the first colon separates
    if (c < 1) { if (k === 0) return null; continue; }
    const key = part.slice(0, c).trim();
    if (!/^[a-z0-9-]+$/.test(key)) { if (k === 0) return null; continue; }
    const val = part.slice(c + 1).trim().replace(/\\\|/g, '|');
    if (k === 0) { type = key; value = val; }
    fields[key] = val;
  }
  return { type, value, fields };
}

export function isSceneHeading(trimmed: string): boolean {
  return /^\.[^.\s]/.test(trimmed) || SCENE_RE.test(trimmed);
}

export function parseTitlePage(lines: string[]): { titlePage: Record<string, string>; bodyStart: number } {
  const titlePage: Record<string, string> = {};
  if (!/^[A-Za-z][^:]*:/.test(lines[0] ?? '')) return { titlePage, bodyStart: 1 };
  let i = 0, key = '';
  for (; i < lines.length && lines[i].trim() !== ''; i++) {
    const m = /^([A-Za-z][^:]*):\s*(.*)$/.exec(lines[i]);
    if (m && !/^\s/.test(lines[i])) { key = m[1].trim().toLowerCase(); titlePage[key] = m[2].trim(); }
    else if (key) titlePage[key] = (titlePage[key] ? titlePage[key] + '\n' : '') + lines[i].trim();
  }
  return { titlePage, bodyStart: i + 1 };
}

/** Read the Spine title-page key: library spine IDs, or "custom" followed by "id: Name" lines. */
export function parseSpines(value: string | undefined): { spines: Spine[]; unknown: string[] } {
  const spines: Spine[] = [], unknown: string[] = [];
  if (!value) return { spines, unknown };
  const [first, ...rest] = value.split('\n');
  for (const id of first.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (id === 'custom') {
      const stages = rest.map(l => /^([a-z0-9-]+)\s*:\s*(.+)$/.exec(l.trim())).filter(Boolean).map(m => ({ id: m![1], name: m![2].trim() }));
      spines.push({ id: 'custom', name: 'Custom spine', stages });
    } else if (LIBRARY[id]) spines.push(LIBRARY[id]);
    else unknown.push(id);
  }
  return { spines, unknown };
}

export function parse(text: string): CascadeDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const n = lines.length;
  const { titlePage, bodyStart } = parseTitlePage(lines);
  const levels = (titlePage['structure'] ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const diagnostics: Diagnostic[] = [];
  const { spines, unknown: unknownSpines } = parseSpines(titlePage['spine']);
  const sequenceById = new Map<string, Section>();
  let stageTarget: Section | null = null;        // section still open to stage notes (nothing but notes since its heading)
  const root: Item[] = [];
  const stack: Section[] = [];
  const ids = new Map<string, number>();
  const goals: Goal[] = [];
  const goalById = new Map<string, Goal>();
  const stats = { sections: 0, sequences: 0, scenes: 0, beats: 0, goals: 0, ids: 0 };

  let scene: Scene | null = null;
  let beat: Beat | null = null;
  let idTarget: Section | Scene | null = null;   // heading still waiting for its id note
  let synTarget: Section | null = null;          // section still waiting for its synopsis
  let boneyard = false;

  const blank = (ln: number) => ln < 1 || ln > n || lines[ln - 1].trim() === '';
  const here = () => (stack.length ? stack[stack.length - 1].children : root);
  const problem = (line: number, message: string) => diagnostics.push({ line, message });
  const claimId = (id: string, ln: number): boolean => {
    if (!ID_RE.test(id)) { problem(ln, `"${id}" is not a valid ID. Use 1 to 32 lowercase letters, digits, or hyphens.`); return false; }
    if (ids.has(id)) { problem(ln, `ID "${id}" is already used on line ${ids.get(id)}.`); return false; }
    ids.set(id, ln); stats.ids++; return true;
  };
  const stageOk = (ref: string, ln: number): boolean => {
    if (!spines.length) { problem(ln, 'This script names no spine in its title page, so this stage has nothing to refer to. Add a "Spine:" line.'); return false; }
    const [a, b] = ref.includes('/') ? ref.split('/') : [undefined, ref];
    const pool = a ? spines.filter(sp => sp.id === a.trim()) : spines;
    if (!pool.some(sp => sp.stages.some(st => st.id === (b ?? '').trim()))) { problem(ln, `"${ref}" is not a stage of ${spines.map(sp => sp.name).join(' or ')}.`); return false; }
    return true;
  };
  const closeBeat = (end: number) => { if (beat) { beat.endLine = end; beat = null; } };
  const closeScene = (end: number) => { if (scene) { scene.endLine = end; scene = null; } };

  for (let ln = bodyStart; ln <= n; ln++) {
    const t = lines[ln - 1].trim();
    if (boneyard) { if (t.includes('*/')) boneyard = false; continue; }
    if (t === '') continue;
    if (t.startsWith('/*')) { if (!t.includes('*/')) boneyard = true; continue; }

    const note = parseStructuredNote(t);
    if (note && TYPES.has(note.type)) {
      if (!blank(ln - 1) || !blank(ln + 1)) problem(ln, `This ${note.type} note needs a blank line above and below it.`);
      const f = note.fields;
      if (note.type === 'id') {
        if (!idTarget) problem(ln, 'This id note does not follow a section or scene heading.');
        else if (idTarget.id) problem(ln, 'This heading already has an ID.');
        else if (claimId(note.value, ln)) { idTarget.id = note.value; if (idTarget.type === 'section') sequenceById.set(note.value, idTarget); }
        continue;
      }
      if (note.type === 'resume') {
        if (!idTarget || idTarget.type !== 'section') problem(ln, 'A resume note goes directly under a sequence heading.');
        else if (idTarget.id) problem(ln, 'This heading already has an ID, so it starts a sequence of its own and cannot resume another.');
        else if (!sequenceById.has(note.value)) problem(ln, `No earlier sequence has the ID "${note.value}".`);
        else { idTarget.resumes = note.value; if (idTarget.level === 'sequence') stats.sequences--; idTarget = null; }
        continue;
      }
      if (note.type === 'stage') {
        if (!stageTarget) problem(ln, 'A stage note goes directly under a sequence heading. To attach a stage to a beat, add "| stage: ..." to the beat note.');
        else if (stageOk(note.value, ln)) stageTarget.stages.push(note.value);
        continue;
      }
      idTarget = null;                     // goal, status and beat notes may sit between a section and its synopsis
      if (note.type === 'goal') {
        if (!f['id']) { problem(ln, 'A goal needs an id, so that status notes can refer to it.'); continue; }
        if (!f['subject']) problem(ln, 'A goal needs a subject: the agent who wants it.');
        if (!claimId(f['id'], ln)) continue;
        let status: GoalStatus = 'active';
        if (f['status']) {
          if (f['status'] === 'secret' || f['status'] === 'active') status = f['status'];
          else problem(ln, `A goal starts as "secret" or "active", not "${f['status']}".`);
        }
        const g: Goal = {
          type: 'goal', id: f['id'], want: note.value, line: ln, status,
          subject: (f['subject'] ?? '').split(',').map(s => s.trim()).filter(Boolean),
          object: f['object'] || undefined, for: f['for'] || undefined, from: f['from'] || undefined, history: [{ status, line: ln }],
        };
        for (const k of ['for', 'from'] as const) if (g[k] && !goalById.has(g[k]!)) problem(ln, `Goal "${g.id}" names "${g[k]}" in its ${k} field, but no goal with that ID has been declared before it.`);
        goals.push(g); goalById.set(g.id, g); here().push(g); stats.goals++;
      } else if (note.type === 'status') {
        const g = goalById.get(f['goal'] ?? '');
        if (!STATUSES.has(note.value)) problem(ln, `"${note.value}" is not a status. Use secret, active, won, lost, or abandoned.`);
        else if (!f['goal']) problem(ln, 'A status note needs a goal field naming the goal it changes.');
        else if (!g) problem(ln, `No goal with the ID "${f['goal']}" has been declared before this line.`);
        else if (CLOSED.has(g.status)) problem(ln, `Goal "${g.id}" was already ${g.status} on line ${g.history[g.history.length - 1].line}.`);
        else if (note.value === g.status) problem(ln, `Goal "${g.id}" is already ${g.status}.`);
        else if (note.value === 'secret') problem(ln, `Goal "${g.id}" is already in the open, so it cannot become secret again.`);
        else {
          g.status = note.value as GoalStatus; g.history.push({ status: g.status, line: ln });
          here().push({ type: 'status', goal: g.id, status: g.status, line: ln });
        }
      } else {
        synTarget = null; stageTarget = null;
        closeBeat(ln - 1);
        beat = { type: 'beat', text: note.value, line: ln, endLine: ln, fields: f, ahead: f['ahead'] || undefined, scenes: scene ? [scene.line] : [] };
        if (f['id'] && claimId(f['id'], ln)) beat.id = f['id'];
        if (f['stage'] && stageOk(f['stage'], ln)) beat.stage = f['stage'];
        here().push(beat); stats.beats++;
      }
      continue;
    }
    if (/\[\[\s*(id|beat|goal|status|resume|stage)\s*:/.test(t)) problem(ln, 'A Cascade note must be alone on its line.');

    const sec = /^(#+)\s*(.*)$/.exec(t);
    if (sec) {
      closeBeat(ln - 1);                                // 9.2: a beat ends with its sequence; the scene, being physical, carries on
      const depth = sec[1].length;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()!.endLine = ln - 1;
      const s: Section = { type: 'section', depth, level: levels[depth - 1], title: sec[2].trim(), line: ln, endLine: ln, children: [], stages: [] };
      here().push(s); stack.push(s); stats.sections++;
      if (s.level === 'sequence') stats.sequences++;
      idTarget = s; synTarget = s; stageTarget = s;
      continue;
    }
    const syn = /^=(?!=)\s*(.*)$/.exec(t);
    if (syn) { if (synTarget && synTarget.synopsis === undefined) synTarget.synopsis = syn[1].trim(); continue; }

    if (blank(ln - 1) && blank(ln + 1) && isSceneHeading(t)) {
      closeScene(ln - 1);                               // 9.3: a scene heading does not end a beat
      let heading = t.replace(/^\./, '');
      let number: string | undefined;
      const num = /\s*#([^#]+)#\s*$/.exec(heading);
      if (num) { number = num[1]; heading = heading.slice(0, num.index); }
      scene = { type: 'scene', heading: heading.trim(), number, line: ln, endLine: ln };
      here().push(scene); stats.scenes++;
      if (beat) beat.scenes.push(ln);
      idTarget = scene; synTarget = null; stageTarget = null;
      continue;
    }
    idTarget = null; synTarget = null; stageTarget = null;
  }
  closeBeat(n); closeScene(n);
  while (stack.length) stack.pop()!.endLine = n;
  for (const id of unknownSpines) problem(1, `The spine "${id}" is not one FountainPen knows. Known spines: ${Object.keys(LIBRARY).join(', ')}, or "custom".`);
  if (stats.sections && !levels.length)
    problem(1, 'This script has sections but no "Structure:" line in its title page, so they have no Cascade meaning.');
  diagnostics.sort((a, b) => a.line - b.line);
  return { titlePage, levels, spines, bodyStart, lineCount: n, children: root, goals, diagnostics, stats };
}
