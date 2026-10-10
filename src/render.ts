// Display-only classification of script lines. The Fountain specification is the authority on
// these rules; this is a light reading of them, enough to lay a script out on screen.
import { parseStructuredNote, isSceneHeading } from './parser';

export type Kind = 'heading' | 'action' | 'character' | 'paren' | 'dialogue' | 'transition'
  | 'centered' | 'section' | 'synopsis' | 'beat' | 'goal' | 'status' | 'id' | 'pagebreak';
export interface Block { kind: Kind; line: number; text: string; depth?: number; fields?: Record<string, string> }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escape, drop inline notes, and apply Fountain emphasis. */
export function inline(s: string): string {
  return esc(s.replace(/\[\[[^\]]*\]\]/g, '').replace(/\[\[.*$/, ''))
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/(^|[^\w])_(.+?)_(?!\w)/g, '$1<u>$2</u>');
}

const isCue = (t: string) => {
  const core = t.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim();
  return /[A-Z]/.test(core) && core === core.toUpperCase() && !/[a-z]/.test(core);
};

export function blocks(text: string, bodyStart: number): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = bodyStart - 1, boneyard = false;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const start = i; const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') para.push(lines[i++].trim());
    const first = para[0], ln = start + 1;
    if (boneyard || first.startsWith('/*')) { boneyard = !para.join('\n').includes('*/'); continue; }

    if (para.length === 1) {
      const note = parseStructuredNote(first);
      if (note && (note.type === 'beat' || note.type === 'id' || note.type === 'goal' || note.type === 'status')) {
        out.push({ kind: note.type, line: ln, text: note.value, fields: note.fields }); continue;
      }
      const sec = /^(#+)\s*(.*)$/.exec(first);
      if (sec) { out.push({ kind: 'section', line: ln, text: sec[2], depth: sec[1].length }); continue; }
      const syn = /^=(?!=)\s*(.*)$/.exec(first);
      if (syn) { out.push({ kind: 'synopsis', line: ln, text: syn[1] }); continue; }
      if (/^={3,}$/.test(first)) { out.push({ kind: 'pagebreak', line: ln, text: '' }); continue; }
      if (isSceneHeading(first)) { out.push({ kind: 'heading', line: ln, text: first.replace(/^\./, '').replace(/\s*#[^#]+#\s*$/, '') }); continue; }
      const cen = /^>\s*(.*?)\s*<$/.exec(first);
      if (cen) { out.push({ kind: 'centered', line: ln, text: cen[1] }); continue; }
      if (first.startsWith('>')) { out.push({ kind: 'transition', line: ln, text: first.slice(1).trim() }); continue; }
      if (first === first.toUpperCase() && /TO:$/.test(first)) { out.push({ kind: 'transition', line: ln, text: first }); continue; }
    }
    const forcedCue = first.startsWith('@');
    if (para.length > 1 && !first.startsWith('!') && (forcedCue || isCue(first))) {
      out.push({ kind: 'character', line: ln, text: first.replace(/^@/, '').replace(/\s*\^$/, '') });
      para.slice(1).forEach((l, k) =>
        out.push({ kind: /^\(.*\)$/.test(l) ? 'paren' : 'dialogue', line: ln + 1 + k, text: l }));
      continue;
    }
    out.push({ kind: 'action', line: ln, text: para.map((l, k) => (k === 0 ? l.replace(/^!/, '') : l)).join('\n') });
  }
  return out;
}
