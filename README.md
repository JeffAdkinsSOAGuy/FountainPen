# FountainPen

A script editor built on [Fountain Cascade](https://github.com/JeffAdkinsSOAGuy/fountain-cascade), an extension of the Fountain screenplay syntax.

**Status:** first slice. It opens a script and shows its drama beside the text: sequences, the goals in play in each, and the beats, with scene headings as quiet markers between them. It does not edit yet.

**Supports:** Fountain Cascade v0.2.

## Run it

You need [Node.js](https://nodejs.org) 20 or later.

```
npm install
npm run build
```

Then open `dist/fountainpen.html` in a browser. Use **Open script**, or drag a `.fountain` file onto the page. The file is read in the browser and is not sent anywhere.

## Test it

```
npm test
```

## What is here

| Path | What it is |
|---|---|
| `src/parser.ts` | The Cascade parser. Text in; sections, scenes, goals with their status history, beats, IDs, and markup problems out. No dependencies. |
| `src/render.ts` | Lays script lines out for display (scene heading, action, dialogue). Display only. |
| `src/view.ts` | The outline view. |
| `src/page.html` | The page and its styles. |
| `build.mjs` | Bundles everything into the single file `dist/fountainpen.html`. |
| `test/` | Parser tests, run against a complete marked-up script. |

## Not built yet

- Editing the script or the markup
- The beat agent: an AI pass that reads a whole script and proposes goals, sequences, and beats for you to accept or reject
- Story spines (planned for Cascade v0.3)
- Co-writer alternatives (planned for Cascade v0.4)
- A desktop wrapper
