import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access, mkdir, lstat, readFile, readdir, rename, rm, writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  DIFFICULTIES, REQUIRED_CATEGORIES, answersMatch, cleanAnswerList,
  normalizeAnswer, normalizedAnswerList,
} from "./study_rules.mjs";

export { DIFFICULTIES, REQUIRED_CATEGORIES, answersMatch, cleanAnswerList, normalizeAnswer, normalizedAnswerList };

export const DIFFICULTY_FOLDERS = Object.freeze({
  simple: "Simple",
  intermediate: "Intermediate",
  complex: "Complex",
});
const CASE_ID_PATTERN = /^CASE-\d{4,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TEMPLATE_PATTERN = /(?:^|[\s_-])templates?(?:$|[\s_-])/i;
const execFileAsync = promisify(execFile);

export class PracticeError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "PracticeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function ensureObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PracticeError("INVALID_DATA", message);
  }
  return value;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "~") return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

export function parseFrontmatter(text, label = "case file") {
  if (typeof text !== "string") throw new PracticeError("INVALID_CASE", `${label}: expected text.`);
  const source = text.replace(/^\uFEFF/, "");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new PracticeError("INVALID_CASE", `${label}: frontmatter must begin with ---.`);
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) {
    throw new PracticeError("INVALID_CASE", `${label}: frontmatter is missing its closing --- delimiter.`);
  }
  const metadata = {};
  const keyLines = new Map();
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith("#")) continue;
    const match = /^([^:#][^:]*):(?:\s*(.*))$/.exec(line);
    if (!match) {
      throw new PracticeError("INVALID_CASE", `${label}: invalid frontmatter line ${index + 1}.`);
    }
    const key = match[1].trim();
    if (Object.hasOwn(metadata, key)) {
      throw new PracticeError("DUPLICATE_PROPERTY", `${label}: duplicate frontmatter property ${key}.`);
    }
    metadata[key] = parseScalar(match[2]);
    keyLines.set(key, index);
  }
  return { source, eol, lines, closing, metadata, keyLines, body: lines.slice(closing + 1).join(eol).trim() };
}

export function updateFrontmatter(text, updates, label = "case file") {
  const parsed = parseFrontmatter(text, label);
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}: ${value ?? ""}`;
    if (parsed.keyLines.has(key)) parsed.lines[parsed.keyLines.get(key)] = line;
    else {
      parsed.lines.splice(parsed.closing, 0, line);
      parsed.closing += 1;
    }
  }
  return parsed.lines.join(parsed.eol);
}

function validCalendarDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function publicCaseBody(body, label) {
  const lines = body.split(/\r?\n/);
  const answerIndexes = [];
  let hasEmbeddedAnswer = false;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(CPT|ICD-10|HCPCS)\s*:\s*(.*?)\s*$/i.exec(lines[index]);
    if (!match) continue;
    answerIndexes.push(index);
    if (match[2]) hasEmbeddedAnswer = true;
  }
  if (hasEmbeddedAnswer) {
    throw new PracticeError(
      "ANSWER_IN_PUBLIC_CASE",
      `${label}: an answer appears in the public case file. Move it to .case-generator/answer_registry.json before studying this case.`,
      409,
    );
  }
  if (answerIndexes.length) {
    const first = answerIndexes[0];
    const tailIsOnlyAnswerFields = lines.slice(first).every((line) => !line.trim() || /^\s*(CPT|ICD-10|HCPCS)\s*:\s*$/i.test(line));
    if (tailIsOnlyAnswerFields) return lines.slice(0, first).join("\n").trim();
  }
  return body.trim();
}

function relativePath(root, path) {
  const result = relative(root, path).replaceAll("\\", "/");
  if (!result || result.startsWith("../") || isAbsolute(result)) {
    throw new PracticeError("UNSAFE_PATH", "A case path escaped the Medical Coding repository.", 500);
  }
  return result;
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

async function realDirectory(path, label) {
  let stats;
  try { stats = await lstat(path); } catch {
    throw new PracticeError("MISSING_CASE_FOLDER", `${label} is missing. Create it in the Obsidian vault and try again.`, 409);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new PracticeError("MISSING_CASE_FOLDER", `${label} must be a real local directory, not a link.`, 409);
  }
}

async function markdownFiles(root) {
  await realDirectory(root, relative(root, root) || basename(root));
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || TEMPLATE_PATTERN.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
    }
  }
  await walk(root);
  return files;
}

function formatIssue(error, path, root) {
  return `${relativePath(root, path)}: ${error.message.replace(/^.*?:\s*/, "")}`;
}

function requiredString(metadata, key, label) {
  const value = metadata[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new PracticeError("INVALID_CASE", `${label}: ${key} must be a non-empty text value.`);
  }
  return value.trim();
}

function caseRecord(path, root, text) {
  const rel = relativePath(root, path);
  const parsed = parseFrontmatter(text, rel);
  if (parsed.metadata.type !== "case-study") {
    throw new PracticeError("INVALID_CASE", `${rel}: type must be case-study.`);
  }
  const caseId = requiredString(parsed.metadata, "case_id", rel);
  if (!CASE_ID_PATTERN.test(caseId)) {
    throw new PracticeError("INVALID_CASE", `${rel}: case_id must look like CASE-0001.`);
  }
  const difficulty = requiredString(parsed.metadata, "difficulty", rel).toLowerCase();
  if (!DIFFICULTIES.includes(difficulty)) {
    throw new PracticeError("INVALID_CASE", `${rel}: difficulty must be simple, intermediate, or complex.`);
  }
  const status = requiredString(parsed.metadata, "status", rel).toLowerCase();
  if (!["pending", "not-started", "in-progress", "completed"].includes(status)) {
    throw new PracticeError("INVALID_CASE", `${rel}: status is not supported.`);
  }
  const completionDate = parsed.metadata.date == null ? null : String(parsed.metadata.date);
  if (completionDate && !validCalendarDate(completionDate)) {
    throw new PracticeError("INVALID_CASE", `${rel}: date must be YYYY-MM-DD.`);
  }
  if (status === "completed" && !completionDate) {
    throw new PracticeError("INVALID_CASE", `${rel}: completed cases require a completion date.`);
  }
  return {
    path,
    relativePath: rel,
    caseId,
    difficulty,
    status,
    completionDate,
    codingArea: typeof parsed.metadata.coding_area === "string" ? parsed.metadata.coding_area : "",
    specialty: typeof parsed.metadata.specialty === "string" ? parsed.metadata.specialty : "",
    body: parsed.body,
    text,
  };
}

function systemAnswerRecord(registry, caseId, difficulty) {
  const cases = ensureObject(registry.cases, "Answer registry must contain a cases object.");
  const entry = cases[caseId];
  if (!entry) {
    throw new PracticeError("MISSING_ANSWER_KEY", "No answer key is available for this case.", 409, { caseId });
  }
  const result = {};
  for (const category of REQUIRED_CATEGORIES[difficulty]) {
    if (!Array.isArray(entry[category])) {
      throw new PracticeError("MISSING_ANSWER_KEY", `No ${category.toUpperCase()} answer key is available for this case.`, 409, { caseId, category });
    }
    result[category] = cleanAnswerList(entry[category]);
  }
  return result;
}

function calculateStreak(activity, today) {
  const positive = (day) => Number(activity[day] ?? 0) > 0;
  const date = new Date(`${today}T00:00:00Z`);
  if (!positive(today)) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (!positive(date.toISOString().slice(0, 10))) return 0;
  }
  let count = 0;
  while (positive(date.toISOString().slice(0, 10))) {
    count += 1;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return count;
}

function casesThisWeek(activity, today) {
  const cursor = new Date(`${today}T00:00:00Z`);
  const mondayOffset = (cursor.getUTCDay() + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - mondayOffset);
  let count = 0;
  for (let index = 0; index < 7; index += 1) {
    count += Number(activity[cursor.toISOString().slice(0, 10)] ?? 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function clueOptions(record) {
  const body = record.body.toLowerCase();
  const clues = ["Re-read the assessment and identify every diagnosis explicitly confirmed in the documentation."];
  if (/\b(left|right|bilateral)\b/.test(body)) clues.push("Reconsider the documented laterality and whether it belongs in the final code selection.");
  if (/\b(initial|subsequent|sequela|encounter)\b/.test(body)) clues.push("Review the documented encounter circumstances before finalizing the diagnosis selection.");
  if (/\b(procedure|performed|radiograph|imaging|test|administered|suppl|device|injection|surgery)\w*\b/.test(body)) clues.push("Look again at which procedures, services, or supplies were actually documented as performed.");
  if (/\bhistory|secondary|comorbid|underlying\b/.test(body)) clues.push("Consider whether a secondary condition affected care or is only historical context.");
  if (record.difficulty === "intermediate") clues.push("Review whether a separately documented supply or service supports the HCPCS portion of this case.");
  return [...new Set(clues)];
}

function publicSession(record, session, systemAnswers = null) {
  const payload = {
    caseId: record.caseId,
    difficulty: record.difficulty,
    codingArea: record.codingArea,
    specialty: record.specialty,
    casePath: record.relativePath,
    body: publicCaseBody(record.body, record.relativePath),
    categories: REQUIRED_CATEGORIES[record.difficulty],
    phase: session.phase,
    userAnswers: session.userAnswers ?? Object.fromEntries(REQUIRED_CATEGORIES[record.difficulty].map((key) => [key, [""]])),
    comparisonResults: session.comparisonResults ?? {},
    verificationStates: session.verificationStates ?? {},
    correctedAnswers: session.correctedAnswers ?? {},
    clueUsage: session.clueUsage ?? 0,
    startedAt: session.startedAt,
    isResolved: session.phase === "resolved",
  };
  if (systemAnswers) payload.systemAnswers = systemAnswers;
  return payload;
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

async function writeJsonAtomic(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path, missingCode, missingMessage) {
  let text;
  try { text = await readFile(path, "utf8"); } catch (error) {
    if (error.code === "ENOENT") throw new PracticeError(missingCode, missingMessage, 409);
    throw error;
  }
  try { return { text, value: ensureObject(JSON.parse(text), `${basename(path)} must contain a JSON object.`) }; } catch (error) {
    if (error instanceof PracticeError) throw error;
    throw new PracticeError("INVALID_DATA", `${basename(path)} contains invalid JSON.`, 409);
  }
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function githubUsername(root) {
  try {
    const remote = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const match = /github\.com[/:]([^/]+)\/[^/]+?(?:\.git)?$/i.exec(remote);
    return match?.[1] ?? null;
  } catch { return null; }
}

function gitOutput(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  }).trim();
}

function publicationReadiness(root) {
  try {
    if (gitOutput(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
      return { available: false, reason: "The Medical Coding folder is not a Git repository." };
    }
    const branch = gitOutput(root, ["branch", "--show-current"]);
    if (!branch) return { available: false, reason: "Check out a named Git branch before publishing." };
    if (branch !== "main") return { available: false, branch, reason: "Check out main so the dashboard deployment workflow will run after the push." };
    gitOutput(root, ["remote", "get-url", "origin"]);
    if (!gitOutput(root, ["config", "user.name"]) || !gitOutput(root, ["config", "user.email"])) {
      return { available: false, branch, reason: "Configure your Git name and email before publishing." };
    }
    const upstream = gitOutput(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if (upstream !== `origin/${branch}`) {
      return { available: false, branch, reason: `Set origin/${branch} as this branch's upstream before publishing.` };
    }
    const [behind, ahead] = gitOutput(root, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]).split(/\s+/).map(Number);
    if (behind || ahead) {
      return { available: false, branch, reason: "Synchronize the current branch with origin before enabling per-case publishing." };
    }
    const status = gitOutput(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status) {
      return {
        available: false,
        branch,
        reason: "Commit or set aside the current repository changes before enabling per-case publishing.",
      };
    }
    return { available: true, branch, remote: "origin", reason: "" };
  } catch {
    return { available: false, reason: "Git or the origin remote is not available for publishing." };
  }
}

export class PracticeRepository {
  constructor(root, options = {}) {
    this.root = resolve(root);
    this.caseRoot = join(this.root, "Case Study");
    this.generatorRoot = join(this.root, ".case-generator");
    this.answerKeysRoot = join(this.generatorRoot, "answer_keys");
    this.answerRegistryPath = join(this.generatorRoot, "answer_registry.json");
    this.caseRegistryPath = join(this.generatorRoot, "case_registry.json");
    this.sessionPath = join(this.generatorRoot, "practice_session.json");
    this.requestsPath = join(this.generatorRoot, "generation_requests.json");
    this.resultsRoot = join(this.generatorRoot, "results");
    this.today = options.today ?? (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.lock = Promise.resolve();
  }

  async _withLock(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolveLock) => { release = resolveLock; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  config() {
    return {
      local: true,
      githubUsername: githubUsername(this.root),
      publication: publicationReadiness(this.root),
    };
  }

  async _git(args) {
    return execFileAsync("git", ["-C", this.root, ...args], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
    }).then(({ stdout }) => stdout.trim());
  }

  async _savePublication(resultPath, result, publication) {
    result.publication = publication;
    await writeJsonAtomic(resultPath, result);
    return publication;
  }

  async _publishPreparedResult(resultPath, result, allowCompletionChanges = false) {
    const publication = result.publication;
    const expected = [publication.source_path, publication.archive_path, publication.registry_path];
    const branch = publication.branch || gitOutput(this.root, ["branch", "--show-current"]);
    if (!branch) {
      return this._savePublication(resultPath, result, {
        ...publication,
        status: "failed",
        retryable: true,
        message: "The case was saved locally, but publishing needs a named Git branch.",
      });
    }

    if (publication.status === "committed" && publication.commit_sha) {
      const head = await this._git(["rev-parse", "HEAD"]).catch(() => "");
      if (head !== publication.commit_sha) {
        return this._savePublication(resultPath, result, {
          ...publication,
          status: "failed",
          retryable: false,
          message: "The case commit is no longer the current commit. Push it manually to avoid publishing unrelated work.",
        });
      }
      try {
        await this._git(["push", "origin", branch]);
        return this._savePublication(resultPath, result, {
          ...publication,
          status: "pushed",
          retryable: false,
          branch,
          pushed_at: new Date().toISOString(),
          message: "The completed case was committed and pushed to GitHub.",
        });
      } catch {
        return this._savePublication(resultPath, result, {
          ...publication,
          status: "committed",
          retryable: true,
          branch,
          message: "The case was committed locally, but the push failed. Check GitHub authentication or connectivity and retry.",
        });
      }
    }

    const changedOutput = await Promise.all([
      this._git(["diff", "--name-only", "-z"]),
      this._git(["diff", "--cached", "--name-only", "-z"]),
      this._git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const changedPaths = [...new Set(changedOutput.flatMap((output) => output.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"))))];
    if (!allowCompletionChanges && changedPaths.length === 0) {
      return this._savePublication(resultPath, result, {
        ...publication,
        status: "failed",
        retryable: false,
        message: "No unpublished completion changes were found. Check GitHub before retrying.",
      });
    }
    if (changedPaths.length) {
      const unexpected = changedPaths.filter((path) => !expected.includes(path));
      if (unexpected.length) {
        return this._savePublication(resultPath, result, {
          ...publication,
          status: "failed",
          retryable: true,
          message: "The case was saved locally, but other repository changes must be committed or set aside before publishing it.",
        });
      }
    }

    try {
      await this._git(["add", "-A", "--", ...expected]);
      const staged = (await this._git(["diff", "--cached", "--name-only", "-z"]))
        .split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
      const unexpectedStaged = staged.filter((path) => !expected.includes(path));
      if (unexpectedStaged.length || !staged.includes(publication.archive_path) || !staged.includes(publication.registry_path)) {
        await this._git(["restore", "--staged", "--", ...expected]).catch(() => {});
        return this._savePublication(resultPath, result, {
          ...publication,
          status: "failed",
          retryable: true,
          message: "Git staging did not match the completed case files, so nothing was committed.",
        });
      }
      await this._git(["commit", "-m", `Complete ${result.case_id}`]);
    } catch {
      await this._git(["restore", "--staged", "--", ...expected]).catch(() => {});
      return this._savePublication(resultPath, result, {
        ...publication,
        status: "failed",
        retryable: true,
        message: "The case was saved locally, but Git could not create the commit. Check your Git name and email configuration.",
      });
    }

    const commitSha = await this._git(["rev-parse", "HEAD"]);
    const committed = await this._savePublication(resultPath, result, {
      ...publication,
      status: "committed",
      retryable: true,
      branch,
      commit_sha: commitSha,
      committed_at: new Date().toISOString(),
      message: "The case was committed locally and is ready to push.",
    });
    try {
      await this._git(["push", "origin", branch]);
      return this._savePublication(resultPath, result, {
        ...committed,
        status: "pushed",
        retryable: false,
        pushed_at: new Date().toISOString(),
        message: "The completed case was committed and pushed to GitHub.",
      });
    } catch {
      return this._savePublication(resultPath, result, {
        ...committed,
        message: "The case was committed locally, but the push failed. Check GitHub authentication or connectivity and retry.",
      });
    }
  }

  async _readCase(path) {
    const resolved = resolve(path);
    relativePath(this.root, resolved);
    const stats = await lstat(resolved).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink()) {
      throw new PracticeError("CASE_UNAVAILABLE", "The selected case is no longer available.", 409);
    }
    return caseRecord(resolved, this.root, await readFile(resolved, "utf8"));
  }

  async _allCaseFiles() {
    await realDirectory(this.caseRoot, "Case Study/");
    return markdownFiles(this.caseRoot);
  }

  async dashboard() {
    const files = await this._allCaseFiles();
    const activity = {};
    const cases = {};
    const issues = [];
    let pending = 0;
    for (const path of files) {
      try {
        const record = await this._readCase(path);
        const inArchive = record.relativePath.startsWith("Case Study/Archive/");
        if (record.status === "completed") {
          activity[record.completionDate] = (activity[record.completionDate] ?? 0) + 1;
          (cases[record.completionDate] ??= []).push({ path: record.relativePath, difficulty: record.difficulty });
        } else if (inArchive) {
          issues.push(`${record.relativePath}: only completed cases belong in Archive.`);
        } else if (record.status === "pending") pending += 1;
      } catch (error) {
        issues.push(formatIssue(error, path, this.root));
      }
    }
    for (const entries of Object.values(cases)) entries.sort((a, b) => a.path.localeCompare(b.path));
    const sortedActivity = Object.fromEntries(Object.entries(activity).sort(([a], [b]) => a.localeCompare(b)));
    const sortedCases = Object.fromEntries(Object.entries(cases).sort(([a], [b]) => a.localeCompare(b)));
    const today = this.today();
    const solveTimes = [];
    let passedCases = 0;
    let failedCases = 0;
    if (await exists(this.resultsRoot)) {
      for (const entry of await readdir(this.resultsRoot, { withFileTypes: true })) {
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".json") continue;
        try {
          const result = JSON.parse(await readFile(join(this.resultsRoot, entry.name), "utf8"));
          if (Number.isFinite(result.solve_duration_seconds) && result.solve_duration_seconds >= 0) {
            solveTimes.push(result.solve_duration_seconds);
          }
          if (result.answer_outcome === "passed") passedCases += 1;
          if (result.answer_outcome === "failed") failedCases += 1;
        } catch { /* Invalid private result files do not block the public dashboard. */ }
      }
    }
    return {
      activity: sortedActivity,
      cases: sortedCases,
      stats: {
        totalCompleted: Object.values(activity).reduce((sum, count) => sum + count, 0),
        pendingCases: pending,
        currentStreak: calculateStreak(activity, today),
        casesThisWeek: casesThisWeek(activity, today),
        averageSolveSeconds: solveTimes.length
          ? Math.round(solveTimes.reduce((sum, seconds) => sum + seconds, 0) / solveTimes.length)
          : null,
        timedCases: solveTimes.length,
        passedCases,
        failedCases,
      },
      issues,
    };
  }

  async _loadSession() {
    if (!(await exists(this.sessionPath))) return null;
    const { value } = await readJson(this.sessionPath, "NO_SESSION", "No active practice session exists.");
    return value;
  }

  async _saveSession(session) {
    await writeJsonAtomic(this.sessionPath, { version: 1, ...session });
  }

  async _readAnswerRegistry(difficulty) {
    if (!DIFFICULTIES.includes(difficulty)) {
      throw new PracticeError("INVALID_DIFFICULTY", "The case difficulty is not supported.");
    }
    const difficultyPath = join(this.answerKeysRoot, `${difficulty}.json`);
    const path = await exists(difficultyPath) ? difficultyPath : this.answerRegistryPath;
    const result = await readJson(path, "ANSWER_REGISTRY_UNAVAILABLE", "The private answer registry is unavailable.");
    if (result.value.difficulty && result.value.difficulty !== difficulty) {
      throw new PracticeError("INVALID_DATA", `The ${difficulty} answer key contains a different difficulty.`, 409);
    }
    return { path, ...result };
  }

  async session() {
    const session = await this._loadSession();
    if (!session?.casePath) return null;
    if (!session.startedAt || !Number.isFinite(Date.parse(session.startedAt))) {
      session.startedAt = new Date(this.now()).toISOString();
      await this._saveSession(session);
    }
    let record;
    try { record = await this._readCase(join(this.root, session.casePath)); } catch {
      await rm(this.sessionPath, { force: true });
      return null;
    }
    if (record.status !== "pending") {
      await rm(this.sessionPath, { force: true });
      return null;
    }
    let systemAnswers = null;
    if (["reviewing", "resolved"].includes(session.phase)) {
      const { value: registry } = await this._readAnswerRegistry(record.difficulty);
      systemAnswers = systemAnswerRecord(registry, record.caseId, record.difficulty);
    }
    return publicSession(record, session, systemAnswers);
  }

  async _idCounts() {
    const counts = new Map();
    for (const path of await this._allCaseFiles()) {
      try {
        const record = await this._readCase(path);
        counts.set(record.caseId, (counts.get(record.caseId) ?? 0) + 1);
      } catch { /* Selection reports invalid active files separately. */ }
    }
    return counts;
  }

  async _selectUnlocked(requestedDifficulty) {
    const active = await this._loadSession();
    if (active?.casePath) {
      const current = await this.session();
      if (current) return { case: current, resumed: true };
    }
    let difficulty = String(requestedDifficulty ?? "").toLowerCase();
    if (difficulty === "random") difficulty = DIFFICULTIES[Math.floor(this.random() * DIFFICULTIES.length)];
    if (!DIFFICULTIES.includes(difficulty)) {
      throw new PracticeError("INVALID_DIFFICULTY", "Choose Simple, Intermediate, Complex, or Random.");
    }
    const folder = join(this.caseRoot, DIFFICULTY_FOLDERS[difficulty]);
    await realDirectory(folder, `Case Study/${DIFFICULTY_FOLDERS[difficulty]}/`);
    const candidates = [];
    const problems = [];
    for (const path of await markdownFiles(folder)) {
      try {
        const record = await this._readCase(path);
        if (record.difficulty !== difficulty) throw new PracticeError("INVALID_CASE", `${record.relativePath}: folder and difficulty do not match.`);
        if (record.status === "pending") candidates.push(record);
      } catch (error) { problems.push(formatIssue(error, path, this.root)); }
    }
    if (problems.length) {
      throw new PracticeError("INVALID_CASE_FOLDER", problems.join("\n"), 409, { difficulty });
    }
    if (!candidates.length) {
      throw new PracticeError("NO_CASES", "You Got No More. I request more.", 404, { difficulty });
    }
    const idCounts = await this._idCounts();
    const ambiguous = candidates.filter((record) => idCounts.get(record.caseId) !== 1);
    if (ambiguous.length) {
      throw new PracticeError("DUPLICATE_CASE_ID", `Duplicate case ID detected: ${ambiguous.map((item) => item.caseId).join(", ")}. Resolve it before selecting a case.`, 409, { difficulty });
    }
    const record = candidates[Math.floor(this.random() * candidates.length)];
    const { value: registry } = await this._readAnswerRegistry(record.difficulty);
    systemAnswerRecord(registry, record.caseId, record.difficulty);
    publicCaseBody(record.body, record.relativePath);
    const session = {
      casePath: record.relativePath,
      caseId: record.caseId,
      difficulty: record.difficulty,
      phase: "answering",
      userAnswers: Object.fromEntries(REQUIRED_CATEGORIES[record.difficulty].map((key) => [key, [""]])),
      comparisonResults: {},
      verificationStates: {},
      correctedAnswers: {},
      clueUsage: 0,
      startedAt: new Date(this.now()).toISOString(),
    };
    await this._saveSession(session);
    return { case: publicSession(record, session), resumed: false };
  }

  async select(requestedDifficulty) {
    return this._withLock(() => this._selectUnlocked(requestedDifficulty));
  }

  async clue() {
    return this._withLock(async () => {
      const session = await this._loadSession();
      if (!session?.casePath) throw new PracticeError("NO_SESSION", "Start a case before requesting a clue.", 409);
      if (session.phase !== "answering") throw new PracticeError("NOT_READY", "Clues are available while answering the case.", 409);
      const record = await this._readCase(join(this.root, session.casePath));
      const clues = clueOptions(record);
      session.clueUsage = Number(session.clueUsage ?? 0) + 1;
      await this._saveSession(session);
      return { clue: clues[Math.min(session.clueUsage - 1, clues.length - 1)], clueUsage: session.clueUsage };
    });
  }

  async cancel() {
    return this._withLock(async () => {
      const session = await this._loadSession();
      if (!session?.casePath) throw new PracticeError("NO_SESSION", "No active practice session exists.", 409);
      const record = await this._readCase(join(this.root, session.casePath));
      if (record.status !== "pending") throw new PracticeError("CASE_UNAVAILABLE", "Only a pending case can be cancelled.", 409);
      await rm(this.sessionPath, { force: true });
      return { cancelled: true, caseId: record.caseId };
    });
  }

  async check(userAnswers) {
    return this._withLock(async () => {
      const session = await this._loadSession();
      if (!session?.casePath) throw new PracticeError("NO_SESSION", "Start a case before checking answers.", 409);
      if (session.phase !== "answering") return this.session();
      const record = await this._readCase(join(this.root, session.casePath));
      const raw = {};
      for (const category of REQUIRED_CATEGORIES[record.difficulty]) {
        raw[category] = cleanAnswerList(userAnswers?.[category]);
      }
      const { value: registry } = await this._readAnswerRegistry(record.difficulty);
      const systemAnswers = systemAnswerRecord(registry, record.caseId, record.difficulty);
      session.userAnswers = raw;
      session.comparisonResults = Object.fromEntries(REQUIRED_CATEGORIES[record.difficulty].map((category) => [category, answersMatch(raw[category], systemAnswers[category])]));
      session.phase = "reviewing";
      session.verificationStates = {};
      session.correctedAnswers = {};
      await this._saveSession(session);
      return publicSession(record, session, systemAnswers);
    });
  }

  async verify(verificationStates, correctedAnswers, userAnswers = {}) {
    return this._withLock(async () => {
      const session = await this._loadSession();
      if (!session?.casePath || !["reviewing", "resolved"].includes(session.phase)) {
        throw new PracticeError("NOT_READY", "Check the answer before verifying the result.", 409);
      }
      const record = await this._readCase(join(this.root, session.casePath));
      const { value: registry } = await this._readAnswerRegistry(record.difficulty);
      const systemAnswers = systemAnswerRecord(registry, record.caseId, record.difficulty);
      const storedVerification = {};
      const storedCorrections = {};
      const unresolved = [];
      const authoritative = {};
      for (const category of REQUIRED_CATEGORIES[record.difficulty]) {
        const value = verificationStates?.[category] ?? {};
        const userCorrect = typeof value.userCorrect === "boolean" ? value.userCorrect : null;
        const systemCorrect = typeof value.systemCorrect === "boolean" ? value.systemCorrect : null;
        storedVerification[category] = { userCorrect, systemCorrect };
        const submitted = cleanAnswerList(userAnswers?.[category]);
        const suppliedCorrection = cleanAnswerList(correctedAnswers?.[category]);
        storedCorrections[category] = systemCorrect === false && userCorrect === true && submitted.length
          ? submitted
          : suppliedCorrection;
        if (userCorrect === null || systemCorrect === null) unresolved.push(`${category.toUpperCase()} needs both verification choices.`);
        if (systemCorrect === false && !storedCorrections[category].length) unresolved.push(`${category.toUpperCase()} needs a corrected authoritative answer.`);
        if (systemCorrect === true) authoritative[category] = systemAnswers[category];
        if (systemCorrect === false && storedCorrections[category].length) authoritative[category] = storedCorrections[category];
      }
      session.verificationStates = storedVerification;
      session.correctedAnswers = storedCorrections;
      session.authoritativeAnswers = authoritative;
      session.phase = unresolved.length ? "reviewing" : "resolved";
      await this._saveSession(session);
      return { ...publicSession(record, session, systemAnswers), unresolved };
    });
  }

  async complete(action, publish = false) {
    return this._withLock(async () => {
      if (!new Set(["next", "home"]).has(action)) throw new PracticeError("INVALID_ACTION", "Completion action must be next or home.");
      const session = await this._loadSession();
      if (!session?.casePath || session.phase !== "resolved") {
        throw new PracticeError("UNRESOLVED_CASE", "Verify every coding category before completing this case.", 409);
      }
      const record = await this._readCase(join(this.root, session.casePath));
      if (record.status !== "pending") throw new PracticeError("CASE_UNAVAILABLE", "Only a pending case can be completed.", 409);
      const date = this.today();
      if (!validCalendarDate(date)) throw new PracticeError("INVALID_DATE", "The local completion date is unavailable.", 500);
      const publicationRequested = publish === true;
      const publicationPreflight = publicationRequested ? publicationReadiness(this.root) : null;
      const categories = REQUIRED_CATEGORIES[record.difficulty];
      const { path: answerRegistryPath, text: answerText, value: answerRegistry } = await this._readAnswerRegistry(record.difficulty);
      const originalSystemAnswers = systemAnswerRecord(answerRegistry, record.caseId, record.difficulty);
      for (const category of categories) {
        const verification = session.verificationStates?.[category];
        const correction = cleanAnswerList(session.correctedAnswers?.[category]);
        if (typeof verification?.userCorrect !== "boolean" || typeof verification?.systemCorrect !== "boolean") {
          throw new PracticeError("UNRESOLVED_CASE", `${category.toUpperCase()} still needs manual verification.`, 409);
        }
        if (verification.systemCorrect === false && verification.userCorrect !== true && !correction.length) {
          throw new PracticeError("UNRESOLVED_CASE", `${category.toUpperCase()} needs a corrected authoritative answer.`, 409);
        }
      }
      const { text: registryText, value: caseRegistry } = await readJson(this.caseRegistryPath, "CASE_REGISTRY_UNAVAILABLE", "The case registry is unavailable.");
      if (!Array.isArray(caseRegistry.cases)) throw new PracticeError("INVALID_DATA", "case_registry.json must contain a cases array.", 409);
      const registryMatches = caseRegistry.cases.filter((item) => item?.case_id === record.caseId);
      if (registryMatches.length !== 1) throw new PracticeError("CASE_REGISTRY_MISMATCH", `The registry must contain exactly one entry for ${record.caseId}.`, 409);
      const archiveFolder = join(this.caseRoot, "Archive", DIFFICULTY_FOLDERS[record.difficulty]);
      await mkdir(archiveFolder, { recursive: true });
      const archivePath = join(archiveFolder, basename(record.path));
      if (await exists(archivePath)) throw new PracticeError("ARCHIVE_COLLISION", `Archive already contains ${basename(record.path)}. Nothing was overwritten.`, 409);
      const passed = categories.every((category) => {
        const verification = session.verificationStates[category];
        const systemAccepted = verification?.systemCorrect === true
          && answersMatch(session.userAnswers[category], originalSystemAnswers[category]);
        const corrected = cleanAnswerList(session.correctedAnswers?.[category]);
        const correctedAccepted = verification?.systemCorrect === false
          && verification?.userCorrect === true
          && corrected.length > 0
          && answersMatch(session.userAnswers[category], corrected);
        return verification?.userCorrect === true && (systemAccepted || correctedAccepted);
      });
      const resultPath = join(this.resultsRoot, passed
        ? `${record.caseId}.json`
        : `${record.caseId}-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
      if (passed && await exists(resultPath)) throw new PracticeError("RESULT_COLLISION", `A study result already exists for ${record.caseId}. Nothing was overwritten.`, 409);

      const authoritativeAnswers = {};
      const updatedAnswerRegistry = deepCopy(answerRegistry);
      const answerEntry = updatedAnswerRegistry.cases[record.caseId];
      answerEntry.correction_history ??= [];
      for (const category of categories) {
        const verification = session.verificationStates[category];
        if (verification.systemCorrect) authoritativeAnswers[category] = originalSystemAnswers[category];
        else {
          const corrected = cleanAnswerList(session.correctedAnswers[category]);
          authoritativeAnswers[category] = corrected;
          answerEntry.correction_history.push({
            category,
            previous_answer: originalSystemAnswers[category],
            corrected_answer: corrected,
            correction_date: date,
          });
          answerEntry[category] = corrected;
        }
      }
      const updatedCaseRegistry = deepCopy(caseRegistry);
      updatedCaseRegistry.cases.find((item) => item.case_id === record.caseId).path = relativePath(this.root, archivePath);
      const archiveRelativePath = relativePath(this.root, archivePath);
      const completedCase = updateFrontmatter(record.text, { status: "completed", date }, record.relativePath);
      const result = {
        version: 1,
        case_id: record.caseId,
        difficulty: record.difficulty,
        completion_date: date,
        coding_area: record.codingArea,
        specialty: record.specialty,
        user_answers_raw: session.userAnswers,
        user_answers_normalized: Object.fromEntries(categories.map((category) => [category, normalizedAnswerList(session.userAnswers[category])])),
        original_system_answers: originalSystemAnswers,
        manual_verification: session.verificationStates,
        corrected_answers: session.correctedAnswers,
        authoritative_answers: authoritativeAnswers,
        automatic_matches: session.comparisonResults,
        answer_outcome: passed ? "passed" : "failed",
        clue_usage: Number(session.clueUsage ?? 0),
        started_at: session.startedAt ?? null,
        completed_at: new Date(this.now()).toISOString(),
        solve_duration_seconds: session.startedAt
          ? Math.max(0, Math.round((this.now() - Date.parse(session.startedAt)) / 1000))
          : null,
        publication: publicationRequested && passed ? {
          requested: true,
          status: "pending",
          retryable: false,
          branch: publicationPreflight?.branch ?? "",
          remote: "origin",
          source_path: record.relativePath,
          archive_path: archiveRelativePath,
          registry_path: ".case-generator/case_registry.json",
          message: "Waiting to publish the completed case.",
        } : {
          requested: false,
          status: "not_requested",
          retryable: false,
          message: "This completion was saved locally only.",
        },
      };

      if (!passed) {
        result.publication = {
          requested: false,
          status: "not_requested",
          retryable: false,
          message: "The case was returned to the pending practice pool.",
        };
        try {
          await mkdir(this.resultsRoot, { recursive: true });
          await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
          await writeJsonAtomic(answerRegistryPath, updatedAnswerRegistry);
        } catch (error) {
          await rm(resultPath, { force: true }).catch(() => {});
          await writeAtomic(answerRegistryPath, answerText).catch(() => {});
          throw new PracticeError("REQUEUE_WRITE_FAILED", `The case could not be returned to the practice pool safely: ${error.message}`, 500);
        }
        await rm(this.sessionPath, { force: true }).catch(() => {});
        if (action === "home") return { completed: false, requeued: true, action, publication: result.publication, dashboard: await this.dashboard() };
        try {
          const selected = await this._selectUnlocked(record.difficulty);
          return { completed: false, requeued: true, action, publication: result.publication, ...selected };
        } catch (error) {
          if (error instanceof PracticeError && error.code === "NO_CASES") {
            return { completed: false, requeued: true, action, publication: result.publication, noMore: true, difficulty: record.difficulty };
          }
          throw error;
        }
      }

      const backupPath = join(dirname(record.path), `.${basename(record.path)}.${randomUUID()}.practice-backup`);
      let resultCreated = false;
      let moved = false;
      try {
        await mkdir(this.resultsRoot, { recursive: true });
        await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        resultCreated = true;
        await writeJsonAtomic(answerRegistryPath, updatedAnswerRegistry);
        await writeJsonAtomic(this.caseRegistryPath, updatedCaseRegistry);
        await rename(record.path, backupPath);
        try {
          await writeFile(archivePath, completedCase, { encoding: "utf8", flag: "wx" });
          moved = true;
          await rm(backupPath, { force: true });
        } catch (error) {
          await rename(backupPath, record.path).catch(() => {});
          throw error;
        }
      } catch (error) {
        if (moved) {
          await writeFile(record.path, record.text, { encoding: "utf8", flag: "wx" }).catch(() => {});
          await rm(archivePath, { force: true }).catch(() => {});
        }
        if (await exists(backupPath)) await rename(backupPath, record.path).catch(() => {});
        await writeAtomic(answerRegistryPath, answerText).catch(() => {});
        await writeAtomic(this.caseRegistryPath, registryText).catch(() => {});
        if (resultCreated) await rm(resultPath, { force: true }).catch(() => {});
        throw new PracticeError("ARCHIVE_WRITE_FAILED", `The case could not be archived safely: ${error.message}`, 500);
      }
      await rm(this.sessionPath, { force: true }).catch(() => {});

      let publication = result.publication;
      if (publicationRequested) {
        if (publicationPreflight?.available) {
          try {
            publication = await this._publishPreparedResult(resultPath, result, true);
          } catch {
            publication = {
              ...result.publication,
              status: "failed",
              retryable: true,
              message: "The case was saved locally, but the GitHub publication step could not finish.",
            };
            await this._savePublication(resultPath, result, publication).catch(() => {});
          }
        } else {
          publication = {
            ...result.publication,
            status: "failed",
            retryable: true,
            message: `The case was saved locally. ${publicationPreflight?.reason ?? "GitHub publishing is not configured."}`,
          };
          await this._savePublication(resultPath, result, publication).catch(() => {});
        }
      }

      if (action === "home") return { completed: true, action, publication, dashboard: await this.dashboard() };
      try {
        const selected = await this._selectUnlocked(record.difficulty);
        return { completed: true, action, publication, ...selected };
      } catch (error) {
        if (error instanceof PracticeError && error.code === "NO_CASES") {
          return { completed: true, action, publication, noMore: true, difficulty: record.difficulty };
        }
        throw error;
      }
    });
  }

  async publish(caseId) {
    return this._withLock(async () => {
      if (!CASE_ID_PATTERN.test(String(caseId ?? ""))) throw new PracticeError("INVALID_CASE_ID", "Choose a valid completed case to publish.");
      const resultPath = join(this.resultsRoot, `${caseId}.json`);
      const { value: result } = await readJson(resultPath, "RESULT_UNAVAILABLE", `No local study result exists for ${caseId}.`);
      if (!result.publication?.requested) throw new PracticeError("NOT_REQUESTED", "GitHub publication was not requested for this completion.", 409);
      if (result.publication.status === "pushed") return { publication: result.publication };
      const publication = await this._publishPreparedResult(resultPath, result, false);
      return { publication };
    });
  }

  async requestMore(difficulty, count = 100) {
    return this._withLock(async () => {
      const normalizedDifficulty = String(difficulty ?? "").toLowerCase();
      if (!DIFFICULTIES.includes(normalizedDifficulty)) throw new PracticeError("INVALID_DIFFICULTY", "Choose a specific difficulty before requesting more cases.");
      const amount = Number(count);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 500) throw new PracticeError("INVALID_COUNT", "Requested case count must be between 1 and 500.");
      let queue = { version: 1, requests: [] };
      if (await exists(this.requestsPath)) queue = (await readJson(this.requestsPath, "", "")).value;
      if (!Array.isArray(queue.requests)) throw new PracticeError("INVALID_DATA", "generation_requests.json must contain a requests array.", 409);
      const existing = queue.requests.find((item) => item.status === "pending" && item.difficulty === normalizedDifficulty && item.count === amount);
      if (existing) return { request: existing, duplicate: true };
      const request = {
        id: randomUUID(),
        requested_at: new Date().toISOString(),
        source: "practice-app",
        difficulty: normalizedDifficulty,
        count: amount,
        status: "pending",
      };
      queue.requests.push(request);
      await writeJsonAtomic(this.requestsPath, queue);
      return { request, duplicate: false };
    });
  }
}
