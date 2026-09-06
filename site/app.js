import {
  LEVEL_THRESHOLDS, buildCalendar, countLabel, formatDay, levelLabel,
  navigationIndex, todayKey, validateActivity, validateCaseIndex, caseUrl, caseTitle, dateFromHash,
} from "./calendar.js";
import { saveDraft, loadDraft, clearDraft } from "./offline.js";

const APP_STATES = Object.freeze({
  IDLE: "idle",
  SELECTING_DIFFICULTY: "selectingDifficulty",
  LOADING_CASE: "loadingCase",
  ANSWERING: "answering",
  CONFIRMING_CHECK: "confirmingCheck",
  REVIEWING: "reviewing",
  VERIFYING: "verifying",
  RESOLVED: "resolved",
  ARCHIVING: "archiving",
  COMPLETED: "completed",
  ERROR: "error",
});
const CATEGORY_LABELS = Object.freeze({ icd10: "ICD-10", cpt: "CPT", hcpcs: "HCPCS" });
const byId = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const tooltip = byId("tooltip");
const grid = byId("heatmap");
const scroller = byId("heatmap-scroll");

let localAvailable = false;
let activity = null;
let cases = {};
let displayedToday = null;
let dayLinks = [];
let selectedLink = null;
let current = null;
let appState = APP_STATES.IDLE;
let lastDifficulty = "simple";
let verificationTimer = null;
let toastTimer = null;
let publicationConfig = { available: false, reason: "GitHub publishing is not configured." };
let publicationCaseId = null;
let publicationContinuation = null;
let stopwatchTimer = null;
let online = navigator.onLine;

class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  if (!online && method === "POST") throw new AppError("OFFLINE", "You are offline. Checking, verification, and completion require a connection.");
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: method === "POST" ? {
      "Content-Type": "application/json",
      "X-Medical-Coding-App": "1",
    } : { Accept: "application/json" },
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error ?? {};
    throw new AppError(error.code ?? "REQUEST_FAILED", error.message ?? "The request could not be completed.", error);
  }
  return payload;
}

function showToast(message) {
  const toast = byId("toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
}

function showGlobalAlert(message) {
  const alert = byId("global-alert");
  alert.textContent = message;
  alert.hidden = !message;
}

function updateNetworkStatus() {
  online = navigator.onLine;
  const badge = byId("connection-badge");
  if (!online) { badge.innerHTML = '<span aria-hidden="true"></span> Offline · drafts only'; badge.classList.add("is-offline"); }
  else if (localAvailable) { badge.innerHTML = '<span aria-hidden="true"></span> Local workspace'; badge.classList.remove("is-offline"); }
}

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function setAppState(next) {
  appState = next;
  document.body.dataset.appState = next;
}

function setTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try {
    if (theme) localStorage.setItem("medical-coding-theme", theme);
    else localStorage.removeItem("medical-coding-theme");
  } catch { /* Theme persistence is optional. */ }
  const effective = theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  byId("theme-toggle").title = `Use ${effective === "dark" ? "light" : "dark"} theme`;
  byId("theme-toggle").setAttribute("aria-label", byId("theme-toggle").title);
}

function initializeTheme() {
  let saved = null;
  try { saved = localStorage.getItem("medical-coding-theme"); } catch { /* Ignore unavailable storage. */ }
  setTheme(["light", "dark"].includes(saved) ? saved : null);
  byId("theme-toggle").addEventListener("click", () => {
    const effective = document.documentElement.dataset.theme
      ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(effective === "dark" ? "light" : "dark");
  });
}

function hideTooltip() { tooltip.hidden = true; }

function showTooltip(link) {
  tooltip.textContent = `${formatDay(link.dataset.date)}\n${countLabel(Number(link.dataset.count))}`;
  tooltip.hidden = false;
  const anchor = link.getBoundingClientRect();
  const box = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2))}px`;
  tooltip.style.top = `${anchor.top > box.height + 16 ? anchor.top - box.height - 9 : anchor.bottom + 9}px`;
}

function renderCases(day) {
  const entries = cases[day] ?? [];
  const items = entries.map((entry) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "case-link";
    link.href = caseUrl(entry.path);
    link.target = "_blank";
    link.rel = "noreferrer";
    link.setAttribute("aria-label", `${caseTitle(entry.path)} — ${entry.difficulty} case. Open on GitHub.`);
    const name = document.createElement("span");
    name.className = "case-name";
    name.textContent = caseTitle(entry.path);
    const difficulty = document.createElement("span");
    difficulty.className = "case-difficulty";
    difficulty.textContent = entry.difficulty;
    const arrow = document.createElement("span");
    arrow.className = "case-arrow";
    arrow.textContent = "↗";
    arrow.setAttribute("aria-hidden", "true");
    link.append(name, difficulty, arrow);
    item.append(link);
    return item;
  });
  byId("case-list").replaceChildren(...items);
  byId("empty-state").hidden = entries.length > 0;
}

function selectDay(link) {
  if (selectedLink) {
    selectedLink.removeAttribute("aria-current");
    selectedLink.tabIndex = -1;
  }
  selectedLink = link;
  link.tabIndex = 0;
  link.setAttribute("aria-current", "true");
  byId("selected-date").textContent = formatDay(link.dataset.date);
  byId("selected-count").textContent = countLabel(Number(link.dataset.count));
  renderCases(link.dataset.date);
}

function dayLink(cell) {
  const link = document.createElement("a");
  link.href = `#day=${cell.key}`;
  link.className = "day";
  link.dataset.date = cell.key;
  link.dataset.count = cell.count;
  link.dataset.level = cell.level;
  link.tabIndex = -1;
  link.setAttribute("aria-label", `${formatDay(cell.key)}: ${countLabel(cell.count)}. View cases.`);
  if (cell.key === displayedToday) link.dataset.today = "true";
  link.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") showTooltip(link); });
  link.addEventListener("pointerleave", hideTooltip);
  link.addEventListener("focus", () => { selectDay(link); showTooltip(link); });
  link.addEventListener("blur", hideTooltip);
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectDay(link);
    showTooltip(link);
    if (window.location.hash !== link.hash) window.history.pushState(null, "", link.hash);
  });
  return link;
}

function renderCalendar() {
  displayedToday = todayKey();
  const calendar = buildCalendar(activity, displayedToday);
  byId("heatmap-layout").style.setProperty("--weeks", calendar.weeks);
  byId("date-range").textContent = `${formatDay(calendar.start, { month: "short", day: "numeric", year: "numeric" })} — ${formatDay(calendar.end, { month: "short", day: "numeric", year: "numeric" })}`;
  const fragment = document.createDocumentFragment();
  dayLinks = [];
  selectedLink = null;
  for (const cell of calendar.cells) {
    const element = cell.inRange ? dayLink(cell) : document.createElement("span");
    if (cell.inRange) dayLinks.push(element);
    else { element.className = "padding-day"; element.setAttribute("aria-hidden", "true"); }
    element.style.gridColumn = cell.column + 1;
    element.style.gridRow = cell.row + 1;
    fragment.append(element);
  }
  grid.replaceChildren(fragment);
  byId("month-labels").replaceChildren(...calendar.months.map((month) => {
    const label = document.createElement("span");
    label.textContent = month.label;
    label.style.gridColumn = month.column + 1;
    return label;
  }));
  const linkedDate = dateFromHash(window.location.hash);
  selectDay(dayLinks.find((link) => link.dataset.date === linkedDate) ?? dayLinks.at(-1));
  byId("activity-content").hidden = false;
  scroller.scrollLeft = scroller.scrollWidth;
  if (linkedDate) selectedLink.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderStats(stats, nextActivity) {
  const total = stats?.totalCompleted ?? Object.values(nextActivity).reduce((sum, value) => sum + value, 0);
  byId("stat-total").textContent = total;
  byId("stat-pending").textContent = stats?.pendingCases ?? "—";
  byId("stat-streak").textContent = stats?.currentStreak ?? "—";
  byId("stat-week").textContent = stats?.casesThisWeek ?? "—";
  byId("stat-average").textContent = formatDuration(stats?.averageSolveSeconds);
  byId("stat-average-note").textContent = stats?.timedCases
    ? `${stats.timedCases} timed ${stats.timedCases === 1 ? "case" : "cases"}`
    : "No timed cases yet";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function startStopwatch() {
  window.clearInterval(stopwatchTimer);
  const update = () => {
    const started = Date.parse(current?.startedAt);
    byId("case-stopwatch").textContent = Number.isFinite(started)
      ? formatDuration(Math.max(0, (Date.now() - started) / 1000))
      : "00:00";
  };
  update();
  stopwatchTimer = window.setInterval(update, 1000);
}

async function staticActivity() {
  const response = await fetch(`./data/case_activity.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Static activity is unavailable.");
  return response.json();
}

async function loadDashboard() {
  const state = byId("load-state");
  const panel = document.querySelector(".activity-panel");
  panel.setAttribute("aria-busy", "true");
  state.hidden = false;
  state.textContent = "Loading case activity…";
  byId("retry").hidden = true;
  try {
    const payload = localAvailable ? await api("/api/dashboard") : await staticActivity();
    activity = validateActivity(payload);
    cases = validateCaseIndex(payload);
    renderCalendar();
    renderStats(payload.stats, activity);
    state.hidden = true;
    if (payload.issues?.length) showGlobalAlert(`Some case metadata needs attention. ${payload.issues.join(" ")}`);
    else showGlobalAlert("");
  } catch (error) {
    activity = null;
    cases = {};
    byId("activity-content").hidden = true;
    state.textContent = "Case activity could not be loaded. Correct the local case metadata or try again.";
    byId("retry").hidden = false;
    if (localAvailable) showGlobalAlert(error.message);
  } finally {
    panel.setAttribute("aria-busy", "false");
  }
}

function appendInline(element, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) element.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    const child = document.createElement(token.startsWith("**") ? "strong" : "code");
    child.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
    element.append(child);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) element.append(document.createTextNode(text.slice(cursor)));
}

function renderMarkdown(markdown) {
  const fragment = document.createDocumentFragment();
  const lines = String(markdown ?? "").split(/\r?\n/);
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const element = document.createElement("p");
    paragraph.forEach((line, index) => {
      if (index) element.append(document.createElement("br"));
      appendInline(element, line);
    });
    fragment.append(element);
    paragraph = [];
  };
  const flushList = () => { if (list) { fragment.append(list); list = null; } };
  for (const line of lines) {
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      fragment.append(element);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph(); flushList();
      const element = document.createElement("blockquote");
      appendInline(element, quote[1]);
      fragment.append(element);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      list ??= document.createElement("ul");
      const element = document.createElement("li");
      appendInline(element, item[1]);
      list.append(element);
      continue;
    }
    flushList();
    paragraph.push(line.replace(/\s{2}$/, ""));
  }
  flushParagraph(); flushList();
  return fragment;
}

function transitionTo(view) {
  const home = byId("home-view");
  const caseView = byId("case-view");
  const next = view === "case" ? caseView : home;
  const previous = view === "case" ? home : caseView;
  previous.classList.remove("is-active");
  previous.hidden = true;
  next.hidden = false;
  next.classList.remove("is-active");
  requestAnimationFrame(() => next.classList.add("is-active"));
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

function answerInput(category, value, index, correction = false) {
  const row = document.createElement("div");
  row.className = "answer-row";
  const input = document.createElement("input");
  input.className = "code-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = value;
  input.placeholder = `${CATEGORY_LABELS[category]} code`;
  input.setAttribute("aria-label", `${correction ? "Corrected " : ""}${CATEGORY_LABELS[category]} answer ${index + 1}`);
  input.readOnly = !correction && current.phase !== "answering";
  input.addEventListener("input", () => {
    const target = correction ? current.correctedAnswers : current.userAnswers;
    target[category][index] = input.value;
    if (correction) { markVerificationDirty(); scheduleVerification(); }
    else if (current?.caseId) saveDraft(current.caseId, { userAnswers: current.userAnswers, savedAt: Date.now() });
  });
  const remove = document.createElement("button");
  remove.className = "remove-answer";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${CATEGORY_LABELS[category]} answer ${index + 1}`);
  remove.disabled = (!correction && current.phase !== "answering");
  remove.addEventListener("click", () => {
    const target = correction ? current.correctedAnswers : current.userAnswers;
    if (target[category].length === 1) target[category][0] = "";
    else target[category].splice(index, 1);
    if (correction) { markVerificationDirty(); renderVerification(); scheduleVerification(); } else renderAnswerGroups();
  });
  row.append(input, remove);
  return row;
}

function renderAnswerGroups() {
  const container = byId("answer-groups");
  const groups = current.categories.map((category) => {
    current.userAnswers[category] ??= [""];
    const group = document.createElement("section");
    group.className = "answer-group";
    const header = document.createElement("div");
    header.className = "answer-group-header";
    const title = document.createElement("h3");
    title.textContent = CATEGORY_LABELS[category];
    const note = document.createElement("span");
    note.textContent = category === "hcpcs" ? "Intermediate case" : "Add every applicable code";
    header.append(title, note);
    group.append(header, ...current.userAnswers[category].map((value, index) => answerInput(category, value, index)));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-answer";
    add.textContent = "+ Add another";
    add.disabled = current.phase !== "answering";
    add.addEventListener("click", () => { current.userAnswers[category].push(""); renderAnswerGroups(); });
    group.append(add);
    return group;
  });
  container.replaceChildren(...groups);
  const answering = current.phase === "answering";
  byId("check-button").hidden = !answering;
  byId("clue-button").disabled = !answering;
}

function codeChips(values) {
  const list = document.createElement("div");
  list.className = "code-list";
  for (const value of values ?? []) {
    const chip = document.createElement("span");
    chip.className = "code-chip";
    chip.textContent = value;
    list.append(chip);
  }
  return list;
}

function verificationChoice(category, target, correct) {
  const label = document.createElement("label");
  label.className = "choice-label";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = `${category}-${target}`;
  input.value = String(correct);
  input.checked = current.verificationStates?.[category]?.[`${target}Correct`] === correct;
  input.addEventListener("change", () => {
    current.verificationStates[category] ??= { userCorrect: null, systemCorrect: null };
    current.verificationStates[category][`${target}Correct`] = correct;
    if (target === "system" && !correct) current.correctedAnswers[category] ??= [""];
    markVerificationDirty();
    renderVerification();
    scheduleVerification();
  });
  const text = document.createElement("span");
  text.textContent = correct ? "Correct" : "Incorrect";
  label.append(input, text);
  return label;
}

function correctionPanel(category) {
  const panel = document.createElement("div");
  panel.className = "correction-panel";
  const header = document.createElement("div");
  header.className = "answer-group-header";
  const title = document.createElement("h3");
  title.textContent = "Correct Answer";
  const note = document.createElement("span");
  note.textContent = "Required when the system answer is incorrect";
  header.append(title, note);
  if (!current.correctedAnswers[category]?.length) current.correctedAnswers[category] = [""];
  panel.append(header, ...current.correctedAnswers[category].map((value, index) => answerInput(category, value, index, true)));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-answer";
  add.textContent = "+ Add another corrected answer";
  add.addEventListener("click", () => { current.correctedAnswers[category].push(""); markVerificationDirty(); renderVerification(); });
  panel.append(add);
  return panel;
}

function renderVerification() {
  const container = byId("verification-groups");
  const groups = current.categories.map((category) => {
    const group = document.createElement("section");
    group.className = `verification-group${current.comparisonResults[category] ? "" : " is-different"}`;
    const heading = document.createElement("div");
    heading.className = "verification-heading";
    const title = document.createElement("h3");
    title.textContent = CATEGORY_LABELS[category];
    const match = document.createElement("span");
    match.className = `match-badge ${current.comparisonResults[category] ? "is-match" : "is-different"}`;
    match.textContent = current.comparisonResults[category] ? "✓ Automated match" : "× Automated difference";
    heading.append(title, match);
    const comparison = document.createElement("div");
    comparison.className = "answer-comparison";
    for (const [label, values] of [["Your answer", current.userAnswers[category]], ["System answer", current.systemAnswers[category]]]) {
      const column = document.createElement("div");
      column.className = "comparison-column";
      const caption = document.createElement("span");
      caption.className = "comparison-label";
      caption.textContent = label;
      column.append(caption, codeChips(values));
      comparison.append(column);
    }
    const controls = document.createElement("div");
    controls.className = "verification-controls";
    for (const [target, label] of [["user", "User answer"], ["system", "System answer"]]) {
      const question = document.createElement("fieldset");
      question.className = "verification-question";
      const legend = document.createElement("legend");
      legend.textContent = label;
      const choices = document.createElement("div");
      choices.className = "choice-group";
      choices.append(verificationChoice(category, target, true), verificationChoice(category, target, false));
      question.append(legend, choices);
      controls.append(question);
    }
    group.append(heading, comparison, controls);
    if (current.verificationStates?.[category]?.systemCorrect === false) group.append(correctionPanel(category));
    return group;
  });
  container.replaceChildren(...groups);
  const resolved = current.phase === "resolved";
  byId("verification-status").textContent = resolved ? "Ready to complete" : "Needs review";
  byId("verification-status").classList.toggle("is-success", resolved);
  byId("next-case").disabled = !resolved || appState === APP_STATES.ARCHIVING;
  byId("return-home").disabled = !resolved || appState === APP_STATES.ARCHIVING;
  byId("verification-card").hidden = false;
}

function configurePublicationOption(reset = false) {
  const checkbox = byId("publish-checkbox");
  checkbox.disabled = !publicationConfig.available;
  if (reset) checkbox.checked = publicationConfig.available;
  byId("publish-help").textContent = publicationConfig.available
    ? `Creates “Complete ${current?.caseId ?? "this case"}” on ${publicationConfig.branch} and pushes only the archived case plus case registry.`
    : publicationConfig.reason;
}

function scheduleVerification() {
  window.clearTimeout(verificationTimer);
  verificationTimer = window.setTimeout(persistVerification, 180);
}

function markVerificationDirty() {
  current.phase = "reviewing";
  current.isResolved = false;
  setAppState(APP_STATES.VERIFYING);
}

async function persistVerification() {
  if (!current?.systemAnswers) return;
  setAppState(APP_STATES.VERIFYING);
  try {
    const result = await api("/api/cases/verify", {
      method: "POST",
      body: { verificationStates: current.verificationStates, correctedAnswers: current.correctedAnswers },
    });
    current = result;
    setAppState(result.isResolved ? APP_STATES.RESOLVED : APP_STATES.REVIEWING);
    renderVerification();
    const meaningful = result.unresolved?.filter((message) => !message.includes("both verification choices")) ?? [];
    showMessage(byId("verification-message"), meaningful.join(" "));
  } catch (error) {
    setAppState(APP_STATES.ERROR);
    showMessage(byId("verification-message"), error.message);
  }
}

function applyCasePayload(payload) {
  current = payload;
  current.userAnswers ??= Object.fromEntries(current.categories.map((category) => [category, [""]]));
  current.verificationStates ??= {};
  current.correctedAnswers ??= {};
  current.comparisonResults ??= {};
  lastDifficulty = current.difficulty;
  setAppState(current.isResolved ? APP_STATES.RESOLVED : current.phase === "reviewing" ? APP_STATES.REVIEWING : APP_STATES.ANSWERING);
  byId("case-title").textContent = current.caseId;
  byId("case-path-label").textContent = current.casePath;
  byId("case-difficulty").textContent = current.difficulty;
  const metadata = [];
  for (const value of [current.codingArea, current.specialty]) {
    if (!value) continue;
    const item = document.createElement("span");
    item.textContent = value;
    metadata.push(item);
  }
  byId("case-meta").replaceChildren(...metadata);
  byId("case-document").replaceChildren(renderMarkdown(current.body));
  byId("clue-count").textContent = current.clueUsage ?? 0;
  byId("clue-panel").hidden = true;
  byId("answer-status").textContent = current.phase === "answering" ? "Not checked" : "Checked";
  renderAnswerGroups();
  byId("verification-card").hidden = !current.systemAnswers;
  if (current.systemAnswers) renderVerification();
  configurePublicationOption(true);
  startStopwatch();
  showMessage(byId("answer-message"), "");
  showMessage(byId("verification-message"), "");
  transitionTo("case");
  saveDraft("active", { case: { ...current, systemAnswers: undefined }, savedAt: Date.now() });
  loadDraft(current.caseId).then((draft) => {
    if (!draft || current.phase !== "answering") return;
    current.userAnswers = draft.userAnswers ?? current.userAnswers;
    renderAnswerGroups();
    showToast("Offline draft restored.");
  });
}

async function selectDifficulty(difficulty, button) {
  setAppState(APP_STATES.LOADING_CASE);
  showMessage(byId("difficulty-message"), "");
  const buttons = [...document.querySelectorAll(".difficulty-option")];
  buttons.forEach((item) => { item.disabled = true; });
  button.dataset.label = button.querySelector("strong").textContent;
  button.querySelector("strong").textContent = "Loading…";
  try {
    const result = await api("/api/cases/select", { method: "POST", body: { difficulty } });
    byId("difficulty-dialog").close();
    applyCasePayload(result.case);
    if (result.resumed) showToast("Your active case was restored.");
  } catch (error) {
    setAppState(APP_STATES.ERROR);
    if (error.code === "NO_CASES") {
      byId("difficulty-dialog").close();
      openNoMore(error.details.difficulty ?? difficulty);
    } else showMessage(byId("difficulty-message"), error.message);
  } finally {
    buttons.forEach((item) => { item.disabled = false; });
    button.querySelector("strong").textContent = button.dataset.label;
  }
}

function openNoMore(difficulty) {
  lastDifficulty = difficulty === "random" ? lastDifficulty : difficulty;
  byId("no-more-copy").textContent = `There are no pending ${lastDifficulty} cases.`;
  showMessage(byId("request-message"), "");
  byId("no-more-dialog").showModal();
}

function showPublication(publication, caseId, continuation) {
  publicationCaseId = caseId;
  publicationContinuation = continuation;
  const pushed = publication.status === "pushed";
  const symbol = byId("publication-symbol");
  symbol.textContent = pushed ? "✓" : "!";
  symbol.classList.toggle("is-error", !pushed);
  byId("publication-title").textContent = pushed ? "Completion published" : "Saved locally; GitHub needs attention";
  byId("publication-copy").textContent = publication.message;
  const commit = byId("publication-commit");
  commit.textContent = publication.commit_sha
    ? `Commit ${publication.commit_sha.slice(0, 12)} · ${publication.branch}`
    : publication.branch ? `Branch ${publication.branch}` : "";
  commit.hidden = !commit.textContent;
  byId("publication-retry").hidden = !publication.retryable;
  byId("publication-dialog").showModal();
}

function finishPublicationDialog() {
  byId("publication-dialog").close();
  const continuation = publicationContinuation;
  publicationContinuation = null;
  publicationCaseId = null;
  continuation?.();
}

async function completeCase(action) {
  if (!current?.isResolved) {
    showMessage(byId("verification-message"), "Verify every coding category before completing this case.");
    return;
  }
  setAppState(APP_STATES.ARCHIVING);
  renderVerification();
  const completedCaseId = current.caseId;
  const publish = byId("publish-checkbox").checked && !byId("publish-checkbox").disabled;
  try {
    const result = await api("/api/cases/complete", { method: "POST", body: { action, publish } });
    setAppState(APP_STATES.COMPLETED);
    current = null;
    window.clearInterval(stopwatchTimer);
    await clearDraft(completedCaseId);
    if (result.case) {
      applyCasePayload(result.case);
      await loadDashboard();
    } else {
      transitionTo("home");
      await loadDashboard();
    }
    const continueFlow = () => {
      if (result.noMore) openNoMore(result.difficulty);
      else if (result.case) showToast("Case completed and archived. Your next case is ready.");
      else showToast("Case completed, saved, and archived.");
    };
    if (result.publication?.requested) showPublication(result.publication, completedCaseId, continueFlow);
    else continueFlow();
  } catch (error) {
    setAppState(APP_STATES.ERROR);
    showMessage(byId("verification-message"), error.message);
    renderVerification();
  }
}

async function cancelCase() {
  const button = byId("confirm-cancel");
  button.disabled = true;
  try {
    const result = await api("/api/cases/cancel", { method: "POST" });
    byId("cancel-dialog").close();
    window.clearInterval(stopwatchTimer);
    current = null;
    await clearDraft(result.caseId);
    setAppState(APP_STATES.IDLE);
    transitionTo("home");
    showToast(`${result.caseId} was cancelled and remains pending.`);
  } catch (error) {
    byId("cancel-dialog").close();
    showGlobalAlert(error.message);
  } finally { button.disabled = false; }
}

async function configureLocalMode() {
  const badge = byId("connection-badge");
  try {
    const config = await api("/api/config");
    localAvailable = config.local === true || config.cloud === true;
    publicationConfig = config.publication ?? publicationConfig;
    if (config.githubUsername) byId("github-username").textContent = `@${config.githubUsername}`;
    badge.innerHTML = `<span aria-hidden="true"></span> ${config.cloud ? "Private cloud" : "Local workspace"}`;
    badge.classList.remove("is-offline");
  } catch {
    localAvailable = false;
    publicationConfig = { available: false, reason: "GitHub publishing is available only from the local application." };
    badge.innerHTML = '<span aria-hidden="true"></span> Dashboard only';
    badge.classList.add("is-offline");
  }
}

async function restoreSession() {
  if (!localAvailable) {
    const cached = await loadDraft("active");
    if (cached?.case) { applyCasePayload(cached.case); showToast("Offline case restored. Checking remains unavailable until you reconnect."); }
    return;
  }
  try {
    const result = await api("/api/session");
    if (result.session) applyCasePayload(result.session);
  } catch (error) { showGlobalAlert(error.message); }
}

grid.addEventListener("keydown", (event) => {
  const index = dayLinks.indexOf(event.target);
  if (index < 0) return;
  if (event.key === "Escape") { hideTooltip(); return; }
  if (event.key === " ") { event.preventDefault(); event.target.click(); return; }
  const next = navigationIndex(index, event.key, dayLinks.map((link) => link.dataset.date), event.ctrlKey || event.metaKey);
  if (next === null) return;
  event.preventDefault();
  dayLinks[next].focus({ preventScroll: true });
  dayLinks[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  showTooltip(dayLinks[next]);
});
scroller.addEventListener("scroll", hideTooltip);
window.addEventListener("scroll", hideTooltip, { passive: true });
window.addEventListener("resize", hideTooltip);
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("hashchange", () => {
  const linkedDate = dateFromHash(window.location.hash);
  const target = dayLinks.find((link) => link.dataset.date === linkedDate) ?? dayLinks.at(-1);
  if (target) { selectDay(target); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  hideTooltip();
});
document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".day")) hideTooltip(); });

byId("legend-levels").replaceChildren(...LEVEL_THRESHOLDS.map((_, index) => {
  const square = document.createElement("span");
  square.className = "legend-square";
  square.dataset.level = index;
  square.setAttribute("role", "img");
  square.setAttribute("aria-label", levelLabel(index));
  square.title = levelLabel(index);
  return square;
}));

byId("retry").addEventListener("click", loadDashboard);
byId("present-case").addEventListener("click", () => {
  if (!localAvailable) {
    showGlobalAlert("Daily practice needs the local application server. Run node scripts/practice_server.mjs from the Medical Coding folder.");
    return;
  }
  setAppState(APP_STATES.SELECTING_DIFFICULTY);
  byId("difficulty-dialog").showModal();
});
document.querySelectorAll(".difficulty-option").forEach((button) => {
  button.addEventListener("click", () => selectDifficulty(button.dataset.difficulty, button));
});
byId("answer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  showMessage(byId("answer-message"), "");
  setAppState(APP_STATES.CONFIRMING_CHECK);
  byId("check-dialog").showModal();
});
byId("confirm-check").addEventListener("click", async (event) => {
  event.preventDefault();
  byId("check-dialog").close();
  byId("check-button").disabled = true;
  try {
    const result = await api("/api/cases/check", { method: "POST", body: { userAnswers: current.userAnswers } });
    applyCasePayload(result);
    byId("verification-card").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  } catch (error) {
    setAppState(APP_STATES.ERROR);
    showMessage(byId("answer-message"), error.message);
  } finally { byId("check-button").disabled = false; }
});
byId("clue-button").addEventListener("click", async () => {
  byId("clue-button").disabled = true;
  try {
    const result = await api("/api/cases/clue", { method: "POST" });
    byId("clue-count").textContent = result.clueUsage;
    byId("clue-panel").textContent = result.clue;
    byId("clue-panel").hidden = false;
    current.clueUsage = result.clueUsage;
  } catch (error) { showMessage(byId("answer-message"), error.message); }
  finally { byId("clue-button").disabled = current?.phase !== "answering"; }
});
byId("next-case").addEventListener("click", () => completeCase("next"));
byId("return-home").addEventListener("click", () => completeCase("home"));
byId("cancel-case").addEventListener("click", () => byId("cancel-dialog").showModal());
byId("confirm-cancel").addEventListener("click", (event) => { event.preventDefault(); cancelCase(); });
byId("close-case").addEventListener("click", () => {
  if (current?.isResolved) completeCase("home");
  else { transitionTo("home"); showToast("This case remains pending. Present Daily Case will restore it."); }
});
byId("no-more-home").addEventListener("click", async () => { transitionTo("home"); await loadDashboard(); });
byId("request-more").addEventListener("click", async (event) => {
  event.preventDefault();
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/api/cases/request-more", { method: "POST", body: { difficulty: lastDifficulty, count: 100 } });
    byId("no-more-dialog").close();
    showToast(result.duplicate ? "A matching 100-case request is already queued." : `Requested 100 ${lastDifficulty} cases for the generator workflow.`);
  } catch (error) { showMessage(byId("request-message"), error.message); }
  finally { button.disabled = false; }
});
byId("publication-close").addEventListener("click", finishPublicationDialog);
byId("publication-retry").addEventListener("click", async () => {
  const button = byId("publication-retry");
  button.disabled = true;
  button.textContent = "Retrying…";
  try {
    const result = await api("/api/cases/publish", { method: "POST", body: { caseId: publicationCaseId } });
    const pushed = result.publication.status === "pushed";
    const symbol = byId("publication-symbol");
    symbol.textContent = pushed ? "✓" : "!";
    symbol.classList.toggle("is-error", !pushed);
    byId("publication-title").textContent = pushed ? "Completion published" : "Saved locally; GitHub needs attention";
    byId("publication-copy").textContent = result.publication.message;
    const commit = byId("publication-commit");
    commit.textContent = result.publication.commit_sha
      ? `Commit ${result.publication.commit_sha.slice(0, 12)} · ${result.publication.branch}`
      : result.publication.branch ? `Branch ${result.publication.branch}` : "";
    commit.hidden = !commit.textContent;
    button.hidden = !result.publication.retryable;
  } catch (error) {
    byId("publication-copy").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Retry Push";
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && activity && todayKey() !== displayedToday) loadDashboard();
});

async function initialize() {
  initializeTheme();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  updateNetworkStatus();
  await configureLocalMode();
  await loadDashboard();
  await restoreSession();
}

initialize();
