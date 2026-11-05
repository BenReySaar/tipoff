// The server creates its own tables on first run (same as schema.sql), so no manual database step is needed.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, platform TEXT, standalone INTEGER DEFAULT 0, prefs TEXT DEFAULT '{"change":true,"eve":true,"result":false}', push TEXT)`,
  `CREATE TABLE IF NOT EXISTS follows (device TEXT NOT NULL, team TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (device, team, kind))`,
  `CREATE INDEX IF NOT EXISTS follows_team ON follows(team)`,
  `CREATE TABLE IF NOT EXISTS activity (day TEXT NOT NULL, device TEXT NOT NULL, type TEXT NOT NULL, n INTEGER DEFAULT 1, PRIMARY KEY (day, device, type))`,
  `CREATE INDEX IF NOT EXISTS activity_type ON activity(type, day)`,
  `CREATE TABLE IF NOT EXISTS changes (ts INTEGER NOT NULL, game INTEGER NOT NULL, kind TEXT NOT NULL, info TEXT)`,
  `CREATE TABLE IF NOT EXISTS feedback (ts INTEGER NOT NULL, device TEXT, topic TEXT NOT NULL, source TEXT, text TEXT NOT NULL, contact TEXT, teams TEXT, platform TEXT)`,
  `CREATE INDEX IF NOT EXISTS feedback_ts ON feedback(ts)`,
  `CREATE TABLE IF NOT EXISTS pushlog (day TEXT NOT NULL, kind TEXT NOT NULL, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, PRIMARY KEY (day, kind))`,
  `CREATE TABLE IF NOT EXISTS nicks (device TEXT NOT NULL, team TEXT NOT NULL, nick TEXT NOT NULL, PRIMARY KEY (device, team))`,
  `CREATE TABLE IF NOT EXISTS practices (device TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pending (device TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL, msg TEXT NOT NULL)`,
  // a team's practice schedule as the last parent who changed it entered it (days, times, places only)
  `CREATE TABLE IF NOT EXISTS team_prac (team TEXT PRIMARY KEY, data TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)`,
  // "how did it end?": a final score a parent reported before the association published one
  `CREATE TABLE IF NOT EXISTS reports (game INTEGER NOT NULL, device TEXT NOT NULL, hs INTEGER NOT NULL, aws INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (game, device))`,
];
// Columns added after launch. Running them again fails harmlessly ("duplicate column"), so errors are ignored.
export const MIGRATIONS = [
  `ALTER TABLE feedback ADD COLUMN diag TEXT`,
];

let ready = false;
export async function ensureSchema(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  for (const m of MIGRATIONS) { try { await env.DB.prepare(m).run(); } catch (e) { /* already there */ } }
  ready = true;
}
