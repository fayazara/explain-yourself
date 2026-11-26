# explain-yourself

An agent skill that makes your coding agent **show** you what it changed instead of telling you. It opens your app in Chrome, circles each change with a hand-drawn pencil loop, and explains it out loud.

Made for people who'd rather see a change than read a wall of "✅ Updated X". Especially handy if you're visual or have ADHD.

## Install

```bash
npx skills add fayazara/explain-yourself
```

Then, after your agent makes a change to a web app with its dev server running, ask it to **explain yourself** (or run `/explain-yourself`).

## Better voice (optional)

It uses your browser's built-in voice by default. For a natural voice, add an [ElevenLabs](https://elevenlabs.io) key once:

```bash
node ~/.claude/skills/explain-yourself/scripts/show.mjs --setup
```

The path depends on your agent; it's this skill's install folder. Setup asks for the key (hidden), a voice id and a model, and saves them to `~/.explain-yourself/config.json` (readable only by you). The environment variables `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL` override the saved values.

## How it works

- The agent writes a short `tour.json`: a few steps, each pointing at a changed element (or a few lines of code) with one or two spoken sentences.
- `scripts/show.mjs` opens Chrome on your dev server and plays it. A small draggable pill has play/pause, next and a transcript toggle. Space and the ← → arrow keys work too.
- Narration text is sent to ElevenLabs only if you set up a key. Clips are cached in `~/.explain-yourself/cache`.

Requirements: Node 18+ and Google Chrome. The first run installs `playwright-core` (no browser download).
