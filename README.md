# FountainPen

A script editor built on [Fountain Cascade](https://github.com/JeffAdkinsSOAGuy/fountain-cascade), an extension of the Fountain screenplay syntax.

**Status:** first slice. It opens a script and shows its sequences, scenes, and beats beside the text. It does not edit yet.

**Supports:** Fountain Cascade v0.1.1.

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
| `src/parser.ts` | The Cascade parser. Text in; sections, scenes, beats, IDs, and markup problems out. No dependencies. |
| `src/render.ts` | Lays script lines out for display (scene heading, action, dialogue). Display only. |
| `src/view.ts` | The outline view. |
| `src/page.html` | The page and its styles. |
| `build.mjs` | Bundles everything into the single file `dist/fountainpen.html`. |
| `test/` | Parser tests, run against a complete marked-up script. |

## Not built yet

- Editing the script or the markup
- Story spines (Cascade v0.2)
- Co-writer alternatives (Cascade v0.3)
- A desktop wrapper
