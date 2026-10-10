// The beat agent. It reads a script in parts of about five thousand words, scene by scene, carrying a
// ledger of agents, goals and the open sequence from one part to the next, and returns what it finds
// as proposals. Nothing here changes the script: see edit.ts.
import { CascadeDoc, Item, parseStructuredNote } from './parser';

export type Proposal =
  | { kind: 'sequence'; line: number; id?: string; title: string; synopsis: string; stage?: string; reason: string }
  | { kind: 'resume'; line: number; sequence: string; title: string; reason: string }
  | { kind: 'goal'; line: number; id: string; want: string; subject: string[]; object?: string; for?: string; from?: string; status: 'secret' | 'active'; reason: string }
  | { kind: 'status'; line: number; goal: string; status: 'active' | 'won' | 'lost' | 'abandoned'; reason: string }
  | { kind: 'beat'; line: number; text: string; ahead?: string; stage?: string; reason: string };
export interface AgentNote { name: string; about: string }
export interface Analysis { agents: AgentNote[]; proposals: Proposal[]; dropped: string[]; truncated: boolean; raw: string }
export interface Part { from: number; to: number; words: number; scenes: number }

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
const isMarkup = (t: string) => {
  const n = parseStructuredNote(t);
  return (n !== null && ['id', 'resume', 'stage', 'goal', 'status', 'beat'].includes(n.type)) || /^#+\s/.test(t) || /^=(?!=)/.test(t);
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

export const SYSTEM = `You analyse screenplays for a writer. You never rewrite the script and you never invent story events. You only mark where its drama lies, using the model below. Every mark you make is a proposal the writer will accept or reject, so prefer a few marks you can defend to many you cannot.

THE MODEL

A script is cut two ways. The physical cut is the scene: a unit of place and time, opened by a scene heading. Scenes exist for production and carry no dramatic meaning. The dramatic cut is made of sequences and beats, which are defined by what agents want and who holds power. They are free to cross scene headings.

AGENT. Anyone or anything that wants something and can act to get it. A person, a group, a ghost, a machine, an animal or a storm can be an agent if the story gives it a will. A known agent who takes on a new goal is not a new agent.

GOAL. Something an agent wants to bring about over a stretch of story. It has a subject (the agent who wants it), a want (a short verb phrase) and usually an object (the agent or thing it is aimed at), so that it reads as a sentence: WIFE wants to divorce HUSBAND. An agent may hold several goals at once.

THE GOAL TREE. Goals form a tree. A goal may serve another: he wins her over to find the bombs, and finds the bombs to stop the villain. A goal that serves no other is a top-level goal. A story usually creates its top-level goals early, and each later stretch pursues smaller goals in their service. Look for the top-level goals first, and make every smaller goal name the one it serves.

RAISED AND REPLACED GOALS. A goal may grow out of an earlier one. If the earlier goal stays live, the new one has been raised from it: he was using her, and now he loves her, and both goals are live. If the earlier goal is abandoned, the new one has replaced it: she gives up saving her grandmother, and selling her takes its place. Growing out of a goal is different from serving one. A new feeling, a new tactic or a new immediate aim does not by itself mean the old goal has been abandoned.

STATUS. Every goal has a status at every point in the script. "secret" means its object does not know the subject is pursuing it. What the audience knows does not matter: if the audience learns of a plan before its victim does, the goal is still secret. It becomes "active" at the line where its object learns of it, including by watching or hearing a record of it. A goal can only be secret if its object is an agent. A goal ends "won", "lost" or "abandoned", and once it has ended it never changes again. Progress is not winning, a setback is not losing, and turning to something else for a while is not abandoning.

SEQUENCE. A stretch of story about agents and their goals. It is a conflict between goals, a preparation for pursuing one, or the creation of one. A goal is not bound to one sequence: it may be created in one, stay secret through another and be fought over in a third.
- A sequence may pause while another sequence plays, and resume afterwards. When the story returns to a conflict that an earlier sequence was about, and its goals are still unresolved, that earlier sequence is resuming. It is not a new sequence.
- Agents may enter or leave during a sequence. An entrance does not end the sequence, though it may shift the power or change the goals in play.
- A sequence often ends when a goal it is about is won or lost, while the goal above it in the tree lives on and gives rise to the next sequence. This is a tendency, not a rule.

BEAT. A stretch of a sequence in which the balance of power between the agents, and what each is trying to do at that moment, stay the same. A new beat begins where the power shifts or an agent's objective changes. An objective is what an agent is trying to do right now in service of a goal. A tactic is how they go about it. A change of tactic alone does not begin a beat. A tactic that succeeds does, because it shifts the power. A scene heading does not begin a beat: if nothing turns, the beat carries on into the next scene. A passage with no agents, such as an establishing shot, belongs to no beat.
- A sequence opens with a beat, saying where the power stands, as soon as an agent is present.
- When a sequence resumes, a new beat begins. The beat that was in progress when it paused does not pick up again.

SPINE AND STAGE. A spine is a story arc, such as the Hero's Journey: an ordered list of stages. A stage is a plot point the story is expected to reach, usually a goal being created, prepared for, fought over, raised or resolved. A stage is a label on a sequence or a beat. It is never a sequence or a goal in itself, and a story need not reach every stage or reach them in order.

HOW YOU ARE GIVEN THE SCRIPT

The script comes in parts, in order, a few scenes at a time. With each part you are given the ledger: the story so far, the agents, the goals with their status and place in the tree, the sequences so far with their ids, the sequence that is open, and the beat in progress. You are also told how far the writer has already marked sequences, and whether a spine is in use. Read the ledger first. A goal set up in an earlier part often decides what a moment in this part means. A new part is not a new sequence, a new beat or a new goal.

In each part, [N] stands in front of every line where a mark may be placed. A mark goes immediately before that line. You may only use bracketed numbers from the current part. A beat that starts when a character speaks goes before that character's name. If something turns in the middle of a speech or a paragraph, mark it at the next bracketed line. The part may already contain marks, written inside double square brackets, and lines starting with # (headings) or = (synopses). Treat existing marks as decided: do not repeat them and do not contradict them.

HOW TO WORK ON A PART

1. Sequences. Decide, in this order: does the open sequence carry on? Is the story returning to an earlier sequence whose goals are still unresolved (a resume)? Or has it turned to a conflict or a goal that no earlier sequence was about (a new sequence)? A change of scene, place, speaker or tactic is none of these. When unsure, the open sequence carries on.
2. Entrances. When an agent enters, ask three things in order. Did the balance of power just shift? Then it is a new beat. Did someone's goal change, or did the newcomer bring one? Then declare it. Is the story now about a different conflict altogether? Only then is it a new sequence.
3. Goals. Note any goal that is created and any goal whose status changes. For each new goal ask whether it serves a goal in the ledger, and whether it grew out of one.
4. Beats. Go through the part asking, at every bracketed line: what is different immediately after this line that was not true immediately before it? Who has the upper hand, and did that just change? Has what someone is trying to do just changed? Mark a beat only where something has. The beat in progress carries on from the last part unless something turns. Expect far fewer beats than the scenes have events.
5. Stages. Only if a spine is supplied: where a sequence or beat you are proposing clearly is one of its stages, name the stage on it. Leave it off when the fit is not clear.

WHAT TO RETURN

Return JSON Lines only: one JSON object per line, no other text, no code fences. First any new agents, then every proposal in script order, then one carry object.

{"kind":"agent","name":"WIFE","about":"one sentence on who they are and what drives them"}
{"kind":"sequence","line":12,"id":"bedroom","title":"Not Until You're Divorced","synopsis":"one sentence on what happens","reason":"the creation of the divorce goal"}
{"kind":"goal","line":12,"id":"exclusive","want":"be exclusive with","subject":["WIFE"],"object":"GIRLFRIEND","status":"active","reason":"one sentence"}
{"kind":"goal","line":40,"id":"divorce","want":"divorce","subject":["WIFE"],"object":"HUSBAND","for":"exclusive","status":"secret","reason":"she takes it on to meet the girlfriend's condition, and he does not know"}
{"kind":"beat","line":80,"text":"She says it","ahead":"WIFE","reason":"power shifts to her: he can no longer pretend"}
{"kind":"status","line":80,"goal":"divorce","status":"active","reason":"she says it to his face"}
{"kind":"goal","line":80,"id":"reputation","want":"protect","subject":["HUSBAND"],"object":"his reputation","status":"active","reason":"her demand creates it"}
{"kind":"resume","line":300,"sequence":"bedroom","reason":"the story returns to the two of them with the exclusivity goal still open"}
{"kind":"carry","summary":"the story so far in under 150 words: what has happened, what each agent now wants, who knows what, and what is still unresolved"}

Rules for the fields:
- "line" is a bracketed number from the current part.
- Every "id" is a short lowercase word, or words joined by hyphens, of at most 32 characters, and is unique in the script: never reuse an id from the ledger, for a goal or a sequence.
- Name agents exactly as the script names them in character cues, in capitals.
- Propose "sequence" and "resume" objects as the message for the part tells you to. A resume names the id of an earlier sequence from the ledger that is not the open one. Once the first sequence begins, everything after it belongs to a sequence, so an interlude needs one of its own or belongs to its neighbour.
- "status" on a goal is "secret" or "active". Declare a goal at the line where it is created. If it is already held when the story opens, declare it where its holder first comes into play, and do not invent a moment of creation.
- A status object records a change to a goal from the ledger or from this part: "active", "won", "lost" or "abandoned", at the line where it happens. Follow the order of the script as the audience sees it, not the order of events in story time. A goal that has not resolved gets no status change, and a goal that has ended gets no further change.
- Word "want" so that subject, want and object read as one sentence. For SUZIE wants to cash in DURAND, the want is: cash in. Do not put quotation marks in it, and do not repeat the object inside it.
- Keep goals few. One aim is one goal, however many steps it takes: do not declare a new goal for each step, and do not declare again a goal that is already in the ledger.
- "object" is optional. Use the character's name in capitals, or plain words when the object is not a character ("the viewer", "his reputation").
- "for" is optional. It is the id of the goal this goal serves. "from" is optional. It is the id of the goal this goal grew out of. Each must name a goal declared earlier. When a goal replaces another, also give the status object that marks the old one abandoned.
- "ahead" is optional. It names the agent who actually holds the power in the beat, even if someone else believes they do. Leave it out when nobody clearly has the upper hand.
- "stage" is optional on sequence and beat objects, and is allowed only when a spine is supplied. It is the id of one of that spine's stages.
- Beat "text" is at most eight words and says what turns, in plain language. "title" is at most five words. Keep every piece of text on one line, without square brackets or vertical bars.
- "reason" is one sentence saying which shift of power or objective, or which goal, justifies the mark.
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
  goals: Map<string, { sentence: string; status: string; line: number; object?: string; for?: string; from?: string }>;
  sequence: string; beat: string; firstSeen: Map<string, number>; alias: Map<string, string>;
  /** Every sequence so far, marked or proposed, in order. */ sequences: Array<{ id: string; title: string }>;
  /** The id of the open sequence, if any. */ open: string;
  stages: Set<string>;
  /** Lines where the writer's own sequence headings take effect, and those sequences. */
  marked: Set<number>; markedSequences: Array<{ id: string; title: string }>;
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
    goals: new Map(doc.goals.map(g => [g.id, { sentence: sentence(g), status: g.status, line: g.line, object: g.object, for: g.for, from: g.from }])),
    sequence: '', beat: '', sequences: [], open: '', alias: new Map(),
    stages: new Set(doc.spines.flatMap(sp => sp.stages.map(st => st.id))),
    // the first place a mark could go after each of the writer's sequence headings
    marked: new Set(walk(doc.children, 'section').filter((x: any) => x.level === 'sequence' || !doc.levels.length)
      .map((x: any) => [...ok].filter(n => n > x.line).sort((a, b) => a - b)[0]).filter(Boolean)),
    markedSequences: walk(doc.children, 'section').filter((x: any) => x.id).map((x: any) => ({ id: x.id, title: x.title })),
  };
}

/** The message for the part the run is on, or null when every part has been read. */
export function partMessage(run: Run): string | null {
  const part = run.parts[run.k];
  if (!part) return null;
  const L = lines(run.text), n = run.parts.length;
  // sequences and beats already marked in the script before this part count as the ones so far
  const marked = walk(run.doc.children, 'section').filter((x: any) => x.line < part.from && x.level === 'sequence');
  const before = (type: string) => walk(run.doc.children, type).filter((x: any) => x.line < part.from).pop();
  const lastMarked = marked[marked.length - 1];
  const seq = run.sequence || (lastMarked ? `${lastMarked.resumes ?? lastMarked.id ?? ''}: ${lastMarked.title}` : ''), beat = run.beat || before('beat')?.text || '';
  const sofar = [...marked.filter((x: any) => x.id).map((x: any) => ({ id: x.id as string, title: x.title as string })), ...run.sequences];
  const goals = [...run.goals.entries()].map(([id, g]) => `- ${id}: ${g.sentence} (${g.status}${g.for ? `, serves ${g.for}` : ', top-level'}${g.from ? `, grew out of ${g.from}` : ''})`).join('\n');
  const tail = run.k === 0 ? '' : L.slice(Math.max(run.doc.bodyStart - 1, part.from - 13), part.from - 1).map(l => l.trim()).filter(l => l && !isMarkup(l)).join('\n');
  const spine = run.doc.spines.length
    ? run.doc.spines.map(sp => `Spine in use: ${sp.name}. Name a stage where the fit is clear. Its stages, in order:\n${sp.stages.map(st => `- ${st.id}: ${st.name}${st.about ? `. ${st.about}` : ''}`).join('\n')}`).join('\n')
    : 'No spine is in use, so do not name stages.';
  return [
    run.doc.titlePage['title'] ? `Title: ${run.doc.titlePage['title']}` : '',
    `This is part ${run.k + 1} of ${n}${run.k === n - 1 ? ', the last part' : ''}.`,
    run.doc.stats.sequences
      ? 'The writer has already marked some sequences: they are the headings in the script and the ones listed in the ledger. Treat those as decided. Propose a sequence only where the story turns to a conflict or goal that no existing heading introduces, which is usual in a stretch the writer has not marked yet. Propose a resume where an earlier sequence returns.'
      : 'The script has no sequence headings of its own, so propose sequences, and resumes where an earlier sequence returns.',
    spine,
    '<ledger>',
    `Story so far: ${run.summary || (run.k === 0 ? 'Nothing yet. This is the opening.' : 'No summary was carried over.')}`,
    `Agents: ${run.agents.length ? run.agents.map(a => `${a.name} (${a.about})`).join('; ') : 'none yet'}`,
    `Goals:\n${goals || 'none yet'}`,
    `Sequences so far:\n${sofar.length ? sofar.map(x => `- ${x.id}: ${x.title}`).join('\n') : 'none yet'}`,
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
    if (!['beat', 'goal', 'sequence', 'resume', 'status'].includes(kind)) return;
    const stage = (() => { const st = str(o.stage).split('/').pop()!.trim(); return st && run.stages.has(st) ? st : undefined; })();
    const what = kind === 'beat' ? `beat "${str(o.text)}"` : kind === 'goal' ? `goal "${str(o.id)}"` : kind === 'sequence' ? `sequence "${str(o.title)}"` : kind === 'resume' ? `resume of "${str(o.sequence)}"` : `status change for "${str(o.goal)}"`;
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
      run.proposals.push({ kind, line, text: str(o.text), ahead: str(o.ahead) || undefined, stage, reason });
      run.beat = str(o.text) + (str(o.ahead) ? ` (${str(o.ahead)} ahead)` : '');
    } else if (kind === 'sequence') {
      if (run.marked.has(line)) { run.dropped.push(`Dropped the ${what}: the writer already starts a sequence there.`); return; }
      if (!str(o.title)) return;
      const title = str(o.title).replace(/^#+\s*/, '');
      let id = str(o.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
      if (!id || run.ids.has(id)) { let k = 1; while (run.ids.has('q' + k)) k++; run.alias.set(id || '?', 'q' + k); id = 'q' + k; }
      run.ids.add(id);
      run.proposals.push({ kind, line, id, title, synopsis: str(o.synopsis), stage, reason });
      run.sequences.push({ id, title }); run.open = id;
      run.sequence = `${id}: ${title}` + (str(o.synopsis) ? ` (${str(o.synopsis)})` : ''); run.beat = '';
    } else if (kind === 'resume') {
      if (run.marked.has(line)) { run.dropped.push(`Dropped the ${what}: the writer already starts a sequence there.`); return; }
      const want = str(o.sequence), id = run.alias.get(want) ?? want;
      const target = run.sequences.find(x => x.id === id) ?? run.markedSequences.find(x => x.id === id);
      if (!target) { run.dropped.push(`Dropped the ${what}: no earlier sequence has that id.`); return; }
      if (run.open === id) return;                                   // it never paused: nothing to mark
      run.proposals.push({ kind: 'resume', line, sequence: id, title: target.title, reason });
      run.open = id; run.sequence = `${id}: ${target.title} (resumed)`; run.beat = '';
    } else if (kind === 'goal') {
      const id = str(o.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
      const subject = names(o.subject);
      o.want = str(o.want).replace(/^["'“”]+|["'“”]+$/g, '');
      if (!id || !subject.length || !str(o.want)) { run.dropped.push(`Dropped the ${what}: it had no id, subject or want.`); return; }
      if (run.ids.has(id)) { run.dropped.push(`Dropped the ${what}: that ID is already in use.`); return; }
      const object = str(o.object) || undefined, status = o.status === 'secret' && object ? 'secret' : 'active';
      run.ids.add(id); run.goalLine.set(id, line);
      const known = (v: unknown) => (str(v) && run.goalLine.has(str(v)) && str(v) !== id ? str(v) : undefined);
      const parent = known(o.for), origin = known(o.from);
      run.proposals.push({ kind, line, id, want: str(o.want), subject, object, for: parent, from: origin, status, reason });
      run.goals.set(id, { sentence: sentence({ subject, want: str(o.want), object }), status, line, object, for: parent, from: origin });
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
    let line = Number(o.line);
    // a goal cannot be declared before the goals it names, so go no earlier than they are
    for (const dep of [g?.for, g?.from]) if (dep && allowed.has(line)) line = Math.max(line, run.goalLine.get(dep) ?? 0);
    if (!g || !g.object || !run.ok.has(line) || line >= g.line) return;
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
  const order = { sequence: 0, resume: 0, beat: 1, status: 2, goal: 3 };
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
