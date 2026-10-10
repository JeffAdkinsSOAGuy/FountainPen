// Fountain Cascade parser (spec v0.1.1).
// Reads a .fountain file and returns its Cascade structure: sections, scenes, beats, IDs.
// It does not classify dialogue or action; see render.ts for display.
// Line numbers are 1-based.

export interface Diagnostic { line: number; message: string }

export interface Beat {
  type: 'beat'; text: string; id?: string; line: number; endLine: number;
  fields: Record<string, string>;
}
export interface Scene {
  type: 'scene'; heading: string; number?: string; id?: string;
  line: number; endLine: number; beats: Beat[];
}
export interface Section {
  type: 'section'; depth: number; level?: string; title: string; id?: string;
  synopsis?: string; line: number; endLine: number; children: Array<Section | Scene>;
}
export interface StructuredNote { type: string; value: string; fields: Record<string, string> }
export interface CascadeDoc {
  titlePage: Record<string, string>;
  levels: string[];
  bodyStart: number;
  lineCount: number;
  children: Array<Section | Scene>;
  diagnostics: Diagnostic[];
  stats: { sections: number; sequences: number; scenes: number; beats: number; ids: number };
}

const ID_RE = /^[a-z0-9-]{1,32}$/;
const SCENE_RE = /^(INT\.?\/EXT|INT|EXT|EST|I\/E)[.\s]/i;
const TYPES = new Set(['id', 'beat']);

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

export function parse(text: string): CascadeDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const n = lines.length;
  const { titlePage, bodyStart } = parseTitlePage(lines);
  const levels = (titlePage['structure'] ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const diagnostics: Diagnostic[] = [];
  const root: Array<Section | Scene> = [];
  const stack: Section[] = [];
  const ids = new Map<string, number>();
  const stats = { sections: 0, sequences: 0, scenes: 0, beats: 0, ids: 0 };

  let scene: Scene | null = null;
  let beat: Beat | null = null;
  let idTarget: Section | Scene | null = null;   // heading still waiting for its id note
  let synTarget: Section | null = null;          // section still waiting for its synopsis
  let boneyard = false;

  const blank = (ln: number) => ln < 1 || ln > n || lines[ln - 1].trim() === '';
  const claimId = (id: string, ln: number): boolean => {
    if (!ID_RE.test(id)) { diagnostics.push({ line: ln, message: `"${id}" is not a valid ID. Use 1 to 32 lowercase letters, digits, or hyphens.` }); return false; }
    if (ids.has(id)) { diagnostics.push({ line: ln, message: `ID "${id}" is already used on line ${ids.get(id)}.` }); return false; }
    ids.set(id, ln); stats.ids++; return true;
  };
  const closeScene = (end: number) => {
    if (beat) { beat.endLine = end; beat = null; }
    if (scene) { scene.endLine = end; scene = null; }
  };

  for (let ln = bodyStart; ln <= n; ln++) {
    const raw = lines[ln - 1];
    const t = raw.trim();
    if (boneyard) { if (t.includes('*/')) boneyard = false; continue; }
    if (t === '') continue;
    if (t.startsWith('/*')) { if (!t.includes('*/')) boneyard = true; continue; }

    const note = parseStructuredNote(t);
    if (note && TYPES.has(note.type)) {
      if (!blank(ln - 1) || !blank(ln + 1))
        diagnostics.push({ line: ln, message: `This ${note.type} note needs a blank line above and below it.` });
      if (note.type === 'id') {
        if (!idTarget) diagnostics.push({ line: ln, message: 'This id note does not follow a section or scene heading.' });
        else if (idTarget.id) diagnostics.push({ line: ln, message: 'This heading already has an ID.' });
        else if (claimId(note.value, ln)) idTarget.id = note.value;
      } else {
        idTarget = null; synTarget = null;
        if (!scene) { diagnostics.push({ line: ln, message: 'This beat is not inside a scene.' }); continue; }
        if (beat) beat.endLine = ln - 1;
        beat = { type: 'beat', text: note.value, line: ln, endLine: ln, fields: note.fields };
        if (note.fields['id'] && claimId(note.fields['id'], ln)) beat.id = note.fields['id'];
        scene.beats.push(beat); stats.beats++;
      }
      continue;
    }
    if (/\[\[\s*(id|beat)\s*:/.test(t))
      diagnostics.push({ line: ln, message: 'A Cascade note must be alone on its line.' });

    const sec = /^(#+)\s*(.*)$/.exec(t);
    if (sec) {
      closeScene(ln - 1);
      const depth = sec[1].length;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()!.endLine = ln - 1;
      const s: Section = { type: 'section', depth, level: levels[depth - 1], title: sec[2].trim(), line: ln, endLine: ln, children: [] };
      (stack.length ? stack[stack.length - 1].children : root).push(s);
      stack.push(s); stats.sections++;
      if (s.level === 'sequence') stats.sequences++;
      idTarget = s; synTarget = s;
      continue;
    }
    const syn = /^=(?!=)\s*(.*)$/.exec(t);
    if (syn) { if (synTarget && synTarget.synopsis === undefined) synTarget.synopsis = syn[1].trim(); continue; }

    if (blank(ln - 1) && blank(ln + 1) && isSceneHeading(t)) {
      closeScene(ln - 1);
      let heading = t.replace(/^\./, '');
      let number: string | undefined;
      const num = /\s*#([^#]+)#\s*$/.exec(heading);
      if (num) { number = num[1]; heading = heading.slice(0, num.index); }
      scene = { type: 'scene', heading: heading.trim(), number, line: ln, endLine: ln, beats: [] };
      (stack.length ? stack[stack.length - 1].children : root).push(scene);
      stats.scenes++; idTarget = scene; synTarget = null;
      continue;
    }
    idTarget = null; synTarget = null;
  }
  closeScene(n);
  while (stack.length) stack.pop()!.endLine = n;
  if (stats.sections && !levels.length)
    diagnostics.push({ line: 1, message: 'This script has sections but no "Structure:" line in its title page, so they have no Cascade meaning.' });
  return { titlePage, levels, bodyStart, lineCount: n, children: root, diagnostics, stats };
}
