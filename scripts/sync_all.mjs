import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const localMode = args.includes("--local");
const push = args.includes("--push");
const script = (name) => join(root, "scripts", name);

function run(name, forwarded) {
  console.log(`\n=== ${name} ===`);
  execFileSync(process.execPath, [script(name), ...forwarded], { cwd: root, stdio: "inherit", windowsHide: true });
}

try {
  const pullArgs = [...(localMode ? ["--local"] : []), ...(dryRun ? ["--dry-run"] : []), ...(push ? ["--push"] : [])];
  run("sync_obsidian.mjs", pullArgs);
  if (dryRun) {
    console.log("\nDry run complete; local-to-cloud write was skipped.");
  } else {
    run("sync_cloud.mjs", localMode ? ["--local"] : []);
    console.log("\nBidirectional sync complete: cloud state reconciled to Obsidian, then local state imported to D1.");
  }
} catch (error) {
  process.exitCode = error.status ?? 1;
  console.error("\nBidirectional sync stopped before all stages completed.");
}
