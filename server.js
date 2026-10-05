const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure database directory exists
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'quotidian.db');
const db = new DatabaseSync(dbPath);

// Enable Foreign Keys & WAL mode for performance
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT,
    schedule TEXT NOT NULL,
    target TEXT NOT NULL,
    habit_group TEXT,
    color TEXT,
    start_date TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS completions (
    habit_id TEXT NOT NULL,
    date_str TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (habit_id, date_str),
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_notes (
    date_str TEXT PRIMARY KEY,
    note TEXT NOT NULL
  );
`);

// Middleware
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname, { etag: false, lastModified: false }));

/**
 * Default Settings
 */
const defaultSettings = {
  weekStartsOn: 'monday',
  showArchivedInHabits: true,
  density: 'comfortable',
  reduceMotion: false,
  theme: 'light',
  dateFormat: 'weekday_day_month',
  confirmPermanentDelete: true
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...defaultSettings };
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
}

function saveSetting(key, val) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  stmt.run(key, JSON.stringify(val));
}

function getHabitsWithCompletions() {
  const habits = db.prepare('SELECT * FROM habits ORDER BY sort_order ASC').all();
  const habitMap = new Map();

  for (const h of habits) {
    habitMap.set(h.id, {
      id: h.id,
      name: h.name,
      note: h.note || undefined,
      schedule: JSON.parse(h.schedule),
      target: JSON.parse(h.target),
      group: h.habit_group || 'Anytime',
      color: h.color || null,
      startDate: h.start_date,
      archived: Boolean(h.archived),
      order: h.sort_order,
      completions: {},
      bestStreak: h.best_streak
    });
  }

  const completions = db.prepare('SELECT habit_id, date_str, count FROM completions').all();
  for (const c of completions) {
    const habit = habitMap.get(c.habit_id);
    if (habit) {
      habit.completions[c.date_str] = c.count;
    }
  }

  return Array.from(habitMap.values());
}

/**
 * Seed Sample Data
 */
function seedSampleData() {
  db.exec('DELETE FROM completions;');
  db.exec('DELETE FROM habits;');

  const now = new Date();
  const toDateStr = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getPastStr = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    return toDateStr(d);
  };

  const todayStr = toDateStr(now);

  const demoHabits = [
    {
      id: 'demo-meditation',
      name: 'Morning meditation',
      note: '15 minutes mindfulness',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Morning',
      color: 'stone',
      startDate: getPastStr(75),
      archived: 0,
      order: 0,
      bestStreak: 21,
      completions: (() => {
        const c = {};
        for (let i = 0; i < 14; i++) c[getPastStr(i)] = 1;
        for (let i = 16; i < 60; i++) if (i % 9 !== 0) c[getPastStr(i)] = 1;
        return c;
      })()
    },
    {
      id: 'demo-deepwork',
      name: 'Deep work focus block',
      note: '90 minutes uninterrupted',
      schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
      target: { type: 'boolean', count: 1 },
      group: 'Morning',
      color: 'ink',
      startDate: getPastStr(60),
      archived: 0,
      order: 1,
      bestStreak: 15,
      completions: (() => {
        const c = {};
        for (let i = 1; i < 60; i++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          const day = d.getDay();
          if (day >= 1 && day <= 5 && i % 4 !== 0) c[toDateStr(d)] = 1;
        }
        return c;
      })()
    },
    {
      id: 'demo-water',
      name: 'Drink 8 glasses of water',
      note: 'Hydration through the day',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'count', count: 8 },
      group: 'Anytime',
      color: 'blue',
      startDate: getPastStr(90),
      archived: 0,
      order: 2,
      bestStreak: 18,
      completions: (() => {
        const c = {};
        c[todayStr] = 5;
        for (let i = 1; i < 45; i++) c[getPastStr(i)] = (i % 7 === 0) ? 4 : 8;
        return c;
      })()
    },
    {
      id: 'demo-gym',
      name: 'Strength training',
      note: 'Compound lifts or bodyweight',
      schedule: { type: 'custom', days: [1, 3, 5] },
      target: { type: 'boolean', count: 1 },
      group: 'Afternoon',
      color: 'rust',
      startDate: getPastStr(70),
      archived: 0,
      order: 3,
      bestStreak: 10,
      completions: (() => {
        const c = {};
        for (let i = 1; i < 70; i++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          if ([1, 3, 5].includes(d.getDay()) && i % 8 !== 0) c[toDateStr(d)] = 1;
        }
        return c;
      })()
    },
    {
      id: 'demo-run',
      name: 'Long weekend run',
      note: 'Aerobic base building',
      schedule: { type: 'weekends', days: [0, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Morning',
      color: 'sand',
      startDate: getPastStr(80),
      archived: 0,
      order: 4,
      bestStreak: 8,
      completions: (() => {
        const c = {};
        for (let i = 1; i < 80; i++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          if ((d.getDay() === 0 || d.getDay() === 6) && i % 5 !== 0) c[toDateStr(d)] = 1;
        }
        return c;
      })()
    },
    {
      id: 'demo-reading',
      name: 'Read 20 pages',
      note: 'Fiction or philosophy',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Evening',
      color: 'olive',
      startDate: getPastStr(110),
      archived: 0,
      order: 5,
      bestStreak: 32,
      completions: (() => {
        const c = {};
        c[todayStr] = 1;
        for (let i = 1; i < 110; i++) if (i % 11 !== 0) c[getPastStr(i)] = 1;
        return c;
      })()
    },
    {
      id: 'demo-journal',
      name: 'Evening reflection & notes',
      note: 'Highlights, gratitude, tomorrow plan',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Evening',
      color: 'sand',
      startDate: getPastStr(45),
      archived: 0,
      order: 6,
      bestStreak: 11,
      completions: (() => {
        const c = {};
        c[getPastStr(1)] = 1;
        c[getPastStr(2)] = 1;
        for (let i = 4; i < 45; i++) if (i % 3 !== 0) c[getPastStr(i)] = 1;
        return c;
      })()
    },
    {
      id: 'demo-spanish',
      name: 'Spanish grammar practice',
      note: 'Vocabulary flashcards & verbs',
      schedule: { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
      target: { type: 'boolean', count: 1 },
      group: 'Anytime',
      color: 'stone',
      startDate: getPastStr(150),
      archived: 1,
      order: 7,
      bestStreak: 19,
      completions: (() => {
        const c = {};
        for (let i = 35; i < 120; i++) if (i % 2 === 0) c[getPastStr(i)] = 1;
        return c;
      })()
    }
  ];

  const insertHabit = db.prepare(`
    INSERT INTO habits (id, name, note, schedule, target, habit_group, color, start_date, archived, sort_order, best_streak)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCompletion = db.prepare(`
    INSERT INTO completions (habit_id, date_str, count)
    VALUES (?, ?, ?)
  `);

  for (const h of demoHabits) {
    insertHabit.run(
      h.id,
      h.name,
      h.note || null,
      JSON.stringify(h.schedule),
      JSON.stringify(h.target),
      h.group,
      h.color || null,
      h.startDate,
      h.archived,
      h.order,
      h.bestStreak
    );

    for (const [dateStr, count] of Object.entries(h.completions)) {
      insertCompletion.run(h.id, dateStr, count);
    }
  }

  // Ensure default settings exist
  for (const [k, v] of Object.entries(defaultSettings)) {
    saveSetting(k, v);
  }
}

// Auto-seed if newly created database
const habitCount = db.prepare('SELECT COUNT(*) as count FROM habits').get().count;
if (habitCount === 0) {
  seedSampleData();
}

function getDailyNotes() {
  const rows = db.prepare('SELECT date_str, note FROM daily_notes').all();
  const notes = {};
  for (const r of rows) {
    notes[r.date_str] = r.note;
  }
  return notes;
}

/**
 * ============================================================================
 * REST API Routes
 * ============================================================================
 */

// Full State
app.get('/api/state', (req, res) => {
  res.json({
    version: 1,
    habits: getHabitsWithCompletions(),
    settings: getSettings(),
    notes: getDailyNotes()
  });
});

app.post('/api/state', (req, res) => {
  const { version, habits, settings, notes, mode } = req.body;
  if (version !== 1) {
    return res.status(400).json({ error: 'Version mismatch. Expected version 1.' });
  }

  if (mode === 'replace') {
    db.exec('DELETE FROM completions;');
    db.exec('DELETE FROM habits;');
    db.exec('DELETE FROM daily_notes;');
  }

  const insertHabit = db.prepare(`
    INSERT OR REPLACE INTO habits (id, name, note, schedule, target, habit_group, color, start_date, archived, sort_order, best_streak)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCompletion = db.prepare(`
    INSERT OR REPLACE INTO completions (habit_id, date_str, count)
    VALUES (?, ?, ?)
  `);

  if (Array.isArray(habits)) {
    for (const h of habits) {
      insertHabit.run(
        h.id,
        h.name,
        h.note || null,
        JSON.stringify(h.schedule),
        JSON.stringify(h.target),
        h.group || 'Anytime',
        h.color || null,
        h.startDate,
        h.archived ? 1 : 0,
        h.order || 0,
        h.bestStreak || 0
      );

      if (h.completions) {
        for (const [dateStr, count] of Object.entries(h.completions)) {
          insertCompletion.run(h.id, dateStr, count);
        }
      }
    }
  }

  if (settings) {
    for (const [k, v] of Object.entries(settings)) {
      saveSetting(k, v);
    }
  }

  if (notes && typeof notes === 'object') {
    const insertNote = db.prepare('INSERT OR REPLACE INTO daily_notes (date_str, note) VALUES (?, ?)');
    for (const [dStr, noteText] of Object.entries(notes)) {
      if (noteText && typeof noteText === 'string') {
        insertNote.run(dStr, noteText);
      }
    }
  }

  res.json({
    version: 1,
    habits: getHabitsWithCompletions(),
    settings: getSettings(),
    notes: getDailyNotes()
  });
});

// Habits
app.get('/api/habits', (req, res) => {
  res.json(getHabitsWithCompletions());
});

app.post('/api/habits', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM habits WHERE archived = 0').get().count;
  if (count >= 24) {
    return res.status(400).json({ error: 'Active habit limit of 24 reached.' });
  }

  const { id, name, note, schedule, target, group, color, startDate, archived, order, bestStreak } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const habitId = id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const stmt = db.prepare(`
    INSERT INTO habits (id, name, note, schedule, target, habit_group, color, start_date, archived, sort_order, best_streak)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    habitId,
    name.slice(0, 40),
    note || null,
    JSON.stringify(schedule || { type: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] }),
    JSON.stringify(target || { type: 'boolean', count: 1 }),
    group || 'Anytime',
    color || null,
    startDate || new Date().toISOString().slice(0, 10),
    archived ? 1 : 0,
    order || 0,
    bestStreak || 0
  );

  res.json({ success: true, id: habitId });
});

app.put('/api/habits/:id', (req, res) => {
  const { id } = req.params;
  const { name, note, schedule, target, group, color, startDate, archived, order, bestStreak } = req.body;

  const stmt = db.prepare(`
    UPDATE habits SET
      name = coalesce(?, name),
      note = ?,
      schedule = coalesce(?, schedule),
      target = coalesce(?, target),
      habit_group = coalesce(?, habit_group),
      color = ?,
      start_date = coalesce(?, start_date),
      archived = coalesce(?, archived),
      sort_order = coalesce(?, sort_order),
      best_streak = coalesce(?, best_streak)
    WHERE id = ?
  `);

  stmt.run(
    name ? name.slice(0, 40) : null,
    note !== undefined ? (note || null) : null,
    schedule ? JSON.stringify(schedule) : null,
    target ? JSON.stringify(target) : null,
    group || null,
    color !== undefined ? (color || null) : null,
    startDate || null,
    archived !== undefined ? (archived ? 1 : 0) : null,
    order !== undefined ? order : null,
    bestStreak !== undefined ? bestStreak : null,
    id
  );

  res.json({ success: true });
});

app.delete('/api/habits/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM habits WHERE id = ?').run(id);
  res.json({ success: true });
});

// Reorder
app.post('/api/habits/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (Array.isArray(orderedIds)) {
    const stmt = db.prepare('UPDATE habits SET sort_order = ? WHERE id = ?');
    orderedIds.forEach((id, index) => {
      stmt.run(index, id);
    });
  }
  res.json({ success: true });
});

// Toggle / Stepper Completion
app.post('/api/habits/:id/toggle', (req, res) => {
  const { id } = req.params;
  const { dateStr } = req.body;
  if (!dateStr) return res.status(400).json({ error: 'dateStr required' });

  const existing = db.prepare('SELECT count FROM completions WHERE habit_id = ? AND date_str = ?').get(id, dateStr);
  if (existing && existing.count > 0) {
    db.prepare('DELETE FROM completions WHERE habit_id = ? AND date_str = ?').run(id, dateStr);
  } else {
    db.prepare('INSERT OR REPLACE INTO completions (habit_id, date_str, count) VALUES (?, ?, 1)').run(id, dateStr);
  }

  res.json({ success: true });
});

app.post('/api/habits/:id/count', (req, res) => {
  const { id } = req.params;
  const { dateStr, count, delta } = req.body;
  if (!dateStr) return res.status(400).json({ error: 'dateStr required' });

  let nextCount = 0;
  if (count !== undefined) {
    nextCount = Math.max(0, Math.min(10, count));
  } else if (delta !== undefined) {
    const existing = db.prepare('SELECT count FROM completions WHERE habit_id = ? AND date_str = ?').get(id, dateStr);
    const cur = existing ? existing.count : 0;
    nextCount = Math.max(0, Math.min(10, cur + delta));
  }

  if (nextCount <= 0) {
    db.prepare('DELETE FROM completions WHERE habit_id = ? AND date_str = ?').run(id, dateStr);
  } else {
    db.prepare('INSERT OR REPLACE INTO completions (habit_id, date_str, count) VALUES (?, ?, ?)').run(id, dateStr, nextCount);
  }

  res.json({ success: true, count: nextCount });
});

// Daily Notes
app.get('/api/notes/:dateStr', (req, res) => {
  const { dateStr } = req.params;
  const row = db.prepare('SELECT note FROM daily_notes WHERE date_str = ?').get(dateStr);
  res.json({ dateStr, note: row ? row.note : '' });
});

app.put('/api/notes/:dateStr', (req, res) => {
  const { dateStr } = req.params;
  const { note } = req.body;
  if (!note || !note.trim()) {
    db.prepare('DELETE FROM daily_notes WHERE date_str = ?').run(dateStr);
  } else {
    db.prepare('INSERT OR REPLACE INTO daily_notes (date_str, note) VALUES (?, ?)').run(dateStr, note.trim());
  }
  res.json({ success: true, dateStr, note: (note || '').trim() });
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    saveSetting(k, v);
  }
  res.json({ success: true, settings: getSettings() });
});

// Reset & Seed
app.post('/api/reset', (req, res) => {
  db.exec('DELETE FROM completions;');
  db.exec('DELETE FROM habits;');
  db.exec('DELETE FROM daily_notes;');
  res.json({ success: true });
});

app.post('/api/seed', (req, res) => {
  seedSampleData();
  res.json({ success: true, state: { habits: getHabitsWithCompletions(), settings: getSettings(), notes: getDailyNotes() } });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Quotidian web app listening on http://localhost:${PORT}`);
});
