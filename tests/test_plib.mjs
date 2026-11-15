import assert from "node:assert/strict";
import test from "node:test";
import * as P from "../mods/herdr-notes/plib.js";

const note = (id, extra = {}) => ({ id, title: `Note ${id}`, body: "", updated: "2026-11-10T10:00:00Z", revision: `r-${id}`, ...extra });

test("versions older than the first automation release are refused", () => {
  assert.deepEqual(P.parseVersion("plib version 0.1.4 (6d08229)"), [0, 1, 4]);
  assert.equal(P.parseVersion("unknown command"), null);
  assert.equal(P.versionOk([0, 1, 3]), false);
  assert.equal(P.versionOk([0, 1, 4]), true);
  assert.equal(P.versionOk([0, 2, 0]), true);
  assert.equal(P.versionOk([1, 0, 0]), true);
  assert.equal(P.versionOk(null), false);
});

test("reads never synchronize and writes defer it", () => {
  assert.deepEqual(P.listArgs(), ["list", "--json", "--no-sync"]);
  assert.deepEqual(P.statusArgs(), ["status", "--json"]);
  assert.ok(P.addArgs({ title: "a", body: "b" }).includes("--no-sync"));
  assert.ok(P.editArgs("id", { title: "a" }, "rev").includes("--no-sync"));
  assert.ok(P.deleteArgs("id", "rev").includes("--no-sync"));
});

test("a custom library folder is passed before the command", () => {
  assert.deepEqual(P.listArgs("/tmp/lib"), ["--home", "/tmp/lib", "list", "--json", "--no-sync"]);
  assert.deepEqual(P.syncArgs("/tmp/lib"), ["--home", "/tmp/lib", "sync"]);
  assert.deepEqual(P.skillArgs(), ["skills", "verify", "--json"]);
});

test("values that start with a dash or span lines stay one argument", () => {
  const args = P.addArgs({ title: "-draft", body: "--flag\nline 'two' \"three\"", project: true });
  assert.deepEqual(args, ["add", "--title=-draft", "--body=--flag\nline 'two' \"three\"", "--project", "--json", "--no-sync"]);
  assert.ok(P.addArgs({ title: "a" }).includes("--body="));
  assert.ok(P.addArgs({ title: "a" }).includes("--global"));
});

test("an edit sends only the changed fields and the revision it read", () => {
  assert.deepEqual(P.editArgs("abc", { body: "" }, "rev1"), ["edit", "abc", "--body=", "--if-match=rev1", "--json", "--no-sync"]);
  assert.deepEqual(P.editArgs("abc", { title: "T", scope: "global" }, null), ["edit", "abc", "--title=T", "--global", "--json", "--no-sync"]);
  assert.deepEqual(P.editArgs("abc", { scope: "project" }, "r"), ["edit", "abc", "--project", "--if-match=r", "--json", "--no-sync"]);
  assert.deepEqual(P.deleteArgs("abc", "r"), ["delete", "abc", "--yes", "--if-match=r", "--json", "--no-sync"]);
});

test("changed fields compare against what plib last returned", () => {
  const base = { title: "A", body: "b", scope: "global" };
  assert.equal(P.changedFields(base, { title: "A", body: "b", scope: "global" }), null);
  assert.deepEqual(P.changedFields(base, { title: "A", body: "", scope: "project" }), { body: "", scope: "project" });
});

test("write results separate success, conflicts, missing notes and other errors", () => {
  const saved = { operation: "edit", note: { id: "1", revision: "r2" }, deleted: false, sync: { status: "skipped" } };
  assert.deepEqual(P.writeOutcome({ code: 0, stdout: JSON.stringify(saved), stderr: "" }), { ok: true, note: saved.note, deleted: false, sync: "skipped" });

  const conflict = P.writeOutcome({ code: 1, stderr: "plib: note changed", stdout: JSON.stringify({ ...saved, error: "note changed; read it again before editing (--if-match mismatch)" }) });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.note.revision, "r2");

  const gone = P.writeOutcome({ code: 1, stdout: "", stderr: 'plib: ID "abc" matches 0 notes: note not found\n' });
  assert.equal(gone.gone, true);
  assert.equal(gone.conflict, false);
  assert.equal(gone.error, 'ID "abc" matches 0 notes: note not found');

  const setup = P.writeOutcome({ code: 1, stdout: "", stderr: "plib: first run: use plib for setup\n" });
  assert.deepEqual([setup.ok, setup.conflict, setup.gone], [false, false, false]);
  assert.equal(P.writeOutcome(null).ok, false);
});

test("a missing program is told apart from other failures", () => {
  assert.equal(P.isMissingProgram(new Error("cannot start plib: program not found")), true);
  assert.equal(P.isMissingProgram("cannot start plib: No such file or directory (os error 2)"), true);
  assert.equal(P.isMissingProgram("machine ada is unreachable"), false);
  assert.equal(P.errorText(new Error("plib: boom\nmore")), "boom");
});

test("the skill verdict follows the destinations the person uses", () => {
  const report = (...statuses) => ({ verifications: statuses.map((status) => ({ status })) });
  assert.equal(P.skillVerdict(report("up-to-date", "up-to-date")), "ok");
  assert.equal(P.skillVerdict(report("up-to-date", "not-installed")), "ok");
  assert.equal(P.skillVerdict(report("up-to-date", "outdated")), "outdated");
  assert.equal(P.skillVerdict(report("not-installed", "not-installed")), "missing");
  assert.equal(P.skillVerdict(report("modified", "not-installed")), "modified");
  assert.equal(P.skillVerdict(report("up-to-date", "modified")), "ok");
  assert.equal(P.skillVerdict(null), "unknown");
  assert.equal(P.skillVerdict({ verifications: [] }), "unknown");
});

test("notes are listed newest edit first and filtered by scope and words", () => {
  const notes = [
    note("a", { updated: "2026-11-01T00:00:00Z", title: "Deploy steps", body: "run make release" }),
    note("b", { updated: "2026-11-05T00:00:00Z", project: "github.com/acme/api", title: "API todo", body: "Release notes" }),
    note("c", { updated: "2026-11-05T00:00:00Z" }),
  ];
  assert.deepEqual(P.sortNotes(notes).map((n) => n.id), ["b", "c", "a"]);
  assert.deepEqual(P.filterNotes(notes, { scope: "project" }).map((n) => n.id), ["b"]);
  assert.deepEqual(P.filterNotes(notes, { scope: "global" }).map((n) => n.id), ["a", "c"]);
  assert.deepEqual(P.filterNotes(notes, { query: "RELEASE" }).map((n) => n.id), ["a", "b"]);
  assert.deepEqual(P.filterNotes(notes, { query: "release make" }).map((n) => n.id), ["a"]);
  assert.equal(P.filterNotes(notes).length, 3);
});

test("a saved note enters, moves in or leaves a folder's list", () => {
  const list = [note("a"), note("b", { project: "github.com/acme/api" })];
  assert.deepEqual(P.upsert(list, note("c"), "github.com/acme/api").map((n) => n.id), ["c", "a", "b"]);
  assert.deepEqual(P.upsert(list, note("a", { project: "github.com/other/x" }), "github.com/acme/api").map((n) => n.id), ["b"]);
  assert.equal(P.inScope(note("x", { project: "github.com/acme/api" }), ""), false);
});

test("labels, previews, titles and ages read well", () => {
  assert.equal(P.projectLabel("github.com/illegalstudio/elephc"), "elephc");
  assert.equal(P.projectLabel(""), "");
  assert.equal(P.preview("  one\n\n two\tthree "), "one two three");
  assert.equal(P.preview("abcdef", 3), "abc…");
  assert.equal(P.titleFromBody("\n\n## Fix the *login* bug\nmore"), "Fix the *login* bug");
  assert.equal(P.titleFromBody("- [ ] call Anna"), "[ ] call Anna");
  assert.equal(P.titleFromBody("   \n"), "");
  assert.equal(P.titleFromBody("x".repeat(80)).length, 61);
  assert.equal(P.byteLength("aé€😀"), 1 + 2 + 3 + 4);
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(P.ago("2026-11-12T11:59:40Z", now), "now");
  assert.equal(P.ago("2026-11-12T11:15:00Z", now), "45m");
  assert.equal(P.ago("2026-11-12T03:00:00Z", now), "9h");
  assert.equal(P.ago("2026-11-09T12:00:00Z", now), "3d");
  assert.equal(P.ago("0001-01-01T00:00:00Z", now), "");
  assert.equal(P.ago("garbage", now), "");
  assert.match(P.ago("2026-10-02T12:00:00Z", now), /^Oct [12]$/);
  assert.match(P.ago("2025-10-02T12:00:00Z", now), /^Oct [12], 2025$/);
});

test("a panel hidden by its column or its stack does not poll", () => {
  const tree = (hidden, active) => ({ id: "root", type: "row", children: [
    { id: "main", type: "block", content: { tab: "active" } },
    { id: "panel", type: "column", hidden, children: [
      { id: "panel-body", type: "stack", active, children: [
        { id: "files", type: "block", content: { mod: "files" } },
        { id: "notes", type: "block", content: { mod: "herdr-notes" } } ] } ] } ] });
  assert.equal(P.blockVisible(tree(false, "notes"), "herdr-notes"), true);
  assert.equal(P.blockVisible(tree(true, "notes"), "herdr-notes"), false);
  assert.equal(P.blockVisible(tree(false, "files"), "herdr-notes"), false);
  assert.equal(P.blockVisible(tree(false, "files"), "other-mod"), true);
  assert.equal(P.blockVisible(null, "herdr-notes"), true);
});
