// The server creates its own tables on first run (same as schema.sql), so no manual database step is needed.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, platform TEXT, standalone INTEGER DEFAULT 0, prefs TEXT DEFAULT '{"change":true,"eve":true,"result":false}', push TEXT)`,
  `CREATE TABLE IF NOT EXISTS follows (device TEXT NOT NULL, team TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (device, team, kind))`,
  `CREATE INDEX IF NOT EXISTS follows_team ON follows(team)`,
  `CREATE TABLE IF NOT EXISTS activity (day TEXT NOT NULL, device TEXT NOT NULL, type TEXT NOT NULL, n INTEGER DEFAULT 1, PRIMARY KEY (day, device, type))`,
  `CREATE INDEX IF NOT EXISTS activity_type ON activity(type, day)`,
  `CREATE TABLE IF NOT EXISTS changes (ts INTEGER NOT NULL, game INTEGER NOT NULL, kind TEXT NOT NULL, info TEXT)`,
  `CREATE TABLE IF NOT EXISTS pushlog (day TEXT NOT NULL, kind TEXT NOT NULL, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, PRIMARY KEY (day, kind))`,
];

let ready = false;
export async function ensureSchema(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  ready = true;
}
