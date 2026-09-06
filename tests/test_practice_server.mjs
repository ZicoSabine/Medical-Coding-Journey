import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPracticeServer } from "../scripts/practice_server.mjs";

test("local server serves the app securely and protects write routes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "medical-coding-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "site"), { recursive: true });
  await mkdir(join(root, "Case Study", "Simple"), { recursive: true });
  await mkdir(join(root, "Case Study", "Intermediate"), { recursive: true });
  await mkdir(join(root, "Case Study", "Complex"), { recursive: true });
  await writeFile(join(root, "site", "index.html"), "<!doctype html><title>Practice</title>");
  const server = createPracticeServer(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(await page.text(), "<!doctype html><title>Practice</title>");

  const config = await fetch(`${origin}/api/config`).then((response) => response.json());
  assert.equal(config.local, true);

  const rejected = await fetch(`${origin}/api/cases/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ difficulty: "simple" }),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, "INVALID_REQUEST");

  const noCases = await fetch(`${origin}/api/cases/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Medical-Coding-App": "1" },
    body: JSON.stringify({ difficulty: "simple" }),
  });
  assert.equal(noCases.status, 404);
  assert.equal((await noCases.json()).error.code, "NO_CASES");
});
