#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, lstat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeError, PracticeRepository } from "./practice_core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ROOT = join(ROOT, "site");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? Number(argv[index + 1]) : 8000;
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) {
    throw new Error("--port must be an integer between 1024 and 65535.");
  }
  return value;
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function jsonBody(request) {
  const type = request.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new PracticeError("INVALID_CONTENT_TYPE", "Requests must use application/json.", 415);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw new PracticeError("REQUEST_TOO_LARGE", "Request body is too large.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {
    throw new PracticeError("INVALID_JSON", "Request body contains invalid JSON.");
  }
}

function requireLocalAppRequest(request) {
  if (request.headers["x-medical-coding-app"] !== "1") {
    throw new PracticeError("INVALID_REQUEST", "This action is available only from the local practice application.", 403);
  }
}

async function apiResponse(repository, request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, repository.config());
  if (request.method === "GET" && url.pathname === "/api/dashboard") return sendJson(response, 200, await repository.dashboard());
  if (request.method === "GET" && url.pathname === "/api/session") return sendJson(response, 200, { session: await repository.session() });
  if (request.method !== "POST") throw new PracticeError("METHOD_NOT_ALLOWED", "This API route does not support that method.", 405);
  requireLocalAppRequest(request);
  const body = await jsonBody(request);
  if (url.pathname === "/api/cases/select") return sendJson(response, 200, await repository.select(body.difficulty));
  if (url.pathname === "/api/cases/clue") return sendJson(response, 200, await repository.clue());
  if (url.pathname === "/api/cases/check") return sendJson(response, 200, await repository.check(body.userAnswers));
  if (url.pathname === "/api/cases/verify") return sendJson(response, 200, await repository.verify(body.verificationStates, body.correctedAnswers, body.userAnswers));
  if (url.pathname === "/api/cases/cancel") return sendJson(response, 200, await repository.cancel());
  if (url.pathname === "/api/cases/complete") return sendJson(response, 200, await repository.complete(body.action, body.publish));
  if (url.pathname === "/api/cases/publish") return sendJson(response, 200, await repository.publish(body.caseId));
  if (url.pathname === "/api/cases/request-more") return sendJson(response, 200, await repository.requestMore(body.difficulty, body.count ?? 100));
  throw new PracticeError("NOT_FOUND", "API route not found.", 404);
}

async function staticResponse(request, response, url, siteRoot = SITE_ROOT) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch {
    throw new PracticeError("NOT_FOUND", "File not found.", 404);
  }
  if (pathname === "/") pathname = "/index.html";
  const path = resolve(siteRoot, `.${pathname}`);
  const rel = relative(siteRoot, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(/[\\/]/).some((part) => part.startsWith("."))) {
    throw new PracticeError("NOT_FOUND", "File not found.", 404);
  }
  const stats = await lstat(path).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) throw new PracticeError("NOT_FOUND", "File not found.", 404);
  const body = await readFile(path);
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
}

export function createPracticeServer(root = ROOT) {
  const repository = new PracticeRepository(root);
  const siteRoot = join(resolve(root), "site");
  return createServer(async (request, response) => {
    try {
      const host = String(request.headers.host ?? "").toLowerCase();
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        throw new PracticeError("INVALID_HOST", "The local application accepts only localhost requests.", 403);
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) await apiResponse(repository, request, response, url);
      else if (["GET", "HEAD"].includes(request.method)) await staticResponse(request, response, url, siteRoot);
      else throw new PracticeError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    } catch (error) {
      const known = error instanceof PracticeError;
      sendJson(response, known ? error.status : 500, {
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "The local application encountered an unexpected error.",
          ...(known ? error.details : {}),
        },
      });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.argv.slice(2));
  const server = createPracticeServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Medical Coding Journey is ready at http://127.0.0.1:${port}/`);
    console.log("Press Ctrl+C to stop the local application.");
  });
}
