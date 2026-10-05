# Quotidian

A quiet, minimal habit tracker full-stack web application. Built with vanilla HTML, CSS, JavaScript, and an Express + SQLite backend.

## How to Run the Website

### Start the Server
```bash
npm start
```
The server will start at:
```
http://localhost:3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

*(For live reload during development: `npm run dev`)*

## Architecture

- **Backend**: Node.js + Express serving the single-page application and REST API.
- **Database**: SQLite database stored in `data/quotidian.db` with WAL mode enabled.
- **Frontend**: Clean single-page application (vanilla JS, HTML, CSS) with zero front-end build step.
- **Syncing**: Real-time optimistic UI updates with automatic persistence to the SQLite backend and local storage caching.
- **Pre-Seeded Data**: Automatically initializes with 8 realistic demo habits and 2026 history on first run.

## Information Architecture
The application features 4 views switched via hash routing without page reloads:
- `#today`: Daily checklist showing habits scheduled for today, progress bar (`2 of 5`), time-of-day groups (Morning, Afternoon, Evening, Anytime), and inline quick add.
- `#habits`: Library management. Add new habits with full schedule/target options, edit inline, manual reordering (▲/▼), archiving, and in-place permanent deletion. Capped at 24 active habits.
- `#review`: 7-day week strip, interactive month calendar grid with daily completion ratios, past day inspection & completion editor, a GitHub-style annual year heatmap (January–December with year stepping, habit selector, ink-opacity scaling, and summary run stats), and a 28-day performance table with current and all-time best streaks.
- `#settings`: Preferences for week start day (Monday/Sunday), archived habit visibility, density (Comfortable/Compact), motion reduction, color scheme (Light/System), date formatting, permanent delete confirmation, and data management.

## Keyboard Shortcuts (on Today view)
- `j` / `k`: Move selection down / up through today's habit rows.
- `x` or `Space`: Toggle completion of the selected habit (or increment count).
- `n`: Focus the inline quick-add field.
- `1` – `4`: Switch views (`1` = Today, `2` = Habits, `3` = Review, `4` = Settings).
- `Escape`: Clear and blur quick-add input.

## REST API Endpoints

- `GET /api/state`: Retrieve current habits, completions, and settings
- `POST /api/state`: Full state import / sync (supports `merge` and `replace` modes)
- `GET /api/habits`: List all habits with completions
- `POST /api/habits`: Create a new habit
- `PUT /api/habits/:id`: Update an existing habit
- `DELETE /api/habits/:id`: Permanently delete a habit
- `POST /api/habits/:id/toggle`: Toggle habit completion for a specific calendar date (`{ dateStr }`)
- `POST /api/habits/:id/count`: Update numeric count for a date (`{ dateStr, count }` or `{ dateStr, delta }`)
- `POST /api/habits/reorder`: Persist manual habit ordering (`{ orderedIds: [...] }`)
- `GET /api/settings`: Retrieve settings
- `PUT /api/settings`: Update settings
- `POST /api/seed`: Re-seed sample data across 2026
- `POST /api/reset`: Reset and clear all data from database

## Data Export & Reset
- **Export JSON**: Under **Settings → Data**, click **Export** to download a dated JSON backup (`quotidian-YYYY-MM-DD.json`).
- **Import JSON**: Restore habits by selecting Merge or Replace and uploading your JSON backup.
- **Load Sample Data**: Under **Settings → Data**, click **Load Sample Data** to re-populate the demo dataset at any time.
- **Reset All Data**: Under **Settings → Data**, type `delete` into the confirmation field and click **Reset**.
