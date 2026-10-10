// The beat agent. It reads a script in parts of about five thousand words, scene by scene, carrying a
// ledger of agents, goals and the open sequence from one part to the next, and returns what it finds
// as proposals. Nothing here changes the script: see edit.ts.
import { CascadeDoc, Item, parseStructuredNote } from './parser';

export type Proposal =
  | { kind: 'sequence'; line: number; title: string; synopsis: string; reason: string }
  | { kind: 'goal'; line: number; id: string; want: string; subject: string[]; object?: string; for?: string; status: 'secret' | 'active'; reason: string }
  | { kind: 'status'; line: number; goal: string; status: 'active' | 'won' | 'lost' | 'abandoned'; reason: string }
  | { kind: 'beat'; line: number; text: string; ahead?: string; reason: string };
export interface AgentNote { name: string; about: string }
export interface Analysis { agents: AgentNote[]; proposals: Proposal[]; dropped: string[]; truncated: boolean; raw: string }
export interface Part { from: number; to: number; words: number; scenes: number }

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
const isMarkup = (t: string) => {
  const n = parseStructuredNote(t);
  return (n !== null && ['id', 'goal', 'status', 'beat'].includes(n.type)) || /^#+\s/.test(t) || /^=(?!=)/.test(t);
};
const walk = (nodes: Item[], type: string): any[] =>
  nodes.flatMap(c => [...(c.type === type ? [c] : []), ...(c.type === 'section' ? walk(c.children, type) : [])]);

/** Lines a note may be placed before: the first line of each paragraph of script text. */
export function insertionLines(text: string, doc: CascadeDoc): Set<number> {
  const L = lines(text), out = new Set<number>();
  let boneyard = false;
  for (let i = doc.bodyStart - 1; i < L.length; i++) {
    const t = L[i].trim();
    if (boneyard) { if (t.includes('*/')) boneyard = false; continue; }
    if (t.startsWith('/*')) { boneyard = !t.includes('*/'); continue; }
    if (t === '' || (i > 0 && L[i - 1].trim() !== '' && i >= doc.bodyStart)) continue;
    if (!isMarkup(t)) out.add(i + 1);
  }
  return out;
}

/** The script, or lines from..to of it, with [line] in front of every place a note may go. */
export function numberedScript(text: string, doc: CascadeDoc, from = 1, to = Infinity): string {
  const ok = insertionLines(text, doc);
  return lines(text).map((l, i) => (ok.has(i + 1) ? `[${i + 1}] ${l.trim()}` : l.trim()))
    .filter((_, i) => i + 1 >= from && i + 1 <= to).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Cut the script into parts of roughly `target` words. A part always ends where a scene ends, so a
 * scene is never split; one very long scene becomes a part on its own.
 */
export function partsOf(text: string, doc: CascadeDoc, target = 5000): Part[] {
  const L = lines(text);
  const count = (a: number, b: number) => L.slice(a - 1, b).join(' ').split(/\s+/).filter(Boolean).length;
  // each scene starts at its heading, pulled back over any markup and blank lines that introduce it
  const starts = walk(doc.children, 'scene').map((s: any) => {
    let at = s.line;
    while (at - 1 >= doc.bodyStart && (L[at - 2].trim() === '' || isMarkup(L[at - 2].trim()))) at--;
    return at;
  }).filter((v: number, i: number, a: number[]) => i === 0 || v > a[i - 1]);
  if (starts.length) starts[0] = doc.bodyStart; else starts.push(doc.bodyStart);
  const parts: Part[] = [];
  let from = starts[0], words = 0, scenes = 0;
  starts.forEach((s, i) => {
    const end = (starts[i + 1] ?? L.length + 1) - 1, w = count(s, end);
    if (scenes > 0 && words + w > target * 1.15) { parts.push({ from, to: s - 1, words, scenes }); from = s; words = 0; scenes = 0; }
    words += w; scenes++;
    if (i === starts.length - 1) parts.push({ from, to: L.length, words, scenes });
  });
  return parts;
}

export const SYSTEM = `You analyse screenplays for a writer. You never rewrite the script. You only mark where its drama lies, using the model below, and every mark you make is a proposal the writer will accept or reject.

THE MODEL

A script is cut two ways. The physical cut is the scene: a unit of place and time, opened by a scene heading. Scenes exist for production and carry no dramatic meaning. The dramatic cut is made of sequences and beats, which are defined by what agents want and who holds power. They are free to cross scene headings.

AGENT. Anyone or anything that wants something and can act to get it. A person, a ghost, a machine, an animal or a storm can be an agent if the story gives it a will.

GOAL. Something an agent wants to bring about over a stretch of story. It has a subject (the agent who wants it), a want (a short verb phrase) and usually an object (the agent or thing it is aimed at), so that it reads as a sentence: WIFE wants to divorce HUSBAND. An agent may hold several goals. One goal may exist because of another: she wants the divorce because she wants to marry someone else.

STATUS. Every goal has a status at every point in the script. "secret" means hidden from its object (others, and the audience, may know). "active" means known to its object and being pursued. A goal ends "won", "lost" or "abandoned". A goal can only be secret if its object is an agent.

SEQUENCE. A stretch of story about agents and their goals. It is either a conflict between two goals or the creation of a goal. A goal is not bound to one sequence: it may be created in one, stay secret through another and be fought over in a third.

BEAT. A stretch of a sequence in which the balance of power between the agents, and what each is trying to do at that moment, stay the same. A new beat begins where the power shifts or an agent's objective changes. An objective is what an agent is trying to do right now in service of a goal. A tactic is how they go about it. A change of tactic alone does not begin a beat. A tactic that succeeds does, because it shifts the power. A scene heading does not begin a beat: if nothing turns, the beat carries on into the next scene. A passage with no agents, such as an establishing shot, belongs to no beat.

HOW YOU ARE GIVEN THE SCRIPT

The script comes in parts, in order, a few scenes at a time. With each part you are given the ledger: the story so far, the agents and goals already found, the sequence that is open, and the beat that is in progress. Read the ledger first. A goal set up in an earlier part often decides what a moment in this part means.

In each part, [N] stands in front of every line where a mark may be placed. A mark goes immediately before that line. You may only use bracketed numbers from the current part. A beat that starts when a character speaks goes before that character's name. The part may already contain marks, written as [[beat: ...]], [[goal: ...]], [[status: ...]], [[id: ...]], lines starting with # (sequence headings) and lines starting with = (synopses). Treat existing marks as decided and do not repeat them.

HOW TO WORK ON A PART

1. Decide whether the open sequence carries on through this part or a new one begins in it. A new sequence begins where the story turns to a different conflict, or to the creation of a different goal. Many parts begin and end inside the same sequence. Do not start a sequence just because a part or a scene starts.
2. Note any agent you have not met, any goal that is created, and any goal whose status changes.
3. Go through the part asking, at every line: who has the upper hand, and did that just change? Has what someone is trying to do just changed? Mark a beat only where the answer is yes. The beat in progress carries on from the last part unless something turns. Expect far fewer beats than the scenes have events.

WHAT TO RETURN

Return JSON Lines only: one JSON object per line, no other text, no code fences. First any new agents, then every proposal in script order, then one carry object.

{"kind":"agent","name":"SUZIE","about":"one sentence on who they are and what drives them"}
{"kind":"sequence","line":12,"title":"The Divorce","synopsis":"one sentence on what happens","reason":"conflict between divorce and reputation"}
{"kind":"goal","line":12,"id":"divorce","want":"divorce","subject":["WIFE"],"object":"HUSBAND","for":"exclusive","status":"secret","reason":"one sentence"}
{"kind":"status","line":80,"goal":"divorce","status":"active","reason":"she says it to his face"}
{"kind":"beat","line":80,"text":"She says it","ahead":"WIFE","reason":"power shifts to her: he can no longer pretend"}
{"kind":"carry","summary":"the story so far in under 150 words: what has happened, what each agent now wants, and who knows what"}

Rules for the fields:
- "line" is a bracketed number from the current part.
- Name agents exactly as the script names them in character cues, in capitals. List both individuals and groups that act with a will.
- A goal "id" is a short lowercase word or words joined by hyphens, unique in the script: do not reuse an id from the ledger. "status" on a goal is "secret" or "active". Declare a goal at the line where it is created, or where it first bears on what happens if it is already held when the story opens.
- A status object records a change to a goal from the ledger or from this part: "active", "won", "lost" or "abandoned", at the line where it happens. Follow the order of the script as the audience sees it, not the order of events in story time. A goal that has not resolved gets no status change.
- Word "want" so that subject, want and object read as one sentence: SUZIE wants to "cash in" DURAND. Do not repeat the object inside "want".
- Keep goals few. One aim is one goal, however many steps it takes: do not declare a new goal for each step, and do not declare again a goal that is already in the ledger. When the story returns to a conflict from earlier, start a new sequence but keep using the goals already declared.
- "object" is optional. Use the character's name in capitals, or plain words when the object is not a character ("the viewer", "his reputation").
- "for" is optional. It is the id of another goal that this goal serves.
- "ahead" is optional. It names who actually holds the power in the beat, even if someone else believes they do. Leave it out when nobody clearly has the upper hand.
- Beat "text" is at most eight words and says what turns, in plain language. "title" is at most five words.
- "reason" is one sentence saying which shift of power or objective, or which goal, justifies the mark.
- Propose sequences only if you are told the script has no sequence headings of its own. Once the first sequence begins, everything after it belongs to a sequence, so an interlude needs one of its own or belongs to its neighbour. A sequence need not open with a beat.
- The carry summary replaces the one you were given, so keep what still matters from it.
- If the script is inconsistent about a name or a detail, pick the commonest form and say nothing about it.

HINDSIGHT

After the last part you may be asked one more question, without the script: now that you know how the story ends, which goals in the ledger were in fact held in secret before the line where you declared them? Answer as that request describes.`;

/**
 * Pull every complete top-level JSON object out of a reply, however it is laid out: one per line,
 * pretty-printed, wrapped in an array or a code fence, or run together on one line.
 */
export function jsonObjects(raw: string): { objects: any[]; unreadable: number; incomplete: boolean } {
  const objects: any[] = [];
  let depth = 0, start = -1, inString = false, escaped = false, unreadable = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (depth > 0 && c === '"') inString = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) {
      try { objects.push(JSON.parse(raw.slice(start, i + 1))); } catch { unreadable++; }
      start = -1;
    }
  }
  return { objects, unreadable, incomplete: depth > 0 };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const names = (v: unknown) => (Array.isArray(v) ? v.map(str) : str(v).split(',').map(s => s.trim())).filter(Boolean);
const sentence = (g: { subject: string[]; want: string; object?: string }) => `${g.subject.join(' and ')} wants to ${g.want}${g.object ? ' ' + g.object : ''}`;

/** A run in progress: the script, its parts, and everything found so far. */
export interface Run {
  text: string; doc: CascadeDoc; parts: Part[]; k: number;
  agents: AgentNote[]; proposals: Proposal[]; dropped: string[]; truncated: boolean; raw: string;
  summary: string;
  ok: Set<number>; ids: Set<string>; goalLine: Map<string, number>; closed: Set<string>;
  goals: Map<string, { sentence: string; status: string; line: number; object?: string }>;
  sequence: string; beat: string; firstSeen: Map<string, number>;
}

export function startRun(text: string, doc: CascadeDoc, targetWords = 5000): Run {
  const ids = new Set<string>();
  const collect = (n: any[]) => n.forEach(c => { if (c.id) ids.add(c.id); if (c.type === 'section') collect(c.children); });
  collect(doc.children as any[]);
  const L = lines(text), ok = insertionLines(text, doc), firstSeen = new Map<string, number>();
  for (const n of ok) { const t = L[n - 1].trim().replace(/^@/, '').replace(/\s*\(.*\)\s*$/, '').replace(/\s*\^$/, '');
    if (/^[A-Z][A-Z0-9 .'\-]*$/.test(t) && L[n] !== undefined && L[n].trim() !== '' && !firstSeen.has(t)) firstSeen.set(t, n); }
  return {
    text, doc, parts: partsOf(text, doc, targetWords), k: 0, agents: [], proposals: [], dropped: [], truncated: false, raw: '',
    summary: '', ok, ids, firstSeen,
    goalLine: new Map(doc.goals.map(g => [g.id, g.line])),
    closed: new Set(doc.goals.filter(g => ['won', 'lost', 'abandoned'].includes(g.status)).map(g => g.id)),
    goals: new Map(doc.goals.map(g => [g.id, { sentence: sentence(g), status: g.status, line: g.line, object: g.object }])),
    sequence: '', beat: '',
  };
}

/** The message for the part the run is on, or null when every part has been read. */
export function partMessage(run: Run): string | null {
  const part = run.parts[run.k];
  if (!part) return null;
  const L = lines(run.text), n = run.parts.length;
  // sequences and beats already marked in the script before this part count as the open ones
  const before = (type: string) => walk(run.doc.children, type).filter((x: any) => x.line < part.from).pop();
  const seq = run.sequence || before('section')?.title || '', beat = run.beat || before('beat')?.text || '';
  const goals = [...run.goals.entries()].map(([id, g]) => `- ${id}: ${g.sentence} (${g.status})`).join('\n');
  const tail = run.k === 0 ? '' : L.slice(Math.max(run.doc.bodyStart - 1, part.from - 13), part.from - 1).map(l => l.trim()).filter(l => l && !isMarkup(l)).join('\n');
  return [
    run.doc.titlePage['title'] ? `Title: ${run.doc.titlePage['title']}` : '',
    `This is part ${run.k + 1} of ${n}${run.k === n - 1 ? ', the last part' : ''}.`,
    run.doc.stats.sequences ? 'The script has sequence headings of its own, so do not propose sequences.' : 'The script has no sequence headings of its own, so propose them.',
    '<ledger>',
    `Story so far: ${run.summary || (run.k === 0 ? 'Nothing yet. This is the opening.' : 'No summary was carried over.')}`,
    `Agents: ${run.agents.length ? run.agents.map(a => `${a.name} (${a.about})`).join('; ') : 'none yet'}`,
    `Goals:\n${goals || 'none yet'}`,
    `Open sequence: ${seq || 'none yet'}`,
    `Beat in progress: ${beat || 'none'}`,
    '</ledger>',
    tail ? `<previous_lines note="the end of the last part, for continuity only; already marked">\n${tail}\n</previous_lines>` : '',
    `<script part="${run.k + 1}">\n${numberedScript(run.text, run.doc, part.from, part.to)}\n</script>`,
    'Return the JSON Lines for this part now.',
  ].filter(Boolean).join('\n\n');
}

/** Read the reply for the current part into the run, checking every finding, and move to the next part. */
export function absorb(run: Run, raw: string): void {
  const part = run.parts[run.k], L = lines(run.text);
  const found = jsonObjects(raw);
  run.raw += (run.raw ? '\n' : '') + raw.trim();
  if (found.incomplete) run.truncated = true;
  if (found.unreadable) run.dropped.push(`${found.unreadable} part${found.unreadable === 1 ? '' : 's'} of a reply could not be read.`);
  found.objects.forEach((o: any) => {
    if (!o || typeof o !== 'object') return;
    const kind = str(o.kind), reason = str(o.reason);
    if (kind === 'agent') { if (str(o.name) && !run.agents.some(a => a.name === str(o.name))) run.agents.push({ name: str(o.name), about: str(o.about) }); return; }
    if (kind === 'carry') { if (str(o.summary)) run.summary = str(o.summary); return; }
    if (!['beat', 'goal', 'sequence', 'status'].includes(kind)) return;
    const what = kind === 'beat' ? `beat "${str(o.text)}"` : kind === 'goal' ? `goal "${str(o.id)}"` : kind === 'sequence' ? `sequence "${str(o.title)}"` : `status change for "${str(o.goal)}"`;
    let line = Number(o.line);
    if (!run.ok.has(line)) {                       // inside a paragraph or speech: move to where it starts
      let at = line;
      while (at > run.doc.bodyStart && L[at - 2] !== undefined && L[at - 2].trim() !== '') at--;
      if (!Number.isInteger(line) || line < 1 || line > L.length || !run.ok.has(at)) { run.dropped.push(`Dropped the ${what}: line ${o.line} is not a place a mark can go.`); return; }
      run.dropped.push(`Moved the ${what} from line ${line} to line ${at}, the start of that speech or paragraph.`);
      line = at;
    }
    if (part && (line < part.from || line > part.to)) { run.dropped.push(`Dropped the ${what}: line ${line} is outside the part being read.`); return; }
    if (kind === 'beat') {
      if (!str(o.text)) return;
      run.proposals.push({ kind, line, text: str(o.text), ahead: str(o.ahead) || undefined, reason });
      run.beat = str(o.text) + (str(o.ahead) ? ` (${str(o.ahead)} ahead)` : '');
    } else if (kind === 'sequence') {
      if (run.doc.stats.sequences) { run.dropped.push(`Dropped the ${what}: this script already has sequences.`); return; }
      if (!str(o.title)) return;
      const title = str(o.title).replace(/^#+\s*/, '');
      run.proposals.push({ kind, line, title, synopsis: str(o.synopsis), reason });
      run.sequence = title + (str(o.synopsis) ? `: ${str(o.synopsis)}` : ''); run.beat = '';
    } else if (kind === 'goal') {
      const id = str(o.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
      const subject = names(o.subject);
      if (!id || !subject.length || !str(o.want)) { run.dropped.push(`Dropped the ${what}: it had no id, subject or want.`); return; }
      if (run.ids.has(id)) { run.dropped.push(`Dropped the ${what}: that ID is already in use.`); return; }
      const object = str(o.object) || undefined, status = o.status === 'secret' && object ? 'secret' : 'active';
      run.ids.add(id); run.goalLine.set(id, line);
      run.proposals.push({ kind, line, id, want: str(o.want), subject, object, for: str(o.for) || undefined, status, reason });
      run.goals.set(id, { sentence: sentence({ subject, want: str(o.want), object }), status, line, object });
    } else {
      const goal = str(o.goal), status = str(o.status);
      if (!['active', 'won', 'lost', 'abandoned'].includes(status)) { run.dropped.push(`Dropped the ${what}: "${status}" is not a status.`); return; }
      if (!run.goalLine.has(goal) || run.goalLine.get(goal)! > line) { run.dropped.push(`Dropped the ${what}: no such goal has been declared by line ${line}.`); return; }
      if (run.closed.has(goal)) { run.dropped.push(`Dropped the ${what}: that goal has already ended.`); return; }
      if (run.goals.get(goal)?.status === status) return;
      if (status !== 'active') run.closed.add(goal);
      run.proposals.push({ kind: 'status', line, goal, status: status as any, reason });
      const g = run.goals.get(goal); if (g) g.status = status;
    }
  });
  run.k++;
}

/** After the last part: ask, without the script, which goals were secretly held before they were declared. */
export function hindsightMessage(run: Run): string | null {
  const mine = run.proposals.filter(p => p.kind === 'goal' && p.object) as Extract<Proposal, { kind: 'goal' }>[];
  if (run.parts.length < 2 || !mine.length || !run.firstSeen.size) return null;
  return [
    'You have now read the whole script. This is the hindsight question, and the script is not included.',
    `Story as it ended: ${run.summary}`,
    'Goals you declared, with the line where you declared each:',
    mine.map(g => `- ${g.id}: ${sentence(g)} (declared at line ${g.line} as ${g.status})`).join('\n'),
    'Lines where each character first speaks:',
    [...run.firstSeen.entries()].map(([name, line]) => `- ${name}: ${line}`).join('\n'),
    'Reading in parts, you could only declare a goal once it showed itself. Knowing the ending, was any of these goals already held, hidden from its object, earlier than the line where you declared it? For each one that was, return one JSON object per line, and nothing else:',
    '{"kind":"hindsight","goal":"the goal id","line":the line where its holder first speaks, taken from the list above,"reason":"one sentence"}',
    'Only include a goal if the script itself later shows it was held all along. If none qualifies, return {"kind":"none"}.',
  ].join('\n\n');
}

/** Move a goal back to where it was secretly first held, and mark the point it came into the open. */
export function absorbHindsight(run: Run, raw: string): void {
  run.raw += '\n' + raw.trim();
  const allowed = new Set(run.firstSeen.values());
  jsonObjects(raw).objects.forEach((o: any) => {
    if (str(o?.kind) !== 'hindsight') return;
    const g = run.proposals.find(p => p.kind === 'goal' && p.id === str(o.goal)) as Extract<Proposal, { kind: 'goal' }> | undefined;
    const line = Number(o.line);
    if (!g || !g.object || !allowed.has(line) || line >= g.line) return;
    const shown = g.line;
    run.goalLine.set(g.id, line);
    if (g.status === 'active' && !run.proposals.some(p => p.kind === 'status' && p.goal === g.id && p.line === shown))
      run.proposals.push({ kind: 'status', line: shown, goal: g.id, status: 'active', reason: 'This is where the goal comes into the open.' });
    g.line = line; g.status = 'secret';
    g.reason = `${str(o.reason) || 'Held in secret from here.'} (Placed with hindsight: it only shows itself at line ${shown}.)`;
  });
}

/** Everything the run has found, in script order. */
export function result(run: Run): Analysis {
  for (const p of run.proposals) if (p.kind === 'goal' && p.for && !run.ids.has(p.for)) p.for = undefined;
  const order = { sequence: 0, beat: 1, status: 2, goal: 3 };
  run.proposals.sort((a, b) => a.line - b.line || order[a.kind] - order[b.kind]);
  return { agents: run.agents, proposals: run.proposals, dropped: run.dropped, truncated: run.truncated, raw: run.raw };
}

/** Read a reply to a script given whole, as one part. */
export function readReply(raw: string, text: string, doc: CascadeDoc): Analysis {
  const run = startRun(text, doc, Infinity);
  absorb(run, raw);
  return result(run);
}

export interface RunOptions {
  key: string; model: string; text: string; doc: CascadeDoc; targetWords?: number;
  signal?: AbortSignal; onProgress?: (part: number, parts: number, findings: number) => void;
}
type Msg = { role: string; content: string };

/** One streamed request. Returns the text and whether the model ran out of room. */
async function stream(o: RunOptions, messages: Msg[], tick: (text: string) => void): Promise<{ text: string; cut: boolean }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: o.signal,
    headers: {
      'content-type': 'application/json', 'x-api-key': o.key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: o.model, max_tokens: 16000, stream: true, system: SYSTEM, messages }),
  });
  if (!res.ok || !res.body) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* not JSON */ }
    throw new Error(detail || `The API answered with status ${res.status}.`);
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '', cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let ev: any;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { out += ev.delta.text; tick(out); }
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'max_tokens') cut = true;
      else if (ev.type === 'error') throw new Error(ev.error?.message ?? 'The API reported an error.');
    }
  }
  return { text: out, cut };
}

/** Ask one question, carrying on if the reply is cut off, so that the answer always ends on a whole finding. */
async function ask(o: RunOptions, content: string, tick: (text: string) => void): Promise<{ text: string; cut: boolean }> {
  const first: Msg = { role: 'user', content };
  let all = '', cut = false;
  for (let round = 0; round < 4; round++) {
    const messages = round === 0 ? [first] : [first, { role: 'assistant', content: all },
      { role: 'user', content: 'Your reply was cut off. Carry on from exactly where it stopped, starting with the next JSON object. Do not repeat anything you have already given, and do not add any other text.' }];
    const part = await stream(o, messages, t => tick(all + '\n' + t));
    cut = part.cut;
    const joined = all + (all ? '\n' : '') + part.text;
    if (!cut) { all = joined; break; }
    const end = joined.lastIndexOf('}');
    if (end < 0 || end + 1 <= all.length) { all = joined; break; }     // no progress: stop asking
    all = joined.slice(0, end + 1);
  }
  return { text: all, cut };
}

/**
 * Read the script part by part through the Anthropic Messages API, from the browser. If a part fails,
 * what was found before it is kept and the failure is reported as a note.
 */
export async function analyse(o: RunOptions): Promise<Analysis> {
  const run = startRun(o.text, o.doc, o.targetWords ?? 5000);
  const n = run.parts.length;
  for (let msg = partMessage(run); msg !== null; msg = partMessage(run)) {
    const k = run.k, sofar = run.proposals.length;
    o.onProgress?.(k + 1, n, sofar);
    try {
      const reply = await ask(o, msg, t => o.onProgress?.(k + 1, n, sofar + jsonObjects(t).objects.length));
      if (reply.cut) run.truncated = true;
      absorb(run, reply.text);
    } catch (e: any) {
      if (k === 0 || e?.name === 'AbortError') throw e;
      run.dropped.push(`The run stopped at part ${k + 1} of ${n}: ${e?.message ?? e}. Everything found before that is listed.`);
      return result(run);
    }
  }
  const hind = hindsightMessage(run);
  if (hind) { try { absorbHindsight(run, (await ask(o, hind, () => {})).text); } catch (e: any) { if (e?.name === 'AbortError') throw e; } }
  return result(run);
}
