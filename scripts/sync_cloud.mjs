import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { parseFrontmatter } from "./practice_core.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const database = process.env.MEDICAL_CODING_D1_NAME || "medical-coding-journey";
const remote = process.argv.includes("--local") ? [] : ["--remote"];
const sql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const files = [];
for (const folder of ["Simple", "Intermediate", "Complex", "Archive\\Simple", "Archive\\Intermediate", "Archive\\Complex"]) {
  const path = join(root, "Case Study", folder);
  for (const name of await readdir(path).catch(() => [])) if (name.endsWith(".md")) files.push(join(path, name));
}
const answerSources = {};
for (const difficulty of ["simple", "intermediate", "complex"]) {
  const grouped = join(root, ".case-generator", "answer_keys", `${difficulty}.json`);
  const legacy = join(root, ".case-generator", "answer_registry.json");
  const path = await readFile(grouped, "utf8").catch(() => readFile(legacy, "utf8").catch(() => "{\"cases\":{}}"));
  const parsed = JSON.parse(path); Object.assign(answerSources, parsed.cases || {});
}
const statements = [];
for (const path of files) {
  const text = await readFile(path, "utf8"); const parsed = parseFrontmatter(text, path); const m = parsed.metadata;
  if (m.type !== "case-study" || !m.case_id) continue;
  const difficulty = String(m.difficulty || "").toLowerCase(); if (!["simple", "intermediate", "complex"].includes(difficulty)) continue;
  const status = m.status === "completed" ? "completed" : "pending"; const source = relative(root, path).replaceAll("\\", "/");
  const hash = createHash("sha256").update(parsed.body).digest("hex"); const answer = answerSources[m.case_id] || {};
  statements.push(`INSERT INTO cases(case_id,difficulty,coding_area,specialty,clinical_markdown,status,generated_date,completed_date,source_path,case_hash) VALUES(${sql(m.case_id)},${sql(difficulty)},${sql(m.coding_area)},${sql(m.specialty)},${sql(parsed.body)},${sql(status)},${sql(m.generated_date)},${status === "completed" ? sql(m.date) : "NULL"},${sql(source)},${sql(hash)}) ON CONFLICT(case_id) DO UPDATE SET clinical_markdown=excluded.clinical_markdown,difficulty=excluded.difficulty,coding_area=excluded.coding_area,specialty=excluded.specialty,status=CASE WHEN cases.status='completed' THEN 'completed' ELSE excluded.status END,generated_date=excluded.generated_date,completed_date=COALESCE(cases.completed_date,excluded.completed_date),source_path=excluded.source_path,case_hash=excluded.case_hash,updated_at=CURRENT_TIMESTAMP;`);
  for (const category of ["icd10", "cpt", "hcpcs"]) for (const [index, value] of (Array.isArray(answer[category]) ? answer[category] : []).entries()) statements.push(`INSERT OR REPLACE INTO answers(case_id,coding_system,answer_value,answer_order,version,is_current,source_hash) VALUES(${sql(m.case_id)},${sql(category)},${sql(value)},${index},1,1,${sql(hash)});`);
}
const command = statements.join("\n");
if (!statements.length) throw new Error("No case files were found to import.");
const tempDir = await mkdtemp(join(tmpdir(), "medical-coding-sync-"));
const sqlFile = join(tempDir, "import.sql");
try {
  await writeFile(sqlFile, `${command}\n`, "utf8");
  const args = ["d1", "execute", database, ...remote, "--file", sqlFile];
  const globalWrangler = process.platform === "win32" && process.env.APPDATA
    ? join(process.env.APPDATA, "npm", "node_modules", "wrangler", "bin", "wrangler.js")
    : "";
  if (globalWrangler && existsSync(globalWrangler)) execFileSync(process.execPath, [globalWrangler, ...args], { cwd: root, stdio: "inherit" });
  else execFileSync(process.platform === "win32" ? "npx.ps1" : "npx", ["wrangler", ...args], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  console.log(`Imported ${files.length} case files into ${database}.`);
} finally { await rm(tempDir, { recursive: true, force: true }); }
