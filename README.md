# FountainPen

A script editor built on [Fountain Cascade](https://github.com/JeffAdkinsSOAGuy/fountain-cascade), an extension of the Fountain screenplay syntax.

**Status:** early. It opens a script and shows its drama beside the text: sequences (including ones that pause and resume), the goals in play in each, and the beats, with scene headings as quiet markers between them. A Goals tab shows the goal tree, and a script that names a spine, such as the Hero's Journey, gets a checklist of its stages. A plot written with no script text opens the same way. Its beat agent reads a whole script and proposes goals, sequences, and beats for you to accept, edit, or reject. You cannot yet edit the script text itself.

**Supports:** Fountain Cascade v0.3.1.

## Run it

You need [Node.js](https://nodejs.org) 20 or later.

```
npm install
npm run build
```

Then open `dist/fountainpen.html` in a browser. Use **Open script**, or drag a `.fountain` file onto the page. The file is read in the browser and is not sent anywhere.

## The beat agent

**Find beats** sends the script to Claude through Anthropic's API, using your own API key, and asks where the drama turns. It reads in parts of about 5,000 words, always breaking between scenes, and carries a ledger from part to part: the story so far, the agents, each goal and its status, the open sequence, and the beat in progress. After the last part it asks one hindsight question, so that a goal revealed late can be marked as secret from where it was first held. It works from the definitions in the Cascade specification: agents, goals and their status, sequences, and beats.

- What comes back is a list of proposals, each with its reason, grouped by sequence.
- Accept or reject each one, edit a beat's wording or a sequence's title first if you like, or accept a whole sequence at once.
- Accepting writes a Cascade note into the script. The script's own text is never changed.
- **Save changes** writes the file back to disk.

The key is sent only to `api.anthropic.com`, and is kept in the browser only if you tick the box. Each run is billed to your key. This only works from your own built copy, not from a hosted preview.

## Test it

```
npm test
```

## What is here

| Path | What it is |
|---|---|
| `src/parser.ts` | The Cascade parser. Text in; sections, scenes, goals with their status history, beats, IDs, and markup problems out. No dependencies. |
| `src/spines.ts` | The library of spines and their stages. |
| `src/render.ts` | Lays script lines out for display (scene heading, action, dialogue). Display only. |
| `src/agent.ts` | The beat agent: its instructions, the API call, and the checks on what comes back. |
| `src/edit.ts` | Writes accepted proposals into a script as Cascade notes. |
| `src/view.ts` | The outline, the proposals panel, and saving. |
| `src/page.html` | The page and its styles. |
| `build.mjs` | Bundles everything into the single file `dist/fountainpen.html`. |
| `test/` | Tests for the parser, the agent's checks, and the editing, run against a complete script and recorded model replies. `test/conformance` is a copy of the conformance cases from the Fountain Cascade repository. |

## Not built yet

- Editing the script text, or moving and deleting existing marks
- Keeping unreviewed proposals between sessions
- A plot view you can write in: adding and linking goals, sequences, beats, and stages by hand
- The beat agent proposing goal links, resumed sequences, and stages
- Co-writer alternatives (planned for Cascade v0.4)
- A desktop wrapper
