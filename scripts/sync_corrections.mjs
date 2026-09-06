import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname.replace(/^\//, "").replaceAll("/", "\\");
await writeFile(join(root, ".case-generator", "corrections.json"), JSON.stringify({ version: 1, exported_at: new Date().toISOString(), corrections: [] }, null, 2));
console.log("Created the ignored corrections export placeholder. Cloud correction export requires D1 access.");
