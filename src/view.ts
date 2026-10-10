import { parse, CascadeDoc, Section, Scene } from './parser';
import { blocks, inline } from './render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

let doc: CascadeDoc;
let longest = 1;

function scenesIn(nodes: Array<Section | Scene>): Scene[] {
  return nodes.flatMap(c => (c.type === 'scene' ? [c] : scenesIn(c.children)));
}

function sceneHtml(s: Scene): string {
  const len = s.endLine - s.line + 1;
  const beats = s.beats.map(b =>
    `<li><button class="o-beat" data-line="${b.line}"><span class="o-text">${inline(b.text)}</span>${b.id ? `<span class="o-id">${esc(b.id)}</span>` : ''}</button></li>`).join('');
  return `<li class="o-scene-item"><button class="o-scene" data-line="${s.line}" data-end="${s.endLine}">
    <span class="o-text">${esc(s.heading)}</span>${s.id ? `<span class="o-id">${esc(s.id)}</span>` : ''}
    <span class="o-len" title="${len} lines"><i style="width:${Math.max(4, Math.round((len / longest) * 100))}%"></i></span>
  </button>${beats ? `<ol class="o-beats">${beats}</ol>` : ''}</li>`;
}

function nodeHtml(node: Section | Scene): string {
  if (node.type === 'scene') return sceneHtml(node);
  const sc = scenesIn(node.children);
  const nb = sc.reduce((a, s) => a + s.beats.length, 0);
  return `<li class="o-section d${Math.min(node.depth, 3)}"><details open>
    <summary><span class="o-level">${esc(node.level ?? 'section')}</span>
      <span class="o-title" data-line="${node.line}">${esc(node.title)}</span>${node.id ? `<span class="o-id">${esc(node.id)}</span>` : ''}
      <span class="o-count">${plural(sc.length, 'scene')} · ${plural(nb, 'beat')}</span></summary>
    ${node.synopsis ? `<p class="o-syn">${inline(node.synopsis)}</p>` : ''}
    <ol>${node.children.map(nodeHtml).join('')}</ol></details></li>`;
}

function load(text: string, name: string, sample = false) {
  doc = parse(text);
  const all = scenesIn(doc.children);
  longest = Math.max(1, ...all.map(s => s.endLine - s.line + 1));
  const title = doc.titlePage['title'] || name.replace(/\.[^.]+$/, '');
  $('doc-title').textContent = title;
  $('doc-sample').hidden = !sample;
  const st = doc.stats;
  $('stats').textContent = [st.sequences ? plural(st.sequences, 'sequence') : st.sections ? plural(st.sections, 'section') : '',
    plural(st.scenes, 'scene'), plural(st.beats, 'beat')].filter(Boolean).join(' · ');

  const plain = !st.sections && !st.beats;
  $('outline').innerHTML =
    (plain ? `<p class="hint">This is plain Fountain: no sequences or beats are marked yet, so the outline lists scenes only.</p>` : '') +
    (all.length ? `<ol class="o-root">${doc.children.map(nodeHtml).join('')}</ol>` : `<p class="hint">No scene headings were found in this file.</p>`);

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
      case 'beat': return `<p class="m m-beat" ${a}><span>beat</span>${inline(b.text)}</p>`;
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

function spy() {
  const scroller = $('script');
  const base = scroller.getBoundingClientRect().top + 40;
  let cur = 0;
  scroller.querySelectorAll<HTMLElement>('.s-heading').forEach(h => { if (h.getBoundingClientRect().top <= base) cur = Number(h.dataset.line); });
  $('outline').querySelectorAll<HTMLElement>('.o-scene').forEach(b => {
    const on = Number(b.dataset.line) === cur;
    if (on !== b.classList.contains('here')) {
      b.classList.toggle('here', on);
      if (on && $('outline').offsetParent !== null) b.scrollIntoView({ block: 'nearest' });
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
