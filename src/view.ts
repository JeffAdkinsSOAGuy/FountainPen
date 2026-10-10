import { parse, CascadeDoc, Scene, Beat, Goal, Item } from './parser';
import { blocks, inline } from './render';
import { analyse, Proposal, AgentNote } from './agent';
import { apply } from './edit';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

let doc: CascadeDoc;
let longest = 1;
let beatList: Beat[] = [];
let text = '';
let fileName = 'script.fountain';
let dirty = false;
let pending: Proposal[] = [];
let agents: AgentNote[] = [];
let notes: string[] = [];
let rawReply = '';
let run: AbortController | null = null;
let saveHandle: any = null;

const walk = <T extends Item>(nodes: Item[], type: T['type']): T[] =>
  nodes.flatMap(c => [...(c.type === type ? [c as T] : []), ...(c.type === 'section' ? walk<T>(c.children, type) : [])]);

/** "SUZIE wants to cash in DURAND" */
function goalSentence(g: Goal): string {
  return `<b>${esc(g.subject.join(' and ') || 'Someone')}</b> ${g.subject.length > 1 ? 'want' : 'wants'} to ${inline(g.want)}${g.object ? ` <b>${esc(g.object)}</b>` : ''}`;
}
const stageName = (ref: string) => { const id = ref.split('/').pop()!.trim();
  for (const sp of doc.spines) { const st = sp.stages.find(x => x.id === id); if (st) return st.name; } return id; };
const stageChip = (ref: string) => `<span class="stage">${esc(stageName(ref))}</span>`;

/** Every place each stage of the script's spines is attached, as line numbers. */
function stageUse(): Map<string, number[]> {
  const use = new Map<string, number[]>();
  const add = (ref: string, line: number) => { const id = ref.split('/').pop()!.trim(); use.set(id, [...(use.get(id) ?? []), line]); };
  walk<any>(doc.children, 'section').forEach(s => s.stages.forEach((r: string) => add(r, s.line)));
  beatList.forEach(b => { if (b.stage) add(b.stage, b.line); });
  return use;
}

/** The spine as a checklist: its stages in order, each showing whether the script has reached it. */
function spinesHtml(): string {
  const use = stageUse();
  return doc.spines.map(sp => `<details class="o-spine" open><summary><span class="o-level">spine</span><span class="o-title">${esc(sp.name)}</span>
    <span class="o-count">${sp.stages.filter(st => use.has(st.id)).length} of ${plural(sp.stages.length, 'stage')} placed</span></summary>
    <ol>${sp.stages.map((st, i) => { const at = use.get(st.id);
      return `<li><button class="o-stage${at ? '' : ' missing'}" ${at ? `data-line="${at[0]}"` : 'disabled'} title="${esc(st.about ?? '')}">
        <span class="o-num">${i + 1}</span><span class="o-text">${esc(st.name)}</span><span class="o-id">${at ? (at.length > 1 ? at.length + ' places' : '') : 'not placed'}</span></button></li>`; }).join('')}</ol></details>`).join('');
}

/** The goal tree: top-level goals, with the goals that serve them beneath. */
function goalTreeHtml(): string {
  if (!doc.goals.length) return '<p class="hint">No goals are marked in this script yet.</p>';
  const kids = (id?: string) => doc.goals.filter(g => (g.for && doc.goals.some(x => x.id === g.for) ? g.for : undefined) === id);
  const row = (g: Goal): string => {
    const origin = g.from ? doc.goals.find(x => x.id === g.from) : undefined;
    const open = g.status === 'secret' || g.status === 'active';
    return `<li><button class="o-goal${open ? '' : ' closed'}" data-line="${g.line}"><span class="o-text">${goalSentence(g)}${
      origin ? ` <span class="o-for">${origin.status === 'abandoned' ? 'replaced' : 'raised from'} “${goalSentence(origin).replace(/<[^>]+>/g, '')}”</span>` : ''}</span>
      <span class="o-steps">${g.history.map(h => statusChip(h.status)).join('<span class="arrow">→</span>')}</span></button>
      ${kids(g.id).length ? `<ul>${kids(g.id).map(row).join('')}</ul>` : ''}</li>`;
  };
  const top = kids(undefined), live = doc.goals.filter(g => g.status === 'secret' || g.status === 'active').length;
  return `<p class="hint">${plural(top.length, 'top-level goal')}, ${doc.goals.length - top.length} serving ${top.length === 1 ? 'it' : 'them'}. ${live ? `${live} still open at the end.` : 'All resolved by the end.'}</p>
    <ul class="o-tree">${top.map(row).join('')}</ul>`;
}

const statusChip = (s: string) => `<span class="st st-${s}">${s}</span>`;

/** Goals in play in a stretch of script: declared there, or changing status there. */
function goalsHtml(from: number, to: number): string {
  const rows = doc.goals.map(g => {
    const inside = g.history.filter(h => h.line >= from && h.line <= to);
    if (!inside.length) return '';
    const before = g.history.filter(h => h.line < from).pop();
    const steps = [...(before ? [before.status] : []), ...inside.map(h => h.status)];
    const parent = g.for ? doc.goals.find(x => x.id === g.for) : undefined;
    return `<li><button class="o-goal" data-line="${inside[0].line}"><span class="o-text">${goalSentence(g)}${
      parent ? ` <span class="o-for">so that ${goalSentence(parent)}</span>` : ''}</span>
      <span class="o-steps">${steps.map(statusChip).join('<span class="arrow">→</span>')}</span></button></li>`;
  }).join('');
  return rows ? `<ul class="o-goals" aria-label="Goals">${rows}</ul>` : '';
}

function itemHtml(node: Item): string {
  switch (node.type) {
    case 'goal': case 'status': return '';      // shown in the goals block of their sequence
    case 'scene':
      return `<li><button class="o-scene" data-line="${node.line}"><span class="o-text">${esc(node.heading)}</span>${node.id ? `<span class="o-id">${esc(node.id)}</span>` : ''}</button></li>`;
    case 'beat': {
      const len = node.endLine - node.line + 1;
      const across = node.scenes.length > 1 ? `<span class="o-across">runs through ${node.scenes.length} scenes</span>` : '';
      return `<li><button class="o-beat" data-line="${node.line}" data-end="${node.endLine}">
        <span class="o-text">${inline(node.text)}</span>${node.id ? `<span class="o-id">${esc(node.id)}</span>` : ''}
        <span class="o-meta">${node.stage ? stageChip(node.stage) : ''}${node.ahead ? `<span class="o-ahead">${esc(node.ahead)} ahead</span>` : ''}${across}</span>
        <span class="o-len" title="${len} lines"><i style="width:${Math.max(4, Math.round((len / longest) * 100))}%"></i></span>
      </button></li>`;
    }
    case 'section': {
      const ns = walk<Scene>(node.children, 'scene').length, nb = walk<Beat>(node.children, 'beat').length;
      return `<li class="o-section d${Math.min(node.depth, 3)}"><details open>
        <summary><span class="o-level">${esc(node.level ?? 'section')}${node.resumes ? ', resumed' : ''}</span>
          <span class="o-title" data-line="${node.line}">${esc(node.title)}</span>${node.id ? `<span class="o-id">${esc(node.id)}</span>` : ''}
          <span class="o-count">${plural(nb, 'beat')} · ${plural(ns, 'scene')}</span></summary>
        ${node.synopsis ? `<p class="o-syn">${inline(node.synopsis)}</p>` : ''}
        ${node.stages.length ? `<p class="o-stages">${node.stages.map(stageChip).join('')}</p>` : ''}
        ${node.children.some(c => c.type === 'section') ? '' : goalsHtml(node.line, node.endLine)}
        <ol>${node.children.map(itemHtml).join('')}</ol></details></li>`;
    }
  }
}

function load(newText: string, name: string, sample = false) {
  text = newText; fileName = name; dirty = false; pending = []; agents = []; notes = []; rawReply = ''; saveHandle = null;
  $('doc-sample').hidden = !sample;
  render(true);
}

/** Redraw everything from the current text. */
function render(toTop = false) {
  const name = fileName;
  doc = parse(text);
  beatList = walk<Beat>(doc.children, 'beat');
  longest = Math.max(1, ...beatList.map(b => b.endLine - b.line + 1));
  const title = doc.titlePage['title'] || name.replace(/\.[^.]+$/, '');
  $('doc-title').textContent = title;
  const st = doc.stats;
  $('stats').textContent = [st.sequences ? plural(st.sequences, 'sequence') : st.sections ? plural(st.sections, 'section') : '',
    st.goals ? plural(st.goals, 'goal') : '', plural(st.beats, 'beat'), plural(st.scenes, 'scene')].filter(Boolean).join(' · ');

  const plain = !st.sections && !st.beats && !st.goals;
  const loose = doc.children.some(c => c.type === 'goal' || c.type === 'status') ? goalsHtml(doc.bodyStart, doc.lineCount) : '';
  $('outline').innerHTML =
    (plain ? `<p class="hint">This is plain Fountain: no sequences, goals, or beats are marked yet, so the outline lists scenes only.</p>` : '') +
    spinesHtml() + (st.sections ? '' : loose) +
    (st.scenes || st.beats ? `<ol class="o-root">${doc.children.map(itemHtml).join('')}</ol>` : `<p class="hint">No scene headings were found in this file.</p>`);

  const d = doc.diagnostics;
  $('problems').innerHTML = d.length
    ? `<details><summary>${plural(d.length, 'problem')} in the markup</summary><ul>${d.map(x =>
        `<li><button data-line="${x.line}">Line ${x.line}</button> ${esc(x.message)}</li>`).join('')}</ul></details>`
    : `<p class="ok">No problems found in the markup.</p>`;

  const tp = doc.titlePage;
  const head = tp['title'] ? `<header class="s-title"><h1>${inline(tp['title'])}</h1>${
    tp['credit'] ? `<p>${inline(tp['credit'])}</p>` : ''}${tp['author'] || tp['authors'] ? `<p>${inline(tp['author'] || tp['authors'])}</p>` : ''}</header>` : '';
  $('page').innerHTML = head + blocks(text, doc.bodyStart).map(b => {
    const a = `data-line="${b.line}"`;
    switch (b.kind) {
      case 'section': return `<p class="m m-section d${Math.min(b.depth ?? 1, 3)}" ${a}>${inline(b.text)}</p>`;
      case 'synopsis': return `<p class="m m-syn" ${a}>${inline(b.text)}</p>`;
      case 'beat': return `<p class="m m-beat" ${a}><span>beat</span><span>${inline(b.text)}${
        b.fields?.['ahead'] ? ` <em>${esc(b.fields['ahead'])} ahead</em>` : ''}</span></p>`;
      case 'goal': {
        const g = doc.goals.find(x => x.line === b.line);
        return g ? `<p class="m m-goal" ${a}><span>goal</span><span>${goalSentence(g)} ${statusChip(g.history[0].status)}</span></p>` : '';
      }
      case 'status': {
        const g = doc.goals.find(x => x.id === b.fields?.['goal']);
        return `<p class="m m-goal" ${a}><span>goal</span><span>${g ? goalSentence(g) : esc(b.fields?.['goal'] ?? '')} ${statusChip(b.text)}</span></p>`;
      }
      case 'stage': return `<p class="m m-goal" ${a}><span>stage</span><span>${esc(stageName(b.text))}</span></p>`;
      case 'resume': return `<p class="m m-syn" ${a}>Resumes the sequence from earlier.</p>`;
      case 'id': return `<span class="m-anchor" ${a}></span>`;
      case 'pagebreak': return `<hr ${a}>`;
      case 'heading': return `<h2 class="s-heading" ${a}>${inline(b.text)}</h2>`;
      default: return `<p class="s-${b.kind}" ${a}>${inline(b.text).replace(/\n/g, '<br>')}</p>`;
    }
  }).join('');
  if (toTop) $('script').scrollTop = 0;
  $('save').hidden = !dirty;
  $('goals-pane').innerHTML = goalTreeHtml();
  $('tab-goals').textContent = `Goals (${doc.goals.length})`;
  renderProposals();
  spy();
}

// ---------- proposals from the beat agent ----------

function proposalHtml(p: Proposal, i: number): string {
  const blocked = p.kind === 'status' && !doc.goals.some(g => g.id === p.goal);
  let body = '';
  if (p.kind === 'beat') body = `<input class="p-edit" data-i="${i}" data-f="text" value="${esc(p.text)}" aria-label="Beat description">${p.ahead ? `<span class="o-ahead">${esc(p.ahead)} ahead</span>` : ''}`;
  else if (p.kind === 'sequence') body = `<input class="p-edit p-title" data-i="${i}" data-f="title" value="${esc(p.title)}" aria-label="Sequence title">${p.synopsis ? `<span class="o-syn">${inline(p.synopsis)}</span>` : ''}`;
  else if (p.kind === 'goal') body = `<span>${goalSentence({ subject: p.subject, want: p.want, object: p.object } as Goal)} ${statusChip(p.status)}</span>`;
  else { const g = doc.goals.find(x => x.id === p.goal) ?? (pending.find(x => x.kind === 'goal' && x.id === p.goal) as any);
    body = `<span>${g ? goalSentence(g) : esc(p.goal)} ${statusChip(p.status)}</span>`; }
  return `<li class="p-item p-${p.kind}"><span class="p-kind">${p.kind === 'status' ? 'goal' : p.kind}</span>
    <div class="p-body">${body}${p.reason ? `<span class="p-why">${esc(p.reason)}</span>` : ''}
      ${blocked ? '<span class="p-why">Accept its goal first.</span>' : ''}
      <span class="p-acts"><button type="button" class="b-accept" data-accept="${i}"${blocked ? ' disabled' : ''}>Accept</button>
      <button type="button" data-reject="${i}">Reject</button><button type="button" class="b-link" data-line="${p.line}">Show in script</button></span></div></li>`;
}

function renderProposals() {
  const has = pending.length > 0 || agents.length > 0 || notes.length > 0 || rawReply !== '';
  $('tab-proposals').hidden = !has;
  $('tab-proposals').textContent = `Proposals (${pending.length})`;
  if (!has) { if (!$('proposals').hidden) setRail('outline'); $('proposals').innerHTML = ''; return; }
  // group by sequence: existing sequence sections, or sequences the agent proposes
  const marks: Array<{ line: number; title: string; proposed: boolean }> = [
    ...walk<any>(doc.children, 'section').filter(s => !s.children.some((c: Item) => c.type === 'section')).map(s => ({ line: s.line, title: s.title, proposed: false })),
    ...pending.filter(p => p.kind === 'sequence').map(p => ({ line: p.line, title: (p as any).title, proposed: true })),
  ].sort((a, b) => a.line - b.line);
  const groups = new Map<number, number[]>();
  pending.forEach((p, i) => {
    const g = marks.filter(m => m.line <= p.line).pop()?.line ?? 0;
    groups.set(g, [...(groups.get(g) ?? []), i]);
  });
  const who = agents.length ? `<details class="p-ledger"><summary>Who the agent found (${agents.length})</summary><ul>${agents.map(a =>
    `<li><b>${esc(a.name)}</b> ${esc(a.about)}</li>`).join('')}</ul></details>` : '';
  const warn = notes.length ? `<details class="p-ledger p-notes"><summary>${plural(notes.length, 'note')} from this run</summary><ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>` : '';
  const rawBox = rawReply ? `<details class="p-ledger"><summary>What the agent sent back</summary><pre class="p-raw">${esc(rawReply)}</pre></details>` : '';
  $('proposals').innerHTML = who + warn + rawBox + (pending.length ? '' : `<p class="hint">${dirty || !notes.length ? 'Every proposal has been accepted or rejected.' : 'This run produced no proposals.'}</p>`) +
    [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([line, idx]) => {
      const m = marks.find(x => x.line === line);
      return `<section class="p-group"><header><div><span class="o-level">${m ? (m.proposed ? 'proposed sequence' : 'sequence') : 'before any sequence'}</span>
        <span class="o-title">${esc(m?.title ?? 'Opening')}</span></div>
        <button type="button" class="b-accept" data-accept-all="${idx.join(',')}">Accept all ${idx.length}</button></header>
        <ol>${idx.map(i => proposalHtml(pending[i], i)).join('')}</ol></section>`;
    }).join('');
}

/** Write the chosen proposals into the script and keep the rest, with their line numbers moved along. */
function accept(indices: number[]) {
  const chosen = indices.map(i => pending[i]).filter(Boolean);
  // a status change can only be written once its goal exists
  const goalIds = new Set([...doc.goals.map(g => g.id), ...chosen.filter(p => p.kind === 'goal').map(p => (p as any).id)]);
  const ok = chosen.filter(p => p.kind !== 'status' || goalIds.has(p.goal));
  if (!ok.length) return;
  const keepScroll = $('script').scrollTop;
  const done = apply(text, ok);
  text = done.text; dirty = true;
  pending = pending.filter(p => !ok.includes(p)).map(p => ({ ...p, line: done.shift(p.line) }));
  render();
  $('script').scrollTop = keepScroll;
}

function reject(i: number) {
  const p = pending[i];
  if (!p) return;
  pending = pending.filter(x => x !== p && !(p.kind === 'goal' && x.kind === 'status' && x.goal === p.id));
  if (p.kind === 'goal') pending.forEach(x => { if (x.kind === 'goal' && x.for === p.id) x.for = undefined; });
  renderProposals();
}

function setRail(which: 'outline' | 'goals' | 'proposals') {
  $('outline-pane').hidden = which !== 'outline';
  $('goals-pane').hidden = which !== 'goals';
  $('tab-goals').setAttribute('aria-pressed', String(which === 'goals'));
  $('proposals').hidden = which !== 'proposals';
  $('tab-outline2').setAttribute('aria-pressed', String(which === 'outline'));
  $('tab-proposals').setAttribute('aria-pressed', String(which === 'proposals'));
}

const store = { get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage unavailable */ } } };

async function findBeats() {
  const key = $<HTMLInputElement>('api-key').value.trim(), model = $<HTMLInputElement>('api-model').value.trim();
  const status = $('agent-status');
  if (!key) { status.textContent = 'Enter your Anthropic API key first.'; return; }
  store.set('fp-model', model);
  store.set('fp-key', $<HTMLInputElement>('api-remember').checked ? key : '');
  run = new AbortController();
  $('agent-start').hidden = true; $('agent-stop').hidden = false;
  status.textContent = 'Sending the script…';
  try {
    const a = await analyse({ key, model, text, doc, signal: run.signal,
      onProgress: (part, parts, found) => { status.textContent = `Reading part ${part} of ${parts}… ${found} findings so far.`; } });
    pending = a.proposals; agents = a.agents;
    rawReply = a.raw;
    notes = [...a.dropped, ...(a.truncated ? ['The reply was cut off before it finished, so the end of the script may have no proposals.'] : []),
      ...(a.proposals.length ? [] : [a.raw.trim() ? 'The reply had nothing in it that could be used as a proposal. Open "What the agent sent back" to see it.' : 'The reply was empty.'])];
    $<HTMLDialogElement>('agent-dialog').close();
    status.textContent = '';
    renderProposals(); setRail('proposals'); setPane('outline');
  } catch (e: any) {
    status.textContent = e?.name === 'AbortError' ? 'Stopped.'
      : e instanceof TypeError ? 'This page could not reach the Anthropic API. Open FountainPen from your own built copy (dist/fountainpen.html) and check your connection.'
      : `The run failed: ${e?.message ?? e}`;
  } finally { run = null; $('agent-start').hidden = false; $('agent-stop').hidden = true; }
}

async function save() {
  const w = window as any;
  try {
    if (w.showSaveFilePicker) {
      saveHandle = saveHandle ?? await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Fountain script', accept: { 'text/plain': ['.fountain'] } }] });
      const out = await saveHandle.createWritable(); await out.write(text); await out.close();
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    dirty = false; $('save').hidden = true;
  } catch (e: any) { if (e?.name !== 'AbortError') $('save').textContent = 'Save failed. Try again'; }
}

function goTo(line: number) {
  const scroller = $('script');
  const els = Array.from(scroller.querySelectorAll<HTMLElement>('[data-line]'));
  setPane('script');   // show the script first: hidden elements cannot be measured
  const target = els.find(e => Number(e.dataset.line) >= line && e.offsetParent !== null) ?? els[els.length - 1];
  if (!target) return;
  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
  scroller.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}

/** Highlight the beat and the scene that the top of the script pane is in. */
function spy() {
  const scroller = $('script');
  const base = scroller.getBoundingClientRect().top + 40;
  let line = 0, sceneLine = 0;
  for (const el of Array.from(scroller.querySelectorAll<HTMLElement>('#page > [data-line]'))) {
    if (el.offsetParent === null && !el.classList.contains('m-anchor')) continue;
    if (el.getBoundingClientRect().top > base) break;
    line = Number(el.dataset.line);
    if (el.classList.contains('s-heading')) sceneLine = line;
  }
  const beat = beatList.filter(b => b.line <= line && line <= b.endLine).pop();
  $('outline').querySelectorAll<HTMLElement>('.o-scene, .o-beat').forEach(b => {
    const on = Number(b.dataset.line) === (b.classList.contains('o-beat') ? beat?.line : sceneLine);
    if (on !== b.classList.contains('here')) {
      b.classList.toggle('here', on);
      if (on && b.classList.contains('o-beat') && $('outline').offsetParent !== null) b.scrollIntoView({ block: 'nearest' });
    }
  });
}

function setPane(p: 'outline' | 'script') {
  document.body.dataset.pane = p;
  $('tab-outline').setAttribute('aria-pressed', String(p === 'outline'));
  $('tab-script').setAttribute('aria-pressed', String(p === 'script'));
}

function readFile(f: File | undefined) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => load(String(r.result), f.name);
  r.readAsText(f);
}

function start() {
  document.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
    if (el && (el.closest('.rail'))) { e.preventDefault(); goTo(Number(el.dataset.line)); }
  });
  $('script').addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
  $<HTMLInputElement>('file').addEventListener('change', e => readFile((e.target as HTMLInputElement).files?.[0]));
  $<HTMLInputElement>('markup').addEventListener('change', e => { document.body.dataset.markup = (e.target as HTMLInputElement).checked ? 'on' : 'off'; });
  $('proposals').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.dataset.accept) accept([Number(t.dataset.accept)]);
    else if (t.dataset.acceptAll) accept(t.dataset.acceptAll.split(',').map(Number));
    else if (t.dataset.reject) reject(Number(t.dataset.reject));
  });
  $('proposals').addEventListener('input', e => {
    const t = e.target as HTMLInputElement, p = pending[Number(t.dataset.i)] as any;
    if (p && t.dataset.f) p[t.dataset.f] = t.value;
  });
  $('tab-outline2').addEventListener('click', () => setRail('outline'));
  $('tab-goals').addEventListener('click', () => setRail('goals'));
  $('tab-proposals').addEventListener('click', () => setRail('proposals'));
  $('find').addEventListener('click', () => {
    $('agent-size').textContent = `${doc.lineCount.toLocaleString()} lines`;
    $('agent-status').textContent = '';
    $<HTMLDialogElement>('agent-dialog').showModal();
  });
  $('agent-form').addEventListener('submit', e => { e.preventDefault(); findBeats(); });
  $('agent-stop').addEventListener('click', () => run?.abort());
  $('agent-cancel').addEventListener('click', () => { run?.abort(); $<HTMLDialogElement>('agent-dialog').close(); });
  $('save').addEventListener('click', save);
  $<HTMLInputElement>('api-key').value = store.get('fp-key');
  $<HTMLInputElement>('api-remember').checked = !!store.get('fp-key');
  if (store.get('fp-model')) $<HTMLInputElement>('api-model').value = store.get('fp-model');
  $('tab-outline').addEventListener('click', () => setPane('outline'));
  $('tab-script').addEventListener('click', () => setPane('script'));
  ['dragover', 'drop'].forEach(t => document.addEventListener(t, e => {
    e.preventDefault();
    if (t === 'drop') readFile((e as DragEvent).dataTransfer?.files?.[0]);
  }));
  const sample = JSON.parse($('sample').textContent || '""');
  setPane('outline');
  load(sample, 'moral-dilemma.fountain', true);
}
start();
