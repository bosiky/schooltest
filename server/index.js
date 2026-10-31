import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, dbMode, dbWarning, all, get, run } from './db.js';
import { aiEnabled, extractQuestions, aiGrade, readAnswerSheet, SUBJECTS } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
});

// 包裝 async 路由，統一錯誤處理
const h = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '伺服器錯誤' });
  });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

const TYPE_NAMES = { choice: '選擇題', truefalse: '是非題', fill: '填充題', short: '簡答題' };

// ---------- 系統資訊 ----------
app.get('/api/meta', h(async (req, res) => {
  const counts = await all('SELECT subject, grade, COUNT(*) AS n FROM questions GROUP BY subject, grade ORDER BY grade, subject');
  res.json({ dbMode, dbWarning, aiEnabled: aiEnabled(), subjects: SUBJECTS, typeNames: TYPE_NAMES, counts });
}));

// ---------- 學生 ----------
app.get('/api/students', h(async (req, res) => {
  res.json(await all(`SELECT s.*,
      (SELECT COUNT(*) FROM exams e WHERE e.student_id = s.id AND e.status = 'graded') AS exam_count,
      (SELECT ROUND(AVG(score), 1) FROM exams e WHERE e.student_id = s.id AND e.status = 'graded') AS avg_score
    FROM students s ORDER BY s.id`));
}));
app.post('/api/students', h(async (req, res) => {
  const { name, grade } = req.body;
  if (!name?.trim()) throw bad('請輸入姓名');
  const r = await run('INSERT INTO students (name, grade) VALUES (?, ?)', [name.trim(), Number(grade) || null]);
  res.json(await get('SELECT * FROM students WHERE id = ?', [r.lastId]));
}));
app.put('/api/students/:id', h(async (req, res) => {
  const { name, grade } = req.body;
  await run('UPDATE students SET name = ?, grade = ? WHERE id = ?', [name, Number(grade) || null, req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/students/:id', h(async (req, res) => {
  const id = req.params.id;
  await run('DELETE FROM exam_items WHERE exam_id IN (SELECT id FROM exams WHERE student_id = ?)', [id]);
  await run('DELETE FROM exams WHERE student_id = ?', [id]);
  await run('DELETE FROM students WHERE id = ?', [id]);
  res.json({ ok: true });
}));

// ---------- 上傳圖檔 → AI 辨識題目（先預覽，不直接存） ----------
app.post('/api/upload', upload.array('images', 10), h(async (req, res) => {
  if (!req.files?.length) throw bad('請選擇圖片檔（JPG / PNG / WEBP / HEIC）');
  const uploadIds = [];
  for (const f of req.files) {
    const r = await run('INSERT INTO uploads (filename, original_name) VALUES (?, ?)', [f.filename, f.originalname]);
    uploadIds.push(r.lastId);
  }
  const questions = await extractQuestions(req.files, { subject: req.body.subject, grade: req.body.grade });
  res.json({
    upload_id: uploadIds[0],
    images: req.files.map((f) => '/uploads/' + f.filename),
    questions,
  });
}));

// ---------- 題庫 ----------
function parseQ(q) {
  return { ...q, options: q.options ? JSON.parse(q.options) : null };
}
function cleanQ(q) {
  if (!SUBJECTS.includes(q.subject)) q.subject = '其他';
  const grade = Math.min(6, Math.max(1, Number(q.grade) || 1));
  if (!TYPE_NAMES[q.type]) throw bad('題型錯誤');
  if (!q.content?.trim()) throw bad('題目內容不可空白');
  if (!String(q.answer ?? '').trim()) throw bad(`題目「${q.content.slice(0, 20)}」缺少答案`);
  return [
    q.subject, grade, q.unit || null, q.type, q.content.trim(),
    q.type === 'choice' ? JSON.stringify((q.options || []).filter((o) => String(o).trim())) : null,
    String(q.answer).trim(), q.explanation || null, q.has_figure ? 1 : 0,
  ];
}
app.get('/api/questions', h(async (req, res) => {
  const { subject, grade, type, q, unit } = req.query;
  const where = [], args = [];
  if (subject) { where.push('subject = ?'); args.push(subject); }
  if (grade) { where.push('grade = ?'); args.push(Number(grade)); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (unit) { where.push('unit = ?'); args.push(unit); }
  if (q) { where.push('(content LIKE ? OR answer LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = await all(
    `SELECT q.*, u.filename AS image FROM questions q LEFT JOIN uploads u ON u.id = q.upload_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC LIMIT 500`, args);
  res.json(rows.map(parseQ));
}));
app.get('/api/units', h(async (req, res) => {
  const { subject, grade } = req.query;
  const where = ["unit IS NOT NULL AND unit <> ''"], args = [];
  if (subject) { where.push('subject = ?'); args.push(subject); }
  if (grade) { where.push('grade = ?'); args.push(Number(grade)); }
  res.json(await all(`SELECT unit, COUNT(*) AS n FROM questions WHERE ${where.join(' AND ')} GROUP BY unit ORDER BY unit`, args));
}));
app.post('/api/questions/bulk', h(async (req, res) => {
  const { questions = [], upload_id = null } = req.body;
  if (!questions.length) throw bad('沒有題目可儲存');
  const rows = questions.map(cleanQ); // 先全部驗證
  // 一次多筆寫入，減少與雲端資料庫的往返次數
  await run(`INSERT INTO questions (subject, grade, unit, type, content, options, answer, explanation, has_figure, upload_id)
             VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`, rows.flatMap((r) => [...r, upload_id]));
  res.json({ saved: rows.length });
}));
app.put('/api/questions/:id', h(async (req, res) => {
  await run(`UPDATE questions SET subject=?, grade=?, unit=?, type=?, content=?, options=?, answer=?, explanation=?, has_figure=?
             WHERE id = ?`, [...cleanQ(req.body), req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/questions/:id', h(async (req, res) => {
  await run('DELETE FROM exam_items WHERE question_id = ?', [req.params.id]);
  await run('DELETE FROM questions WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- 錯題計算 ----------
// 回傳每題的作答統計：答錯次數、最後一次是否答對（最後一次答對 = 已訂正）
async function wrongStats(studentId) {
  const rows = await all(
    `SELECT i.question_id, i.is_correct, i.student_answer, e.submitted_at
     FROM exam_items i JOIN exams e ON e.id = i.exam_id
     WHERE e.student_id = ? AND e.status = 'graded' ORDER BY e.submitted_at, i.id`, [studentId]);
  const map = new Map();
  for (const r of rows) {
    const s = map.get(r.question_id) || { question_id: r.question_id, attempts: 0, wrong_count: 0 };
    s.attempts++;
    if (!r.is_correct) { s.wrong_count++; s.last_wrong_at = r.submitted_at; s.last_wrong_answer = r.student_answer; }
    s.last_correct = !!r.is_correct;
    map.set(r.question_id, s);
  }
  return [...map.values()].filter((s) => s.wrong_count > 0);
}

app.get('/api/students/:id/wrong', h(async (req, res) => {
  const stats = await wrongStats(req.params.id);
  if (!stats.length) return res.json([]);
  const qs = await all(`SELECT * FROM questions WHERE id IN (${stats.map(() => '?').join(',')})`, stats.map((s) => s.question_id));
  const qmap = new Map(qs.map((q) => [q.id, parseQ(q)]));
  res.json(stats.filter((s) => qmap.has(s.question_id))
    .map((s) => ({ ...qmap.get(s.question_id), ...s, mastered: s.last_correct }))
    .sort((a, b) => (a.mastered - b.mastered) || String(b.last_wrong_at).localeCompare(String(a.last_wrong_at))));
}));

app.get('/api/students/:id/stats', h(async (req, res) => {
  const id = req.params.id;
  const bySubject = await all(
    `SELECT subject, COUNT(*) AS exams, ROUND(AVG(score),1) AS avg_score, MAX(score) AS best, MIN(score) AS worst
     FROM exams WHERE student_id = ? AND status = 'graded' GROUP BY subject`, [id]);
  const trend = await all(
    `SELECT id, title, subject, score, submitted_at FROM exams WHERE student_id = ? AND status = 'graded'
     ORDER BY submitted_at DESC LIMIT 20`, [id]);
  res.json({ bySubject, trend: trend.reverse() });
}));

// ---------- 產生考卷 ----------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

app.post('/api/exams', h(async (req, res) => {
  const { student_id, subject, grade, unit, count = 10, types = [], mode = 'random', title } = req.body;
  if (!student_id) throw bad('請先選擇學生');
  const student = await get('SELECT * FROM students WHERE id = ?', [student_id]);
  if (!student) throw bad('找不到學生');
  const n = Math.min(100, Math.max(1, Number(count) || 10));

  const where = [], args = [];
  if (subject) { where.push('subject = ?'); args.push(subject); }
  if (grade) { where.push('grade = ?'); args.push(Number(grade)); }
  if (unit) { where.push('unit = ?'); args.push(unit); }
  if (types.length) { where.push(`type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
  const pool = await all(`SELECT id FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args);
  if (!pool.length) throw bad('符合條件的題目數為 0，請先上傳題目或放寬條件。');

  const poolIds = new Set(pool.map((p) => p.id));
  const wrongIds = shuffle((await wrongStats(student_id)).filter((s) => !s.last_correct && poolIds.has(s.question_id)).map((s) => s.question_id));

  let picked = [];
  if (mode === 'wrong_only') {
    if (!wrongIds.length) throw bad('這個條件下沒有尚未訂正的錯題，太棒了！');
    picked = wrongIds.slice(0, n);
  } else {
    if (mode === 'wrong_first') picked = wrongIds.slice(0, Math.ceil(n / 2)); // 錯題最多佔一半
    const rest = shuffle(pool.map((p) => p.id).filter((id) => !picked.includes(id)));
    picked = shuffle([...picked, ...rest.slice(0, n - picked.length)]);
  }

  const examTitle = title?.trim() || `${grade ? grade + '年級 ' : ''}${subject || '綜合'}${unit ? '・' + unit : ''} 測驗`;
  const r = await run('INSERT INTO exams (student_id, title, subject, grade, total) VALUES (?, ?, ?, ?, ?)',
    [student_id, examTitle, subject || '綜合', Number(grade) || null, picked.length]);
  await run(`INSERT INTO exam_items (exam_id, question_id, seq) VALUES ${picked.map(() => '(?, ?, ?)').join(', ')}`,
    picked.flatMap((qid, i) => [r.lastId, qid, i + 1]));
  res.json({ id: r.lastId, total: picked.length, requested: n });
}));

app.get('/api/exams', h(async (req, res) => {
  const { student_id } = req.query;
  res.json(await all(
    `SELECT e.*, s.name AS student_name FROM exams e JOIN students s ON s.id = e.student_id
     ${student_id ? 'WHERE e.student_id = ?' : ''} ORDER BY e.id DESC LIMIT 200`, student_id ? [student_id] : []));
}));

async function loadExam(id, withAnswers) {
  const exam = await get('SELECT e.*, s.name AS student_name FROM exams e JOIN students s ON s.id = e.student_id WHERE e.id = ?', [id]);
  if (!exam) throw Object.assign(new Error('找不到考卷'), { status: 404 });
  const items = (await all(
    `SELECT i.id AS item_id, i.seq, i.student_answer, i.is_correct, i.feedback,
            q.id AS question_id, q.type, q.content, q.options, q.answer, q.explanation, q.has_figure, q.subject, q.unit,
            u.filename AS image
     FROM exam_items i JOIN questions q ON q.id = i.question_id LEFT JOIN uploads u ON u.id = q.upload_id
     WHERE i.exam_id = ? ORDER BY i.seq`, [id])).map(parseQ);
  const show = withAnswers || exam.status === 'graded';
  if (!show) items.forEach((it) => { delete it.answer; delete it.explanation; });
  return { ...exam, items };
}

app.get('/api/exams/:id', h(async (req, res) => {
  res.json(await loadExam(req.params.id, req.query.answers === '1'));
}));
app.delete('/api/exams/:id', h(async (req, res) => {
  await run('DELETE FROM exam_items WHERE exam_id = ?', [req.params.id]);
  await run('DELETE FROM exams WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- 改考卷 ----------
function norm(s) {
  return String(s ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全形轉半形
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/[\s。．.!！?？]+$/g, '')
    .replace(/\s+/g, '')
    .replace(/[、,，;；]/g, ',');
}
function normChoice(s) {
  const t = norm(s).toUpperCase();
  const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '①': 'A', '②': 'B', '③': 'C', '④': 'D' };
  const c = t.replace(/[()（）]/g, '')[0] || '';
  return map[c] || c;
}
function normTF(s) {
  const t = norm(s);
  if (/^(o|○|◯|對|是|✓|✔|v|t|true)$/.test(t)) return 'O';
  if (/^(x|×|✗|✘|錯|否|f|false)$/.test(t)) return 'X';
  return t.toUpperCase();
}

// keyBy：'item' = answers 以 item_id 為 key（線上作答）；'seq' = 以題號為 key（拍照辨識）
async function gradeExam(examId, answers, keyBy = 'item') {
  const exam = await loadExam(examId, true);
  const pendingAI = [];
  const results = new Map();
  for (const it of exam.items) {
    const ans = String(answers[keyBy === 'seq' ? it.seq : it.item_id] ?? '').trim();
    let ok = false;
    if (!ans) ok = false;
    else if (it.type === 'choice') ok = normChoice(ans) === normChoice(it.answer);
    else if (it.type === 'truefalse') ok = normTF(ans) === normTF(it.answer);
    else ok = String(it.answer).split('|').some((a) => norm(a) === norm(ans));
    results.set(it.item_id, { ans, ok, feedback: null });
    if (!ok && ans && (it.type === 'fill' || it.type === 'short')) pendingAI.push({ id: it.item_id, content: it.content, answer: it.answer, student_answer: ans });
  }
  // 填充/簡答比對不到時，交給 AI 判斷是否意思相同
  if (pendingAI.length) {
    if (aiEnabled()) {
      try {
        for (const g of await aiGrade(pendingAI)) {
          const r = results.get(g.id);
          if (r) { r.ok = !!g.correct; r.feedback = g.feedback || null; }
        }
      } catch (e) {
        console.error('AI 批改失敗：', e.message);
        pendingAI.forEach((p) => (results.get(p.id).feedback = 'AI 批改失敗，請家長人工確認'));
      }
    } else {
      pendingAI.forEach((p) => (results.get(p.id).feedback = '與參考答案不同，請家長人工確認'));
    }
  }
  for (const [itemId, r] of results) {
    await run('UPDATE exam_items SET student_answer = ?, is_correct = ?, feedback = ? WHERE id = ?', [r.ans, r.ok ? 1 : 0, r.feedback, itemId]);
  }
  await recalcScore(examId);
  return loadExam(examId, true);
}

async function recalcScore(examId) {
  const s = await get('SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM exam_items WHERE exam_id = ?', [examId]);
  const total = Number(s.total) || 0, correct = Number(s.correct) || 0;
  const score = total ? Math.round((correct / total) * 100) : 0;
  await run(`UPDATE exams SET total = ?, correct = ?, score = ?, status = 'graded',
             submitted_at = COALESCE(submitted_at, datetime('now','localtime')) WHERE id = ?`, [total, correct, score, examId]);
}

// 線上作答交卷（answers: { item_id: 答案 }）
app.post('/api/exams/:id/submit', h(async (req, res) => {
  res.json(await gradeExam(req.params.id, req.body.answers || {}));
}));

// 拍照改紙本考卷：AI 讀出手寫答案後自動批改
app.post('/api/exams/:id/photo', upload.array('images', 5), h(async (req, res) => {
  if (!req.files?.length) throw bad('請上傳考卷照片');
  const exam = await loadExam(req.params.id, true);
  const read = await readAnswerSheet(req.files, exam.items);
  const answers = {};
  for (const a of read) answers[a.seq] = a.answer;
  res.json(await gradeExam(req.params.id, answers, 'seq'));
}));

// 家長手動改判對錯
app.put('/api/exams/:id/items/:itemId', h(async (req, res) => {
  await run('UPDATE exam_items SET is_correct = ?, feedback = ? WHERE id = ? AND exam_id = ?',
    [req.body.is_correct ? 1 : 0, req.body.is_correct ? null : req.body.feedback ?? null, req.params.itemId, req.params.id]);
  await recalcScore(req.params.id);
  res.json(await loadExam(req.params.id, true));
}));

// SPA fallback
app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

const PORT = Number(process.env.PORT) || 3000;
await initDb();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 小學測驗系統已啟動：http://localhost:${PORT}`);
  console.log(`   資料庫模式：${dbMode}　AI 辨識：${aiEnabled() ? '已啟用' : '未設定 GEMINI_API_KEY'}`);
});
