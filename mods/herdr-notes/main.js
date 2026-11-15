// Notes for the focused pane's project, kept in plib (Project Library).
// Every read and write is a plib call on the machine that owns the space, so
// the panel and the agents working there share one library.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings, window, layout, notify, nextCommand, props } from "herdr";
import * as P from "./plib.js";

const MOD = "herdr-notes";
const POLL = 10000;       // how often a shown panel rereads the list
const STALE = 15000;      // a panel shown again after this long rereads at once
const AUTOSAVE = 1200;    // quiet time after the last keystroke
const SYNC_AFTER_WRITE = 4000;
const SYNC_EVERY = 300000;
const SKILL_EVERY = 600000;
const MAX_ROWS = 400;
const COPIED = 1500;      // how long a copy button shows its check

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on: on ?? null };
}
const contextKey = (loc) => JSON.stringify([loc.on, loc.cwd]);

function stored(key, fallback) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
  catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* the choice lasts until restart */ }
}

// The folder plib runs in decides the project; without one it runs in the machine's home.
const at = (place) => ({ on: place.on, ...(place.dir ? { cwd: place.dir } : {}) });
const baseOf = (note) => ({ title: note.title, body: note.body ?? "", scope: P.scopeOf(note), project: note.project ?? "", revision: note.revision ?? null });
const machineName = (on) => on ?? "This computer";

export default class Notes extends View {
  init(_props, cx) {
    this.home = props()?.home || null;
    this.contexts = new Map();
    this.machines = new Map();
    this.session = null;
    this.query = "";
    this.filter = stored("filter", "all");
    this.mode = stored("mode", "edit");
    this.dismissed = stored("skill.dismissed", {});
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search notes" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.searching = true; this.typing = this.search; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searching = false; if (this.typing === this.search) this.typing = null; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => { if (this.visible()) this.refresh(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "new") this.open(null, cx);
        else if (command === "back") this.leave(cx);
        else if (command === "focus") (this.session ? this.session.title : this.search).focus();
        cx.notify();
      }
    });
  }

  // Unsaved text goes out before the pane, tab or app closes.
  async close() {
    const s = this.session;
    if (s && !s.dead && this.dirty(s)) await this.commit(s);
  }

  visible() {
    return P.blockVisible(layout(), MOD) || panes().some((p) => p.mod === MOD);
  }

  machine(on) {
    const key = on ?? "";
    let m = this.machines.get(key);
    if (!m) { m = { on: on ?? null, skill: null, skillAt: 0, syncing: false, syncedAt: 0, syncError: null, syncGen: 0 }; this.machines.set(key, m); }
    return m;
  }

  // ---- reading -----------------------------------------------------------

  refresh(cx) {
    const loc = location(), key = contextKey(loc);
    let ctx = this.contexts.get(key);
    if (!ctx) {
      ctx = { key, on: loc.on, cwd: loc.cwd, dir: loc.cwd, state: "loading", notes: [], project: "", root: null, git: null, error: null, loading: false, again: false, loadedAt: 0, print: "" };
      this.contexts.set(key, ctx);
      if (this.contexts.size > 40) this.contexts.delete(this.contexts.keys().next().value);
    }
    const switched = this.ctx !== ctx;
    this.ctx = ctx;
    if (ctx.loading) { ctx.again = true; return; }
    ctx.loading = true;
    cx.spawn(async (cx) => {
      try { await this.load(ctx, cx); }
      catch (e) { ctx.state = "error"; ctx.error = P.errorText(e); }
      finally {
        ctx.loading = false; ctx.loadedAt = Date.now();
        const print = JSON.stringify([ctx.state, ctx.error, ctx.project, ctx.git, ctx.notes.map((n) => [n.id, n.revision])]);
        const changed = print !== ctx.print;
        ctx.print = print;
        if (ctx.again) { ctx.again = false; if (this.ctx === ctx) this.refresh(cx); }
        if (changed || switched) cx.notify();
      }
    });
  }

  async status(ctx) {
    ctx.dir = ctx.cwd;
    try { return await exec("plib", P.statusArgs(this.home), at(ctx)); }
    catch (e) {
      // A folder that no longer exists fails like a missing program: ask again from home.
      if (!ctx.cwd) throw e;
      const result = await exec("plib", P.statusArgs(this.home), { on: ctx.on });
      ctx.dir = null;
      return result;
    }
  }

  async load(ctx, cx) {
    const started = Date.now();
    let status;
    try { status = await this.status(ctx); }
    catch (e) { ctx.state = P.isMissingProgram(e) ? "missing" : "error"; ctx.error = P.errorText(e); return; }
    const info = status.code === 0 ? P.parseJSON(status.stdout) : null;
    if (!info) {
      const v = await exec("plib", P.versionArgs(), { on: ctx.on }).catch(() => null);
      const version = P.parseVersion(v?.stdout);
      if (version && !P.versionOk(version)) { ctx.state = "outdated"; ctx.version = version.join("."); }
      else { ctx.state = "error"; ctx.error = P.errorText(status.stderr || status.stdout); }
      return;
    }
    ctx.root = info.root ?? null; ctx.project = info.project || ""; ctx.git = info.git ?? null;
    if (!info.initialized) { ctx.state = "uninitialized"; return; }
    const list = await exec("plib", P.listArgs(this.home), at(ctx));
    const notes = list.code === 0 ? P.parseJSON(list.stdout) : null;
    if (!Array.isArray(notes)) { ctx.state = "error"; ctx.error = P.errorText(list.stderr || "plib list returned no notes"); return; }
    // This list may predate a note the panel just wrote: showing it would undo the edit on screen.
    if ((this.machine(ctx.on).wroteAt ?? 0) >= started && ctx.state === "ready") { ctx.again = true; return; }
    ctx.notes = P.sortNotes(notes); ctx.state = "ready"; ctx.error = null;
    this.reconcile(ctx);
    this.checkSkill(ctx.on, cx);
    this.watch(ctx, cx);
    const m = this.machine(ctx.on);
    if (ctx.git?.remote && !m.syncing && Date.now() - m.syncedAt > SYNC_EVERY) this.sync(ctx.on, cx);
  }

  // The local library folder tells us at once when an agent writes a note.
  watch(ctx, cx) {
    if (ctx.on || !ctx.root || this.watched === ctx.root) return;
    const root = this.watched = ctx.root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          const paths = await watchFolder(root);
          // plib's own Git bookkeeping is not a change to the notes.
          if (paths.every((path) => path.startsWith(`${root}/.git`))) continue;
          if (this.watched === root && this.ctx && !this.ctx.on && this.visible()) this.refresh(cx);
        }
      } catch { if (this.watched === root) this.watched = null; }
    });
  }

  checkSkill(on, cx, force = false) {
    const m = this.machine(on);
    if (m.skillChecking || (!force && Date.now() - m.skillAt < SKILL_EVERY)) return;
    m.skillChecking = true;
    cx.spawn(async (cx) => {
      try {
        // A stale copy exits nonzero and still prints its report.
        const r = await exec("plib", P.skillArgs(), { on });
        m.skill = P.skillVerdict(P.parseJSON(r.stdout));
      } catch { /* asked again on the next check */ }
      finally { m.skillChecking = false; m.skillAt = Date.now(); cx.notify(); }
    });
  }

  sync(on, cx) {
    const m = this.machine(on);
    if (m.syncing) { m.syncAgain = true; return; }
    m.syncing = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("plib", P.syncArgs(this.home), { on, timeout: 120000 });
        m.syncError = r.code === 0 ? null : P.errorText(r.stderr || r.stdout);
      } catch (e) { m.syncError = P.errorText(e); }
      finally {
        m.syncing = false; m.syncedAt = Date.now();
        if (m.syncAgain) { m.syncAgain = false; this.sync(on, cx); }
        else if (this.ctx && this.ctx.on === m.on) this.refresh(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  // Writes stay local (--no-sync) so typing never waits on the network; one
  // sync follows once the edits pause.
  syncSoon(on, cx) {
    const m = this.machine(on), gen = ++m.syncGen;
    cx.timer.after(SYNC_AFTER_WRITE, (cx) => { if (gen === m.syncGen) this.sync(on, cx); });
  }

  // ---- the open note -----------------------------------------------------

  open(note, cx) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "ready") return;
    this.leave(cx);
    const base = note ? baseOf(note) : { title: "", body: "", scope: ctx.project && this.filter !== "global" ? "project" : "global", project: "", revision: null };
    const s = { id: note?.id ?? null, on: ctx.on, dir: ctx.dir, project: ctx.project, base, scope: base.scope, gen: 0, saving: false, again: false, status: "", error: null, conflict: null, gone: false, confirm: false, dead: false, final: null, auto: false, fresh: !note };
    s.title = InputState.new({ placeholder: "Title", value: base.title });
    // A textarea, not Herdr's code editor: only text states can take a paste from the mod (see paste).
    s.body = TextareaState.new({ value: base.body });
    // What the fields hold for the saved note: an editor may normalize text, and that is not an edit.
    s.shown = { title: s.title.value(), body: s.body.value() };
    for (const state of [s.title, s.body]) {
      state.on("change", (_e, cx) => this.edited(s, cx));
      state.on("focus", () => { this.typing = state; });
      state.on("blur", (_e, cx) => { if (this.typing === state) this.typing = null; if (!s.dead && this.dirty(s)) this.save(s, cx); });
    }
    this.session = s;
    if (!note) s.title.focus();
    cx.notify();
  }

  /**
   * The note as the fields describe it now. An empty title takes the body's
   * first line, and keeps following it until the person types a title.
   */
  draft(s) {
    const raw = s.final ?? { title: s.title.value(), body: s.body.value() };
    const body = raw.body === s.shown.body ? s.base.body : raw.body;
    const typed = raw.title !== s.shown.title;
    const auto = typed || !s.id ? !raw.title.trim() : s.auto;
    const title = auto ? P.titleFromBody(body) || (s.id ? s.base.title : "") : typed || !s.id ? raw.title.trim() : s.base.title;
    return { title, body, scope: s.scope, raw, auto };
  }

  dirty(s) {
    const d = this.draft(s);
    if (!d.title) return false;
    return s.id ? Boolean(P.changedFields(s.base, d)) : true;
  }

  edited(s, cx) {
    if (s.dead || s.final) return;
    const before = s.status;
    const d = this.draft(s);
    if (!d.title) s.status = d.raw.title || d.raw.body ? "untitled" : "";
    else if (s.id && !P.changedFields(s.base, d)) { if (s.status === "edited" || s.status === "untitled") s.status = ""; }
    else {
      s.status = "edited";
      const gen = ++s.gen;
      cx.timer.after(AUTOSAVE, (cx) => { if (gen === s.gen) this.save(s, cx); });
    }
    if (s.status !== before) cx.notify();
  }

  save(s, cx) {
    if (s.dead) return;
    if (s.saving) { s.again = true; return; }
    cx.spawn(async (cx) => {
      await this.commit(s);
      if (s.again) { s.again = false; if (!s.dead && this.dirty(s)) return this.save(s, cx); }
      if (this.session !== s && !s.dead) await this.rescue(s);
      cx.notify();
      if (s.wrote) { s.wrote = false; this.syncSoon(s.on, cx); }
    });
    cx.notify();
  }

  // A note the person already left cannot show a banner: its text must not be lost quietly.
  async rescue(s) {
    if (s.status !== "conflict" && s.status !== "error" && !s.gone) return;
    const d = this.draft(s);
    if (s.status === "error") { notify({ title: `"${d.title}" was not saved`, body: s.error ?? "plib failed", level: "error" }); return; }
    try {
      const copy = { title: s.gone ? d.title : `${d.title} (my version)`, body: d.body, project: d.scope === "project" };
      const out = P.writeOutcome(await exec("plib", P.addArgs(copy, this.home), at(s)));
      if (!out.ok || !out.note) throw new Error(out.error);
      this.machine(s.on).wroteAt = Date.now();
      this.patch(s.on, out.note.id, out.note); s.wrote = true;
      if (!s.gone) notify({ title: "Note changed elsewhere", body: `Your edits were kept as "${copy.title}".`, level: "warning" });
    } catch (e) { notify({ title: `"${d.title}" was not saved`, body: P.errorText(e), level: "error" }); }
  }

  /** One add or edit for the open note. Never throws; the result is on the session. */
  async commit(s) {
    const d = this.draft(s);
    if (!d.title) { s.status = d.raw.title || d.raw.body ? "untitled" : ""; return; }
    const changes = s.id ? P.changedFields(s.base, d) : d;
    if (!changes) { if (s.status === "edited") s.status = ""; return; }
    if (P.byteLength(d.body) > P.MAX_BODY_BYTES) { s.status = "error"; s.error = "This note is too large to save from the panel (100 KB)."; return; }
    const args = s.id ? P.editArgs(s.id, changes, s.base.revision, this.home) : P.addArgs({ title: d.title, body: d.body, project: d.scope === "project" }, this.home);
    s.saving = true; s.status = "saving"; s.gen++;
    try {
      const out = P.writeOutcome(await exec("plib", args, at(s)));
      if (out.ok && out.note) {
        s.id = out.note.id; s.base = baseOf(out.note); s.scope = s.base.scope; s.shown = { ...d.raw }; s.auto = d.auto;
        s.status = "saved"; s.error = null; s.conflict = null; s.gone = false; s.wrote = true;
        // Show the title the note was given, unless the person is typing one.
        if (d.auto && !s.final && s.title.value() === d.raw.title && d.raw.title !== s.base.title) {
          s.title.set_value(s.base.title); s.shown.title = s.title.value();
        }
        this.machine(s.on).wroteAt = Date.now();
        this.patch(s.on, out.note.id, out.note);
      } else if (out.conflict && out.note) { s.conflict = out.note; s.status = "conflict"; }
      else if (out.gone) { s.gone = true; s.status = ""; }
      else { s.status = "error"; s.error = out.error ?? "plib could not save this note"; s.scope = s.base.scope; }
    } catch (e) { s.status = "error"; s.error = P.errorText(e); }
    finally { s.saving = false; }
  }

  /** Every list of that machine learns about a write without waiting for the next poll. */
  patch(on, id, note) {
    for (const ctx of this.contexts.values()) {
      if (ctx.on !== (on ?? null) || ctx.state !== "ready") continue;
      ctx.notes = note ? P.sortNotes(P.upsert(ctx.notes, note, ctx.project)) : ctx.notes.filter((n) => n.id !== id);
    }
  }

  // A fresh list may show that the open note changed or went away elsewhere.
  reconcile(ctx) {
    const s = this.session;
    if (!s || !s.id || s.saving || s.dead || s.on !== ctx.on) return;
    const note = ctx.notes.find((n) => n.id === s.id);
    if (!note) { if (P.inScope({ project: s.base.project }, ctx.project)) s.gone = true; return; }
    s.gone = false;
    if (note.revision === s.base.revision) { if (s.conflict) s.conflict = null; return; }
    if (this.dirty(s)) { s.conflict = note; s.status = "conflict"; }
    else this.adopt(s, note);
  }

  /** Shows `note` in the fields as the saved state. */
  adopt(s, note) {
    s.base = baseOf(note); s.scope = s.base.scope; s.conflict = null; s.gone = false; s.status = ""; s.error = null;
    if (s.title.value() !== note.title) s.title.set_value(note.title);
    if (s.body.value() !== s.base.body) s.body.set_value(s.base.body);
    s.shown = { title: s.title.value(), body: s.body.value() };
  }

  /** Keeps what the person typed over the other version; fields they left alone take the other side. */
  keepMine(s, cx) {
    const theirs = baseOf(s.conflict), raw = { title: s.title.value(), body: s.body.value() };
    if (raw.title === s.shown.title) { s.title.set_value(theirs.title); s.shown.title = s.title.value(); }
    if (raw.body === s.shown.body) { s.body.set_value(theirs.body); s.shown.body = s.body.value(); }
    s.base = theirs; s.conflict = null; s.status = "edited";
    this.save(s, cx);
  }

  toggleScope(s, cx) {
    if (s.saving || (s.scope === "global" && !s.project)) return;
    s.scope = s.scope === "project" ? "global" : "project";
    if (s.id || this.dirty(s)) this.save(s, cx);
    cx.notify();
  }

  remove(s, cx) {
    if (!s.id) { this.drop(s); cx.notify(); return; }
    s.gen++; s.dead = true; s.status = "deleting";
    cx.spawn(async (cx) => {
      try {
        const out = P.writeOutcome(await exec("plib", P.deleteArgs(s.id, s.base.revision, this.home), at(s)));
        if (out.ok || out.gone) { this.machine(s.on).wroteAt = Date.now(); this.patch(s.on, s.id, null); this.drop(s); this.syncSoon(s.on, cx); }
        else {
          s.dead = false; s.confirm = false;
          if (out.conflict && out.note) { s.conflict = out.note; s.status = "conflict"; }
          else { s.status = "error"; s.error = out.error; }
        }
      } catch (e) { s.dead = false; s.confirm = false; s.status = "error"; s.error = P.errorText(e); }
      finally { cx.notify(); }
    });
    cx.notify();
  }

  // Edit or Preview is the person's choice for every note, until they change it.
  // A note being written for the first time has nothing to preview, so it opens in the editor.
  modeOf(s) { return s.fresh ? "edit" : this.mode; }

  toggleMode(s, cx) {
    this.mode = this.modeOf(s) === "edit" ? "preview" : "edit";
    s.fresh = false;
    store("mode", this.mode);
    cx.notify();
  }

  /** Back to the list, saving what is unsaved on the way. */
  leave(cx) {
    const s = this.session;
    if (!s) return;
    s.final = { title: s.title.value(), body: s.body.value() };
    if (!s.dead && this.dirty(s)) this.save(s, cx);
    this.drop(s);
  }

  drop(s) {
    if (!s.final) s.final = { title: s.title.value(), body: s.body.value() };
    s.gen++;
    s.title.release(); s.body.release();
    if (this.session === s) this.session = null;
  }

  initialize(ctx, cx) {
    if (ctx.busy) return;
    ctx.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("plib", P.initArgs(this.home), { on: ctx.on });
        if (r.code !== 0) notify({ title: "Could not create the library", body: P.errorText(r.stderr || r.stdout), level: "error" });
      } catch (e) { notify({ title: "Could not create the library", body: P.errorText(e), level: "error" }); }
      finally { ctx.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  browse(url, cx) {
    cx.spawn(async () => {
      try {
        const r = await exec(window()?.platform === "macos" ? "open" : "xdg-open", [url]);
        if (r.code !== 0) throw new Error("no browser");
      } catch { notify({ title: "Open in your browser", body: url, level: "info" }); }
    });
  }

  key(e, cx) {
    const s = this.session, mod = e.modifiers?.control || e.modifiers?.platform;
    if (e.key === "escape" && s) { if (s.confirm) s.confirm = false; else this.leave(cx); }
    else if (e.key === "escape" && this.query) { this.search.set_value(""); this.query = ""; }
    else if (e.key === "s" && mod && s) this.save(s, cx);
    else if (!(e.key === "v" && e.modifiers?.control && e.modifiers?.shift && this.paste(cx))) return;
    cx.stop_propagation(); cx.notify();
  }

  /**
   * Ctrl+Shift+V pastes into the focused field. The fields paste only on
   * Ctrl+V, and Omarchy's universal paste (Super+V) reaches Herdr as
   * Ctrl+Shift+V because its terminals need that chord.
   */
  paste(cx) {
    const field = this.typing, s = this.session;
    if (!field) return false;
    const text = cx.read_from_clipboard();
    if (!text) return true;
    field.replace(field === this.search || field === s?.title ? text.replace(/\s*\r?\n\s*/g, " ") : text);
    if (field === this.search) this.query = this.search.value();
    else if (s) this.edited(s, cx);
    return true;
  }

  /** Puts a note's text on this computer's clipboard: its body, or its title when it has none. */
  copy(key, note, cx) {
    cx.write_to_clipboard(note.body || note.title || "");
    this.copiedNote = key;
    cx.timer.after(COPIED, (cx) => { if (this.copiedNote === key) { this.copiedNote = null; cx.notify(); } });
    cx.notify();
  }

  copyButton(t, id, key, note, size = 24) {
    const done = this.copiedNote === key;
    return h_flex().id(id).size(size).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(done ? t.ansi2 : t.dim).hover((st) => st.bg(t.raised).text_color(done ? t.ansi2 : t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.copy(key, note(), cx); })
      .child(svg(`mods/${MOD}/${done ? "check" : "copy"}.svg`).size(14));
  }

  // ---- drawing -----------------------------------------------------------

  button(t, id, label, action, { primary = false, danger = false } = {}) {
    return h_flex().id(id).h(26).px(9).flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
      .border_1().border_color(primary ? t.solid : danger ? t.blocked : t.input)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : danger ? t.blocked : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click(action).child(label);
  }

  ghost(t, id, label, action, active = false) {
    return h_flex().id(id).h(26).px(7).flex_none().items_center().justify_center().rounded(6).text_size(12).cursor_pointer()
      .bg(active ? t.selected : t.background).text_color(active ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(label);
  }

  banner(t, id, color, text, actions = []) {
    return v_flex().id(id).flex_none().mx(8).mt(8).p(10).gap(8).rounded(8).border_1().border_color(color).bg(t.surface)
      .child(div().text_size(12).text_color(t.foreground).child(text))
      .when(actions.length > 0, (el) => el.child(h_flex().gap(6).flex_wrap().children(actions)));
  }

  message(t, title, lines, actions = []) {
    return v_flex().flex_1().min_h(0).p(18).gap(10)
      .child(div().font_semibold().child(title))
      .children(lines.map((line) => typeof line === "string" ? div().text_size(12).text_color(t.muted).child(line) : line))
      .when(actions.length > 0, (el) => el.child(h_flex().pt(4).gap(8).flex_wrap().children(actions)));
  }

  code(t, text) {
    return div().px(8).py(5).rounded(6).bg(t.raised).text_size(12).text_color(t.foreground).font_family(settings().font_family).child(text);
  }

  skillBanner(ctx, t) {
    const m = this.machine(ctx.on), verdict = m.skill, key = ctx.on ?? "";
    if (!verdict || verdict === "ok" || verdict === "unknown" || this.dismissed[key] === verdict) return null;
    const where = ctx.on ? `on ${ctx.on}` : "on this computer";
    const dismiss = this.ghost(t, "skill-dismiss", "Dismiss", (_e, cx) => { this.dismissed[key] = verdict; store("skill.dismissed", this.dismissed); cx.notify(); });
    if (verdict === "modified") {
      return this.banner(t, "skill-banner", t.border, `The plib skill ${where} was edited by hand and differs from the one plib ships.`, [dismiss]);
    }
    const text = verdict === "missing"
      ? `Agents ${where} can't use these notes yet: the plib skill is not installed. Run this in a terminal there:`
      : `The plib skill ${where} is older than plib, so agents may miss notes. Update it in a terminal there:`;
    return v_flex().id("skill-banner").flex_none().mx(8).mt(8).p(10).gap(8).rounded(8).border_1().border_color(t.ansi3).bg(t.surface)
      .child(div().text_size(12).child(text))
      .child(this.code(t, P.SKILL_COMMAND))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button(t, "skill-copy", this.copied ? "Copied" : "Copy", (_e, cx) => { cx.write_to_clipboard(P.SKILL_COMMAND); this.copied = true; cx.notify(); }))
        .child(this.ghost(t, "skill-check", m.skillChecking ? "Checking…" : "Check again", (_e, cx) => { this.copied = false; this.checkSkill(ctx.on, cx, true); cx.notify(); }))
        .child(dismiss));
  }

  listHeader(ctx, t) {
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("Notes"))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(ctx?.project ? P.projectLabel(ctx.project) : ""))
      .when(ctx?.state === "ready", (el) => el.child(this.ghost(t, "notes-new", svg(`mods/${MOD}/plus.svg`).size(14), (_e, cx) => this.open(null, cx))));
  }

  row(note, ctx, t) {
    const text = P.preview(note.body);
    // The copy icon takes the age's place while the pointer is on the row, so rows keep their shape.
    const hot = this.hoverRow === note.id || this.copiedNote === note.id;
    return v_flex().id(`note-${note.id}`).flex_none().px(10).py(7).gap(2).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.open(note, cx))
      .on_hover((hovered, cx) => {
        if (hovered) this.hoverRow = note.id; else if (this.hoverRow === note.id) this.hoverRow = null;
        cx.notify();
      })
      .child(h_flex().h(20).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().font_medium().child(note.title))
        .when(Boolean(ctx.project) && this.filter === "all", (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(note.project ? t.accent : t.dim).child(P.scopeOf(note))))
        .child(h_flex().relative().flex_none().h(20).min_w(20).items_center().justify_end()
          .child(div().text_size(11).text_color(t.dim).when(hot, (el) => el.invisible()).child(P.ago(note.updated)))
          .when(hot, (el) => el.child(this.copyButton(t, `copy-${note.id}`, note.id, () => note, 20).absolute().right(0).top(0)))))
      .when(Boolean(text), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(text)));
  }

  footer(ctx, t) {
    const m = this.machine(ctx.on);
    const state = m.syncing ? "Syncing…" : m.syncError ? "Sync pending · retry" : !ctx.git?.remote ? "Local only" : m.syncedAt ? `Synced ${P.ago(new Date(m.syncedAt).toISOString()) || "now"}` : "Not synced yet";
    const count = `${ctx.notes.length} ${ctx.notes.length === 1 ? "note" : "notes"}`;
    // Always in view below the list: why a folder shows no project notes, then where the notes live.
    return v_flex().flex_none().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .when(!ctx.project && Boolean(ctx.cwd), (el) => el.child(div().px(12).pt(7).truncate().child("No Git remote here: global notes only.")))
      .child(h_flex().h(26).px(12).gap(6).items_center()
        .child(div().flex_none().child(machineName(ctx.on)))
        .child(div().flex_1().min_w(0).truncate().child(`· ${count}`))
        .child(div().id("notes-sync").flex_none().cursor_pointer().text_color(m.syncError ? t.ansi3 : t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.sync(ctx.on, cx)).child(state)));
  }

  list(ctx, t) {
    if (!ctx || (ctx.state === "loading")) return this.message(t, "Loading notes…", []);
    const where = ctx.on ? `on ${ctx.on}` : "on this computer";
    const retry = this.button(t, "notes-retry", "Check again", (_e, cx) => { this.refresh(cx); cx.notify(); });
    if (ctx.state === "missing") {
      return this.message(t, `plib is not installed ${where}`, [
        "Notes are kept in Project Library (plib). Install it there, then check again.",
        this.code(t, "brew install illegalstudio/tap/plib"),
        this.code(t, "mise use -g github:illegalstudio/project-library"),
      ], [this.button(t, "notes-install", "Installation guide", (_e, cx) => this.browse(P.INSTALL_URL, cx), { primary: true }), retry]);
    }
    if (ctx.state === "outdated") {
      return this.message(t, `plib ${where} is too old`, [`This panel needs plib ${P.MIN_VERSION_TEXT} or newer; version ${ctx.version} is installed. Update it, then check again.`], [retry]);
    }
    if (ctx.state === "uninitialized") {
      return this.message(t, `No note library ${where} yet`, [
        "Create a local library now. To share notes between machines, connect a Git remote later with: plib remote set URL",
      ], [this.button(t, "notes-init", ctx.busy ? "Creating…" : "Create library", (_e, cx) => this.initialize(ctx, cx), { primary: true }), retry]);
    }
    if (ctx.state === "error") return this.message(t, "Notes are unavailable", [ctx.error ?? "plib failed", machineName(ctx.on)], [retry]);

    const scoped = Boolean(ctx.project);
    const notes = P.filterNotes(ctx.notes, { query: this.query, scope: scoped ? this.filter : "all" });
    const chip = (id, label) => this.ghost(t, `filter-${id}`, label, (_e, cx) => { this.filter = id; store("filter", id); cx.notify(); }, this.filter === id);
    const m = this.machine(ctx.on), skill = this.skillBanner(ctx, t);
    return v_flex().flex_1().min_h(0)
      .when(Boolean(skill), (el) => el.child(skill))
      .when(Boolean(m.syncError), (el) => el.child(this.banner(t, "sync-banner", t.ansi3, `Notes are saved here but not synchronized: ${m.syncError}`)))
      .child(div().flex_none().px(8).pt(8).child(
        Input.new(this.search).h(30).px(9).rounded(7).border_1().border_color(this.searching ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(scoped, (el) => el.child(h_flex().flex_none().px(8).pt(6).gap(4).child(chip("all", "All")).child(chip("project", P.projectLabel(ctx.project))).child(chip("global", "Global"))))
      .child(v_flex().id("notes-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .children(notes.slice(0, MAX_ROWS).map((note) => this.row(note, ctx, t)))
        .when(notes.length === 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child(
          this.query ? "No notes match this search" : scoped && this.filter !== "all" ? "No notes here yet" : "No notes yet. Press + to write the first one.")))
        .when(notes.length > MAX_ROWS, (el) => el.child(div().p(10).text_size(11).text_color(t.dim).child(`Showing the ${MAX_ROWS} most recent notes. Search to find older ones.`))))
      .child(this.footer(ctx, t));
  }

  detailHeader(s, t) {
    const status = { saving: "Saving…", saved: "Saved", edited: "Edited", untitled: "Add a title to save", deleting: "Deleting…", conflict: "Changed elsewhere", error: "Not saved" }[s.status] ?? "";
    const canMove = s.scope === "project" || Boolean(s.project);
    const label = s.scope === "project" ? P.projectLabel(s.base.project || s.project) || "project" : "Global";
    return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(this.ghost(t, "note-back", "←", (_e, cx) => { this.leave(cx); cx.notify(); }))
      .child(h_flex().id("note-scope").h(22).px(7).flex_none().items_center().rounded(5).bg(t.raised).text_size(11).text_color(s.scope === "project" ? t.accent : t.muted)
        .when(canMove, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.toggleScope(s, cx)))
        .child(label))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(s.status === "error" || s.status === "conflict" ? t.ansi3 : t.dim).child(status))
      .child(this.ghost(t, "note-mode", this.modeOf(s) === "edit" ? "Preview" : "Edit", (_e, cx) => this.toggleMode(s, cx)))
      .child(this.copyButton(t, "note-copy", "open", () => ({ title: s.title.value().trim(), body: s.body.value() })))
      .when(!s.confirm, (el) => el.child(this.ghost(t, "note-delete", svg(`mods/${MOD}/trash.svg`).size(14), (_e, cx) => { s.confirm = true; cx.notify(); })))
      .when(s.confirm, (el) => el
        .child(this.button(t, "note-delete-yes", "Delete", (_e, cx) => this.remove(s, cx), { danger: true }))
        .child(this.ghost(t, "note-delete-no", "Cancel", (_e, cx) => { s.confirm = false; cx.notify(); })));
  }

  detail(s, t) {
    const mode = this.modeOf(s), body = mode === "preview" ? s.body.value() : "";
    return v_flex().flex_1().min_h(0)
      .when(Boolean(s.conflict), (el) => el.child(this.banner(t, "note-conflict", t.ansi3, "This note changed somewhere else while you were editing it.", [
        this.button(t, "conflict-mine", "Keep mine", (_e, cx) => this.keepMine(s, cx)),
        this.button(t, "conflict-theirs", "Load the other version", (_e, cx) => { this.adopt(s, s.conflict); cx.notify(); }),
      ])))
      .when(s.gone && !s.conflict, (el) => el.child(this.banner(t, "note-gone", t.ansi3, "This note was deleted somewhere else.", [
        this.button(t, "gone-keep", "Save it again", (_e, cx) => { s.id = null; s.gone = false; s.base = { ...s.base, revision: null }; this.save(s, cx); }),
        this.button(t, "gone-drop", "Discard", (_e, cx) => { s.dead = true; this.drop(s); cx.notify(); }),
      ])))
      .when(s.status === "error" && Boolean(s.error), (el) => el.child(this.banner(t, "note-error", t.blocked, s.error, [
        this.button(t, "note-retry", "Try again", (_e, cx) => this.save(s, cx)),
      ])))
      .child(div().flex_none().px(8).pt(8).pb(4).child(
        Input.new(s.title).h(34).px(8).rounded(7).bg(t.background).text_size(15).font_semibold().text_color(t.foreground)))
      .when(mode === "edit", (el) => el.child(div().flex_1().min_h(0).px(16).py(8).child(Textarea.new(s.body).size_full().bg(t.background).text_size(13).font_family(settings().font_family).text_color(t.foreground))))
      .when(mode === "preview", (el) => el.child(div().id("note-preview").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(8)
        .child(body.trim() ? TextView.markdown("note-markdown", body).selectable() : div().text_size(12).text_color(t.dim).child("Nothing to preview yet"))));
  }

  render(cx) {
    const key = contextKey(location());
    if (this.visible() && (key !== this.ctx?.key || (!this.ctx.loading && Date.now() - this.ctx.loadedAt > STALE))) this.refresh(cx);
    const t = theme(), s = this.session;
    return v_flex().id("notes").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(s ? this.detailHeader(s, t) : this.listHeader(this.ctx, t))
      .child(s ? this.detail(s, t) : this.list(this.ctx, t));
  }
}
