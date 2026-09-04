import {
  LEVEL_THRESHOLDS, buildCalendar, countLabel, formatDay, levelLabel,
  navigationIndex, todayKey, validateActivity, validateCaseIndex, caseUrl, caseTitle, dateFromHash,
} from "./calendar.js";

const byId = (id) => document.getElementById(id);
const tooltip = byId("tooltip");
const grid = byId("heatmap");
const scroller = byId("heatmap-scroll");
let activity = null;
let cases = {};
let displayedToday = null;
let dayLinks = [];
let selectedLink = null;

function hideTooltip() {
  tooltip.hidden = true;
}

function showTooltip(link) {
  tooltip.textContent = `${formatDay(link.dataset.date)}\n${countLabel(Number(link.dataset.count))}`;
  tooltip.hidden = false;
  const anchor = link.getBoundingClientRect();
  const box = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2))}px`;
  tooltip.style.top = `${anchor.top > box.height + 16 ? anchor.top - box.height - 9 : anchor.bottom + 9}px`;
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

function renderCases(day) {
  const entries = cases[day] ?? [];
  const items = entries.map((entry) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "case-link";
    link.href = caseUrl(entry.path);
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
  link.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") showTooltip(link);
  });
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
  // Start smaller screens at the most recent week, keeping all previous days scrollable.
  scroller.scrollLeft = scroller.scrollWidth;
  if (linkedDate) selectedLink.scrollIntoView({ block: "nearest", inline: "nearest" });
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
window.addEventListener("hashchange", () => {
  const linkedDate = dateFromHash(window.location.hash);
  const target = dayLinks.find((link) => link.dataset.date === linkedDate) ?? dayLinks.at(-1);
  if (target) {
    selectDay(target);
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  hideTooltip();
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".day")) hideTooltip();
});

byId("legend-levels").replaceChildren(...LEVEL_THRESHOLDS.map((_, index) => {
  const square = document.createElement("span");
  square.className = "legend-square";
  square.dataset.level = index;
  square.setAttribute("role", "img");
  square.setAttribute("aria-label", levelLabel(index));
  square.title = levelLabel(index);
  return square;
}));

async function loadActivity() {
  const state = byId("load-state");
  const panel = document.querySelector(".activity-panel");
  panel.setAttribute("aria-busy", "true");
  state.hidden = false;
  state.textContent = "Loading case study activity…";
  byId("retry").hidden = true;
  try {
    const activityUrl = `./data/case_activity.json?v=${Date.now()}`;
    const response = await fetch(activityUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Activity request failed.");
    const payload = await response.json();
    const nextActivity = validateActivity(payload);
    const nextCases = validateCaseIndex(payload);
    activity = nextActivity;
    cases = nextCases;
    renderCalendar();
    state.hidden = true;
  } catch {
    activity = null;
    cases = {};
    byId("activity-content").hidden = true;
    state.textContent = "Case study activity could not be loaded. Please try again.";
    byId("retry").hidden = false;
  } finally {
    panel.setAttribute("aria-busy", "false");
  }
}

byId("retry").addEventListener("click", loadActivity);
// A static deployment still rolls forward when opened on a later day.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && activity && todayKey() !== displayedToday) renderCalendar();
});
window.setInterval(() => {
  if (activity && todayKey() !== displayedToday) renderCalendar();
}, 60_000);
loadActivity();
