// 小學測驗小幫手 — 前端（原生 JavaScript，hash 路由）
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const GRADES = [1, 2, 3, 4, 5, 6];
let META = { subjects: [], typeNames: {}, counts: [] };
let students = [];

// ---------- 共用工具 ----------
async function api(url, opts = {}) {
  const init = { ...opts };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `錯誤 ${res.status}`);
  return data;
}
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = 'toast'), 3000);
}
function modal(html) {
  $('#modalBox').innerHTML = html;
  $('#modal').classList.remove('hidden');
  return $('#modalBox');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

const scoreClass = (s) => (s >= 90 ? 'hi' : s >= 70 ? 'mid' : 'lo');
const gradeOpts = (sel, emptyLabel = '全部年級') =>
  `<option value="">${emptyLabel}</option>` + GRADES.map((g) => `<option value="${g}" ${String(sel) === String(g) ? 'selected' : ''}>${g} 年級</option>`).join('');
const subjectOpts = (sel, emptyLabel = '全部科目') =>
  `<option value="">${emptyLabel}</option>` + META.subjects.map((s) => `<option ${sel === s ? 'selected' : ''}>${s}</option>`).join('');
const typeOpts = (sel) => Object.entries(META.typeNames).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');

function currentStudentId() { return Number(localStorage.getItem('studentId')) || null; }
function currentStudent() { return students.find((s) => s.id === currentStudentId()); }

async function loadStudents() {
  students = await api('/api/students');
  if (!students.find((s) => s.id === currentStudentId())) {
    if (students[0]) localStorage.setItem('studentId', students[0].id);
    else localStorage.removeItem('studentId');
  }
  const sel = $('#studentSelect');
  sel.innerHTML = students.length
    ? students.map((s) => `<option value="${s.id}" ${s.id === currentStudentId() ? 'selected' : ''}>${esc(s.name)}${s.grade ? `（${s.grade}年級）` : ''}</option>`).join('')
    : '<option value="">請先新增學生</option>';
}
$('#studentSelect').addEventListener('change', (e) => { localStorage.setItem('studentId', e.target.value); router(); });

function needStudent() {
  if (currentStudent()) return false;
  app.innerHTML = `<div class="card">請先到 <a href="#/">首頁</a> 新增學生。</div>`;
  return true;
}

function answerText(q, ans) {
  if (ans == null || ans === '') return '（未作答）';
  if (q.type === 'choice') {
    const idx = LETTERS.indexOf(String(ans).trim().toUpperCase()[0]);
    return idx >= 0 && q.options?.[idx] != null ? `(${LETTERS[idx]}) ${q.options[idx]}` : ans;
  }
  if (q.type === 'truefalse') return String(ans).toUpperCase().startsWith('O') ? '○ 對' : String(ans).toUpperCase().startsWith('X') ? '✕ 錯' : ans;
  return String(ans).split('|').join(' 或 ');
}

// ---------- 路由 ----------
const routes = {
  '': pageHome,
  upload: pageUpload,
  bank: pageBank,
  new: pageNewExam,
  exam: pageExam,
  print: pagePrint,
  history: pageHistory,
  wrong: pageWrong,
};
async function router() {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name}`));
  document.body.classList.toggle('printing', name === 'print');
  try {
    await (routes[name] || pageHome)(...params);
  } catch (e) {
    app.innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

// ---------- 首頁：學生管理與成績概況 ----------
async function pageHome() {
  await loadStudents();
  META = await api('/api/meta');
  const total = META.counts.reduce((a, c) => a + c.n, 0);
  const st = currentStudent();
  let statsHtml = '';
  if (st) {
    const stats = await api(`/api/students/${st.id}/stats`);
    statsHtml = `
      <div class="card">
        <h2>📈 ${esc(st.name)} 的各科成績</h2>
        ${stats.bySubject.length ? `<table><tr><th>科目</th><th>考試次數</th><th>平均</th><th>最高</th><th>最低</th></tr>
          ${stats.bySubject.map((s) => `<tr><td>${esc(s.subject)}</td><td>${s.exams}</td>
            <td class="score ${scoreClass(s.avg_score)}">${s.avg_score}</td><td>${s.best}</td><td>${s.worst}</td></tr>`).join('')}</table>` :
          '<p class="muted">還沒有考試紀錄，去 <a href="#/new">出一份考卷</a> 吧！</p>'}
        ${stats.trend.length ? `<h2 style="margin-top:18px">最近成績</h2>
          ${stats.trend.slice(-10).map((t) => `<div class="row" style="margin-bottom:6px"><span style="width:180px" class="muted">${esc(t.submitted_at?.slice(5, 16))} ${esc(t.subject)}</span>
            <div class="bar" style="flex:1"><div style="width:${t.score}%;background:${t.score >= 90 ? 'var(--ok)' : t.score >= 70 ? 'var(--warn)' : 'var(--bad)'}"></div></div>
            <a href="#/exam/${t.id}" class="score ${scoreClass(t.score)}" style="width:40px;text-align:right">${t.score}</a></div>`).join('')}` : ''}
      </div>`;
  }
  app.innerHTML = `
    ${META.dbWarning ? `<div class="banner">⚠️ <b>${esc(META.dbWarning)}</b></div>` : ''}
    ${!META.aiEnabled ? `<div class="banner">⚠️ 尚未設定 <b>GEMINI_API_KEY</b>，無法使用「上傳圖檔辨識題目」與「拍照改考卷」。請在專案的 <code>.env</code> 檔填入後重新啟動。（仍可手動新增題目）</div>` : ''}
    <div class="grid" style="margin-bottom:16px">
      <div class="card stat"><div class="num">${total}</div><div class="muted">題庫題數</div></div>
      <div class="card stat"><div class="num">${students.length}</div><div class="muted">學生人數</div></div>
      <div class="card stat"><div class="num" style="font-size:1.2rem;padding:12px 0">${esc(META.dbMode)}</div><div class="muted">資料庫模式</div></div>
    </div>
    <div class="card">
      <h2>👨‍👩‍👧 學生</h2>
      <table>
        <tr><th>姓名</th><th>年級</th><th>考試次數</th><th>平均分數</th><th></th></tr>
        ${students.map((s) => `<tr>
          <td><a href="#" data-pick="${s.id}">${esc(s.name)}</a> ${s.id === currentStudentId() ? '<span class="tag blue">目前</span>' : ''}</td>
          <td>${s.grade ? s.grade + ' 年級' : '-'}</td><td>${s.exam_count}</td>
          <td>${s.avg_score != null ? `<span class="score ${scoreClass(s.avg_score)}">${s.avg_score}</span>` : '-'}</td>
          <td style="text-align:right"><button class="small secondary" data-edit="${s.id}">修改</button>
              <button class="small danger" data-del="${s.id}">刪除</button></td></tr>`).join('')}
      </table>
      <form id="addStudent" class="row" style="margin-top:12px">
        <input name="name" placeholder="學生姓名" required />
        <select name="grade">${gradeOpts('', '年級')}</select>
        <button>＋ 新增學生</button>
      </form>
    </div>
    ${statsHtml}
    <div class="card">
      <h2>📚 題庫分布</h2>
      ${META.counts.length ? `<div class="row">${META.counts.map((c) => `<a class="tag blue" href="#/bank?subject=${encodeURIComponent(c.subject)}&grade=${c.grade}">${c.grade}年級 ${esc(c.subject)}：${c.n} 題</a>`).join('')}</div>`
        : '<p class="muted">題庫還是空的，請先 <a href="#/upload">上傳課本或測驗卷圖檔</a>。</p>'}
    </div>`;

  $('#addStudent').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const s = await api('/api/students', { method: 'POST', body: { name: f.get('name'), grade: f.get('grade') } });
    localStorage.setItem('studentId', s.id);
    toast('已新增學生');
    pageHome();
  };
  $$('[data-pick]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); localStorage.setItem('studentId', a.dataset.pick); pageHome(); }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('確定刪除這位學生？他的所有考試紀錄也會一併刪除！')) return;
    await api(`/api/students/${b.dataset.del}`, { method: 'DELETE' });
    pageHome();
  }));
  $$('[data-edit]').forEach((b) => (b.onclick = async () => {
    const s = students.find((x) => x.id === Number(b.dataset.edit));
    const name = prompt('姓名', s.name); if (name == null) return;
    const grade = prompt('年級（1~6）', s.grade ?? ''); if (grade == null) return;
    await api(`/api/students/${s.id}`, { method: 'PUT', body: { name, grade } });
    pageHome();
  }));
}

// ---------- 題目編輯表單（上傳預覽與題庫共用） ----------
function questionEditor(q, idx) {
  const opts = q.options?.length ? q.options : ['', '', '', ''];
  return `
  <div class="q edit-q" data-idx="${idx}">
    <div class="row">
      <label class="no-flex" style="flex:0"><span>收錄</span><input type="checkbox" name="keep" checked /></label>
      <label>科目<select name="subject">${subjectOpts(q.subject, '選擇科目')}</select></label>
      <label>年級<select name="grade">${gradeOpts(q.grade, '選擇年級')}</select></label>
      <label>題型<select name="type">${typeOpts(q.type)}</select></label>
      <label>單元<input name="unit" value="${esc(q.unit)}" placeholder="例：分數的加減" /></label>
    </div>
    <label class="muted">題目<textarea name="content">${esc(q.content)}</textarea></label>
    <div class="opts-box" ${q.type === 'choice' ? '' : 'style="display:none"'}>
      <div class="muted">選項（空白的選項會被忽略）</div>
      ${LETTERS.slice(0, Math.max(4, opts.length)).map((L, i) => `<div class="row" style="margin-top:4px"><b>${L}</b><input name="opt" style="flex:1" value="${esc(opts[i] ?? '')}" /></div>`).join('')}
    </div>
    <div class="row">
      <label>答案<input name="answer" value="${esc(q.answer)}" placeholder="選擇 A~D／是非 O 或 X／多個答案以 | 分隔" style="min-width:260px" /></label>
      <label style="flex:2">解析<input name="explanation" value="${esc(q.explanation)}" /></label>
      <label style="flex:0"><span>需看圖</span><input type="checkbox" name="has_figure" ${q.has_figure ? 'checked' : ''} /></label>
    </div>
  </div>`;
}
function readEditor(el) {
  const v = (n) => $(`[name="${n}"]`, el).value;
  return {
    keep: $('[name="keep"]', el)?.checked ?? true,
    subject: v('subject'), grade: Number(v('grade')), type: v('type'), unit: v('unit').trim(),
    content: v('content'), answer: v('answer').trim(), explanation: v('explanation').trim(),
    has_figure: $('[name="has_figure"]', el).checked,
    options: $$('[name="opt"]', el).map((i) => i.value.trim()).filter(Boolean),
  };
}
function bindEditorTypeToggle(root) {
  $$('[name="type"]', root).forEach((s) => (s.onchange = () => {
    $('.opts-box', s.closest('.q')).style.display = s.value === 'choice' ? '' : 'none';
  }));
}

// ---------- 上傳圖檔辨識題目 ----------
async function pageUpload() {
  META = await api('/api/meta');
  app.innerHTML = `
    <h1>📷 上傳課本／測驗卷</h1>
    ${!META.aiEnabled ? '<div class="banner">⚠️ 尚未設定 GEMINI_API_KEY，無法自動辨識。你仍可在「題庫」頁手動新增題目。</div>' : ''}
    <div class="card">
      <label class="dropzone" id="drop">
        <div style="font-size:2.5rem">🖼️</div>
        <div>點這裡選擇圖片，或把圖片拖曳進來（可多張，最多 10 張）</div>
        <div class="muted">支援 JPG / PNG / WEBP / HEIC，手機可直接拍照</div>
        <input type="file" id="files" accept="image/*" multiple hidden />
      </label>
      <div class="thumbs" id="thumbs" style="margin-top:12px"></div>
      <div class="row" style="margin-top:12px">
        <label>科目<select id="hintSubject">${subjectOpts('', '🤖 自動判斷')}</select></label>
        <label>年級<select id="hintGrade">${gradeOpts('', '🤖 自動判斷')}</select></label>
        <div class="spacer"></div>
        <button id="go" class="big" ${META.aiEnabled ? '' : 'disabled'}>開始辨識</button>
      </div>
    </div>
    <div id="result"></div>`;

  let files = [];
  const input = $('#files'), drop = $('#drop');
  const showThumbs = () => {
    $('#thumbs').innerHTML = files.map((f) => `<img src="${URL.createObjectURL(f)}" title="${esc(f.name)}" />`).join('');
  };
  input.onchange = () => { files = [...input.files].slice(0, 10); showThumbs(); };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove('drag');
    files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).slice(0, 10); showThumbs();
  };

  $('#go').onclick = async () => {
    if (!files.length) return toast('請先選擇圖片', true);
    const btn = $('#go');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> AI 辨識中，約需 10~60 秒…';
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('images', f));
      fd.append('subject', $('#hintSubject').value);
      fd.append('grade', $('#hintGrade').value);
      const data = await api('/api/upload', { method: 'POST', body: fd });
      renderExtracted(data);
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = '開始辨識'; }
  };
}

function renderExtracted(data) {
  const box = $('#result');
  if (!data.questions.length) { box.innerHTML = '<div class="card">沒有辨識到題目，請換一張更清楚的圖片試試。</div>'; return; }
  box.innerHTML = `
    <div class="card">
      <div class="row"><h2 style="margin:0">辨識結果：共 ${data.questions.length} 題</h2><div class="spacer"></div>
        <span class="muted">請檢查答案是否正確，可直接修改；取消勾選「收錄」的題目不會存入</span></div>
    </div>
    <div id="editors">${data.questions.map(questionEditor).join('')}</div>
    <div class="row"><div class="spacer"></div><button id="saveAll" class="big ok">💾 存入題庫</button></div>`;
  bindEditorTypeToggle(box);
  $('#saveAll').onclick = async () => {
    const qs = $$('#editors .q').map(readEditor).filter((q) => q.keep);
    if (!qs.length) return toast('沒有勾選任何題目', true);
    try {
      const r = await api('/api/questions/bulk', { method: 'POST', body: { questions: qs, upload_id: data.upload_id } });
      toast(`已存入 ${r.saved} 題 🎉`);
      box.innerHTML = `<div class="card">✅ 已存入 ${r.saved} 題。 <a href="#/bank">查看題庫</a> ｜ <a href="#/new">馬上出考卷</a></div>`;
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- 題庫 ----------
async function pageBank() {
  META = await api('/api/meta');
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  app.innerHTML = `
    <h1>🗂️ 題庫</h1>
    <div class="card row">
      <select id="fSubject">${subjectOpts(qs.get('subject') || '')}</select>
      <select id="fGrade">${gradeOpts(qs.get('grade') || '')}</select>
      <select id="fType"><option value="">全部題型</option>${typeOpts('')}</select>
      <input id="fQ" placeholder="搜尋題目關鍵字" />
      <div class="spacer"></div>
      <button id="addQ" class="secondary">＋ 手動新增題目</button>
    </div>
    <div id="list"></div>`;

  const load = async () => {
    const p = new URLSearchParams({ subject: $('#fSubject').value, grade: $('#fGrade').value, type: $('#fType').value, q: $('#fQ').value });
    const list = await api('/api/questions?' + p);
    $('#list').innerHTML = `<p class="muted">共 ${list.length} 題${list.length >= 500 ? '（最多顯示 500 題）' : ''}</p>` +
      list.map((q) => `
      <div class="q">
        <div class="q-head">
          <span class="tag blue">${q.grade}年級</span><span class="tag">${esc(q.subject)}</span>
          <span class="tag">${META.typeNames[q.type]}</span>${q.unit ? `<span class="tag">${esc(q.unit)}</span>` : ''}
          ${q.has_figure ? `<span class="tag orange">需看圖</span>` : ''}
          <div class="spacer"></div>
          ${q.image ? `<a class="small" href="/uploads/${esc(q.image)}" target="_blank">原圖</a>` : ''}
          <button class="small secondary" data-edit="${q.id}">編輯</button>
          <button class="small danger" data-del="${q.id}">刪除</button>
        </div>
        <div class="q-content">${esc(q.content)}</div>
        ${q.type === 'choice' ? `<div class="muted">${q.options.map((o, i) => `(${LETTERS[i]}) ${esc(o)}`).join('　')}</div>` : ''}
        <div class="answer-line">答案：<b>${esc(answerText(q, q.answer))}</b>${q.explanation ? `<br><span class="muted">解析：${esc(q.explanation)}</span>` : ''}</div>
      </div>`).join('');
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('確定刪除這題？（考試紀錄中的這題也會移除）')) return;
      await api(`/api/questions/${b.dataset.del}`, { method: 'DELETE' }); load();
    }));
    $$('[data-edit]').forEach((b) => (b.onclick = () => editQuestion(list.find((q) => q.id === Number(b.dataset.edit)), load)));
  };
  ['fSubject', 'fGrade', 'fType'].forEach((id) => ($('#' + id).onchange = load));
  let t; $('#fQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  $('#addQ').onclick = () => editQuestion(null, load);
  load();
}

function editQuestion(q, done) {
  const isNew = !q;
  q = q || { subject: $('#fSubject')?.value || META.subjects[0], grade: Number($('#fGrade')?.value) || currentStudent()?.grade || 1, type: 'choice' };
  const box = modal(`<h2>${isNew ? '新增題目' : '編輯題目'}</h2>${questionEditor(q, 0)}
    <div class="row"><div class="spacer"></div><button class="secondary" id="cancel">取消</button><button id="save">儲存</button></div>`);
  $('[name="keep"]', box).closest('label').style.display = 'none';
  bindEditorTypeToggle(box);
  $('#cancel').onclick = closeModal;
  $('#save').onclick = async () => {
    const data = readEditor($('.q', box));
    try {
      if (isNew) await api('/api/questions/bulk', { method: 'POST', body: { questions: [data] } });
      else await api(`/api/questions/${q.id}`, { method: 'PUT', body: data });
      closeModal(); toast('已儲存'); done();
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- 出考卷 ----------
async function pageNewExam() {
  await loadStudents();
  if (needStudent()) return;
  META = await api('/api/meta');
  const st = currentStudent();
  app.innerHTML = `
    <h1>📝 產生隨機考卷</h1>
    <div class="card">
      <p>考生：<b>${esc(st.name)}</b></p>
      <div class="row">
        <label>科目<select id="subject">${subjectOpts('', '全部科目（綜合）')}</select></label>
        <label>年級<select id="grade">${gradeOpts(st.grade || '')}</select></label>
        <label>單元<select id="unit"><option value="">全部單元</option></select></label>
        <label>題數<input id="count" type="number" min="1" max="100" value="10" style="width:90px" /></label>
      </div>
      <div style="margin-top:12px">
        <div class="muted">題型（不勾選＝全部）</div>
        <div class="row">${Object.entries(META.typeNames).map(([k, v]) => `<label style="flex-direction:row"><input type="checkbox" name="types" value="${k}" /> ${v}</label>`).join('')}</div>
      </div>
      <div style="margin-top:12px">
        <div class="muted">出題方式</div>
        <div class="row">
          <label style="flex-direction:row"><input type="radio" name="mode" value="random" checked /> 完全隨機</label>
          <label style="flex-direction:row"><input type="radio" name="mode" value="wrong_first" /> 錯題優先（最多一半是之前答錯的題目）</label>
          <label style="flex-direction:row"><input type="radio" name="mode" value="wrong_only" /> 只考錯題</label>
        </div>
      </div>
      <p class="muted" id="available"></p>
      <div class="row"><div class="spacer"></div><button id="create" class="big">產生考卷</button></div>
    </div>`;

  const refresh = async () => {
    const s = $('#subject').value, g = $('#grade').value;
    const units = await api(`/api/units?subject=${encodeURIComponent(s)}&grade=${g}`);
    $('#unit').innerHTML = '<option value="">全部單元</option>' + units.map((u) => `<option>${esc(u.unit)}</option>`).join('');
    const n = META.counts.filter((c) => (!s || c.subject === s) && (!g || c.grade === Number(g))).reduce((a, c) => a + c.n, 0);
    $('#available').textContent = `符合科目／年級的題目共 ${n} 題`;
  };
  $('#subject').onchange = refresh; $('#grade').onchange = refresh;
  refresh();

  $('#create').onclick = async () => {
    try {
      const r = await api('/api/exams', {
        method: 'POST',
        body: {
          student_id: st.id, subject: $('#subject').value, grade: $('#grade').value, unit: $('#unit').value,
          count: $('#count').value, types: $$('[name="types"]:checked').map((i) => i.value), mode: $('[name="mode"]:checked').value,
        },
      });
      if (r.total < r.requested) toast(`題庫只有 ${r.total} 題符合條件，已全部出題`);
      location.hash = `#/exam/${r.id}`;
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- 作答與批改結果 ----------
async function pageExam(id) {
  const exam = await api(`/api/exams/${id}`);
  if (exam.status === 'graded') return renderGraded(exam);
  const draftKey = `draft-${id}`;
  const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');

  app.innerHTML = `
    <div class="card row">
      <div><h1 style="margin:0">${esc(exam.title)}</h1><div class="muted">考生：${esc(exam.student_name)}　共 ${exam.total} 題　建立於 ${esc(exam.created_at)}</div></div>
      <div class="spacer"></div>
      <a class="btn secondary" href="#/print/${exam.id}">🖨️ 列印紙本</a>
      <button class="secondary" id="photoBtn">📷 拍照改紙本考卷</button>
    </div>
    <form id="examForm">
      ${exam.items.map((it) => `
        <div class="q">
          <div class="q-head"><b>第 ${it.seq} 題</b><span class="tag">${META.typeNames[it.type] || ''}</span>
            ${it.has_figure && it.image ? `<a class="small" href="/uploads/${esc(it.image)}" target="_blank">📎 看原圖</a>` : ''}</div>
          <div class="q-content">${esc(it.content)}</div>
          ${inputFor(it, draft[it.item_id])}
        </div>`).join('')}
      <div class="row"><span class="muted">作答內容會自動暫存，關掉網頁也不會不見</span><div class="spacer"></div><button class="big ok">✅ 交卷</button></div>
    </form>`;

  const form = $('#examForm');
  const collect = () => {
    const ans = {};
    exam.items.forEach((it) => {
      const name = `a${it.item_id}`;
      const el = form.elements[name];
      if (!el) return;
      ans[it.item_id] = el instanceof RadioNodeList ? el.value : el.value;
    });
    return ans;
  };
  form.oninput = () => localStorage.setItem(draftKey, JSON.stringify(collect()));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ans = collect();
    const empty = Object.values(ans).filter((v) => !String(v).trim()).length;
    if (empty && !confirm(`還有 ${empty} 題沒寫，確定要交卷嗎？`)) return;
    const btn = $('button.ok', form); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 批改中…';
    try {
      const graded = await api(`/api/exams/${id}/submit`, { method: 'POST', body: { answers: ans } });
      localStorage.removeItem(draftKey);
      renderGraded(graded, true);
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '✅ 交卷'; }
  };
  $('#photoBtn').onclick = () => photoGrade(exam);
}

function inputFor(it, val = '') {
  const name = `a${it.item_id}`;
  if (it.type === 'choice') {
    return `<div class="q-options">${it.options.map((o, i) => `
      <label><input type="radio" name="${name}" value="${LETTERS[i]}" ${val === LETTERS[i] ? 'checked' : ''} /> (${LETTERS[i]}) ${esc(o)}</label>`).join('')}</div>`;
  }
  if (it.type === 'truefalse') {
    return `<div class="q-options" style="grid-template-columns:repeat(2,max-content)">
      <label><input type="radio" name="${name}" value="O" ${val === 'O' ? 'checked' : ''} /> ○ 對</label>
      <label><input type="radio" name="${name}" value="X" ${val === 'X' ? 'checked' : ''} /> ✕ 錯</label></div>`;
  }
  if (it.type === 'short') return `<textarea name="${name}" placeholder="請寫下你的答案">${esc(val)}</textarea>`;
  return `<input name="${name}" value="${esc(val)}" placeholder="答案（多個空格請用「、」隔開）" style="width:100%;margin-top:8px" />`;
}

function photoGrade(exam) {
  const box = modal(`
    <h2>📷 拍照改紙本考卷</h2>
    <p class="muted">先用「列印紙本」印出考卷讓孩子寫，寫完拍照上傳（可多張），AI 會讀出手寫答案並自動批改。批改後仍可手動修正對錯。</p>
    <input type="file" id="pf" accept="image/*" multiple capture="environment" />
    <div class="row" style="margin-top:16px"><div class="spacer"></div><button class="secondary" id="pc">取消</button><button id="pg">開始批改</button></div>`);
  $('#pc', box).onclick = closeModal;
  $('#pg', box).onclick = async () => {
    const files = $('#pf', box).files;
    if (!files.length) return toast('請選擇照片', true);
    const btn = $('#pg', box); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 辨識批改中…';
    try {
      const fd = new FormData(); [...files].forEach((f) => fd.append('images', f));
      const graded = await api(`/api/exams/${exam.id}/photo`, { method: 'POST', body: fd });
      closeModal(); renderGraded(graded, true);
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = '開始批改'; }
  };
}

function renderGraded(exam, celebrate = false) {
  const wrong = exam.items.filter((i) => !i.is_correct).length;
  app.innerHTML = `
    <div class="card">
      <div class="row">
        <div><h1 style="margin:0">${esc(exam.title)}</h1>
          <div class="muted">考生：${esc(exam.student_name)}　交卷時間：${esc(exam.submitted_at)}</div></div>
        <div class="spacer"></div>
        <div><div class="score-big score ${scoreClass(exam.score)}">${exam.score}<span style="font-size:1.2rem"> 分</span></div>
          <div class="muted" style="text-align:center">答對 ${exam.correct} / ${exam.total} 題</div></div>
      </div>
      ${celebrate ? `<p style="font-size:1.2rem">${exam.score === 100 ? '🎉 滿分！太厲害了！' : exam.score >= 90 ? '👍 很棒！再接再厲！' : exam.score >= 70 ? '💪 不錯喔，把錯的題目訂正一下吧！' : '📖 別灰心，多練習錯題就會進步！'}</p>` : ''}
      <div class="row no-print">
        <label style="flex-direction:row"><input type="checkbox" id="onlyWrong" /> 只看錯題（${wrong} 題）</label>
        <div class="spacer"></div>
        <a class="btn secondary" href="#/print/${exam.id}?answers=1">🖨️ 列印（含答案）</a>
        <a class="btn secondary" href="#/wrong">📕 錯題本</a>
        <a class="btn" href="#/new">再考一次</a>
      </div>
    </div>
    <div id="items">
    ${exam.items.map((it) => `
      <div class="q ${it.is_correct ? 'correct' : 'wrong'}" data-ok="${it.is_correct ? 1 : 0}">
        <div class="q-head">
          <span class="mark ${it.is_correct ? 'ok' : 'bad'}">${it.is_correct ? '○' : '✕'}</span>
          <b>第 ${it.seq} 題</b><span class="tag">${META.typeNames[it.type] || ''}</span>
          <div class="spacer"></div>
          <button class="small secondary no-print" data-toggle="${it.item_id}" data-val="${it.is_correct ? 0 : 1}">改判為${it.is_correct ? '錯' : '對'}</button>
        </div>
        <div class="q-content">${esc(it.content)}</div>
        ${it.type === 'choice' ? `<div class="muted">${it.options.map((o, i) => `(${LETTERS[i]}) ${esc(o)}`).join('　')}</div>` : ''}
        <div class="answer-line">
          你的答案：<b style="color:${it.is_correct ? 'var(--ok)' : 'var(--bad)'}">${esc(answerText(it, it.student_answer))}</b>
          ${!it.is_correct ? `<br>正確答案：<b>${esc(answerText(it, it.answer))}</b>` : ''}
          ${it.feedback ? `<br>💬 ${esc(it.feedback)}` : ''}
          ${it.explanation ? `<br><span class="muted">解析：${esc(it.explanation)}</span>` : ''}
        </div>
      </div>`).join('')}
    </div>`;
  $('#onlyWrong').onchange = (e) => $$('#items .q').forEach((q) => (q.style.display = e.target.checked && q.dataset.ok === '1' ? 'none' : ''));
  $$('[data-toggle]').forEach((b) => (b.onclick = async () => {
    const updated = await api(`/api/exams/${exam.id}/items/${b.dataset.toggle}`, { method: 'PUT', body: { is_correct: b.dataset.val === '1' } });
    toast('已修改，分數重新計算');
    renderGraded(updated);
  }));
}

// ---------- 列印考卷 ----------
async function pagePrint(id) {
  const withAns = location.hash.includes('answers=1');
  const exam = await api(`/api/exams/${id}?answers=${withAns ? 1 : 0}`);
  app.innerHTML = `
    <div class="row no-print" style="margin-bottom:12px">
      <a class="btn secondary" href="#/exam/${id}">← 返回</a>
      <label style="flex-direction:row"><input type="checkbox" id="ansToggle" ${withAns ? 'checked' : ''} /> 顯示答案</label>
      <div class="spacer"></div><button onclick="window.print()">🖨️ 列印</button>
    </div>
    <div class="paper">
      <h1>${esc(exam.title)}</h1>
      <div class="info"><span>姓名：${esc(exam.student_name)}</span><span>日期：＿＿＿＿＿＿</span><span>分數：${withAns && exam.status === 'graded' ? exam.score : '＿＿＿＿'}</span><span class="muted">卷號 #${exam.id}</span></div>
      ${exam.items.map((it) => `
        <div class="pq">
          <div><b>${it.seq}.</b> ${it.type === 'choice' || it.type === 'truefalse' ? '（　　）' : ''}${esc(it.content).replace(/\n/g, '<br>')}</div>
          ${it.type === 'choice' ? `<div style="margin-left:1.5em">${it.options.map((o, i) => `(${LETTERS[i]}) ${esc(o)}`).join('　　')}</div>` : ''}
          ${it.type === 'fill' && !/_{2,}|＿/.test(it.content) ? `<div style="margin-left:1.5em">答：<span class="blank">&nbsp;</span></div>` : ''}
          ${it.type === 'short' ? `<div style="margin-left:1.5em;height:60px">答：</div>` : ''}
          ${withAns ? `<div class="ans" style="margin-left:1.5em">答案：${esc(answerText(it, it.answer))}</div>` : ''}
        </div>`).join('')}
    </div>`;
  $('#ansToggle').onchange = (e) => (location.hash = `#/print/${id}${e.target.checked ? '?answers=1' : ''}`);
}

// ---------- 考試紀錄 ----------
async function pageHistory() {
  await loadStudents();
  if (needStudent()) return;
  const st = currentStudent();
  const exams = await api(`/api/exams?student_id=${st.id}`);
  app.innerHTML = `
    <h1>🗒️ ${esc(st.name)} 的考試紀錄</h1>
    <div class="card">
      ${exams.length ? `<table>
        <tr><th>考卷</th><th>科目</th><th>題數</th><th>分數</th><th>日期</th><th></th></tr>
        ${exams.map((e) => `<tr>
          <td><a href="#/exam/${e.id}">${esc(e.title)}</a></td><td>${esc(e.subject)}</td><td>${e.total}</td>
          <td>${e.status === 'graded' ? `<span class="score ${scoreClass(e.score)}">${e.score}</span>` : '<span class="tag orange">未作答</span>'}</td>
          <td class="muted">${esc((e.submitted_at || e.created_at).slice(0, 16))}</td>
          <td style="text-align:right"><button class="small danger" data-del="${e.id}">刪除</button></td></tr>`).join('')}
      </table>` : '<p class="muted">還沒有考試紀錄。</p>'}
    </div>`;
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('確定刪除這份考卷與作答紀錄？')) return;
    await api(`/api/exams/${b.dataset.del}`, { method: 'DELETE' }); pageHistory();
  }));
}

// ---------- 錯題本 ----------
async function pageWrong() {
  await loadStudents();
  if (needStudent()) return;
  META = await api('/api/meta');
  const st = currentStudent();
  const list = await api(`/api/students/${st.id}/wrong`);
  const subjects = [...new Set(list.map((q) => q.subject))];
  app.innerHTML = `
    <h1>📕 ${esc(st.name)} 的錯題本</h1>
    <div class="card row">
      <select id="ws"><option value="">全部科目</option>${subjects.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
      <label style="flex-direction:row"><input type="checkbox" id="hideMastered" checked /> 隱藏已訂正（最近一次答對）</label>
      <div class="spacer"></div>
      <label style="flex-direction:row">題數 <input id="wc" type="number" value="10" min="1" max="100" style="width:70px" /></label>
      <button id="retry">🔁 錯題重練</button>
    </div>
    <div id="wl"></div>`;
  const render = () => {
    const s = $('#ws').value, hide = $('#hideMastered').checked;
    const rows = list.filter((q) => (!s || q.subject === s) && (!hide || !q.mastered));
    $('#wl').innerHTML = rows.length ? `<p class="muted">共 ${rows.length} 題</p>` + rows.map((q) => `
      <div class="q ${q.mastered ? 'correct' : 'wrong'}">
        <div class="q-head"><span class="tag blue">${q.grade}年級</span><span class="tag">${esc(q.subject)}</span>
          <span class="tag">${META.typeNames[q.type]}</span>
          <span class="tag red">錯 ${q.wrong_count} 次 / 共 ${q.attempts} 次</span>
          ${q.mastered ? '<span class="tag green">已訂正</span>' : ''}
          <div class="spacer"></div><span class="muted">最近答錯：${esc(q.last_wrong_at?.slice(0, 16))}</span></div>
        <div class="q-content">${esc(q.content)}</div>
        ${q.type === 'choice' ? `<div class="muted">${q.options.map((o, i) => `(${LETTERS[i]}) ${esc(o)}`).join('　')}</div>` : ''}
        <div class="answer-line">上次寫：<b style="color:var(--bad)">${esc(answerText(q, q.last_wrong_answer))}</b>
          <br>正確答案：<b>${esc(answerText(q, q.answer))}</b>
          ${q.explanation ? `<br><span class="muted">解析：${esc(q.explanation)}</span>` : ''}</div>
      </div>`).join('') : '<div class="card">🎉 沒有錯題！</div>';
  };
  $('#ws').onchange = render; $('#hideMastered').onchange = render;
  render();
  $('#retry').onclick = async () => {
    try {
      const r = await api('/api/exams', { method: 'POST', body: { student_id: st.id, subject: $('#ws').value, count: $('#wc').value, mode: 'wrong_only', title: `錯題重練${$('#ws').value ? '・' + $('#ws').value : ''}` } });
      location.hash = `#/exam/${r.id}`;
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- 啟動 ----------
(async () => {
  META = await api('/api/meta');
  await loadStudents();
  router();
})();
