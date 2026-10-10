// The beat agent. It sends the whole script to Claude, asks for the agents, goals, sequences and
// beats it can find, and returns them as proposals. Nothing here changes the script: see edit.ts.
import { CascadeDoc, parseStructuredNote } from './parser';

export type Proposal =
  | { kind: 'sequence'; line: number; title: string; synopsis: string; reason: string }
  | { kind: 'goal'; line: number; id: string; want: string; subject: string[]; object?: string; for?: string; status: 'secret' | 'active'; reason: string }
  | { kind: 'status'; line: number; goal: string; status: 'active' | 'won' | 'lost' | 'abandoned'; reason: string }
  | { kind: 'beat'; line: number; text: string; ahead?: string; reason: string };
export interface AgentNote { name: string; about: string }
export interface Analysis { agents: AgentNote[]; proposals: Proposal[]; dropped: string[]; truncated: boolean }

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
const isMarkup = (t: string) => {
  const n = parseStructuredNote(t);
  return (n !== null && ['id', 'goal', 'status', 'beat'].includes(n.type)) || /^#+\s/.test(t) || /^=(?!=)/.test(t);
};

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

/** The script with [line] in front of every place a note may go. */
export function numberedScript(text: string, doc: CascadeDoc): string {
  const ok = insertionLines(text, doc);
  return lines(text).map((l, i) => (ok.has(i + 1) ? `[${i + 1}] ${l.trim()}` : l.trim())).join('\n').replace(/\n{3,}/g, '\n\n');
}

export const SYSTEM = `You analyse screenplays for a writer. You never rewrite the script. You only mark where its drama lies, using the model below, and every mark you make is a proposal the writer will accept or reject.

THE MODEL

A script is cut two ways. The physical cut is the scene: a unit of place and time, opened by a scene heading. Scenes exist for production and carry no dramatic meaning. The dramatic cut is made of sequences and beats, which are defined by what agents want and who holds power. They are free to cross scene headings.

AGENT. Anyone or anything that wants something and can act to get it. A person, a ghost, a machine, an animal or a storm can be an agent if the story gives it a will.

GOAL. Something an agent wants to bring about over a stretch of story. It has a subject (the agent who wants it), a want (a short verb phrase) and usually an object (the agent or thing it is aimed at), so that it reads as a sentence: WIFE wants to divorce HUSBAND. An agent may hold several goals. One goal may exist because of another: she wants the divorce because she wants to marry someone else.

STATUS. Every goal has a status at every point in the script. "secret" means hidden from its object (others, and the audience, may know). "active" means known to its object and being pursued. A goal ends "won", "lost" or "abandoned". A goal can only be secret if its object is an agent.

SEQUENCE. A stretch of story about agents and their goals. It is either a conflict between two goals or the creation of a goal. A goal is not bound to one sequence: it may be created in one, stay secret through another and be fought over in a third.

BEAT. A stretch of a sequence in which the balance of power between the agents, and what each is trying to do at that moment, stay the same. A new beat begins where the power shifts or an agent's objective changes. An objective is what an agent is trying to do right now in service of a goal. A tactic is how they go about it. A change of tactic alone does not begin a beat. A tactic that succeeds does, because it shifts the power. A scene heading does not begin a beat: if nothing turns, the beat carries on into the next scene. A passage with no agents, such as an establishing shot, belongs to no beat.

HOW TO WORK

1. Read the whole script first. Work out who the agents are, what each wants, which goals are hidden from whom, and how each goal ends. Goals set up early often decide what a later moment means.
2. Find the sequences: where one conflict or one creation of a goal starts and the next begins.
3. Go through each sequence asking, at every line: who has the upper hand, and did that just change? Has what someone is trying to do just changed? Mark a beat only where the answer is yes. Expect far fewer beats than scenes have events.

WHAT YOU ARE GIVEN

The script, with [N] in front of every line where a mark may be placed. A mark goes immediately before that line. You may only use line numbers that appear in brackets. A beat that starts when a character speaks goes before that character's name. The script may already contain marks, written as [[beat: ...]], [[goal: ...]], [[status: ...]], [[id: ...]], lines starting with # (sequence headings) and lines starting with = (synopses). Treat existing marks as decided. Do not repeat them, and build on their goal IDs.

WHAT TO RETURN

Return JSON Lines only: one JSON object per line, no other text, no code fences. First the agents, then every proposal in script order.

{"kind":"agent","name":"SUZIE","about":"one sentence on who they are and what drives them"}
{"kind":"sequence","line":12,"title":"The Divorce","synopsis":"one sentence on what happens","reason":"conflict between divorce and reputation"}
{"kind":"goal","line":12,"id":"divorce","want":"divorce","subject":["WIFE"],"object":"HUSBAND","for":"exclusive","status":"secret","reason":"one sentence"}
{"kind":"status","line":80,"goal":"divorce","status":"active","reason":"she says it to his face"}
{"kind":"beat","line":80,"text":"She says it","ahead":"WIFE","reason":"power shifts to her: he can no longer pretend"}

Rules for the fields:
- "line" is a bracketed number from the script.
- Name agents exactly as the script names them in character cues, in capitals.
- A goal "id" is a short lowercase word or words joined by hyphens, unique in the script. "status" on a goal is "secret" or "active". Declare a goal at the line where it is created. If it is already held when the story opens, declare it where it first bears on what happens.
- A status object records a later change: "active", "won", "lost" or "abandoned", at the line where it happens. Follow the order of the script as the audience sees it, not the order of events in story time. A goal that never resolves on the page gets no status change.
- "object" is optional. Use the character's name in capitals, or plain words when the object is not a character ("the viewer", "his reputation").
- "for" is optional. It is the id of another goal that this goal serves.
- "ahead" is optional. It names who actually holds the power in the beat, even if someone else believes they do. Leave it out when nobody clearly has the upper hand.
- Beat "text" is at most eight words and says what turns, in plain language. "title" is at most five words.
- "reason" is one sentence saying which shift of power or objective, or which goal, justifies the mark.
- Propose sequences only if the script has no sequence headings yet. Once the first sequence begins, everything after it belongs to a sequence, so interludes need one of their own or belong to their neighbour. A sequence need not open with a beat.
- List as agents both individuals and groups that act with a will. If the script is inconsistent about a name or a detail, pick the commonest form and say nothing about it.`;

export function buildUserMessage(text: string, doc: CascadeDoc): string {
  const title = doc.titlePage['title'] ? `Title: ${doc.titlePage['title']}\n\n` : '';
  return `${title}Here is the script.\n\n<script>\n${numberedScript(text, doc)}\n</script>\n\nReturn the JSON Lines now.`;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const names = (v: unknown) => (Array.isArray(v) ? v.map(str) : str(v).split(',').map(s => s.trim())).filter(Boolean);

/** Turn the model's reply into checked proposals. Anything that cannot be placed safely is dropped, with a note. */
export function readReply(raw: string, text: string, doc: CascadeDoc): Analysis {
  const ok = insertionLines(text, doc), L = lines(text);
  const ids = new Set<string>([...doc.goals.map(g => g.id)]);
  const taken = new Set<string>();
  const collect = (n: any[]) => n.forEach(c => { if (c.id) taken.add(c.id); if (c.type === 'section') collect(c.children); });
  collect(doc.children as any[]);
  const goalLine = new Map<string, number>(doc.goals.map(g => [g.id, g.line]));
  const closed = new Set<string>(doc.goals.filter(g => ['won', 'lost', 'abandoned'].includes(g.status)).map(g => g.id));
  const agents: AgentNote[] = [], proposals: Proposal[] = [], dropped: string[] = [];
  let truncated = false;

  const rows = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
  rows.forEach((row, i) => {
    let o: any;
    try { o = JSON.parse(row); } catch { if (i === rows.length - 1) truncated = true; else dropped.push('A line of the reply could not be read.'); return; }
    const kind = str(o.kind), reason = str(o.reason);
    if (kind === 'agent') { if (str(o.name)) agents.push({ name: str(o.name), about: str(o.about) }); return; }
    const what = kind === 'beat' ? `beat "${str(o.text)}"` : kind === 'goal' ? `goal "${str(o.id)}"` : kind === 'sequence' ? `sequence "${str(o.title)}"` : `status change for "${str(o.goal)}"`;
    let line = Number(o.line);
    if (!ok.has(line)) {                       // inside a paragraph or speech: move to where it starts
      let at = line;
      while (at > doc.bodyStart && L[at - 2] !== undefined && L[at - 2].trim() !== '') at--;
      if (!Number.isInteger(line) || line < 1 || line > L.length || !ok.has(at)) { dropped.push(`Dropped the ${what}: line ${o.line} is not a place a mark can go.`); return; }
      dropped.push(`Moved the ${what} from line ${line} to line ${at}, the start of that speech or paragraph.`);
      line = at;
    }
    if (kind === 'beat') {
      if (!str(o.text)) return;
      proposals.push({ kind, line, text: str(o.text), ahead: str(o.ahead) || undefined, reason });
    } else if (kind === 'sequence') {
      if (doc.stats.sequences) { dropped.push(`Dropped the ${what}: this script already has sequences.`); return; }
      if (!str(o.title)) return;
      proposals.push({ kind, line, title: str(o.title).replace(/^#+\s*/, ''), synopsis: str(o.synopsis), reason });
    } else if (kind === 'goal') {
      const id = str(o.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
      const subject = names(o.subject);
      if (!id || !subject.length || !str(o.want)) { dropped.push(`Dropped the ${what}: it had no id, subject or want.`); return; }
      if (taken.has(id) || ids.has(id)) { dropped.push(`Dropped the ${what}: that ID is already in use.`); return; }
      const object = str(o.object) || undefined;
      ids.add(id); taken.add(id); goalLine.set(id, line);
      proposals.push({ kind, line, id, want: str(o.want), subject, object, for: str(o.for) || undefined, status: o.status === 'secret' && object ? 'secret' : 'active', reason });
    } else if (kind === 'status') {
      const goal = str(o.goal), status = str(o.status);
      if (!['active', 'won', 'lost', 'abandoned'].includes(status)) { dropped.push(`Dropped the ${what}: "${status}" is not a status.`); return; }
      if (!ids.has(goal) || (goalLine.get(goal) ?? 0) > line) { dropped.push(`Dropped the ${what}: no such goal has been declared by line ${line}.`); return; }
      if (closed.has(goal)) { dropped.push(`Dropped the ${what}: that goal has already ended.`); return; }
      if (status !== 'active') closed.add(goal);
      proposals.push({ kind, line, goal, status: status as any, reason });
    }
  });
  for (const p of proposals) if (p.kind === 'goal' && p.for && !ids.has(p.for)) p.for = undefined;
  const order = { sequence: 0, beat: 1, status: 2, goal: 3 };
  proposals.sort((a, b) => a.line - b.line || order[a.kind] - order[b.kind]);
  return { agents, proposals, dropped, truncated };
}

export interface RunOptions {
  key: string; model: string; text: string; doc: CascadeDoc;
  signal?: AbortSignal; onProgress?: (received: number, rows: number) => void;
}

/** Call the Anthropic Messages API from the browser and stream the reply. */
export async function analyse(o: RunOptions): Promise<Analysis> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: o.signal,
    headers: {
      'content-type': 'application/json', 'x-api-key': o.key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: o.model, max_tokens: 32000, stream: true, system: SYSTEM,
      messages: [{ role: 'user', content: buildUserMessage(o.text, o.doc) }],
    }),
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
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        out += ev.delta.text;
        o.onProgress?.(out.length, out.split('\n').length - 1);
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'max_tokens') cut = true;
      else if (ev.type === 'error') throw new Error(ev.error?.message ?? 'The API reported an error.');
    }
  }
  const a = readReply(out, o.text, o.doc);
  a.truncated = a.truncated || cut;
  return a;
}
