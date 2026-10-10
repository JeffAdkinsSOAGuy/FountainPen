// Builds dist/parser.mjs (for tests and reuse) and dist/fountainpen.html (the whole app in one file).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/parser.ts'], bundle: true, format: 'esm', outfile: 'dist/parser.mjs' });
await build({ entryPoints: ['src/agent.ts'], bundle: true, format: 'esm', outfile: 'dist/agent.mjs' });
await build({ entryPoints: ['src/edit.ts'], bundle: true, format: 'esm', outfile: 'dist/edit.mjs' });
await build({ entryPoints: ['src/summary.ts'], bundle: true, format: 'esm', outfile: 'dist/summary.mjs' });
const app = await build({ entryPoints: ['src/view.ts'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' });
const safe = s => s.replace(/</g, '\\u003c');

// Local settings. A .env file beside this script may hold your Anthropic API key, so you do not have
// to paste it each time. It is read here and built into dist/fountainpen.html only. It is never
// committed (.gitignore) and never put in dist/fragment.html, which is the copy that gets shared.
const env = {};
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
const config = { key: env.ANTHROPIC_API_KEY || '', model: env.FOUNTAINPEN_MODEL || '' };
const sample = safe(JSON.stringify(readFileSync('test/fixtures/moral-dilemma.fountain', 'utf8')));
const body = readFileSync('src/page.html', 'utf8')
  .replace('__SAMPLE__', () => sample)
  .replace('__APP__', () => app.outputFiles[0].text.replace(/<\/script/g, '<\\/script'));
writeFileSync('dist/fragment.html', body.replace('__CONFIG__', '{}'));
writeFileSync('dist/fountainpen.html',
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head><body data-markup="on">\n${body.replace('__CONFIG__', () => safe(JSON.stringify(config)))}\n</body></html>\n`);
console.log('built dist/fountainpen.html', (body.length / 1024).toFixed(0) + ' KB' + (config.key ? ', with the API key from .env' : ''));
