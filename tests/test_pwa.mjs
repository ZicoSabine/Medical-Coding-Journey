import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../site/", import.meta.url);
test("PWA manifest declares an installable standalone app and maskable icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.purpose.includes("maskable")));
  assert.equal(manifest.icons.length >= 2, true);
});

test("service worker keeps private API responses network-only", async () => {
  const worker = await readFile(new URL("sw.js", root), "utf8");
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /event\.request\.method !== "GET"/);
  assert.match(worker, /cache\.put/);
});
