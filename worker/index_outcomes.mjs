import legacy from "./index.mjs";
import { answersMatch, cleanAnswerList, REQUIRED_CATEGORIES } from "../scripts/study_rules.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function active(env) { return env.DB.prepare("SELECT c.*,a.id attempt_id,a.started_at,a.state FROM attempts a JOIN cases c ON c.case_id=a.case_id WHERE a.state IN ('answering','checked','verifying','resolved') LIMIT 1").first(); }
async function expected(env, caseId, difficulty) { const rows = await env.DB.prepare("SELECT coding_system,answer_value FROM answers WHERE case_id=? AND is_current=1 ORDER BY answer_order").bind(caseId).all(); return Object.fromEntries(REQUIRED_CATEGORIES[difficulty].map((cat) => [cat, rows.results.filter((row) => row.coding_system === cat).map((row) => row.answer_value)])); }
function effectiveCorrections(categories, states, corrections, userAnswers) {
  const result = { ...(corrections || {}) };
  for (const category of categories) {
    const submitted = cleanAnswerList(userAnswers?.[category]);
    if (states?.[category]?.systemCorrect === false && states?.[category]?.userCorrect === true && submitted.length) result[category] = submitted;
  }
  return result;
}
async function applyCorrections(env, caseId, states, corrections) {
  const changedAt = new Date().toISOString();
  for (const category of ["icd10", "cpt", "hcpcs"]) {
    if (states?.[category]?.systemCorrect !== false) continue;
    const corrected = cleanAnswerList(corrections?.[category]);
    if (!corrected.length) continue;
    const previousRows = await env.DB.prepare("SELECT answer_value FROM answers WHERE case_id=? AND coding_system=? AND is_current=1 ORDER BY answer_order").bind(caseId, category).all();
    const previous = previousRows.results.map((row) => row.answer_value).join(", ");
    const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version),0) version FROM answers WHERE case_id=? AND coding_system=?").bind(caseId, category).first();
    const version = Number(versionRow?.version || 0) + 1;
    const sourceHash = `cloud-correction-${Date.now()}`;
    const statements = [
      env.DB.prepare("UPDATE answers SET is_current=0,superseded_at=? WHERE case_id=? AND coding_system=? AND is_current=1").bind(changedAt, caseId, category),
      env.DB.prepare("INSERT INTO answer_corrections(case_id,coding_system,previous_answer,corrected_answer,corrected_at) VALUES(?,?,?,?,?)").bind(caseId, category, previous, corrected.join(", "), changedAt),
      ...corrected.map((value, index) => env.DB.prepare("INSERT INTO answers(case_id,coding_system,answer_value,answer_order,version,is_current,source_hash) VALUES(?,?,?,?,?,1,?)").bind(caseId, category, value, index, version, sourceHash)),
    ];
    await env.DB.batch(statements);
  }
}
const forwarded = (request, payload) => {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(payload) });
};

export default { async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (!env.DB || !url.pathname.startsWith("/api/")) return legacy.fetch(request, env, ctx);
  if (url.pathname === "/api/dashboard" && request.method === "GET") {
    const response = await legacy.fetch(request, env, ctx); const data = await response.json();
    const stats = await env.DB.prepare("SELECT COUNT(*) FILTER (WHERE answer_outcome='passed') passedCases,COUNT(*) FILTER (WHERE answer_outcome='failed') failedCases FROM attempts WHERE state='completed'").first();
    return json({ ...data, stats: { ...data.stats, passedCases: Number(stats?.passedCases || 0), failedCases: Number(stats?.failedCases || 0) } }, response.status);
  }
  if (url.pathname === "/api/cases/verify" && request.method === "POST") {
    const payload = await request.clone().json(); const current = await active(env); const normalized = current ? { ...payload, correctedAnswers: effectiveCorrections(REQUIRED_CATEGORIES[current.difficulty], payload.verificationStates, payload.correctedAnswers, payload.userAnswers) } : payload; const response = await legacy.fetch(forwarded(request, normalized), env, ctx); const data = await response.json();
    return json({ ...data, userAnswers: payload.userAnswers ?? data.userAnswers }, response.status);
  }
  if (url.pathname === "/api/cases/complete" && request.method === "POST") {
    const payload = await request.clone().json(); const current = await active(env); const system = current ? await expected(env, current.case_id, current.difficulty) : null; const states = payload.verificationStates || {}; const corrections = current ? effectiveCorrections(REQUIRED_CATEGORIES[current.difficulty], states, payload.correctedAnswers, payload.userAnswers) : {}; const passed = !!current && REQUIRED_CATEGORIES[current.difficulty].every((cat) => { const user = cleanAnswerList(payload.userAnswers?.[cat]); const state = states[cat]; const systemAccepted = state?.userCorrect === true && state?.systemCorrect === true && answersMatch(user, system[cat]); const correctedAccepted = state?.userCorrect === true && state?.systemCorrect === false && answersMatch(user, corrections[cat]); return systemAccepted || correctedAccepted; }); const normalized = { ...payload, correctedAnswers: corrections }; const response = await legacy.fetch(forwarded(request, normalized), env, ctx);
    if (response.ok && current?.state === "resolved") {
      await applyCorrections(env, current.case_id, states, corrections);
      if (!passed) await env.DB.prepare("UPDATE cases SET status='pending',completed_date=NULL,updated_at=CURRENT_TIMESTAMP WHERE case_id=?").bind(current.case_id).run();
      const outcome = passed ? "passed" : "failed";
      await env.DB.prepare("UPDATE attempts SET answer_outcome=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(outcome, current.attempt_id).run();
      const data = await response.json();
      return json({ ...data, completed: passed, requeued: !passed, dashboard: await (async () => { const refreshed = await legacy.fetch(new Request(new URL("/api/dashboard", request.url), { headers: request.headers }), env, ctx); return refreshed.json(); })() }, response.status);
    }
    return response;
  }
  return legacy.fetch(request, env, ctx);
} };
