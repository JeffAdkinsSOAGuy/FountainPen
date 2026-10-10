import { parse, CascadeDoc, Scene, Beat, Goal, Item } from './parser';
import { blocks, inline } from './render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

let doc: CascadeDoc;
let longest = 1;
let beatList: Beat[] = [];

const walk = <T extends Item>(nodes: Item[], type: T['type']): T[] =>
  nodes.flatMap(c => [...(c.type === type ? [c as T] : []), ...(c.type === 'section' ? walk<T>(c.children, type) : [])]);

/** "SUZIE wants to cash in DURAND" */
function goalSentence(g: Goal): string {
  return `<b>${esc(g.subject.join(' and ') || 'Someone')}</b> ${g.subject.length > 1 ? 'want' : 'wants'} to ${inline(g.want)}${g.object ? ` <b>${esc(g.object)}</b>` : ''}`;
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
        <span class="o-meta">${node.ahead ? `<span class="o-ahead">${esc(node.ahead)} ahead</span>` : ''}${across}</span>
        <span class="o-len" title="${len} lines"><i style="width:${Math.max(4, Math.round((len / longest) * 100))}%"></i></span>
      </button></li>`;
    }
    case 'section': {
      const ns = walk<Scene>(node.children, 'scene').length, nb = walk<Beat>(node.children, 'beat').length;
      return `<li class="o-section d${Math.min(node.depth, 3)}"><details open>
        <summary><span class="o-level">${esc(node.level ?? 'section')}</span>
          <span class="o-title" data-line="${node.line}">${esc(node.title)}</span>${node.id ? `<span class="o-id">${esc(node.id)}</span>` : ''}
          <span class="o-count">${plural(nb, 'beat')} · ${plural(ns, 'scene')}</span></summary>
        ${node.synopsis ? `<p class="o-syn">${inline(node.synopsis)}</p>` : ''}
        ${node.children.some(c => c.type === 'section') ? '' : goalsHtml(node.line, node.endLine)}
        <ol>${node.children.map(itemHtml).join('')}</ol></details></li>`;
    }
  }
}

function load(text: string, name: string, sample = false) {
  doc = parse(text);
  beatList = walk<Beat>(doc.children, 'beat');
  longest = Math.max(1, ...beatList.map(b => b.endLine - b.line + 1));
  const title = doc.titlePage['title'] || name.replace(/\.[^.]+$/, '');
  $('doc-title').textContent = title;
  $('doc-sample').hidden = !sample;
  const st = doc.stats;
  $('stats').textContent = [st.sequences ? plural(st.sequences, 'sequence') : st.sections ? plural(st.sections, 'section') : '',
    st.goals ? plural(st.goals, 'goal') : '', plural(st.beats, 'beat'), plural(st.scenes, 'scene')].filter(Boolean).join(' · ');

  const plain = !st.sections && !st.beats && !st.goals;
  const loose = doc.children.some(c => c.type === 'goal' || c.type === 'status') ? goalsHtml(doc.bodyStart, doc.lineCount) : '';
  $('outline').innerHTML =
    (plain ? `<p class="hint">This is plain Fountain: no sequences, goals, or beats are marked yet, so the outline lists scenes only.</p>` : '') +
    (st.sections ? '' : loose) +
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
      case 'id': return `<span class="m-anchor" ${a}></span>`;
      case 'pagebreak': return `<hr ${a}>`;
      case 'heading': return `<h2 class="s-heading" ${a}>${inline(b.text)}</h2>`;
      default: return `<p class="s-${b.kind}" ${a}>${inline(b.text).replace(/\n/g, '<br>')}</p>`;
    }
  }).join('');
  $('script').scrollTop = 0;
  spy();
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
    if (el && (el.closest('#outline') || el.closest('#problems'))) { e.preventDefault(); goTo(Number(el.dataset.line)); }
  });
  $('script').addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
  $<HTMLInputElement>('file').addEventListener('change', e => readFile((e.target as HTMLInputElement).files?.[0]));
  $<HTMLInputElement>('markup').addEventListener('change', e => { document.body.dataset.markup = (e.target as HTMLInputElement).checked ? 'on' : 'off'; });
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
