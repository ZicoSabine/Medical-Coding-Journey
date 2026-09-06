// Generate the README image using the dashboard's calendar, copy, and CSS colors.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LEVEL_THRESHOLDS, buildCalendar, countLabel, formatDay, levelLabel, validateActivity,
} from "../site/calendar.js";

const DASHBOARD_URL = "https://zicosabine.github.io/Medical-Coding-Journey/";

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function copyFromHtml(html, id) {
  const match = html.match(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/\\1>`, "i"));
  if (!match) throw new Error(`Preview is missing dashboard copy: ${id}`);
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return match[2].replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return entities[entity.toLowerCase()];
  }).trim();
}

export function renderPreview(activity, styles, html, today) {
  const calendar = buildCalendar(activity, today);
  const color = (name) => {
    const match = styles.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, "i"));
    if (!match) throw new Error(`Preview is missing CSS color --${name}`);
    return match[1];
  };
  const background = color("background");
  const text = color("text");
  const muted = color("muted");
  const accent = color("accent");
  const border = color("border");
  const colors = LEVEL_THRESHOLDS.map((_, index) => color(`level-${index}`));
  const copy = (id) => copyFromHtml(html, id);
  const textElement = (x, y, value, size = 12, fill = text, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;
  const range = `${formatDay(calendar.start, { month: "short", day: "numeric", year: "numeric" })} — ${formatDay(calendar.end, { month: "short", day: "numeric", year: "numeric" })}`;
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="570" viewBox="0 0 1120 570" role="img" aria-labelledby="title description">',
    `<title id="title">Medical Coding Journey — Case Study Activity</title>`,
    `<desc id="description">${escapeXml(range)}. ${escapeXml(copy("activity-subtitle"))} Open the dashboard to explore completed cases.</desc>`,
    `<rect width="1120" height="570" rx="14" fill="${background}"/>`,
    '<g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif">',
    textElement(32, 45, "〈/〉", 22, accent),
    textElement(76, 42, "THE LEARNING LOG", 11, text, 'letter-spacing="1.4" font-weight="600"'),
    `<a href="${DASHBOARD_URL}" target="_top">${textElement(1088, 42, "Open dashboard ↗", 12, muted, 'text-anchor="end"')}</a>`,
    `<path d="M32 68H1088" stroke="${border}"/>`,
    textElement(32, 130, "Medical Coding Journey", 34, text, 'font-weight="600" letter-spacing="-1.1"'),
    textElement(32, 161, copy("dashboard-title"), 16, muted),
    textElement(32, 193, "ICD-10-CM   /   CPT   /   HCPCS Level II", 11, muted),
    `<rect x="32" y="221" width="1056" height="282" rx="10" fill="${color("surface")}" stroke="${border}"/>`,
    textElement(55, 253, "Case Study Activity", 17, text, 'font-weight="600"'),
    textElement(55, 278, copy("activity-subtitle"), 12, muted),
    textElement(1064, 253, range, 11, muted, 'text-anchor="end"'),
  ];
  const step = 18;
  const startX = 88;
  const startY = 319;
  for (const month of calendar.months) {
    parts.push(textElement(startX + month.column * step, 307, month.label, 10, muted));
  }
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((day, row) => {
    parts.push(textElement(54, startY + row * step + 10, day, 9, muted));
  });
  for (const cell of calendar.cells) {
    const x = startX + cell.column * step;
    const y = startY + cell.row * step;
    if (!cell.inRange) {
      parts.push(`<rect x="${x}" y="${y}" width="13" height="13" rx="2" fill="none" stroke="${border}" stroke-dasharray="2 2" opacity=".4"/>`);
      continue;
    }
    const label = `${formatDay(cell.key)}: ${countLabel(cell.count)}`;
    parts.push(`<a href="${DASHBOARD_URL}#day=${cell.key}" target="_top"><rect data-date="${cell.key}" data-count="${cell.count}" data-level="${cell.level}" x="${x}" y="${y}" width="13" height="13" rx="2" fill="${colors[cell.level]}"><title>${escapeXml(label)}</title></rect></a>`);
  }
  parts.push(textElement(55, 479, "Open the dashboard to select a day and find its cases.", 11, muted));
  parts.push(textElement(897, 479, "Less", 10, muted, 'text-anchor="end"'));
  colors.forEach((fill, index) => {
    parts.push(`<rect x="${908 + index * 18}" y="468" width="13" height="13" rx="2" fill="${fill}"><title>${escapeXml(levelLabel(index))}</title></rect>`);
  });
  parts.push(textElement(1023, 479, "More", 10, muted));
  parts.push(textElement(32, 542, copy("footer-left"), 11, muted));
  parts.push(textElement(1088, 542, copy("footer-right"), 11, muted, 'text-anchor="end"'));
  parts.push("</g></svg>\n");
  return parts.join("\n");
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = resolve(root, "_site");
  const [data, styles, html] = await Promise.all([
    readFile(resolve(output, "data/case_activity.json"), "utf8"),
    readFile(resolve(output, "styles.css"), "utf8"),
    readFile(resolve(output, "index.html"), "utf8"),
  ]);
  const activity = validateActivity(JSON.parse(data));
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(resolve(output, "preview.svg"), renderPreview(activity, styles, html, today), "utf8");
  console.log(`Built _site/preview.svg for ${today}; README preview uses real case activity.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
