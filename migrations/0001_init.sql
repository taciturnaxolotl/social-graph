-- The whole study: who is in it, and who knows whom.

CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- Lowercased, de-titled and de-punctuated, so "Dr. Kyung-Hwa Kim" is found
  -- by a search for "kyung hwa kim".
  search        TEXT NOT NULL,
  -- Known before anyone signs in: the directory hands out usernames, and a
  -- username plus the school's domain is the Google account. That is the
  -- whole identity join, and it is exact.
  email         TEXT UNIQUE,
  -- ug | grad | de | staff | other. Which of these are live is a setting,
  -- because "everyone in the directory" and "everyone worth rating" are not
  -- the same population and the difference is a research decision.
  segment       TEXT NOT NULL,
  class         TEXT,
  major         TEXT,
  department    TEXT,
  dorm          TEXT,
  hometown      TEXT,
  -- An R2 key. The directory photo to begin with, whatever they upload after.
  photo         TEXT,
  invited_by    TEXT REFERENCES people(id),
  -- Set the first time they sign in. A seeded row is a name the directory
  -- published; a joined row is a person who turned up.
  joined_at     TEXT,
  tombstoned_at TEXT,
  created_at    TEXT NOT NULL
) STRICT;

CREATE INDEX people_search ON people (search);
CREATE INDEX people_segment ON people (segment, tombstoned_at);
CREATE INDEX people_dorm ON people (dorm);
CREATE INDEX people_major ON people (major);

CREATE TABLE ratings (
  rater      TEXT NOT NULL REFERENCES people(id),
  subject    TEXT NOT NULL REFERENCES people(id),
  -- 0 is "never heard of them", which is a different answer from 1, not a
  -- smaller one. A graph that only records acquaintance cannot tell a sparse
  -- region from a question nobody asked.
  strength   INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (rater, subject)
) STRICT;

CREATE INDEX ratings_subject ON ratings (subject, strength);

-- "Ask me later" is not a rating and must never become one.
CREATE TABLE skips (
  rater   TEXT NOT NULL REFERENCES people(id),
  subject TEXT NOT NULL REFERENCES people(id),
  at      TEXT NOT NULL,
  PRIMARY KEY (rater, subject)
) STRICT;

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  person     TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_person ON sessions (person);

CREATE TABLE invites (
  code       TEXT PRIMARY KEY,
  person     TEXT NOT NULL UNIQUE REFERENCES people(id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE majors (name TEXT PRIMARY KEY, department TEXT, school TEXT) STRICT;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

-- Everyone is seeded; which slices are live is a setting. See 0004 for the
-- value this actually starts at.
INSERT INTO settings (key, value) VALUES ('segments', '["ug","grad"]');
