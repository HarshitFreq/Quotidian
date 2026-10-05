/**
 * ============================================================================
 * HABITS - Data Model & Storage Specification
 * Storage Key: 'quotidian.v1'
 * Version: 1
 * ============================================================================
 *
 * AppState Schema:
 * {
 *   version: 1,
 *   habits: [
 *     {
 *       id: string,                 // Unique ID (timestamp-entropy)
 *       name: string,               // Required, max 40 chars
 *       note?: string,              // Optional notes
 *       schedule: {
 *         type: "everyday" | "weekdays" | "weekends" | "custom",
 *         days: number[]            // [0..6] (0=Sun, 1=Mon, ..., 6=Sat)
 *       },
 *       target: {
 *         type: "boolean" | "count",// Once a day vs numeric counter
 *         count: number             // 1..10
 *       },
 *       group: "Morning" | "Afternoon" | "Evening" | "Anytime",
 *       color: "stone" | "ink" | "olive" | "rust" | "blue" | "sand" | null,
 *       startDate: string,          // Local YYYY-MM-DD
 *       archived: boolean,          // Excluded from Today & Review
 *       order: number,              // Manual sorting index
 *       completions: Record<string, number>, // "YYYY-MM-DD" -> count achieved
 *       bestStreak: number          // All-time highest streak
 *     }
 *   ],
 *   settings: {
 *     weekStartsOn: "monday" | "sunday",
 *     showArchivedInHabits: boolean,
 *     density: "comfortable" | "compact",
 *     reduceMotion: boolean,
 *     theme: "light" | "system",
 *     dateFormat: "weekday_day_month" | "day_month_year",
 *     confirmPermanentDelete: boolean
 *   }
 * }
 */

const STORAGE_KEY = 'quotidian.v1';
const SCHEMA_VERSION = 1;
const MAX_ACTIVE_HABITS = 24;

// Default initial state
const defaultState = {
  version: SCHEMA_VERSION,
  habits: [],
  notes: {}, // "YYYY-MM-DD" -> string note
  settings: {
    weekStartsOn: 'monday',
    showArchivedInHabits: true,
    density: 'comfortable',
    reduceMotion: false,
    theme: 'light',
    dateFormat: 'weekday_day_month',
    confirmPermanentDelete: true
  }
};

// Dev Date Override (commented out by default)
// const DEV_DATE_OVERRIDE = new Date('2026-10-06');
const DEV_DATE_OVERRIDE = null;

function getEffectiveDate() {
  return DEV_DATE_OVERRIDE ? new Date(DEV_DATE_OVERRIDE) : new Date();
}

/**
 * Returns the current time of day bucket: 'Morning', 'Afternoon', or 'Evening'.
 * 05:00 - 11:59 -> Morning
 * 12:00 - 16:59 -> Afternoon
 * 17:00 - 04:59 -> Evening
 */
function getCurrentTimeOfDay(date = getEffectiveDate()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  return 'Evening';
}

let state;
let todayFilter = 'all'; // 'all' | 'remaining' | 'now'
let selectedPastDate = null;
let heatmapYear = null;
let selectedHeatmapHabitId = 'all';
let focusedHabitIndex = 0;
let lastRenderedQuoteHour = null;

/**
 * Curated list of quiet, thoughtful quotes on consistency, craft, and daily living.
 */
const HOURLY_QUOTES = [
  { text: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { text: "First say to yourself what you would be; and then do what you have to do.", author: "Epictetus" },
  { text: "It is not that we have a short time to live, but that we waste a lot of it.", author: "Seneca" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "A journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Simplicity is about subtracting the obvious and adding the meaningful.", author: "John Maeda" },
  { text: "You do not rise to the level of your goals. You fall to the level of your systems.", author: "James Clear" },
  { text: "Quiet minds cannot be perplexed or frightened, but go on at their own private pace.", author: "Robert Louis Stevenson" },
  { text: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" },
  { text: "Nothing is so fatigue-inducing as the eternal hanging on of an uncompleted task.", author: "William James" },
  { text: "Day by day, what you choose, what you think and what you do is who you become.", author: "Heraclitus" },
  { text: "The art of being wise is the art of knowing what to overlook.", author: "William James" },
  { text: "Life is available only in the present moment.", author: "Thich Nhat Hanh" },
  { text: "Concentrate every minute like a Roman on doing what is in front of you with genuine seriousness.", author: "Marcus Aurelius" },
  { text: "Patience is also a form of action.", author: "Auguste Rodin" },
  { text: "Order your soul. Reduce your wants.", author: "Augustine" },
  { text: "Make each day your masterpiece.", author: "John Wooden" },
  { text: "In the depth of winter, I finally learned that within me there lay an invincible summer.", author: "Albert Camus" },
  { text: "Do not wait; the time will never be 'just right.' Start where you stand.", author: "Napoleon Hill" },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "An ounce of practice is generally worth more than a ton of theory.", author: "E. F. Schumacher" },
  { text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { text: "Well begun is half done.", author: "Aristotle" }
];

function getHourlyQuote(date = getEffectiveDate()) {
  const epochHours = Math.floor(date.getTime() / (1000 * 60 * 60));
  const idx = Math.abs(epochHours) % HOURLY_QUOTES.length;
  return HOURLY_QUOTES[idx];
}

function renderHourlyQuote() {
  const quoteTextEl = document.getElementById('today-quote-text');
  const quoteAuthorEl = document.getElementById('today-quote-author');
  if (!quoteTextEl || !quoteAuthorEl) return;

  const date = getEffectiveDate();
  lastRenderedQuoteHour = date.getHours();

  const quote = getHourlyQuote(date);
  quoteTextEl.textContent = `“${quote.text}”`;
  quoteAuthorEl.textContent = `— ${quote.author}`;
}

/**
 * ============================================================================
 * Pure Calendar & Date Helpers (Local Timezone YYYY-MM-DD)
 * ============================================================================
 */
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getShiftedDate(baseDate, dayOffset) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayOffset);
  return d;
}

function getShiftedDateString(baseDate, dayOffset) {
  return toLocalDateString(getShiftedDate(baseDate, dayOffset));
}

function formatUserDate(date, formatType = state.settings.dateFormat) {
  if (formatType === 'day_month_year') {
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  }
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday}, ${day} ${month}`;
}

/**
 * ============================================================================
 * Pure Schedule & Streak Calculation Functions
 * ============================================================================
 */

/**
 * Returns true if the habit is scheduled for the given calendar date.
 * Unscheduled if date is strictly before habit.startDate.
 */
function isHabitScheduledOnDate(habit, date) {
  const dateStr = toLocalDateString(date);
  if (dateStr < habit.startDate) return false;

  const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const type = habit.schedule.type;

  if (type === 'everyday') return true;
  if (type === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
  if (type === 'weekends') return dayOfWeek === 0 || dayOfWeek === 6;
  if (type === 'custom') {
    return Array.isArray(habit.schedule.days) && habit.schedule.days.includes(dayOfWeek);
  }
  return false;
}

/**
 * Returns true if habit reached complete target on dateStr.
 * Partial progress (e.g. 3/8) counts as not complete.
 */
function isHabitCompletedOnDate(habit, dateStr) {
  if (!habit.completions || dateStr < habit.startDate) return false;
  const count = habit.completions[dateStr] || 0;
  if (habit.target.type === 'count') {
    return count >= habit.target.count;
  }
  return count >= 1;
}

/**
 * Pure Streak Calculation.
 *
 * Cases covered:
 * 1. Scheduled today & completed: streak includes today and walks back through past scheduled days.
 * 2. Scheduled today & incomplete: streak cannot include today; walks back from yesterday.
 * 3. Not scheduled today: skips today and walks back from the most recent scheduled day.
 * 4. Unscheduled days: skipped entirely (e.g. weekdays do not break a weekends-only streak).
 * 5. Missed scheduled day: breaks the streak immediately (returns 0 or streak up to that point).
 * 6. Start Date: days before habit.startDate do not count and terminate the walk.
 */
function calculateStreak(habit, refDate = getEffectiveDate()) {
  const todayStr = toLocalDateString(refDate);
  if (todayStr < habit.startDate) return 0;

  const isTodayScheduled = isHabitScheduledOnDate(habit, refDate);
  const isTodayDone = isTodayScheduled && isHabitCompletedOnDate(habit, todayStr);

  let streak = 0;
  let offset = 0;

  if (isTodayScheduled) {
    if (isTodayDone) {
      streak = 1;
      offset = -1;
    } else {
      // Today was scheduled but not completed yet. Walk starts yesterday.
      offset = -1;
    }
  } else {
    // Today is unscheduled. Walk starts yesterday.
    offset = -1;
  }

  // Walk backwards day by day until habit.startDate
  while (true) {
    const curDate = getShiftedDate(refDate, offset);
    const curDateStr = toLocalDateString(curDate);
    if (curDateStr < habit.startDate) break;

    if (isHabitScheduledOnDate(habit, curDate)) {
      if (isHabitCompletedOnDate(habit, curDateStr)) {
        streak += 1;
      } else {
        // Missed scheduled day breaks the streak
        break;
      }
    }
    offset -= 1;
  }

  return streak;
}

/**
 * Computes all-time best streak by replaying history from habit.startDate to refDate.
 */
function computeBestStreak(habit, refDate = getEffectiveDate()) {
  let maxStreak = habit.bestStreak || 0;
  let currentRun = 0;
  const start = parseLocalDate(habit.startDate);
  const todayStr = toLocalDateString(refDate);

  let cur = new Date(start);
  while (toLocalDateString(cur) <= todayStr) {
    if (isHabitScheduledOnDate(habit, cur)) {
      const curStr = toLocalDateString(cur);
      if (isHabitCompletedOnDate(habit, curStr)) {
        currentRun += 1;
        if (currentRun > maxStreak) maxStreak = currentRun;
      } else {
        currentRun = 0;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  return maxStreak;
}

/**
 * Calculates completion rate over the last 28 scheduled days on or before refDate.
 */
function calculate28DayStats(habit, refDate = getEffectiveDate()) {
  let scheduledCount = 0;
  let completedCount = 0;
  let offset = 0;

  while (scheduledCount < 28) {
    const d = getShiftedDate(refDate, offset);
    const dStr = toLocalDateString(d);
    if (dStr < habit.startDate) break;

    if (isHabitScheduledOnDate(habit, d)) {
      scheduledCount += 1;
      if (isHabitCompletedOnDate(habit, dStr)) {
        completedCount += 1;
      }
    }
    offset -= 1;
  }

  if (scheduledCount === 0) return { scheduledCount: 0, completedCount: 0, percentage: 0 };
  const percentage = Math.round((completedCount / scheduledCount) * 100);
  return { scheduledCount, completedCount, percentage };
}

/**
 * ============================================================================
 * State Persistence Layer
 * ============================================================================
 */
/**
 * Generates rich, realistic test data covering all features across 2026.
 */
function generateSampleData() {
  const today = getEffectiveDate();
  const todayStr = toLocalDateString(today);

  function getPast(offsetDays) {
    return getShiftedDateString(today, -offsetDays);
  }

  // 1. Morning meditation: 14-day current streak ending today
  const meditationCompletions = {};
  for (let i = 0; i < 14; i++) {
    meditationCompletions[getPast(i)] = 1;
  }
  for (let i = 16; i < 60; i++) {
    if (i % 9 !== 0) meditationCompletions[getPast(i)] = 1;
  }

  // 2. Water (count: 8): partial today (5 of 8)
  const waterCompletions = {};
  waterCompletions[todayStr] = 5;
  for (let i = 1; i < 45; i++) {
    waterCompletions[getPast(i)] = (i % 7 === 0) ? 4 : 8;
  }

  // 3. Deep work (weekdays): today not completed yet
  const deepWorkCompletions = {};
  for (let i = 1; i < 60; i++) {
    const d = getShiftedDate(today, -i);
    const day = d.getDay();
    if (day >= 1 && day <= 5 && i % 4 !== 0) {
      deepWorkCompletions[toLocalDateString(d)] = 1;
    }
  }

  // 4. Read 20 pages (everyday): completed today, extensive past history
  const readingCompletions = {};
  readingCompletions[todayStr] = 1;
  for (let i = 1; i < 110; i++) {
    if (i % 11 !== 0) {
      readingCompletions[getPast(i)] = 1;
    }
  }

  // 5. Strength training (custom Mon, Wed, Fri): unscheduled today (Tuesday)
  const gymCompletions = {};
  for (let i = 1; i < 70; i++) {
    const d = getShiftedDate(today, -i);
    const day = d.getDay();
    if ([1, 3, 5].includes(day) && i % 8 !== 0) {
      gymCompletions[toLocalDateString(d)] = 1;
    }
  }

  // 6. Long weekend run (weekends): unscheduled today (Tuesday)
  const runCompletions = {};
  for (let i = 1; i < 80; i++) {
    const d = getShiftedDate(today, -i);
    const day = d.getDay();
    if ((day === 0 || day === 6) && i % 5 !== 0) {
      runCompletions[toLocalDateString(d)] = 1;
    }
  }

  // 7. Evening reflection: yesterday & 2 days ago done, 3 days ago missed
  const reflectCompletions = {};
  reflectCompletions[getPast(1)] = 1;
  reflectCompletions[getPast(2)] = 1;
  for (let i = 4; i < 45; i++) {
    if (i % 3 !== 0) reflectCompletions[getPast(i)] = 1;
  }

  // 8. Spanish grammar (archived)
  const spanishCompletions = {};
  for (let i = 35; i < 120; i++) {
    if (i % 2 === 0) spanishCompletions[getPast(i)] = 1;
  }

  return [
    {
      id: 'demo-meditation',
      name: 'Morning meditation',
      note: '15 minutes mindfulness',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Morning',
      color: 'stone',
      startDate: getPast(75),
      archived: false,
      order: 0,
      completions: meditationCompletions,
      bestStreak: 21
    },
    {
      id: 'demo-deepwork',
      name: 'Deep work focus block',
      note: '90 minutes uninterrupted',
      schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
      target: { type: 'boolean', count: 1 },
      group: 'Morning',
      color: 'ink',
      startDate: getPast(60),
      archived: false,
      order: 1,
      completions: deepWorkCompletions,
      bestStreak: 15
    },
    {
      id: 'demo-water',
      name: 'Drink 8 glasses of water',
      note: 'Hydration through the day',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'count', count: 8 },
      group: 'Anytime',
      color: 'blue',
      startDate: getPast(90),
      archived: false,
      order: 2,
      completions: waterCompletions,
      bestStreak: 18
    },
    {
      id: 'demo-gym',
      name: 'Strength training',
      note: 'Compound lifts or bodyweight',
      schedule: { type: 'custom', days: [1, 3, 5] },
      target: { type: 'boolean', count: 1 },
      group: 'Afternoon',
      color: 'rust',
      startDate: getPast(70),
      archived: false,
      order: 3,
      completions: gymCompletions,
      bestStreak: 10
    },
    {
      id: 'demo-run',
      name: 'Long weekend run',
      note: 'Aerobic base building',
      schedule: { type: 'weekends', days: [0, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Morning',
      color: 'sand',
      startDate: getPast(80),
      archived: false,
      order: 4,
      completions: runCompletions,
      bestStreak: 8
    },
    {
      id: 'demo-reading',
      name: 'Read 20 pages',
      note: 'Fiction or philosophy',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Evening',
      color: 'olive',
      startDate: getPast(110),
      archived: false,
      order: 5,
      completions: readingCompletions,
      bestStreak: 32
    },
    {
      id: 'demo-journal',
      name: 'Evening reflection & notes',
      note: 'Highlights, gratitude, tomorrow plan',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Evening',
      color: null,
      startDate: getPast(45),
      archived: false,
      order: 6,
      completions: reflectCompletions,
      bestStreak: 11
    },
    {
      id: 'demo-spanish',
      name: 'Spanish grammar practice',
      note: 'Vocabulary flashcards & verbs',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Anytime',
      color: 'stone',
      startDate: getPast(150),
      archived: true,
      order: 7,
      completions: spanishCompletions,
      bestStreak: 19
    }
  ];
}

function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem('habits_v1');
    }
    if (!raw) {
      return {
        ...defaultState,
        habits: generateSampleData(),
        notes: {}
      };
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === SCHEMA_VERSION) {
      const habits = Array.isArray(parsed.habits) && parsed.habits.length > 0
        ? parsed.habits
        : generateSampleData();
      return {
        ...defaultState,
        ...parsed,
        habits,
        notes: parsed.notes || {},
        settings: { ...defaultState.settings, ...(parsed.settings || {}) }
      };
    }
  } catch (err) {
    console.error('Failed to load state', err);
  }
  return {
    ...defaultState,
    habits: generateSampleData(),
    notes: {}
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save state', err);
  }
}

// Initialize Application State
state = loadState();
saveState();

/**
 * ============================================================================
 * Backend API Client (Syncs with SQLite / Express when hosted)
 * ============================================================================
 */
async function apiCall(endpoint, options = {}) {
  try {
    const res = await fetch(endpoint, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // Graceful fallback for offline / static mode
    return null;
  }
}

async function syncFromBackend() {
  const data = await apiCall('/api/state');
  if (data && data.version === SCHEMA_VERSION && Array.isArray(data.habits)) {
    state = {
      ...defaultState,
      ...data,
      notes: data.notes || state.notes || {},
      settings: { ...defaultState.settings, ...(data.settings || {}) }
    };
    saveState();
    renderActiveView();
  }
}

/**
 * ============================================================================
 * Routing & View Switching
 * ============================================================================
 */
function getActiveRoute() {
  const hash = window.location.hash.toLowerCase().replace('#', '');
  if (['today', 'habits', 'review', 'settings'].includes(hash)) {
    return hash;
  }
  return 'today';
}

function handleRoute() {
  const route = getActiveRoute();

  // Update nav links
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.view === route);
  });

  // Switch panels
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${route}`);
  });

  renderActiveView(route);
}

function renderActiveView(route = getActiveRoute()) {
  applySettingsClasses();
  updateTopBarCount();

  if (route === 'today') renderTodayView();
  else if (route === 'habits') renderHabitsView();
  else if (route === 'review') renderReviewView();
  else if (route === 'settings') renderSettingsView();
}

function applySettingsClasses() {
  const { density, reduceMotion, theme } = state.settings;
  document.body.classList.toggle('density-compact', density === 'compact');
  document.body.classList.toggle('reduce-motion', !!reduceMotion);

  document.body.classList.remove('theme-light', 'theme-dark', 'theme-system');
  if (theme === 'system') {
    document.body.classList.add('theme-system');
  } else {
    document.body.classList.add('theme-light');
  }
}

function updateTopBarCount() {
  const today = getEffectiveDate();
  const todayStr = toLocalDateString(today);
  const scheduled = state.habits.filter((h) => !h.archived && isHabitScheduledOnDate(h, today));
  const completed = scheduled.filter((h) => isHabitCompletedOnDate(h, todayStr));

  const badge = document.getElementById('top-bar-count');
  if (badge) {
    badge.textContent = `${completed.length}/${scheduled.length} today`;
  }
}

/**
 * ============================================================================
 * VIEW 1: TODAY
 * ============================================================================
 */
function renderTodayView() {
  const today = getEffectiveDate();
  const todayStr = toLocalDateString(today);
  const currentTimePeriod = getCurrentTimeOfDay(today);

  // Date Header
  const dateLine = document.getElementById('today-date-line');
  if (dateLine) {
    dateLine.textContent = formatUserDate(today);
  }

  // Active scheduled habits for today
  const allScheduledHabits = state.habits
    .filter((h) => !h.archived && isHabitScheduledOnDate(h, today))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const totalCount = allScheduledHabits.length;
  const completedCount = allScheduledHabits.filter((h) => isHabitCompletedOnDate(h, todayStr)).length;
  const remainingCount = totalCount - completedCount;

  const nowHabits = allScheduledHabits.filter((h) => {
    const grp = h.group || 'Anytime';
    return grp === currentTimePeriod || grp === 'Anytime';
  });
  const nowCount = nowHabits.length;

  // Progress UI
  const progressText = document.getElementById('today-progress-text');
  const progressFill = document.getElementById('today-progress-fill');
  if (progressText && progressFill) {
    progressText.textContent = `${completedCount} of ${totalCount}`;
    const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    progressFill.style.width = `${pct}%`;
  }

  // Update Filter Tabs Counts and Active State
  const countAllEl = document.getElementById('filter-count-all');
  const countRemEl = document.getElementById('filter-count-remaining');
  const countNowEl = document.getElementById('filter-count-now');
  if (countAllEl) countAllEl.textContent = totalCount;
  if (countRemEl) countRemEl.textContent = remainingCount;
  if (countNowEl) countNowEl.textContent = nowCount;

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.filter === todayFilter);
  });

  // Daily Reflection Note
  const dailyNoteInput = document.getElementById('today-daily-note-input');
  if (dailyNoteInput) {
    if (document.activeElement !== dailyNoteInput) {
      dailyNoteInput.value = (state.notes && state.notes[todayStr]) || '';
    }
  }

  // Quiet All Done banner
  const allDoneBanner = document.getElementById('today-all-done');
  const allDoneText = document.getElementById('all-done-text');
  if (allDoneBanner) {
    if (totalCount > 0 && completedCount === totalCount) {
      allDoneBanner.hidden = false;
      if (allDoneText) {
        allDoneText.textContent = `All ${totalCount} habits completed for today.`;
      }
    } else {
      allDoneBanner.hidden = true;
    }
  }

  // Filter habits according to todayFilter
  let displayedHabits = allScheduledHabits;
  if (todayFilter === 'remaining') {
    displayedHabits = allScheduledHabits.filter((h) => !isHabitCompletedOnDate(h, todayStr));
  } else if (todayFilter === 'now') {
    displayedHabits = nowHabits;
  }

  const container = document.getElementById('today-groups-container');
  const emptyState = document.getElementById('today-empty-state');
  if (!container || !emptyState) return;

  container.innerHTML = '';

  if (state.habits.filter((h) => !h.archived).length === 0) {
    emptyState.textContent = 'Nothing for today.';
    emptyState.hidden = false;
    return;
  }

  if (displayedHabits.length === 0) {
    if (todayFilter === 'remaining' && totalCount > 0) {
      emptyState.textContent = 'All remaining habits are complete for today.';
    } else if (todayFilter === 'now') {
      emptyState.textContent = `No habits scheduled for ${currentTimePeriod.toLowerCase()}.`;
    } else {
      emptyState.textContent = 'Nothing for today.';
    }
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  // Group by Morning, Afternoon, Evening, Anytime
  const groups = ['Morning', 'Afternoon', 'Evening', 'Anytime'];
  const habitElements = [];

  groups.forEach((groupName) => {
    const groupHabits = displayedHabits.filter((h) => (h.group || 'Anytime') === groupName);
    if (groupHabits.length === 0) return;

    const groupHeading = document.createElement('h3');
    groupHeading.className = 'group-label';
    groupHeading.textContent = groupName.toUpperCase();
    container.appendChild(groupHeading);

    const ul = document.createElement('ul');
    ul.className = 'habit-list';

    groupHabits.forEach((habit) => {
      const isDone = isHabitCompletedOnDate(habit, todayStr);
      const streak = calculateStreak(habit, today);
      const curCount = (habit.completions && habit.completions[todayStr]) || 0;

      const li = document.createElement('li');
      li.className = `habit-row${isDone ? ' completed' : ''}${habit.color ? ` tick-${habit.color}` : ''}`;
      li.dataset.habitId = habit.id;

      habitElements.push(li);

      // Main Left Column
      const mainDiv = document.createElement('div');
      mainDiv.className = 'habit-main';

      if (habit.target.type === 'count') {
        // Stepper control
        const stepper = document.createElement('div');
        stepper.className = 'stepper-container';

        const decBtn = document.createElement('button');
        decBtn.type = 'button';
        decBtn.className = 'stepper-btn';
        decBtn.textContent = '−';
        decBtn.disabled = curCount <= 0;
        decBtn.addEventListener('click', () => updateHabitCount(habit.id, todayStr, -1));

        const countSpan = document.createElement('span');
        countSpan.className = 'stepper-count';
        countSpan.textContent = `${curCount}/${habit.target.count}`;

        const incBtn = document.createElement('button');
        incBtn.type = 'button';
        incBtn.className = 'stepper-btn';
        incBtn.textContent = '+';
        incBtn.disabled = curCount >= 10;
        incBtn.addEventListener('click', () => updateHabitCount(habit.id, todayStr, 1));

        stepper.appendChild(decBtn);
        stepper.appendChild(countSpan);
        stepper.appendChild(incBtn);
        mainDiv.appendChild(stepper);
      } else {
        // Single Checkbox
        const label = document.createElement('label');
        label.className = 'checkbox-container';
        label.setAttribute('aria-label', `Mark ${habit.name} complete`);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'checkbox-input';
        checkbox.checked = isDone;
        checkbox.addEventListener('change', () => toggleHabitCompletion(habit.id, todayStr));

        const box = document.createElement('span');
        box.className = 'checkbox-box';

        label.appendChild(checkbox);
        label.appendChild(box);
        mainDiv.appendChild(label);
      }

      // Name & Note
      const contentDiv = document.createElement('div');
      contentDiv.className = 'habit-content';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'habit-name';
      nameSpan.textContent = habit.name;
      contentDiv.appendChild(nameSpan);

      if (habit.note && habit.note.trim()) {
        const noteSpan = document.createElement('span');
        noteSpan.className = 'habit-note';
        noteSpan.textContent = habit.note.trim();
        contentDiv.appendChild(noteSpan);
      }

      mainDiv.appendChild(contentDiv);

      // Meta (Streak)
      const metaDiv = document.createElement('div');
      metaDiv.className = 'habit-meta';

      const streakSpan = document.createElement('span');
      streakSpan.className = 'habit-streak';
      streakSpan.textContent = `${streak}d`;
      metaDiv.appendChild(streakSpan);

      li.appendChild(mainDiv);
      li.appendChild(metaDiv);
      ul.appendChild(li);
    });

    container.appendChild(ul);
  });

  // Maintain keyboard focus index highlight
  if (habitElements.length > 0) {
    if (focusedHabitIndex >= habitElements.length) focusedHabitIndex = 0;
    habitElements[focusedHabitIndex].classList.add('focused');
  }

  // Render the current hourly quote in the footer
  renderHourlyQuote();
}

function toggleHabitCompletion(habitId, dateStr) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  if (!habit.completions) habit.completions = {};
  const current = habit.completions[dateStr] || 0;

  if (habit.target.type === 'count') {
    habit.completions[dateStr] = current >= habit.target.count ? 0 : habit.target.count;
  } else {
    habit.completions[dateStr] = current >= 1 ? 0 : 1;
  }

  habit.bestStreak = computeBestStreak(habit, getEffectiveDate());
  saveState();
  renderActiveView();

  apiCall(`/api/habits/${habitId}/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr, count: habit.completions[dateStr] })
  });
}

function updateHabitCount(habitId, dateStr, delta) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  if (!habit.completions) habit.completions = {};
  const current = habit.completions[dateStr] || 0;
  const next = Math.max(0, Math.min(10, current + delta));
  habit.completions[dateStr] = next;

  habit.bestStreak = computeBestStreak(habit, getEffectiveDate());
  saveState();
  renderActiveView();

  apiCall(`/api/habits/${habitId}/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr, count: next })
  });
}

/**
 * ============================================================================
 * VIEW 2: HABITS (LIBRARY)
 * ============================================================================
 */
let editingHabitId = null;

function renderHabitsView() {
  const listEl = document.getElementById('library-list');
  const emptyEl = document.getElementById('library-empty-state');
  const capWarningEl = document.getElementById('habit-cap-warning');
  if (!listEl) return;

  listEl.innerHTML = '';

  const activeHabitsCount = state.habits.filter((h) => !h.archived).length;
  const isCapped = activeHabitsCount >= MAX_ACTIVE_HABITS;

  if (capWarningEl) {
    capWarningEl.hidden = !isCapped;
  }

  const toggleBtn = document.getElementById('toggle-add-form-btn');
  if (toggleBtn) {
    toggleBtn.disabled = isCapped;
  }

  let visibleHabits = state.settings.showArchivedInHabits
    ? [...state.habits]
    : state.habits.filter((h) => !h.archived);

  visibleHabits.sort((a, b) => (a.order || 0) - (b.order || 0));

  if (visibleHabits.length === 0) {
    if (emptyEl) {
      emptyEl.textContent = 'Nothing for today.';
      emptyEl.hidden = false;
    }
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  visibleHabits.forEach((habit, idx) => {
    const row = document.createElement('div');
    row.className = `library-row${habit.archived ? ' archived' : ''}`;

    // Left info + reorder buttons
    const leftDiv = document.createElement('div');
    leftDiv.className = 'library-left';

    const orderDiv = document.createElement('div');
    orderDiv.className = 'order-controls';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'order-btn';
    upBtn.textContent = '▲';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => moveHabitOrder(habit.id, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'order-btn';
    downBtn.textContent = '▼';
    downBtn.disabled = idx === visibleHabits.length - 1;
    downBtn.addEventListener('click', () => moveHabitOrder(habit.id, 1));

    orderDiv.appendChild(upBtn);
    orderDiv.appendChild(downBtn);
    leftDiv.appendChild(orderDiv);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'library-info';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'library-name';
    nameSpan.textContent = habit.name;
    infoDiv.appendChild(nameSpan);

    const subSpan = document.createElement('div');
    subSpan.className = 'library-sub';
    const schedText = habit.schedule.type === 'everyday' ? 'Every day'
      : habit.schedule.type === 'weekdays' ? 'Weekdays'
      : habit.schedule.type === 'weekends' ? 'Weekends'
      : 'Custom days';
    const targetText = habit.target.type === 'count' ? `${habit.target.count} times` : 'Once a day';
    subSpan.textContent = `${schedText} · ${targetText}${habit.group ? ` · ${habit.group}` : ''}${habit.archived ? ' · (Archived)' : ''}`;
    infoDiv.appendChild(subSpan);

    leftDiv.appendChild(infoDiv);
    row.appendChild(leftDiv);

    // Actions (Edit, Archive/Restore, Delete)
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'library-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'text-btn';
    editBtn.textContent = editingHabitId === habit.id ? 'Close' : 'Edit';
    editBtn.addEventListener('click', () => {
      editingHabitId = editingHabitId === habit.id ? null : habit.id;
      renderHabitsView();
    });
    actionsDiv.appendChild(editBtn);

    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'text-btn';
    archiveBtn.textContent = habit.archived ? 'Restore' : 'Archive';
    archiveBtn.addEventListener('click', () => toggleArchiveHabit(habit.id));
    actionsDiv.appendChild(archiveBtn);

    // In-place Delete Button
    const deleteWrapper = document.createElement('span');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'text-btn';
    deleteBtn.textContent = 'Delete';

    deleteBtn.addEventListener('click', () => {
      if (!state.settings.confirmPermanentDelete) {
        deleteHabitPermanently(habit.id);
        return;
      }
      // In-place confirmation
      deleteWrapper.innerHTML = `
        <span class="inline-confirm">
          Delete?
          <button type="button" class="confirm-delete">Yes</button>
          <button type="button" class="cancel-delete">No</button>
        </span>
      `;
      deleteWrapper.querySelector('.confirm-delete').addEventListener('click', () => deleteHabitPermanently(habit.id));
      deleteWrapper.querySelector('.cancel-delete').addEventListener('click', () => renderHabitsView());
    });

    deleteWrapper.appendChild(deleteBtn);
    actionsDiv.appendChild(deleteWrapper);

    row.appendChild(actionsDiv);
    listEl.appendChild(row);

    // Inline Edit Disclosure
    if (editingHabitId === habit.id) {
      const editPanel = createInlineEditPanel(habit);
      listEl.appendChild(editPanel);
    }
  });
}

function moveHabitOrder(habitId, delta) {
  const index = state.habits.findIndex((h) => h.id === habitId);
  if (index === -1) return;
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= state.habits.length) return;

  const temp = state.habits[index];
  state.habits[index] = state.habits[targetIndex];
  state.habits[targetIndex] = temp;

  state.habits.forEach((h, i) => { h.order = i; });
  saveState();
  renderHabitsView();

  apiCall('/api/habits/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds: state.habits.map((h) => h.id) })
  });
}

function toggleArchiveHabit(habitId) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;
  habit.archived = !habit.archived;
  saveState();
  renderActiveView();

  apiCall(`/api/habits/${habitId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: habit.archived })
  });
}

function deleteHabitPermanently(habitId) {
  state.habits = state.habits.filter((h) => h.id !== habitId);
  if (editingHabitId === habitId) editingHabitId = null;
  saveState();
  renderActiveView();

  apiCall(`/api/habits/${habitId}`, {
    method: 'DELETE'
  });
}

function createInlineEditPanel(habit) {
  const panel = document.createElement('div');
  panel.className = 'inline-edit-panel form-disclosure';

  panel.innerHTML = `
    <h4 class="form-title">Edit Habit</h4>
    <div class="form-grid">
      <div class="form-group full-width">
        <label class="form-label">Name</label>
        <input type="text" class="form-input edit-name" maxlength="40" value="${escapeHtml(habit.name)}">
      </div>
      <div class="form-group full-width">
        <label class="form-label">Note</label>
        <input type="text" class="form-input edit-note" maxlength="100" value="${escapeHtml(habit.note || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Schedule</label>
        <select class="form-select edit-schedule-type">
          <option value="everyday" ${habit.schedule.type === 'everyday' ? 'selected' : ''}>Every day</option>
          <option value="weekdays" ${habit.schedule.type === 'weekdays' ? 'selected' : ''}>Weekdays</option>
          <option value="weekends" ${habit.schedule.type === 'weekends' ? 'selected' : ''}>Weekends</option>
          <option value="custom" ${habit.schedule.type === 'custom' ? 'selected' : ''}>Custom days</option>
        </select>
      </div>
      <div class="form-group edit-custom-days-group" ${habit.schedule.type !== 'custom' ? 'hidden' : ''}>
        <label class="form-label">Custom Days</label>
        <div class="day-toggles edit-day-toggles">
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(1) ? 'active' : ''}" data-day="1">Mon</button>
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(2) ? 'active' : ''}" data-day="2">Tue</button>
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(3) ? 'active' : ''}" data-day="3">Wed</button>
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(4) ? 'active' : ''}" data-day="4">Thu</button>
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(5) ? 'active' : ''}" data-day="5">Fri</button>
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(6) ? 'active' : ''}" data-day="6">Sat</button>
          <button type="button" class="day-toggle-btn ${(habit.schedule.days || []).includes(0) ? 'active' : ''}" data-day="0">Sun</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Target</label>
        <select class="form-select edit-target-type">
          <option value="boolean" ${habit.target.type === 'boolean' ? 'selected' : ''}>Once a day</option>
          <option value="count" ${habit.target.type === 'count' ? 'selected' : ''}>Count</option>
        </select>
      </div>
      <div class="form-group edit-target-count-group" ${habit.target.type !== 'count' ? 'hidden' : ''}>
        <label class="form-label">Target Count (1–10)</label>
        <input type="number" class="form-input edit-target-count" min="1" max="10" value="${habit.target.count || 8}">
      </div>
      <div class="form-group">
        <label class="form-label">Group</label>
        <select class="form-select edit-group">
          <option value="Anytime" ${habit.group === 'Anytime' ? 'selected' : ''}>Anytime</option>
          <option value="Morning" ${habit.group === 'Morning' ? 'selected' : ''}>Morning</option>
          <option value="Afternoon" ${habit.group === 'Afternoon' ? 'selected' : ''}>Afternoon</option>
          <option value="Evening" ${habit.group === 'Evening' ? 'selected' : ''}>Evening</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Left Tick Color</label>
        <select class="form-select edit-color">
          <option value="none" ${!habit.color ? 'selected' : ''}>None</option>
          <option value="stone" ${habit.color === 'stone' ? 'selected' : ''}>Stone</option>
          <option value="ink" ${habit.color === 'ink' ? 'selected' : ''}>Ink</option>
          <option value="olive" ${habit.color === 'olive' ? 'selected' : ''}>Olive</option>
          <option value="rust" ${habit.color === 'rust' ? 'selected' : ''}>Rust</option>
          <option value="blue" ${habit.color === 'blue' ? 'selected' : ''}>Blue</option>
          <option value="sand" ${habit.color === 'sand' ? 'selected' : ''}>Sand</option>
        </select>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn-secondary cancel-edit">Cancel</button>
      <button type="button" class="btn-primary save-edit">Save Changes</button>
    </div>
  `;

  // Dynamic show/hide
  const schedSelect = panel.querySelector('.edit-schedule-type');
  const customDaysGrp = panel.querySelector('.edit-custom-days-group');
  schedSelect.addEventListener('change', () => {
    customDaysGrp.hidden = schedSelect.value !== 'custom';
  });

  const targetSelect = panel.querySelector('.edit-target-type');
  const targetCountGrp = panel.querySelector('.edit-target-count-group');
  targetSelect.addEventListener('change', () => {
    targetCountGrp.hidden = targetSelect.value !== 'count';
  });

  // Day toggle clicks
  panel.querySelectorAll('.edit-day-toggles .day-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  panel.querySelector('.cancel-edit').addEventListener('click', () => {
    editingHabitId = null;
    renderHabitsView();
  });

  panel.querySelector('.save-edit').addEventListener('click', () => {
    const nameVal = panel.querySelector('.edit-name').value.trim();
    if (!nameVal) return;

    habit.name = nameVal;
    habit.note = panel.querySelector('.edit-note').value.trim() || undefined;
    habit.schedule.type = schedSelect.value;
    if (schedSelect.value === 'custom') {
      const days = [];
      panel.querySelectorAll('.edit-day-toggles .day-toggle-btn.active').forEach((b) => {
        days.push(Number(b.dataset.day));
      });
      habit.schedule.days = days;
    }
    habit.target.type = targetSelect.value;
    if (targetSelect.value === 'count') {
      habit.target.count = Math.max(1, Math.min(10, Number(panel.querySelector('.edit-target-count').value) || 1));
    } else {
      habit.target.count = 1;
    }
    habit.group = panel.querySelector('.edit-group').value;
    const colVal = panel.querySelector('.edit-color').value;
    habit.color = colVal === 'none' ? null : colVal;

    habit.bestStreak = computeBestStreak(habit, getEffectiveDate());
    editingHabitId = null;
    saveState();
    renderActiveView();

    apiCall(`/api/habits/${habit.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(habit)
    });
  });

  return panel;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * ============================================================================
 * VIEW 3: REVIEW
 * ============================================================================
 */
function renderReviewView() {
  renderWeekStrip();
  renderMonthGrid();
  renderYearHeatmap();
  renderPerformanceTable();
}

function renderWeekStrip() {
  const headerTr = document.getElementById('week-strip-header');
  const bodyTb = document.getElementById('week-strip-body');
  if (!headerTr || !bodyTb) return;

  headerTr.innerHTML = '<th></th>';
  bodyTb.innerHTML = '';

  const ref = getEffectiveDate();
  const weekStartDay = state.settings.weekStartsOn === 'sunday' ? 0 : 1;
  const currentDay = ref.getDay();

  // Compute offset to start of this week
  let diff = currentDay - weekStartDay;
  if (diff < 0) diff += 7;

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = getShiftedDate(ref, -diff + i);
    weekDays.push(d);
  }

  // Header column days
  weekDays.forEach((d) => {
    const th = document.createElement('th');
    th.textContent = d.toLocaleDateString('en-US', { weekday: 'short' })[0];
    headerTr.appendChild(th);
  });

  const activeHabits = state.habits.filter((h) => !h.archived);
  activeHabits.forEach((habit) => {
    const tr = document.createElement('tr');

    const titleTd = document.createElement('td');
    titleTd.className = 'habit-title-col';
    titleTd.textContent = habit.name;
    tr.appendChild(titleTd);

    weekDays.forEach((d) => {
      const td = document.createElement('td');
      const dStr = toLocalDateString(d);
      const isSched = isHabitScheduledOnDate(habit, d);
      const isDone = isSched && isHabitCompletedOnDate(habit, dStr);

      const box = document.createElement('div');
      box.className = 'week-cell-box';

      if (!isSched) {
        box.classList.add('unscheduled');
        box.textContent = '·';
      } else if (isDone) {
        box.classList.add('done');
      }

      td.appendChild(box);
      tr.appendChild(td);
    });

    bodyTb.appendChild(tr);
  });
}

function renderMonthGrid() {
  const calendarGrid = document.getElementById('month-calendar-grid');
  const monthTitle = document.getElementById('month-name-display');
  if (!calendarGrid) return;

  calendarGrid.innerHTML = '';

  const ref = getEffectiveDate();
  const year = ref.getFullYear();
  const month = ref.getMonth();

  if (monthTitle) {
    monthTitle.textContent = ref.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Weekday column headers
  const weekStartDay = state.settings.weekStartsOn === 'sunday' ? 0 : 1;
  const daysHeader = weekStartDay === 0
    ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  daysHeader.forEach((lbl) => {
    const h = document.createElement('div');
    h.className = 'calendar-header-day';
    h.textContent = lbl;
    calendarGrid.appendChild(h);
  });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  let startOffset = firstDay.getDay() - weekStartDay;
  if (startOffset < 0) startOffset += 7;

  // Empty leading cells
  for (let i = 0; i < startOffset; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day-cell empty';
    calendarGrid.appendChild(emptyCell);
  }

  const todayStr = toLocalDateString(ref);

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const curDate = new Date(year, month, dayNum);
    const dateStr = toLocalDateString(curDate);
    const isFuture = dateStr > todayStr;
    const isSelected = selectedPastDate === dateStr;

    const cell = document.createElement('div');
    cell.className = `calendar-day-cell${isFuture ? ' future' : ''}${isSelected ? ' selected' : ''}`;

    const numSpan = document.createElement('span');
    numSpan.textContent = dayNum;
    cell.appendChild(numSpan);

    // Compute completion ratio for this day across scheduled habits
    const activeHabits = state.habits.filter((h) => !h.archived);
    const scheduled = activeHabits.filter((h) => isHabitScheduledOnDate(h, curDate));
    const completed = scheduled.filter((h) => isHabitCompletedOnDate(h, dateStr));

    const indicator = document.createElement('div');
    indicator.className = 'calendar-indicator';

    if (scheduled.length === 0) {
      indicator.classList.add('ratio-none');
    } else if (completed.length === scheduled.length) {
      indicator.classList.add('ratio-full');
    } else if (completed.length > 0) {
      indicator.classList.add('ratio-half');
    } else {
      indicator.classList.add('ratio-none');
    }

    cell.appendChild(indicator);

    if (!isFuture) {
      cell.addEventListener('click', () => {
        selectedPastDate = dateStr;
        renderMonthGrid();
        renderPastDayInspector(curDate);
      });
    }

    calendarGrid.appendChild(cell);
  }

  if (selectedPastDate && selectedPastDate <= todayStr) {
    renderPastDayInspector(parseLocalDate(selectedPastDate));
  }
}

function renderPastDayInspector(date) {
  const panel = document.getElementById('past-day-inspector');
  const title = document.getElementById('inspector-date-title');
  const list = document.getElementById('inspector-habits-list');
  const noteInput = document.getElementById('inspector-daily-note-input');
  if (!panel || !list) return;

  const dateStr = toLocalDateString(date);
  title.textContent = `Completions for ${formatUserDate(date)}`;
  list.innerHTML = '';

  if (noteInput) {
    noteInput.value = (state.notes && state.notes[dateStr]) || '';
    noteInput.oninput = (e) => {
      const val = e.target.value.trim();
      state.notes = state.notes || {};
      if (val) {
        state.notes[dateStr] = val;
      } else {
        delete state.notes[dateStr];
      }
      saveState();
      apiCall(`/api/notes/${dateStr}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: val })
      });
    };
  }

  const activeHabits = state.habits.filter((h) => !h.archived);
  const scheduled = activeHabits.filter((h) => isHabitScheduledOnDate(h, date));

  if (scheduled.length === 0) {
    list.innerHTML = '<li class="inspector-item" style="color: var(--text-muted)">No habits were scheduled for this day.</li>';
  } else {
    scheduled.forEach((habit) => {
      const isDone = isHabitCompletedOnDate(habit, dateStr);
      const count = (habit.completions && habit.completions[dateStr]) || 0;

      const li = document.createElement('li');
      li.className = 'inspector-item';

      const label = document.createElement('span');
      label.textContent = habit.name;

      li.appendChild(label);

      if (habit.target.type === 'count') {
        const stepper = document.createElement('div');
        stepper.className = 'stepper-container';

        const decBtn = document.createElement('button');
        decBtn.type = 'button';
        decBtn.className = 'stepper-btn';
        decBtn.textContent = '−';
        decBtn.disabled = count <= 0;
        decBtn.addEventListener('click', () => {
          updateHabitCount(habit.id, dateStr, -1);
          renderReviewView();
        });

        const span = document.createElement('span');
        span.className = 'stepper-count';
        span.textContent = `${count}/${habit.target.count}`;

        const incBtn = document.createElement('button');
        incBtn.type = 'button';
        incBtn.className = 'stepper-btn';
        incBtn.textContent = '+';
        incBtn.disabled = count >= 10;
        incBtn.addEventListener('click', () => {
          updateHabitCount(habit.id, dateStr, 1);
          renderReviewView();
        });

        stepper.appendChild(decBtn);
        stepper.appendChild(span);
        stepper.appendChild(incBtn);
        li.appendChild(stepper);
      } else {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isDone;
        cb.addEventListener('change', () => {
          toggleHabitCompletion(habit.id, dateStr);
          renderReviewView();
        });
        li.appendChild(cb);
      }

      list.appendChild(li);
    });
  }

  panel.hidden = false;
}

/**
 * Renders the GitHub-style Year Heatmap for the selected habit or all habits.
 */
function renderYearHeatmap() {
  const container = document.getElementById('heatmap-container');
  const summaryEl = document.getElementById('heatmap-summary');
  const habitSelect = document.getElementById('heatmap-habit-select');
  const yearLabel = document.getElementById('heatmap-year-label');
  const prevBtn = document.getElementById('heatmap-prev-year-btn');
  const nextBtn = document.getElementById('heatmap-next-year-btn');

  if (!container || !summaryEl) return;

  const ref = getEffectiveDate();
  const currentYear = ref.getFullYear();
  if (heatmapYear === null) {
    heatmapYear = currentYear;
  }
  const maxYear = currentYear + 1;

  if (yearLabel) yearLabel.textContent = heatmapYear;
  if (nextBtn) nextBtn.disabled = heatmapYear >= maxYear;

  // Populate habit select options
  if (habitSelect) {
    const activeHabits = state.habits.filter((h) => !h.archived);
    const prevSelected = selectedHeatmapHabitId;
    habitSelect.innerHTML = '<option value="all">All habits</option>';
    activeHabits.forEach((h) => {
      const opt = document.createElement('option');
      opt.value = h.id;
      opt.textContent = h.name;
      if (h.id === prevSelected) opt.selected = true;
      habitSelect.appendChild(opt);
    });
    if (prevSelected === 'all' || !activeHabits.some((h) => h.id === prevSelected)) {
      habitSelect.value = 'all';
      selectedHeatmapHabitId = 'all';
    } else {
      habitSelect.value = prevSelected;
    }
  }

  // Week layout
  const weekStartDay = state.settings.weekStartsOn === 'sunday' ? 0 : 1;
  const rowDayLabels = weekStartDay === 0
    ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const cellSize = 11;
  const cellGap = 2;
  const leftGutter = 20;
  const topGutter = 18;

  const firstDay = new Date(heatmapYear, 0, 1);
  const lastDay = new Date(heatmapYear, 11, 31);
  const totalDays = Math.round((lastDay - firstDay) / 86400000) + 1;
  const startRow = (firstDay.getDay() - weekStartDay + 7) % 7;
  const totalColumns = Math.floor((startRow + totalDays - 1) / 7) + 1;
  const svgWidth = leftGutter + totalColumns * (cellSize + cellGap);
  const svgHeight = topGutter + 7 * (cellSize + cellGap);

  // Month labels J F M A M J J A S O N D
  const monthLetters = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const monthLabelsSvg = [];

  for (let m = 0; m < 12; m++) {
    const mDate = new Date(heatmapYear, m, 1);
    const daysSinceJan1 = Math.round((mDate - firstDay) / 86400000);
    const mCol = Math.floor((startRow + daysSinceJan1) / 7);
    const mX = leftGutter + mCol * (cellSize + cellGap);
    monthLabelsSvg.push(`<text x="${mX}" y="10" class="hm-month-label">${monthLetters[m]}</text>`);
  }

  // Weekday labels on left
  const weekdayLabelsSvg = [];
  for (let r = 0; r < 7; r++) {
    const rY = topGutter + r * (cellSize + cellGap) + cellSize / 2;
    weekdayLabelsSvg.push(`<text x="0" y="${rY}" class="hm-weekday-label">${rowDayLabels[r]}</text>`);
  }

  const todayStr = toLocalDateString(ref);
  const activeHabits = state.habits.filter((h) => !h.archived);
  const targetHabit = selectedHeatmapHabitId === 'all'
    ? null
    : state.habits.find((h) => h.id === selectedHeatmapHabitId);

  const rectsSvg = [];
  let daysCompleteCount = 0;
  let maxRun = 0;
  let curRun = 0;

  for (let k = 0; k < totalDays; k++) {
    const curDate = new Date(heatmapYear, 0, 1 + k);
    const dateStr = toLocalDateString(curDate);
    const isFuture = dateStr > todayStr;
    const dayIndex = startRow + k;
    const col = Math.floor(dayIndex / 7);
    const row = dayIndex % 7;
    const x = leftGutter + col * (cellSize + cellGap);
    const y = topGutter + row * (cellSize + cellGap);

    const weekdayShort = curDate.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = curDate.getDate();
    const monthShort = curDate.toLocaleDateString('en-US', { month: 'short' });
    const dateHeader = `${weekdayShort} ${dayNum} ${monthShort}`;

    let cssClass = 'hm-unscheduled';
    let titleText = `${dateHeader} · Unscheduled`;
    let isDayScheduled = false;
    let isDayFullyComplete = false;

    if (selectedHeatmapHabitId === 'all') {
      const scheduled = activeHabits.filter((h) => isHabitScheduledOnDate(h, curDate));
      const scheduledCount = scheduled.length;
      if (scheduledCount > 0) {
        isDayScheduled = true;
        const completed = scheduled.filter((h) => isHabitCompletedOnDate(h, dateStr));
        const completedCount = completed.length;
        const ratio = completedCount / scheduledCount;
        titleText = `${dateHeader} · ${completedCount}/${scheduledCount}`;

        if (completedCount === 0) {
          cssClass = 'hm-zero';
        } else if (completedCount === scheduledCount) {
          cssClass = 'hm-full';
          isDayFullyComplete = true;
        } else if (ratio < 0.5) {
          cssClass = 'hm-low';
        } else {
          cssClass = 'hm-mid';
        }
      } else {
        cssClass = 'hm-unscheduled';
        titleText = `${dateHeader} · No habits scheduled`;
      }
    } else if (targetHabit) {
      if (isHabitScheduledOnDate(targetHabit, curDate)) {
        isDayScheduled = true;
        const isDone = isHabitCompletedOnDate(targetHabit, dateStr);
        if (targetHabit.target.type === 'count') {
          const count = (targetHabit.completions && targetHabit.completions[dateStr]) || 0;
          const ratio = Math.min(1, count / targetHabit.target.count);
          titleText = `${dateHeader} · ${count}/${targetHabit.target.count}`;
          if (count === 0) {
            cssClass = 'hm-zero';
          } else if (isDone) {
            cssClass = 'hm-full';
            isDayFullyComplete = true;
          } else if (ratio < 0.5) {
            cssClass = 'hm-low';
          } else {
            cssClass = 'hm-mid';
          }
        } else {
          titleText = `${dateHeader} · ${isDone ? '1/1' : '0/1'}`;
          if (isDone) {
            cssClass = 'hm-full';
            isDayFullyComplete = true;
          } else {
            cssClass = 'hm-zero';
          }
        }
      } else {
        cssClass = 'hm-unscheduled';
        titleText = `${dateHeader} · Unscheduled`;
      }
    }

    // Stats counting for days in year up to today
    if (!isFuture && isDayScheduled) {
      if (isDayFullyComplete) {
        daysCompleteCount++;
        curRun++;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 0;
      }
    }

    const clickableClass = !isFuture ? 'clickable' : 'future';
    rectsSvg.push(`
      <rect
        class="hm-cell ${cssClass} ${clickableClass}"
        x="${x}"
        y="${y}"
        width="${cellSize}"
        height="${cellSize}"
        rx="2"
        ry="2"
        data-date="${dateStr}"
        tabindex="${!isFuture ? '0' : '-1'}"
      >
        <title>${titleText}</title>
      </rect>
    `);
  }

  // Summary line: Nimbus Sans L 400
  summaryEl.textContent = `${heatmapYear} · ${daysCompleteCount} days complete · best run ${maxRun}d`;

  // Render SVG
  container.innerHTML = `
    <svg class="heatmap-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      ${monthLabelsSvg.join('')}
      ${weekdayLabelsSvg.join('')}
      ${rectsSvg.join('')}
    </svg>
  `;

  // Attach click & keyboard listeners to clickable cells
  container.querySelectorAll('.hm-cell.clickable').forEach((rect) => {
    rect.addEventListener('click', () => {
      const dStr = rect.dataset.date;
      if (!dStr) return;
      selectedPastDate = dStr;
      renderMonthGrid();
      const inspector = document.getElementById('past-day-inspector');
      if (inspector) {
        inspector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    rect.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        rect.dispatchEvent(new MouseEvent('click'));
      }
    });
  });
}

function renderPerformanceTable() {
  const tbody = document.getElementById('stats-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  const ref = getEffectiveDate();

  const activeHabits = state.habits.filter((h) => !h.archived);
  activeHabits.forEach((habit) => {
    const curStreak = calculateStreak(habit, ref);
    const bestStreak = computeBestStreak(habit, ref);
    const stats28 = calculate28DayStats(habit, ref);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(habit.name)}</td>
      <td class="num">${curStreak}d</td>
      <td class="num">${bestStreak}d</td>
      <td class="num">${stats28.percentage}% <span style="color: var(--text-muted); font-size: 11px;">(${stats28.completedCount}/${stats28.scheduledCount})</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * ============================================================================
 * VIEW 4: SETTINGS
 * ============================================================================
 */
function renderSettingsView() {
  const { weekStartsOn, showArchivedInHabits, density, reduceMotion, theme, dateFormat, confirmPermanentDelete } = state.settings;

  const weekSelect = document.getElementById('setting-week-start');
  if (weekSelect) weekSelect.value = weekStartsOn;

  const showArchivedCb = document.getElementById('setting-show-archived');
  if (showArchivedCb) showArchivedCb.checked = showArchivedInHabits;

  const densitySelect = document.getElementById('setting-density');
  if (densitySelect) densitySelect.value = density;

  const motionCb = document.getElementById('setting-reduce-motion');
  if (motionCb) motionCb.checked = reduceMotion;

  const themeSelect = document.getElementById('setting-theme');
  if (themeSelect) themeSelect.value = theme;

  const dateSelect = document.getElementById('setting-date-format');
  if (dateSelect) dateSelect.value = dateFormat;

  const confirmDeleteCb = document.getElementById('setting-confirm-delete');
  if (confirmDeleteCb) confirmDeleteCb.checked = confirmPermanentDelete;
}

function bindSettingsListeners() {
  document.getElementById('setting-week-start')?.addEventListener('change', (e) => {
    state.settings.weekStartsOn = e.target.value;
    saveState();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  document.getElementById('setting-show-archived')?.addEventListener('change', (e) => {
    state.settings.showArchivedInHabits = e.target.checked;
    saveState();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  document.getElementById('setting-density')?.addEventListener('change', (e) => {
    state.settings.density = e.target.value;
    saveState();
    applySettingsClasses();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  document.getElementById('setting-reduce-motion')?.addEventListener('change', (e) => {
    state.settings.reduceMotion = e.target.checked;
    saveState();
    applySettingsClasses();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  document.getElementById('setting-theme')?.addEventListener('change', (e) => {
    state.settings.theme = e.target.value;
    saveState();
    applySettingsClasses();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  document.getElementById('setting-date-format')?.addEventListener('change', (e) => {
    state.settings.dateFormat = e.target.value;
    saveState();
    renderActiveView();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  document.getElementById('setting-confirm-delete')?.addEventListener('change', (e) => {
    state.settings.confirmPermanentDelete = e.target.checked;
    saveState();
    apiCall('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.settings) });
  });

  // Load Sample Data
  document.getElementById('load-sample-data-btn')?.addEventListener('click', async () => {
    const res = await apiCall('/api/seed', { method: 'POST' });
    if (res && res.state) {
      state = { ...defaultState, ...res.state };
    } else {
      state.habits = generateSampleData();
    }
    saveState();
    renderActiveView();
  });

  // Export JSON
  document.getElementById('export-json-btn')?.addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `quotidian-${toLocalDateString(getEffectiveDate())}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // Import JSON
  const triggerImportBtn = document.getElementById('trigger-import-btn');
  const fileInput = document.getElementById('import-file-input');
  const errorBanner = document.getElementById('settings-error-banner');

  triggerImportBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!imported || imported.version !== SCHEMA_VERSION) {
          showSettingsError(`Import failed: Version mismatch. Expected version ${SCHEMA_VERSION}.`);
          return;
        }

        const mode = document.getElementById('import-mode')?.value || 'merge';
        if (mode === 'replace') {
          state = {
            ...defaultState,
            ...imported,
            settings: { ...defaultState.settings, ...(imported.settings || {}) }
          };
        } else {
          // Merge mode: append or update habits
          const existingIds = new Set(state.habits.map((h) => h.id));
          (imported.habits || []).forEach((h) => {
            if (existingIds.has(h.id)) {
              const idx = state.habits.findIndex((item) => item.id === h.id);
              state.habits[idx] = {
                ...state.habits[idx],
                ...h,
                completions: { ...(state.habits[idx].completions || {}), ...(h.completions || {}) }
              };
            } else {
              state.habits.push(h);
            }
          });
          state.settings = { ...state.settings, ...(imported.settings || {}) };
        }

        saveState();
        apiCall('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...imported, mode })
        });

        if (errorBanner) errorBanner.hidden = true;
        renderActiveView();
        fileInput.value = '';
      } catch (err) {
        showSettingsError('Import failed: Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  });

  function showSettingsError(msg) {
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.hidden = false;
    }
  }

  // Reset Data with Typed Confirmation
  const resetInput = document.getElementById('reset-confirm-input');
  const resetBtn = document.getElementById('reset-data-btn');

  resetInput?.addEventListener('input', () => {
    resetBtn.disabled = resetInput.value.trim().toLowerCase() !== 'delete';
  });

  resetBtn?.addEventListener('click', () => {
    if (resetInput.value.trim().toLowerCase() === 'delete') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('habits_v1');
      state = JSON.parse(JSON.stringify(defaultState));
      saveState();
      apiCall('/api/reset', { method: 'POST' });
      resetInput.value = '';
      resetBtn.disabled = true;
      renderActiveView();
    }
  });
}

/**
 * ============================================================================
 * Adding Habits (Today Quick Add & Habits Full Add)
 * ============================================================================
 */
function bindAddForms() {
  // Today quick add
  const quickInput = document.getElementById('today-quick-add-input');
  quickInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = quickInput.value.trim();
      if (!name) return;

      const activeCount = state.habits.filter((h) => !h.archived).length;
      if (activeCount >= MAX_ACTIVE_HABITS) {
        alert('Active habit cap of 24 reached.');
        return;
      }

      const newHabit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.slice(0, 40),
        schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
        target: { type: 'boolean', count: 1 },
        group: 'Anytime',
        color: null,
        startDate: toLocalDateString(getEffectiveDate()),
        archived: false,
        order: state.habits.length,
        completions: {},
        bestStreak: 0
      };

      state.habits.push(newHabit);
      saveState();
      quickInput.value = '';
      renderActiveView();

      apiCall('/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHabit)
      });
    } else if (e.key === 'Escape') {
      quickInput.value = '';
      quickInput.blur();
    }
  });

  // Habits full add disclosure toggle
  const toggleBtn = document.getElementById('toggle-add-form-btn');
  const disclosure = document.getElementById('add-habit-disclosure');
  const cancelBtn = document.getElementById('cancel-add-btn');
  const fullForm = document.getElementById('full-add-form');

  toggleBtn?.addEventListener('click', () => {
    const isHidden = disclosure.hidden;
    disclosure.hidden = !isHidden;
    if (!disclosure.hidden) {
      document.getElementById('form-name')?.focus();
      const startInput = document.getElementById('form-start-date');
      if (startInput) startInput.value = toLocalDateString(getEffectiveDate());
    }
  });

  cancelBtn?.addEventListener('click', () => {
    disclosure.hidden = true;
    fullForm.reset();
  });

  // Schedule type toggle
  const schedTypeSelect = document.getElementById('form-schedule-type');
  const customDaysGroup = document.getElementById('custom-days-group');
  schedTypeSelect?.addEventListener('change', () => {
    customDaysGroup.hidden = schedTypeSelect.value !== 'custom';
  });

  // Custom days toggles
  document.querySelectorAll('#custom-days-toggles .day-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // Target type toggle
  const targetTypeSelect = document.getElementById('form-target-type');
  const targetCountGroup = document.getElementById('target-count-group');
  targetTypeSelect?.addEventListener('change', () => {
    targetCountGroup.hidden = targetTypeSelect.value !== 'count';
  });

  // Full form submit
  fullForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    const activeCount = state.habits.filter((h) => !h.archived).length;
    if (activeCount >= MAX_ACTIVE_HABITS) {
      alert('Active habit cap of 24 reached.');
      return;
    }

    const name = document.getElementById('form-name')?.value.trim();
    if (!name) return;

    const note = document.getElementById('form-note')?.value.trim();
    const schedType = schedTypeSelect.value;
    let customDays = [];
    if (schedType === 'custom') {
      document.querySelectorAll('#custom-days-toggles .day-toggle-btn.active').forEach((btn) => {
        customDays.push(Number(btn.dataset.day));
      });
    }

    const targetType = targetTypeSelect.value;
    const targetCount = targetType === 'count'
      ? Math.max(1, Math.min(10, Number(document.getElementById('form-target-count')?.value) || 1))
      : 1;

    const group = document.getElementById('form-group')?.value || 'Anytime';
    const colorVal = document.getElementById('form-color')?.value;
    const color = colorVal === 'none' ? null : colorVal;
    const startDate = document.getElementById('form-start-date')?.value || toLocalDateString(getEffectiveDate());

    const newHabit = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.slice(0, 40),
      note: note || undefined,
      schedule: {
        type: schedType,
        days: schedType === 'custom' ? customDays : [0, 1, 2, 3, 4, 5, 6]
      },
      target: {
        type: targetType,
        count: targetCount
      },
      group,
      color,
      startDate,
      archived: false,
      order: state.habits.length,
      completions: {},
      bestStreak: 0
    };

    state.habits.push(newHabit);
    saveState();

    fullForm.reset();
    disclosure.hidden = true;
    renderActiveView();

    apiCall('/api/habits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newHabit)
    });
  });
}

/**
 * ============================================================================
 * Keyboard Navigation (j/k, x/Space, n, f, o, 1..4)
 * ============================================================================
 */
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape un-focuses any active input
    if (e.key === 'Escape') {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      return;
    }

    // Ignore keyboard shortcuts when typing in inputs/textareas/selects
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // View switching 1..4
    if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      const routes = ['today', 'habits', 'review', 'settings'];
      const targetRoute = routes[Number(e.key) - 1];
      window.location.hash = `#${targetRoute}`;
      return;
    }

    // Only active on Today view
    if (getActiveRoute() !== 'today') return;

    // 'f': Cycle filters (All -> Remaining -> Now -> All)
    if (e.key === 'f') {
      e.preventDefault();
      const order = ['all', 'remaining', 'now'];
      const nextIdx = (order.indexOf(todayFilter) + 1) % order.length;
      todayFilter = order[nextIdx];
      renderTodayView();
      return;
    }

    // 'o': Focus daily reflection note
    if (e.key === 'o') {
      e.preventDefault();
      const noteInput = document.getElementById('today-daily-note-input');
      noteInput?.focus();
      return;
    }

    const rows = Array.from(document.querySelectorAll('#today-groups-container .habit-row'));
    if (rows.length === 0) return;

    if (e.key === 'j') {
      e.preventDefault();
      focusedHabitIndex = (focusedHabitIndex + 1) % rows.length;
      highlightFocusedRow(rows);
    } else if (e.key === 'k') {
      e.preventDefault();
      focusedHabitIndex = (focusedHabitIndex - 1 + rows.length) % rows.length;
      highlightFocusedRow(rows);
    } else if (e.key === 'x' || e.key === ' ') {
      e.preventDefault();
      const curRow = rows[focusedHabitIndex];
      if (curRow) {
        const habitId = curRow.dataset.habitId;
        const habit = state.habits.find((h) => h.id === habitId);
        const todayStr = toLocalDateString(getEffectiveDate());
        if (habit) {
          if (habit.target.type === 'count') {
            const current = (habit.completions && habit.completions[todayStr]) || 0;
            const next = current >= habit.target.count ? 0 : current + 1;
            habit.completions[todayStr] = next;
            saveState();
            renderActiveView();
            apiCall(`/api/habits/${habit.id}/count`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dateStr: todayStr, count: next })
            });
          } else {
            toggleHabitCompletion(habit.id, todayStr);
          }
        }
      }
    } else if (e.key === 'n') {
      e.preventDefault();
      const quickAdd = document.getElementById('today-quick-add-input');
      quickAdd?.focus();
    }
  });
}

function bindTodayListeners() {
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      todayFilter = tab.dataset.filter || 'all';
      renderTodayView();
    });
  });

  const dailyNoteInput = document.getElementById('today-daily-note-input');
  if (dailyNoteInput) {
    const saveDailyNote = () => {
      const todayStr = toLocalDateString(getEffectiveDate());
      const val = dailyNoteInput.value.trim();
      state.notes = state.notes || {};
      if (val) {
        state.notes[todayStr] = val;
      } else {
        delete state.notes[todayStr];
      }
      saveState();
      apiCall(`/api/notes/${todayStr}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: val })
      });
    };

    dailyNoteInput.addEventListener('input', () => {
      const todayStr = toLocalDateString(getEffectiveDate());
      state.notes = state.notes || {};
      const val = dailyNoteInput.value.trim();
      if (val) {
        state.notes[todayStr] = val;
      } else {
        delete state.notes[todayStr];
      }
    });

    dailyNoteInput.addEventListener('blur', saveDailyNote);
    dailyNoteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        dailyNoteInput.blur();
      }
    });
  }
}

function highlightFocusedRow(rows) {
  rows.forEach((r, i) => {
    r.classList.toggle('focused', i === focusedHabitIndex);
  });
  if (rows[focusedHabitIndex]) {
    rows[focusedHabitIndex].scrollIntoView({ block: 'nearest' });
  }
}

function bindHeatmapListeners() {
  document.getElementById('heatmap-habit-select')?.addEventListener('change', (e) => {
    selectedHeatmapHabitId = e.target.value;
    renderYearHeatmap();
  });

  document.getElementById('heatmap-prev-year-btn')?.addEventListener('click', () => {
    if (heatmapYear === null) heatmapYear = getEffectiveDate().getFullYear();
    heatmapYear -= 1;
    renderYearHeatmap();
  });

  document.getElementById('heatmap-next-year-btn')?.addEventListener('click', () => {
    const maxYear = getEffectiveDate().getFullYear() + 1;
    if (heatmapYear === null) heatmapYear = getEffectiveDate().getFullYear();
    if (heatmapYear < maxYear) {
      heatmapYear += 1;
      renderYearHeatmap();
    }
  });
}

/**
 * ============================================================================
 * Initialization
 * ============================================================================
 */
function init() {
  window.addEventListener('hashchange', handleRoute);
  bindTodayListeners();
  bindAddForms();
  bindSettingsListeners();
  bindKeyboardShortcuts();
  bindHeatmapListeners();

  // If no hash in URL, default to #today
  if (!window.location.hash) {
    window.location.hash = '#today';
  } else {
    handleRoute();
  }

  // Connect to backend SQLite API if running as a web app
  syncFromBackend();

  // Hourly quote transition timer (checks every 30 seconds)
  setInterval(() => {
    const curHour = getEffectiveDate().getHours();
    if (curHour !== lastRenderedQuoteHour && getActiveRoute() === 'today') {
      renderHourlyQuote();
    }
  }, 30000);
}

init();
