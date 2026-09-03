import {
  LEVEL_THRESHOLDS, buildCalendar, countLabel, formatDay, levelLabel,
  navigationIndex, todayKey, validateActivity,
} from "./calendar.js";

const byId = (id) => document.getElementById(id);
const tooltip = byId("tooltip");
const grid = byId("heatmap");
const scroller = byId("heatmap-scroll");
let activity = null;
let displayedToday = null;
let buttons = [];
let selectedButton = null;

function hideTooltip() {
  tooltip.hidden = true;
}

function showTooltip(button) {
  tooltip.textContent = `${formatDay(button.dataset.date)}\n${countLabel(Number(button.dataset.count))}`;
  tooltip.hidden = false;
  const anchor = button.getBoundingClientRect();
  const box = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2))}px`;
  tooltip.style.top = `${anchor.top > box.height + 16 ? anchor.top - box.height - 9 : anchor.bottom + 9}px`;
}

function selectDay(button) {
  if (selectedButton) {
    selectedButton.setAttribute("aria-pressed", "false");
    selectedButton.tabIndex = -1;
  }
  selectedButton = button;
  button.tabIndex = 0;
  button.setAttribute("aria-pressed", "true");
  byId("selected-date").textContent = formatDay(button.dataset.date);
  byId("selected-count").textContent = countLabel(Number(button.dataset.count));
}

function dayButton(cell) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "day";
  button.dataset.date = cell.key;
  button.dataset.count = cell.count;
  button.dataset.level = cell.level;
  button.tabIndex = -1;
  button.setAttribute("aria-label", `${formatDay(cell.key)}: ${countLabel(cell.count)}`);
  button.setAttribute("aria-pressed", "false");
  if (cell.key === displayedToday) button.setAttribute("aria-current", "date");
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") showTooltip(button);
  });
  button.addEventListener("pointerleave", hideTooltip);
  button.addEventListener("focus", () => { selectDay(button); showTooltip(button); });
  button.addEventListener("blur", hideTooltip);
  button.addEventListener("click", () => { selectDay(button); showTooltip(button); });
  return button;
}

function renderCalendar() {
  displayedToday = todayKey();
  const calendar = buildCalendar(activity, displayedToday);
  byId("heatmap-layout").style.setProperty("--weeks", calendar.weeks);
  byId("date-range").textContent = `${formatDay(calendar.start, { month: "short", day: "numeric", year: "numeric" })} — ${formatDay(calendar.end, { month: "short", day: "numeric", year: "numeric" })}`;
  const fragment = document.createDocumentFragment();
  buttons = [];
  selectedButton = null;
  for (const cell of calendar.cells) {
    const element = cell.inRange ? dayButton(cell) : document.createElement("span");
    if (cell.inRange) buttons.push(element);
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
  byId("empty-state").hidden = calendar.cells.some((cell) => cell.inRange && cell.count > 0);
  selectDay(buttons.at(-1));
  byId("activity-content").hidden = false;
  // Start smaller screens at the most recent week, keeping all previous days scrollable.
  scroller.scrollLeft = scroller.scrollWidth;
}

grid.addEventListener("keydown", (event) => {
  const index = buttons.indexOf(event.target);
  if (index < 0) return;
  if (event.key === "Escape") { hideTooltip(); return; }
  const next = navigationIndex(index, event.key, buttons.map((button) => button.dataset.date), event.ctrlKey || event.metaKey);
  if (next === null) return;
  event.preventDefault();
  buttons[next].focus({ preventScroll: true });
  buttons[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  showTooltip(buttons[next]);
});
scroller.addEventListener("scroll", hideTooltip);
window.addEventListener("scroll", hideTooltip, { passive: true });
window.addEventListener("resize", hideTooltip);
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
    const response = await fetch("./data/case_activity.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Activity request failed.");
    activity = validateActivity(await response.json());
    renderCalendar();
    state.hidden = true;
  } catch {
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
