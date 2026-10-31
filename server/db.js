// 資料庫連線：雙模式與自動安全備援
// - 優先嘗試連線 DATABASE_URL（例如 Supabase / PostgreSQL）
// - 若遠端連線或密碼錯誤，自動無縫切換回「本機 SQLite（data/school.db）」，保證網站永不當機
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function sanitizeDbUrl(url) {
  if (!url) return '';
  const match = url.match(/^(postgres(?:ql)?:\/\/[^:]+:)(.*)(@[^@]+)$/);
  if (!match) return url;
  let [, prefix, pass, suffix] = match;
  if (pass.startsWith('[') && pass.endsWith(']')) {
    pass = pass.slice(1, -1);
  }
  try {
    if (decodeURIComponent(pass) === pass) {
      pass = encodeURIComponent(pass);
    }
  } catch {
    pass = encodeURIComponent(pass);
  }
  return `${prefix}${pass}${suffix}`;
}

const rawUrl = sanitizeDbUrl(process.env.DATABASE_URL?.trim() || '');
const isPg = /^postgres(ql)?:\/\//i.test(rawUrl);
const TZ = process.env.TZ_NAME?.trim() || 'Asia/Taipei';

export let dbMode = '載入中...';
export let dbWarning = null;

let usePg = false;
let pgPool = null;
let libsql = null;

// SQLite 語法 → PostgreSQL 語法
function toPg(sql) {
  let i = 0;
  return sql
    .replace(/datetime\('now',\s*'localtime'\)/g, `to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS')`)
    .replace(/\?/g, () => `$${++i}`);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    grade INTEGER NOT NULL,
    unit TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    options TEXT,
    answer TEXT NOT NULL,
    explanation TEXT,
    has_figure INTEGER DEFAULT 0,
    upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_q_sg ON questions(subject, grade)`,
  `CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title TEXT,
    subject TEXT,
    grade INTEGER,
    total INTEGER DEFAULT 0,
    correct INTEGER,
    score INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    submitted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS exam_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    student_answer TEXT,
    is_correct INTEGER,
    feedback TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_items_exam ON exam_items(exam_id)`,
];

async function initLibSql(asFallback = false) {
  usePg = false;
  const { createClient } = await import('@libsql/client');
  let url = rawUrl;
  if (!url || asFallback) {
    const dataDir = path.join(ROOT, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    url = 'file:' + path.join(dataDir, 'school.db');
    dbMode = asFallback ? '本機 SQLite（雲端備援）' : '本機 SQLite';
  } else {
    dbMode = '雲端 Turso';
  }
  libsql = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined });
  await libsql.execute('PRAGMA foreign_keys = ON').catch(() => {});
  for (const sql of SCHEMA) {
    await libsql.execute(sql);
  }
}

export async function initDb() {
  if (isPg) {
    try {
      const pg = (await import('pg')).default;
      pg.types.setTypeParser(20, (v) => parseInt(v, 10));
      pg.types.setTypeParser(1700, (v) => parseFloat(v));
      const local = /@(localhost|127\.0\.0\.1)[:/]/.test(rawUrl);
      pgPool = new pg.Pool({
        connectionString: rawUrl,
        ssl: local ? false : { rejectUnauthorized: false },
        max: 5,
        connectionTimeoutMillis: 5000,
      });

      // 測試連線並建立資料表
      for (const sql of SCHEMA) {
        await pgPool.query(
          toPg(sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'SERIAL PRIMARY KEY'))
            .replace(/DEFAULT \((to_char\(.*?\))\)/g, 'DEFAULT $1')
        );
      }
      usePg = true;
      dbMode = local ? 'PostgreSQL（本機）' : '雲端 Supabase';
      dbWarning = null;
    } catch (err) {
      console.error('⚠️ Supabase 連線失敗：', err.message);
      const isAuth = /password|auth/i.test(err.message);
      dbWarning = isAuth
        ? 'Supabase 資料庫密碼認證失敗。系統已自動啟用「本機 SQLite」以確保網站正常運作，重設密碼後更新 .env 即可切回雲端。'
        : `Supabase 連線失敗（${err.message}）。系統已自動啟用「本機 SQLite」以確保網站正常運作。`;
      await initLibSql(true);
    }
  } else {
    await initLibSql(false);
  }
}

// ---------- 統一查詢介面 ----------
export async function all(sql, args = []) {
  if (usePg) return (await pgPool.query(toPg(sql), args)).rows;
  const r = await libsql.execute({ sql, args });
  return r.rows.map((row) => ({ ...row }));
}
export async function get(sql, args = []) {
  return (await all(sql, args))[0];
}
export async function run(sql, args = []) {
  if (usePg) {
    const isInsert = /^\s*INSERT/i.test(sql);
    const r = await pgPool.query(toPg(sql) + (isInsert ? ' RETURNING id' : ''), args);
    return { lastId: isInsert ? r.rows[0]?.id ?? null : null, changes: r.rowCount };
  }
  const r = await libsql.execute({ sql, args });
  return { lastId: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null, changes: r.rowsAffected };
}
