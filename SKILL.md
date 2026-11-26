---
name: explain-yourself
description: Give the user a narrated, visual tour of the changes you just made to a web app. It plays in a Chrome window with a voice and a hand-drawn pencil circle on each change. Use when the user asks you to explain, show, walk through, or tour what you changed, or invokes /explain-yourself.
---

# Explain yourself

Show the user what you changed by playing a short narrated tour of the running app.

## 1. Write the tour

Look at what you changed (`git diff`, and `git diff <base>` if you already committed). Write `.explain-yourself/tour.json` at the project root:

```json
{
  "title": "Short name of the change",
  "url": "http://localhost:5173",
  "steps": [
    { "title": "New badge", "page": "/", "point": "data-testid=new-badge",
      "say": "Visitors now see a New badge. It tells them sign-up just got better." },
    { "title": "Errors as you type", "page": "/signup",
      "do": [{ "fill": "role=textbox[name=\"Email\"]", "value": "nope" }],
      "point": "text=valid email",
      "say": "A bad email shows an error right away, not after submit." },
    { "title": "The rule", "file": "src/validate.ts", "lines": "1-22",
      "say": "All the checks live in one small, tested function." }
  ]
}
```

- `url`: the dev server, which must already be running. Check that it responds. If nothing is running, ask the user to start it. Don't start long-lived servers yourself.
- **UI step:** set `page` (the path) and `point`, a Playwright locator for the changed element. Prefer `role=button[name="..."]`, `text=...` or `data-testid=...`, and use `css=` only when nothing else fits. An optional `do` list (`fill` + `value`, `click`, or `press`) reaches the state you want to show. Never click submit or anything destructive.
- **Code step** (a change with no visible UI): set `file` and `lines`.
- Use 3-8 steps, ordered by what the user sees, not by file. Each `say` is 1-2 plain spoken sentences about what changed and why it matters. Don't put file paths or code in `say`.
- Add `.explain-yourself/` to the project's `.gitignore` if it isn't already ignored.

## 2. Play it

Run this in the background. It stays open until the user closes the window:

```bash
node <this skill's folder>/scripts/show.mjs .explain-yourself/tour.json
```

The first run installs one dependency (`playwright-core`) and needs Google Chrome installed.

Then tell the user in one sentence that the tour is open. Don't repeat its contents. If the output says `couldn't find <locator>`, fix that step's `point` and run it again.

## 3. Voice

With no key set up, the tour uses the browser's built-in voice. If the output says `browser speech`, mention once that the user can get a much better voice by running this in their own terminal:

```bash
node <this skill's folder>/scripts/show.mjs --setup
```

It asks for an ElevenLabs API key (hidden input), a voice id and a model, and saves them to `~/.explain-yourself/config.json`. Never ask the user to paste a key into the chat, and never write a key into the project.

## 4. After the tour

The tour has a small draggable pill with play/pause, next and a transcript toggle. If the user asks for changes after watching, make them and offer to replay the tour.
