PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL UNIQUE,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('simple','intermediate','complex')),
  coding_area TEXT,
  specialty TEXT,
  clinical_markdown TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed')),
  generated_date TEXT,
  completed_date TEXT,
  source_path TEXT NOT NULL UNIQUE,
  case_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_difficulty_status ON cases(difficulty, status);
CREATE INDEX IF NOT EXISTS idx_cases_completed_date ON cases(completed_date);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  coding_system TEXT NOT NULL CHECK (coding_system IN ('icd10','cpt','hcpcs')),
  answer_value TEXT NOT NULL,
  answer_order INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  UNIQUE(case_id, coding_system, version, answer_order)
);
CREATE INDEX IF NOT EXISTS idx_answers_current ON answers(case_id, coding_system, is_current);

CREATE TABLE IF NOT EXISTS answer_sets (
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  coding_system TEXT NOT NULL CHECK (coding_system IN ('icd10','cpt','hcpcs')),
  version INTEGER NOT NULL DEFAULT 1,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(case_id, coding_system, version)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  difficulty TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('answering','checked','verifying','resolved','completed','cancelled')),
  started_at TEXT NOT NULL,
  checked_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  clues_used INTEGER NOT NULL DEFAULT 0,
  elapsed_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_one_active ON attempts((1)) WHERE state IN ('answering','checked','verifying','resolved');
CREATE INDEX IF NOT EXISTS idx_attempts_case ON attempts(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_completed ON attempts(state, completed_at);

CREATE TABLE IF NOT EXISTS submitted_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  coding_system TEXT NOT NULL CHECK (coding_system IN ('icd10','cpt','hcpcs')),
  answer_value TEXT NOT NULL,
  answer_order INTEGER NOT NULL,
  normalized_value TEXT NOT NULL,
  automated_match INTEGER,
  user_verified INTEGER,
  system_verified INTEGER,
  final_answer TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attempt_id, coding_system, answer_order)
);
CREATE INDEX IF NOT EXISTS idx_submitted_attempt ON submitted_answers(attempt_id, coding_system);

CREATE TABLE IF NOT EXISTS answer_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  coding_system TEXT NOT NULL,
  previous_answer TEXT NOT NULL,
  corrected_answer TEXT NOT NULL,
  corrected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_case ON answer_corrections(case_id, corrected_at);

CREATE TABLE IF NOT EXISTS sync_state (
  case_id TEXT PRIMARY KEY REFERENCES cases(case_id) ON DELETE CASCADE,
  case_hash TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  last_imported_at TEXT,
  last_exported_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced'
);

CREATE TABLE IF NOT EXISTS generation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('simple','intermediate','complex')),
  requested_count INTEGER NOT NULL DEFAULT 100 CHECK (requested_count > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','fulfilled','failed')),
  requested_at TEXT NOT NULL,
  processed_at TEXT,
  fulfilled_at TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_generation_status ON generation_requests(status, requested_at);
