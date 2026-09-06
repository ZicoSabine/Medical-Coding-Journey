import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PracticeError, PracticeRepository, answersMatch, normalizeAnswer,
  parseFrontmatter, updateFrontmatter,
} from "../scripts/practice_core.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "medical-coding-practice-"));
  for (const folder of ["Simple", "Intermediate", "Complex", "Archive/Simple", "Archive/Intermediate", "Archive/Complex"]) {
    await mkdir(join(root, "Case Study", folder), { recursive: true });
  }
  await mkdir(join(root, ".case-generator"), { recursive: true });
  await writeFile(join(root, ".case-generator", "case_registry.json"), JSON.stringify({ version: 1, next_case_number: 2, cases: [] }, null, 2));
  await writeFile(join(root, ".case-generator", "answer_registry.json"), JSON.stringify({ version: 1, cases: {} }, null, 2));
  let now = Date.parse("2026-09-05T10:00:00.000Z");
  const repository = new PracticeRepository(root, { today: () => "2026-09-05", random: () => 0, now: () => now });
  const advance = (milliseconds) => { now += milliseconds; };
  return { root, repository, advance, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function caseText({ id = "CASE-0001", difficulty = "simple", status = "pending", date = "", body = null } = {}) {
  return `---\ntype: case-study\ncase_id: ${id}\ndifficulty: ${difficulty}\ncoding_area: Emergency department\nspecialty: Cardiology\nstatus: ${status}\ndate: ${date}\ngenerated_date: 2026-09-05\ntime:\nGoogle Help:\n---\n\n${body ?? "# Case Brief\n\n**Patient:** A.B.\n\nThe right wrist was evaluated with radiographs.\n\n## Your Task\n\nUsing your current coding references, review the clinical documentation and determine the applicable coding based solely on the information provided."}\n`;
}

async function addCase(setup, options = {}, answers = { icd10: ["S52.501A"], cpt: ["73110"] }) {
  const difficulty = options.difficulty ?? "simple";
  const folder = difficulty[0].toUpperCase() + difficulty.slice(1);
  const id = options.id ?? "CASE-0001";
  const path = join(setup.root, "Case Study", folder, `${id}.md`);
  await writeFile(path, caseText({ ...options, id, difficulty }));
  const registryPath = join(setup.root, ".case-generator", "case_registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  registry.cases.push({ case_id: id, path: `Case Study/${folder}/${id}.md`, difficulty });
  await writeFile(registryPath, JSON.stringify(registry, null, 2));
  const answerPath = join(setup.root, ".case-generator", "answer_registry.json");
  const answerRegistry = JSON.parse(await readFile(answerPath, "utf8"));
  answerRegistry.cases[id] = { ...answers, correction_history: [] };
  await writeFile(answerPath, JSON.stringify(answerRegistry, null, 2));
  return path;
}

test("frontmatter parsing detects duplicates and preserves unrelated metadata on update", () => {
  const text = caseText();
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.metadata.case_id, "CASE-0001");
  const updated = updateFrontmatter(text, { status: "completed", date: "2026-09-05" });
  assert.match(updated, /specialty: Cardiology/);
  assert.match(updated, /status: completed/);
  assert.match(updated, /date: 2026-09-05/);
  assert.throws(() => parseFrontmatter(text.replace("status: pending", "status: pending\nstatus: completed")), /duplicate/i);
});

test("comparison normalizes only superficial differences and ignores entry order", () => {
  assert.equal(normalizeAnswer("  s52.501a  "), "S52.501A");
  assert.equal(answersMatch([" s52.501a", " 73110 "], ["73110", "S52.501A"]), true);
  assert.equal(answersMatch(["S52.501D"], ["S52.501A"]), false);
});

test("selection is random within the requested folder and never reveals system answers", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await addCase(setup);
  const selected = await setup.repository.select("simple");
  assert.equal(selected.case.caseId, "CASE-0001");
  assert.equal(selected.case.difficulty, "simple");
  assert.deepEqual(selected.case.categories, ["icd10", "cpt"]);
  assert.equal("systemAnswers" in selected.case, false);
  assert.doesNotMatch(JSON.stringify(selected.case), /S52\.501A|73110/);
  assert.equal(selected.case.startedAt, "2026-09-05T10:00:00.000Z");
});

test("cancelling discards the session, keeps the case pending, and records no solve time", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  const source = await addCase(setup);
  await setup.repository.select("simple");
  setup.advance(90_000);
  const cancelled = await setup.repository.cancel();
  assert.equal(cancelled.caseId, "CASE-0001");
  assert.equal(await setup.repository.session(), null);
  assert.match(await readFile(source, "utf8"), /status: pending/);
  assert.equal((await setup.repository.dashboard()).stats.averageSolveSeconds, null);
});

test("public answer fields are blocked before a case is displayed", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await addCase(setup, { body: "# Case\n\nCPT: 73110\nICD-10: S52.501A\nHCPCS:" });
  await assert.rejects(() => setup.repository.select("simple"), (error) => error instanceof PracticeError && error.code === "ANSWER_IN_PUBLIC_CASE");
});

test("checking reveals answers only after confirmation endpoint and stores raw input", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await addCase(setup);
  await setup.repository.select("simple");
  const checked = await setup.repository.check({ icd10: ["  s52.501a "], cpt: ["73110"] });
  assert.deepEqual(checked.systemAnswers, { icd10: ["S52.501A"], cpt: ["73110"] });
  assert.deepEqual(checked.userAnswers.icd10, ["s52.501a"]);
  assert.deepEqual(checked.comparisonResults, { icd10: true, cpt: true });
  assert.equal(checked.phase, "reviewing");
});

test("manual verification supports every correctness combination and requires corrections", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await addCase(setup);
  await setup.repository.select("simple");
  await setup.repository.check({ icd10: ["S52.501D"], cpt: ["73110"] });
  const incomplete = await setup.repository.verify({
    icd10: { userCorrect: false, systemCorrect: false },
    cpt: { userCorrect: true, systemCorrect: true },
  }, { icd10: [""] });
  assert.equal(incomplete.isResolved, false);
  assert.ok(incomplete.unresolved.some((message) => message.includes("corrected authoritative")));
  const resolved = await setup.repository.verify({
    icd10: { userCorrect: false, systemCorrect: false },
    cpt: { userCorrect: true, systemCorrect: true },
  }, { icd10: ["S52.502A"] });
  assert.equal(resolved.isResolved, true);
});

test("checking alone never permits archiving", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  const source = await addCase(setup);
  await setup.repository.select("simple");
  await setup.repository.check({ icd10: ["S52.501A"], cpt: ["73110"] });
  await assert.rejects(() => setup.repository.complete("home"), (error) => error.code === "UNRESOLVED_CASE");
  assert.equal(await readFile(source, "utf8").then(() => true), true);
});

test("completion records history, corrects the key, updates metadata, and archives safely", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  const source = await addCase(setup);
  await setup.repository.select("simple");
  await setup.repository.check({ icd10: ["S52.502A"], cpt: ["73110"] });
  await setup.repository.verify({
    icd10: { userCorrect: true, systemCorrect: false },
    cpt: { userCorrect: true, systemCorrect: true },
  }, { icd10: ["S52.502A"] });
  setup.advance(125_000);
  const completed = await setup.repository.complete("home");
  assert.equal(completed.completed, true);
  await assert.rejects(() => readFile(source, "utf8"), /ENOENT/);
  const archivedPath = join(setup.root, "Case Study", "Archive", "Simple", "CASE-0001.md");
  const archived = await readFile(archivedPath, "utf8");
  assert.match(archived, /status: completed/);
  assert.match(archived, /date: 2026-09-05/);
  const result = JSON.parse(await readFile(join(setup.root, ".case-generator", "results", "CASE-0001.json"), "utf8"));
  assert.deepEqual(result.user_answers_raw.icd10, ["S52.502A"]);
  assert.deepEqual(result.original_system_answers.icd10, ["S52.501A"]);
  assert.deepEqual(result.authoritative_answers.icd10, ["S52.502A"]);
  assert.equal(result.solve_duration_seconds, 125);
  const answers = JSON.parse(await readFile(join(setup.root, ".case-generator", "answer_registry.json"), "utf8"));
  assert.deepEqual(answers.cases["CASE-0001"].icd10, ["S52.502A"]);
  assert.equal(answers.cases["CASE-0001"].correction_history.length, 1);
  const registry = JSON.parse(await readFile(join(setup.root, ".case-generator", "case_registry.json"), "utf8"));
  assert.equal(registry.cases[0].path, "Case Study/Archive/Simple/CASE-0001.md");
  assert.equal(completed.dashboard.stats.totalCompleted, 1);
  assert.equal(completed.dashboard.stats.averageSolveSeconds, 125);
  assert.equal(completed.dashboard.stats.timedCases, 1);
});

test("next case preserves resolved difficulty and handles an empty queue", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await addCase(setup);
  await setup.repository.select("simple");
  await setup.repository.check({ icd10: ["S52.501A"], cpt: ["73110"] });
  await setup.repository.verify({
    icd10: { userCorrect: true, systemCorrect: true },
    cpt: { userCorrect: true, systemCorrect: true },
  }, {});
  const completed = await setup.repository.complete("next");
  assert.equal(completed.noMore, true);
  assert.equal(completed.difficulty, "simple");
});

test("a publication preflight failure never rolls back local completion", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await addCase(setup);
  await setup.repository.select("simple");
  await setup.repository.check({ icd10: ["S52.501A"], cpt: ["73110"] });
  await setup.repository.verify({
    icd10: { userCorrect: true, systemCorrect: true },
    cpt: { userCorrect: true, systemCorrect: true },
  }, {});
  const completed = await setup.repository.complete("home", true);
  assert.equal(completed.publication.status, "failed");
  assert.match(completed.publication.message, /saved locally/i);
  const archived = await readFile(join(setup.root, "Case Study", "Archive", "Simple", "CASE-0001.md"), "utf8");
  assert.match(archived, /status: completed/);
});

test("missing keys, duplicate IDs, and no pending cases fail without fabrication", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  await assert.rejects(() => setup.repository.select("complex"), (error) => error.code === "NO_CASES");
  await addCase(setup);
  const answersPath = join(setup.root, ".case-generator", "answer_registry.json");
  await writeFile(answersPath, JSON.stringify({ version: 1, cases: {} }));
  await assert.rejects(() => setup.repository.select("simple"), (error) => error.code === "MISSING_ANSWER_KEY");
  await writeFile(join(setup.root, "Case Study", "Archive", "Simple", "duplicate.md"), caseText({ status: "completed", date: "2026-09-04" }));
  await assert.rejects(() => setup.repository.select("simple"), (error) => ["MISSING_ANSWER_KEY", "DUPLICATE_CASE_ID"].includes(error.code));
});

test("request more creates one consumable 100-case request per difficulty", async (t) => {
  const setup = await fixture();
  t.after(setup.cleanup);
  const first = await setup.repository.requestMore("intermediate");
  const second = await setup.repository.requestMore("intermediate");
  assert.equal(first.request.count, 100);
  assert.equal(first.request.difficulty, "intermediate");
  assert.equal(second.duplicate, true);
  const queue = JSON.parse(await readFile(join(setup.root, ".case-generator", "generation_requests.json"), "utf8"));
  assert.equal(queue.requests.length, 1);
  assert.equal(queue.requests[0].status, "pending");
});

test("opt-in publication commits only the completed case and registry, then pushes", async (t) => {
  const setup = await fixture();
  const remote = await mkdtemp(join(tmpdir(), "medical-coding-remote-"));
  t.after(setup.cleanup);
  t.after(() => rm(remote, { recursive: true, force: true }));
  await addCase(setup);
  await writeFile(join(setup.root, ".gitignore"), [
    ".case-generator/answer_registry.json",
    ".case-generator/practice_session.json",
    ".case-generator/results/",
    ".case-generator/generation_requests.json",
    "",
  ].join("\n"));
  const git = (args, cwd = setup.root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Practice Test"]);
  git(["config", "user.email", "practice@example.invalid"]);
  git(["add", "-A"]);
  git(["commit", "-m", "Initial fixture"]);
  git(["init", "--bare", remote]);
  git(["remote", "add", "origin", remote]);
  git(["push", "-u", "origin", "main"]);

  assert.equal(setup.repository.config().publication.available, true);
  await setup.repository.select("simple");
  await setup.repository.check({ icd10: ["S52.501A"], cpt: ["73110"] });
  await setup.repository.verify({
    icd10: { userCorrect: true, systemCorrect: true },
    cpt: { userCorrect: true, systemCorrect: true },
  }, {});
  const completed = await setup.repository.complete("home", true);
  assert.equal(completed.publication.status, "pushed");
  assert.equal(git(["log", "-1", "--pretty=%s"]), "Complete CASE-0001");
  assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all"]), "");
  const committedPaths = git(["diff-tree", "--no-renames", "--no-commit-id", "--name-only", "-r", "HEAD"]).split(/\r?\n/);
  assert.deepEqual(new Set(committedPaths), new Set([
    ".case-generator/case_registry.json",
    "Case Study/Archive/Simple/CASE-0001.md",
    "Case Study/Simple/CASE-0001.md",
  ]));
  assert.equal(git(["rev-parse", "HEAD"]), git(["rev-parse", "refs/heads/main"], remote));
});
