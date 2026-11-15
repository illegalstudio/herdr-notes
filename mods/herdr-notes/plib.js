// Everything the panel knows about plib: argument lists, result parsing and
// the small pure helpers the views use. No Herdr imports, so Node can test it.

export const MIN_VERSION = [0, 1, 4];
export const MIN_VERSION_TEXT = MIN_VERSION.join(".");
export const INSTALL_URL = "https://github.com/illegalstudio/project-library#installation";
export const SKILL_COMMAND = "plib skills install";
// One argument carries the whole body. Linux caps a single argument at 128 KiB.
export const MAX_BODY_BYTES = 100000;

export function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function versionOk(version, minimum = MIN_VERSION) {
  if (!version) return false;
  for (let i = 0; i < 3; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

export function parseJSON(text) {
  try { return JSON.parse(String(text ?? "").trim()); }
  catch { return null; }
}

const withHome = (home, args) => home ? ["--home", home, ...args] : args;

export const versionArgs = () => ["--version"];
export const statusArgs = (home) => withHome(home, ["status", "--json"]);
export const listArgs = (home) => withHome(home, ["list", "--json", "--no-sync"]);
export const initArgs = (home) => withHome(home, ["init", "--local"]);
export const syncArgs = (home) => withHome(home, ["sync"]);
export const skillArgs = () => ["skills", "verify", "--json"];

// Values use the --flag=value form: a title or body may start with a dash.
export function addArgs({ title, body, project }, home) {
  return withHome(home, ["add", `--title=${title}`, `--body=${body ?? ""}`, project ? "--project" : "--global", "--json", "--no-sync"]);
}

/** `changes`: any of title, body, scope ("project" | "global"). */
export function editArgs(id, changes, revision, home) {
  const args = ["edit", id];
  if (changes.title !== undefined) args.push(`--title=${changes.title}`);
  if (changes.body !== undefined) args.push(`--body=${changes.body}`);
  if (changes.scope === "project") args.push("--project");
  if (changes.scope === "global") args.push("--global");
  if (revision) args.push(`--if-match=${revision}`);
  args.push("--json", "--no-sync");
  return withHome(home, args);
}

export function deleteArgs(id, revision, home) {
  const args = ["delete", id, "--yes"];
  if (revision) args.push(`--if-match=${revision}`);
  args.push("--json", "--no-sync");
  return withHome(home, args);
}

export const scopeOf = (note) => note?.project ? "project" : "global";

/** The fields of an open note that differ from what plib last returned, or null. */
export function changedFields(base, current) {
  const changes = {};
  if (current.title !== base.title) changes.title = current.title;
  if (current.body !== base.body) changes.body = current.body;
  if (current.scope !== base.scope) changes.scope = current.scope;
  return Object.keys(changes).length ? changes : null;
}

export function byteLength(text) {
  let bytes = 0;
  for (const char of String(text ?? "")) {
    const code = char.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const firstLine = (text) => String(text ?? "").trim().split("\n")[0].replace(/^plib:\s*/, "");

/**
 * What an add, edit or delete did. plib prints one JSON object on success and
 * on application errors (with `error` and a nonzero exit); flag and setup
 * errors print only text.
 */
export function writeOutcome(result) {
  const data = parseJSON(result?.stdout);
  const failed = !result || result.code !== 0 || !data || Boolean(data.error);
  if (!failed) return { ok: true, note: data.note ?? null, deleted: Boolean(data.deleted), sync: data.sync?.status ?? null };
  const error = data?.error || firstLine(result?.stderr) || firstLine(result?.stdout) || "plib failed";
  return {
    ok: false,
    error,
    note: data?.note ?? null,
    conflict: /--if-match mismatch/.test(error),
    gone: /matches 0 notes|note not found/.test(error),
  };
}

export const isMissingProgram = (error) => /program not found|No such file or directory|cannot find the file|not recognized/i.test(String(error?.message ?? error ?? ""));

export const errorText = (error) => firstLine(error?.message ?? error) || "Something went wrong";

/**
 * One word for the plib skill on a machine, from `plib skills verify --json`.
 * A stale copy is a destination the person uses, so it wins over a current one
 * elsewhere; a missing copy matters only when no destination has the skill.
 */
export function skillVerdict(report) {
  const statuses = (report?.verifications ?? []).map((v) => v.status);
  if (!statuses.length) return "unknown";
  if (statuses.includes("outdated")) return "outdated";
  if (statuses.includes("up-to-date")) return "ok";
  if (statuses.includes("modified")) return "modified";
  if (statuses.every((status) => status === "not-installed")) return "missing";
  return "unknown";
}

/** `github.com/acme/api` reads as `api`. */
export const projectLabel = (identity) => String(identity ?? "").split("/").filter(Boolean).pop() ?? "";

export function preview(body, length = 140) {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > length ? chars.slice(0, length).join("") + "…" : text;
}

/** A title for a note saved without one: its first line of text, without Markdown marks. */
export function titleFromBody(body, length = 60) {
  for (const line of String(body ?? "").split("\n")) {
    const text = line.replace(/^[\s#>*+\-]+/, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const chars = Array.from(text);
    return chars.length > length ? chars.slice(0, length).join("").trimEnd() + "…" : text;
  }
  return "";
}

const time = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) && ms > 0 ? ms : 0; };

/** Newest edit first; the ID keeps equal times stable. */
export function sortNotes(notes) {
  return [...notes].sort((a, b) => time(b.updated) - time(a.updated) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `scope`: "all", "project" or "global". Every word of the query must appear. */
export function filterNotes(notes, { query = "", scope = "all" } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter((note) => {
    if (scope !== "all" && scopeOf(note) !== scope) return false;
    if (!words.length) return true;
    const haystack = `${note.title}\n${note.body ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ago(iso, now = Date.now()) {
  const at = time(iso);
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  const date = new Date(at);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** Whether a note belongs in the list plib prints for a folder of `project`. */
export const inScope = (note, project) => !note.project || note.project === project;

/** A list with `note` replaced, added or (when it left the scope) removed. */
export function upsert(notes, note, project) {
  const rest = notes.filter((n) => n.id !== note.id);
  return inScope(note, project) ? [note, ...rest] : rest;
}

/**
 * Whether a layout block showing `mod` is on screen: no hidden ancestor and
 * every stack around it showing its branch. A mod the layout doesn't hold
 * (a pane, a tab, an overlay) counts as shown.
 */
export function blockVisible(root, mod) {
  let found = false, visible = false;
  const walk = (node, shown) => {
    if (!node || typeof node !== "object") return;
    const here = shown && !node.hidden;
    if (node.content?.mod === mod) { found = true; visible = visible || here; }
    for (const child of node.children ?? []) {
      walk(child, here && (node.type !== "stack" || !node.active || node.active === child.id));
    }
    for (const child of node.floating ?? []) walk(child, here);
  };
  walk(root, true);
  return !found || visible;
}
