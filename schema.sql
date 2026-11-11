-- טיפ-אוף: database (Cloudflare D1). Nothing here identifies a person: a device is a random id made by the app.

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,           -- random id created on the phone
  created    INTEGER NOT NULL,           -- ms
  last_seen  INTEGER NOT NULL,           -- ms
  platform   TEXT,                       -- ios | android | other
  standalone INTEGER DEFAULT 0,          -- 1 once opened from the home screen
  prefs      TEXT DEFAULT '{"change":true,"eve":true,"result":false}',
  push       TEXT                        -- PushSubscription JSON, null when off
);

CREATE TABLE IF NOT EXISTS follows (
  device TEXT NOT NULL,
  team   TEXT NOT NULL,                  -- "<league slug>|<team name>"
  kind   TEXT NOT NULL,                  -- full | res (results only)
  PRIMARY KEY (device, team, kind)
);
CREATE INDEX IF NOT EXISTS follows_team ON follows(team);

-- one row per device, per day, per action: daily/weekly/monthly users come from here
CREATE TABLE IF NOT EXISTS activity (
  day    TEXT NOT NULL,                  -- YYYY-MM-DD, Israel time
  device TEXT NOT NULL,
  type   TEXT NOT NULL,                  -- open | follow | push_on | share | nav | calendar | ...
  n      INTEGER DEFAULT 1,
  PRIMARY KEY (day, device, type)
);
CREATE INDEX IF NOT EXISTS activity_type ON activity(type, day);

CREATE TABLE IF NOT EXISTS changes (
  ts    INTEGER NOT NULL,
  game  INTEGER NOT NULL,
  kind  TEXT NOT NULL,                   -- moved | venue | moved+venue | removed | result
  info  TEXT                             -- JSON with before/after
);

-- what parents write in "help" and "what else would you like"
CREATE TABLE IF NOT EXISTS feedback (ts INTEGER NOT NULL, device TEXT, topic TEXT NOT NULL, source TEXT, text TEXT NOT NULL, contact TEXT, teams TEXT, platform TEXT, diag TEXT, done INTEGER);
CREATE INDEX IF NOT EXISTS feedback_ts ON feedback(ts);

CREATE TABLE IF NOT EXISTS pushlog (
  day    TEXT NOT NULL,
  kind   TEXT NOT NULL,                  -- change | result | eve | test
  sent   INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  PRIMARY KEY (day, kind)
);

-- nickname a family gave a followed team ("של דניאל"); only in their own notifications and calendar
CREATE TABLE IF NOT EXISTS nicks (
  device TEXT NOT NULL,
  team   TEXT NOT NULL,
  nick   TEXT NOT NULL,
  PRIMARY KEY (device, team)
);

-- notifications held during quiet hours (23:00–08:00), sent together in the morning
CREATE TABLE IF NOT EXISTS pending (
  device TEXT NOT NULL,
  kind   TEXT NOT NULL,
  ts     INTEGER NOT NULL,
  msg    TEXT NOT NULL
);

-- regular practices a family entered for their teams (only for that phone), as JSON {list, skips}
CREATE TABLE IF NOT EXISTS practices (
  device TEXT PRIMARY KEY,
  data   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_prac (team TEXT PRIMARY KEY, data TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reports (game INTEGER NOT NULL, device TEXT NOT NULL, hs INTEGER NOT NULL, aws INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (game, device));
