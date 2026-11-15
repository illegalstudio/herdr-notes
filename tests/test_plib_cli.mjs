// Runs the panel's argument lists against the installed plib, in a throwaway
// library. Skipped where plib is missing or older than the panel needs.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "../mods/herdr-notes/plib.js";

const probe = spawnSync("plib", P.versionArgs(), { encoding: "utf8" });
const available = !probe.error && P.versionOk(P.parseVersion(probe.stdout));

test("the panel's commands work against the installed plib", { skip: available ? false : `plib ${P.MIN_VERSION_TEXT} or newer is not installed` }, () => {
  const work = mkdtempSync(join(tmpdir(), "herdr-notes-test-"));
  const home = join(work, "library");
  const env = { ...process.env, PLIB_SUPPRESS_SKILLS_NOTICE: "1" };
  delete env.PLIB_HOME;
  const plib = (args) => {
    const r = spawnSync("plib", args, { encoding: "utf8", cwd: work, env });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  try {
    const before = P.parseJSON(plib(P.statusArgs(home)).stdout);
    assert.equal(before.initialized, false);
    assert.equal(plib(P.initArgs(home)).code, 0);
    assert.equal(P.parseJSON(plib(P.statusArgs(home)).stdout).initialized, true);

    const body = "-first line starts with a dash\nsecond 'line' \"quoted\" $HOME";
    const added = P.writeOutcome(plib(P.addArgs({ title: "-Dash title", body }, home)));
    assert.equal(added.ok, true);
    assert.equal(added.note.title, "-Dash title");
    assert.equal(added.note.body, body);
    assert.equal(added.sync, "skipped");

    const empty = P.writeOutcome(plib(P.addArgs({ title: "Title only" }, home)));
    assert.equal(empty.ok, true);
    assert.equal(empty.note.body, "");

    const listed = P.parseJSON(plib(P.listArgs(home)).stdout);
    assert.equal(listed.length, 2);
    assert.equal(listed.find((n) => n.id === added.note.id).revision, added.note.revision);

    const stale = P.writeOutcome(plib(P.editArgs(added.note.id, { body: "x" }, "0000", home)));
    assert.equal(stale.conflict, true);
    assert.equal(stale.note.revision, added.note.revision);

    const edited = P.writeOutcome(plib(P.editArgs(added.note.id, { title: "Renamed", body: "" }, added.note.revision, home)));
    assert.equal(edited.ok, true);
    assert.equal(edited.note.title, "Renamed");
    assert.equal(edited.note.body, "");
    assert.notEqual(edited.note.revision, added.note.revision);

    const noProject = P.writeOutcome(plib(P.addArgs({ title: "Scoped", project: true }, home)));
    assert.equal(noProject.ok, false);
    assert.match(noProject.error, /portable remote/);

    const staleDelete = P.writeOutcome(plib(P.deleteArgs(added.note.id, added.note.revision, home)));
    assert.equal(staleDelete.conflict, true);
    const deleted = P.writeOutcome(plib(P.deleteArgs(added.note.id, edited.note.revision, home)));
    assert.equal(deleted.ok, true);
    assert.equal(deleted.deleted, true);

    const missing = P.writeOutcome(plib(P.editArgs(added.note.id, { title: "again" }, null, home)));
    assert.equal(missing.gone, true);

    assert.equal(plib(P.syncArgs(home)).code, 0);
    assert.equal(P.parseJSON(plib(P.listArgs(home)).stdout).length, 1);
    assert.notEqual(P.skillVerdict(P.parseJSON(plib(P.skillArgs()).stdout)), "unknown");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
