import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter, updateFrontmatter } from "./practice_core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const database = process.env.MEDICAL_CODING_D1_NAME || "medical-coding-journey";
const localMode = process.argv.includes("--local");
const dryRun = process.argv.includes("--dry-run");
const push = process.argv.includes("--push");
const difficulties = ["simple", "intermediate", "complex"];
const folders = { simple: "Simple", intermediate: "Intermediate", complex: "Complex" };
const caseIdPattern = /^CASE-\d{4,}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const categories = ["icd10", "cpt", "hcpcs"];

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function runGit(args) {
  return execFileSync("git", ["-C", root, ...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function gitStatusPaths(output) {
  return new Set(String(output || "").split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim().replaceAll("\\", "/")));
}

function wranglerArgs(command) {
  return ["d1", "execute", database, ...(localMode ? [] : ["--remote"]), "--command", command, "--json"];
}

function runWrangler(args) {
  const globalWrangler = process.platform === "win32" && process.env.APPDATA
    ? join(process.env.APPDATA, "npm", "node_modules", "wrangler", "bin", "wrangler.js")
    : "";
  if (globalWrangler && existsSync(globalWrangler)) {
    return execFileSync(process.execPath, [globalWrangler, ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  }
  return execFileSync(process.platform === "win32" ? "npx.ps1" : "npx", ["wrangler", ...args], {
    cwd: root, encoding: "utf8", windowsHide: true, shell: process.platform === "win32",
  });
}

function parseWranglerJson(output) {
  const indexes = [output.indexOf("["), output.indexOf("{")].filter((index) => index >= 0);
  if (!indexes.length) throw new Error("Wrangler returned no JSON output.");
  const parsed = JSON.parse(output.slice(Math.min(...indexes)));
  const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!envelope || envelope.success === false) throw new Error("Cloudflare D1 rejected the query.");
  return Array.isArray(envelope.results) ? envelope.results : [];
}

function query(command) {
  return parseWranglerJson(runWrangler(wranglerArgs(command)));
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.sync-tmp`);
  try {
    await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }).catch(() => {}); }
}

async function listCaseFiles() {
  const files = [];
  for (const folder of difficulties.flatMap((difficulty) => [folders[difficulty], `Archive\\${folders[difficulty]}`])) {
    const directory = join(root, "Case Study", folder);
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name.endsWith(".md") && caseIdPattern.test(entry.name.slice(0, -3))) files.push(join(directory, entry.name));
    }
  }
  return files;
}

async function readLocalCases() {
  const byId = new Map();
  for (const path of await listCaseFiles()) {
    const text = await readFile(path, "utf8");
    const parsed = parseFrontmatter(text, path);
    const id = String(parsed.metadata.case_id || "");
    if (!caseIdPattern.test(id)) continue;
    if (byId.has(id)) throw new Error(`Duplicate local case ID: ${id}`);
    byId.set(id, { path, text, parsed, metadata: parsed.metadata, bodyHash: createHash("sha256").update(parsed.body).digest("hex") });
  }
  return byId;
}

function publicBody(body) {
  const lines = String(body || "").split(/\r?\n/);
  const firstAnswer = lines.findIndex((line) => /^\s*(CPT|ICD-10|HCPCS)\s*:/i.test(line));
  if (firstAnswer < 0) return String(body || "").trim();
  const tail = lines.slice(firstAnswer);
  if (tail.every((line) => !line.trim() || /^\s*(CPT|ICD-10|HCPCS)\s*:\s*$/i.test(line))) return lines.slice(0, firstAnswer).join("\n").trim();
  throw new Error("Cloud case contains populated answer fields; refusing to copy them into a public note.");
}

function targetPath(difficulty, caseId, completed) {
  const parent = completed ? join(root, "Case Study", "Archive", folders[difficulty]) : join(root, "Case Study", folders[difficulty]);
  return join(parent, `${caseId}.md`);
}

function frontmatterFor(row, body, completed) {
  return [
    "---",
    "type: case-study",
    `case_id: ${row.case_id}`,
    `difficulty: ${row.difficulty}`,
    `coding_area: ${row.coding_area || "general"}`,
    `specialty: ${row.specialty || "general"}`,
    `status: ${completed ? "completed" : "pending"}`,
    `date: ${completed ? row.completed_date : ""}`,
    `generated_date: ${row.generated_date || ""}`,
    "time:",
    "Google Help:",
    "---",
    "",
    publicBody(body),
    "",
  ].join("\n") + "\n";
}

async function moveSafely(source, destination, content) {
  if (resolve(source) === resolve(destination)) {
    if (content !== await readFile(source, "utf8")) await writeFile(source, content, "utf8");
    return;
  }
  if (await exists(destination)) throw new Error(`Destination already exists: ${relative(root, destination)}`);
  const backup = join(dirname(source), `.${basename(source)}.${randomUUID()}.sync-backup`);
  await rename(source, backup);
  try {
    await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
    await rm(backup, { force: true });
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {});
    await rename(backup, source).catch(() => {});
    throw error;
  }
}

function normalizedAnswers(answerRows) {
  const result = Object.fromEntries(categories.map((category) => [category, []]));
  for (const row of answerRows) if (result[row.coding_system]) result[row.coding_system].push(String(row.answer_value));
  return result;
}

async function loadAnswerKey(difficulty) {
  const path = join(root, ".case-generator", "answer_keys", `${difficulty}.json`);
  if (!(await exists(path))) return { path, value: { version: 1, difficulty, cases: {} } };
  return { path, value: JSON.parse(await readFile(path, "utf8")) };
}

async function loadCaseRegistry() {
  const path = join(root, ".case-generator", "case_registry.json");
  const text = await readFile(path, "utf8");
  return { path, text, value: JSON.parse(text) };
}

function registryEntry(row, current, path) {
  return current || {
    case_id: row.case_id,
    path,
    generated_date: row.generated_date || "",
    request_type: "cloud-sync",
    difficulty: row.difficulty,
    coding_area: row.coding_area || "general",
    specialty: row.specialty || "general",
    patient_demographic: "",
    presentation: "",
    diagnoses: [],
    procedures_or_services: [],
  };
}

function answersForCase(answerRows, caseId) {
  return answerRows.filter((row) => row.case_id === caseId);
}

async function main() {
  const preexistingGitPaths = push && !dryRun
    ? gitStatusPaths(runGit(["status", "--porcelain=v1", "--untracked-files=all"]))
    : new Set();
  const cloudCases = query("SELECT case_id,difficulty,coding_area,specialty,clinical_markdown,status,generated_date,completed_date,source_path,case_hash FROM cases ORDER BY case_id;");
  const cloudAnswers = query("SELECT case_id,coding_system,answer_value,answer_order FROM answers WHERE is_current=1 ORDER BY case_id,coding_system,answer_order;");
  const localCases = await readLocalCases();
  const registry = await loadCaseRegistry();
  if (!Array.isArray(registry.value.cases)) throw new Error("case_registry.json must contain a cases array.");
  const keys = new Map();
  for (const difficulty of difficulties) keys.set(difficulty, await loadAnswerKey(difficulty));
  const conflicts = [];
  const changedPaths = new Set();
  let created = 0;
  let completed = 0;
  for (const row of cloudCases) {
    if (!caseIdPattern.test(String(row.case_id)) || !difficulties.includes(String(row.difficulty))) continue;
    const difficulty = String(row.difficulty);
    const isCompleted = row.status === "completed";
    if (isCompleted && !datePattern.test(String(row.completed_date || ""))) {
      conflicts.push(`${row.case_id}: cloud completion has no valid completed_date`);
      continue;
    }
    const key = keys.get(difficulty).value;
    key.difficulty = difficulty;
    key.cases ??= {};
    key.cases[row.case_id] = { ...normalizedAnswers(answersForCase(cloudAnswers, row.case_id)) };
    const target = targetPath(difficulty, row.case_id, isCompleted);
    const local = localCases.get(row.case_id);
    if (local) {
      if (row.case_hash && local.bodyHash !== row.case_hash) {
        conflicts.push(`${row.case_id}: local clinical body differs from cloud; metadata was not changed`);
        continue;
      }
      const localStatus = String(local.metadata.status || "pending").toLowerCase();
      if (!isCompleted && localStatus === "completed") continue;
      const updates = {};
      if (isCompleted) {
        updates.status = "completed";
        updates.date = row.completed_date;
      } else {
        if (localStatus !== "pending") updates.status = "pending";
        if (local.metadata.date != null) updates.date = null;
      }
      if (row.generated_date && String(local.metadata.generated_date || "") !== String(row.generated_date)) updates.generated_date = row.generated_date;
      const updated = Object.keys(updates).length
        ? updateFrontmatter(local.text, updates, relative(root, local.path))
        : local.text;
      if (!dryRun) await moveSafely(local.path, target, updated);
      if (resolve(local.path) !== resolve(target)) changedPaths.add(relative(root, local.path).replaceAll("\\", "/"));
      if (updated !== local.text || resolve(local.path) !== resolve(target)) changedPaths.add(relative(root, target).replaceAll("\\", "/"));
      if (isCompleted) completed += 1;
    } else {
      const content = frontmatterFor(row, row.clinical_markdown, isCompleted);
      if (!dryRun) {
        if (await exists(target)) throw new Error(`Destination already exists: ${relative(root, target)}`);
        await writeAtomic(target, content);
      }
      changedPaths.add(relative(root, target).replaceAll("\\", "/"));
      created += 1;
      if (isCompleted) completed += 1;
    }
    const relativeTarget = relative(root, target).replaceAll("\\", "/");
    const existing = registry.value.cases.find((item) => item?.case_id === row.case_id);
    const entry = registryEntry(row, existing, relativeTarget);
    entry.path = relativeTarget;
    entry.generated_date = row.generated_date || entry.generated_date;
    if (!existing) registry.value.cases.push(entry);
  }
  for (const { path, value } of keys.values()) if (!dryRun) await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
  if (!dryRun) {
    const registryText = `${JSON.stringify(registry.value, null, 2)}\n`;
    if (registryText !== registry.text) {
      await writeAtomic(registry.path, registryText);
      changedPaths.add(".case-generator/case_registry.json");
    }
  }
  if (push && !dryRun && changedPaths.size) {
    const expected = [...changedPaths];
    const preexisting = expected.filter((path) => preexistingGitPaths.has(path));
    if (preexisting.length) throw new Error(`Refusing to push because synchronized paths already had local changes: ${preexisting.join(", ")}`);
    runGit(["add", "-A", "--", ...expected]);
    if (!runGit(["diff", "--cached", "--name-only"])) throw new Error("No synchronized changes were staged.");
    runGit(["commit", "-m", "Sync cloud case completions"]);
    runGit(["push", "origin", "HEAD"]);
  }
  console.log(`Cloud-to-local sync complete: ${cloudCases.length} cloud cases checked, ${created} local notes created, ${completed} completed cases reconciled.`);
  if (conflicts.length) {
    console.warn("Conflicts requiring review:");
    for (const conflict of conflicts) console.warn(`- ${conflict}`);
  }
  if (push && !dryRun && changedPaths.size) console.log("Synchronized case changes were committed and pushed to GitHub.");
  else if (changedPaths.size) console.log("Local files were updated. Review with git diff, then commit and push when ready.");
}

main().catch((error) => { console.error(`Cloud-to-local sync failed: ${error.message}`); process.exitCode = 1; });
