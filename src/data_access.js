import Database from 'better-sqlite3';

const CREATE_NOTEXIST_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS notexist (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL)';
const SELECT_NOTEXIST_SQL = 'SELECT timestamp FROM notexist WHERE id = ?';
const UPSERT_NOTEXIST_SQL = 'INSERT OR REPLACE INTO notexist (id, timestamp) VALUES (?, ?)';

function openDb(dbPath) {
  const conn = new Database(dbPath);
  conn.exec('PRAGMA journal_mode=WAL;');
  conn.exec('PRAGMA busy_timeout=5000;');
  conn.exec(CREATE_NOTEXIST_TABLE_SQL);

  const selectNotExistStmt = conn.prepare(SELECT_NOTEXIST_SQL);
  const upsertNotExistStmt = conn.prepare(UPSERT_NOTEXIST_SQL);

  let db = {
    getNotExist: function (cid) {
      const row = selectNotExistStmt.get(cid);
      if (!row) return null;
      const ts = Number.parseInt(row.timestamp, 10);
      return Number.isNaN(ts) ? null : ts;
    },
    setNotExist: function (cid, ts) {
      upsertNotExistStmt.run(cid, String(ts));
    },
  };
  return db;
}

export { openDb };
