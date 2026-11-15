# Herdr Notes

This repository packages a native mod for the new Herdr desktop app.
Source is under `mods/herdr-notes/`. Herdr's installed
`~/.config/herdr-app/AGENTS.md` and generated type files describe its API;
read them before changing the mod, they are rewritten on every app start.

- Notes live in plib (Project Library, sibling repository `project-library`,
  version 0.1.4 or newer). The mod keeps no store of its own.
- Every plib call goes through `exec("plib", args, { cwd, on })` with an
  argument array, never a shell string. Argument lists and result parsing
  live in `plib.js`, which imports nothing from Herdr so Node can test it.
- plib runs on the machine that owns the focused space (`on`), in the focused
  pane's folder. Do not read or write the library folder directly.
- Reads use `--no-sync`. Writes use `--no-sync` and `--if-match`, then one
  deferred `plib sync`. Never drop the revision check: agents edit the same notes.
- Text the person typed must never be lost quietly: a failed or conflicting
  save shows a banner, or a toast and a saved copy once the note is closed.
- Shipped Herdr mods and layouts are read-only. Integration goes through the
  person's own layout and cloned tab bar (see RECIPE.md).
- Use Herdr theme colors. Keep public assets free of personal notes and
  machine data; make previews from a throwaway library (`props.home`).
- Run `herdr-app check mods/herdr-notes` and
  `node --test tests/test_plib.mjs tests/test_plib_cli.mjs`. The check covers
  only the first render, so also open the panel in Herdr after UI changes.
- The installed mod is a symlink to this folder. Herdr does not reload on
  edits made through it: recreate the link
  (`~/.config/herdr-app/mods/herdr-notes`) to load a change, and confirm the
  new build runs before judging a fix.
- Herdr renders and runs mods only while its window is on a visible
  workspace; `herdr-app shot` returns the last frame otherwise.
- Do not commit generated Herdr type files or `jsconfig.json`.
- Never change sibling repositories from here; forward work as tasks.
- Never generate em dashes. Use concise lowercase Conventional Commits
  without Co-Authored-By trailers. Use gh for GitHub.
