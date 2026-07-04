-- Memory layer schema additions.

CREATE TABLE IF NOT EXISTS short_term_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_short_term_scope_key
    ON short_term_memory(scope, key);
CREATE INDEX IF NOT EXISTS idx_short_term_scope_created
    ON short_term_memory(scope, created_at);

CREATE TABLE IF NOT EXISTS long_term_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_long_term_scope_key
    ON long_term_memory(scope, key);
CREATE INDEX IF NOT EXISTS idx_long_term_scope_created
    ON long_term_memory(scope, created_at);

CREATE TABLE IF NOT EXISTS task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    task TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_history_run_id
    ON task_history(run_id);
CREATE INDEX IF NOT EXISTS idx_task_history_agent_id
    ON task_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_history_created_at
    ON task_history(created_at);
