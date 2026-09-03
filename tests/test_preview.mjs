import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderPreview } from "../scripts/build_preview.mjs";

const styles = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");

test("README preview uses real activity, correct colors and links to dates", () => {
  const svg = renderPreview({ "2026-09-03": 7, "2026-09-04": 99 }, styles, html, "2026-09-03");
  assert.equal((svg.match(/data-date=/g) ?? []).length, 365);
  assert.ok(svg.includes('href="https://zicosabine.github.io/Medical-Coding-Journey/#day=2026-09-03"'));
  assert.match(svg, /data-date="2026-09-03" data-count="7" data-level="4"[^>]*fill="#9a692b"/);
  assert.ok(!svg.includes('data-date="2026-09-04"'));
  assert.ok(!svg.includes("99 cases"));
});

test("empty preview contains no invented positive activity", () => {
  const svg = renderPreview({}, styles, html, "2026-09-03");
  assert.equal((svg.match(/data-count="0"/g) ?? []).length, 365);
  assert.ok(!/data-count="[1-9]/.test(svg));
  assert.ok(svg.includes("Just keep coding, just keep coding ~"));
  assert.ok(svg.includes("One code at a time"));
  assert.ok(svg.includes("Solved in Obsidian"));
});

test("leap-day preview uses the same rolling calendar as the dashboard", () => {
  const svg = renderPreview({ "2024-02-29": 1 }, styles, html, "2024-03-01");
  assert.equal((svg.match(/data-date=/g) ?? []).length, 366);
  assert.match(svg, /data-date="2024-02-29" data-count="1"/);
});

test("preview escapes HTML copy and fails clearly for a missing palette color", () => {
  const customHtml = html.replace("Just keep coding, just keep coding ~", "Coding &amp; cases &lt;daily&gt;");
  const svg = renderPreview({}, styles, customHtml, "2026-09-03");
  assert.ok(svg.includes("Coding &amp; cases &lt;daily&gt;"));
  assert.ok(!svg.includes("&amp;amp;"));
  assert.throws(() => renderPreview({}, "", html, "2026-09-03"), /missing CSS color/);
});
