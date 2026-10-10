// Builds dist/parser.mjs (for tests and reuse) and dist/fountainpen.html (the whole app in one file).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/parser.ts'], bundle: true, format: 'esm', outfile: 'dist/parser.mjs' });
await build({ entryPoints: ['src/agent.ts'], bundle: true, format: 'esm', outfile: 'dist/agent.mjs' });
await build({ entryPoints: ['src/edit.ts'], bundle: true, format: 'esm', outfile: 'dist/edit.mjs' });
const app = await build({ entryPoints: ['src/view.ts'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' });
const safe = s => s.replace(/</g, '\\u003c');
const sample = safe(JSON.stringify(readFileSync('test/fixtures/moral-dilemma.fountain', 'utf8')));
const body = readFileSync('src/page.html', 'utf8')
  .replace('__SAMPLE__', () => sample)
  .replace('__APP__', () => app.outputFiles[0].text.replace(/<\/script/g, '<\\/script'));
writeFileSync('dist/fragment.html', body);
writeFileSync('dist/fountainpen.html',
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head><body data-markup="on">\n${body}\n</body></html>\n`);
console.log('built dist/fountainpen.html', (body.length / 1024).toFixed(0) + ' KB');
