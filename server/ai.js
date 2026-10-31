// Gemini AI：辨識圖檔題目、批改填充/簡答題、辨識手寫考卷答案
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'node:fs';

export const SUBJECTS = ['國語', '數學', '英語', '自然', '社會', '生活', '閩南語', '其他'];
const MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

let client = null;
export function aiEnabled() {
  return !!process.env.GEMINI_API_KEY?.trim();
}
function ai() {
  if (!aiEnabled()) throw new Error('尚未設定 GEMINI_API_KEY，請在 .env 檔案中填入後重新啟動。');
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim() });
  return client;
}

function imagePart(filePath, mimeType) {
  return { inlineData: { mimeType, data: fs.readFileSync(filePath).toString('base64') } };
}

async function generateJson(parts, schema) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
  });
  return JSON.parse(res.text);
}

// 1) 從課本 / 測驗卷圖檔擷取題目
export async function extractQuestions(files, hint = {}) {
  const schema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING, enum: SUBJECTS },
            grade: { type: Type.INTEGER, description: '1~6 年級' },
            unit: { type: Type.STRING, description: '單元名稱或主題，不確定可留空' },
            type: { type: Type.STRING, enum: ['choice', 'truefalse', 'fill', 'short'] },
            content: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            answer: { type: Type.STRING },
            explanation: { type: Type.STRING },
            has_figure: { type: Type.BOOLEAN },
          },
          required: ['subject', 'grade', 'type', 'content', 'answer'],
        },
      },
    },
    required: ['questions'],
  };

  const hintText = [
    hint.subject ? `使用者指定科目：${hint.subject}（請全部使用此科目）。` : '',
    hint.grade ? `使用者指定年級：${hint.grade} 年級（請全部使用此年級）。` : '',
  ].join('\n');

  const prompt = `你是台灣國小老師。以下圖片是台灣國小的課本、習作或測驗卷。
請找出圖片中「所有可以出成考題的題目」，並轉成結構化資料（若圖片是課文內容而非題目，請依內容出 5~10 題適合的題目）。
規則：
1. subject 從 ${SUBJECTS.join('、')} 中選擇；grade 依內容難度與教材判斷 1~6 年級。
2. type：choice=選擇題、truefalse=是非題、fill=填充題/計算題（答案短）、short=簡答/問答題。
3. 選擇題：options 放選項文字（不含 ①②、(A) 等編號），answer 只填正確選項字母 A/B/C/D。
4. 是非題：answer 只填 O（對）或 X（錯）。
5. 填充題：content 中以「____」表示空格；若有多個可接受答案以 | 分隔（例如 "12|十二"）；若有多個空格，答案依序以「、」連接。
6. 若圖片上已有學生作答或標準答案，以「正確答案」為準；若沒有答案，請你自行解題並給出正確答案。
7. explanation 用一兩句適合小學生理解的話說明解法。
8. 題目需要依賴圖片中的圖形/表格才能作答時 has_figure=true，並盡量把圖表資訊用文字寫進 content。
9. 數學式子使用一般文字，如 3×4=____、1/2。全部使用繁體中文（英語科題目保留英文）。
${hintText}`;

  const parts = [{ text: prompt }, ...files.map((f) => imagePart(f.path, f.mimetype))];
  const data = await generateJson(parts, schema);
  return (data.questions || []).map((q) => ({
    ...q,
    subject: hint.subject || q.subject,
    grade: Number(hint.grade || q.grade) || 1,
    options: q.type === 'choice' ? q.options || [] : null,
    has_figure: q.has_figure ? 1 : 0,
  }));
}

// 2) AI 批改填充/簡答題（只送比對不相符的題目）
export async function aiGrade(items) {
  if (!items.length) return [];
  const schema = {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            correct: { type: Type.BOOLEAN },
            feedback: { type: Type.STRING },
          },
          required: ['id', 'correct'],
        },
      },
    },
    required: ['results'],
  };
  const prompt = `你是溫和但嚴謹的國小老師，請批改以下學生答案。
判斷標準：意思正確、數值正確即算對（單位、全形半形、標點、同義詞、國字與數字寫法不同可接受）；錯字過多或概念錯誤算錯。
feedback 用一句話給學生簡短說明（答對可留空）。
題目資料（JSON）：
${JSON.stringify(items.map((i) => ({ id: i.id, 題目: i.content, 參考答案: i.answer, 學生答案: i.student_answer })))}`;
  const data = await generateJson([{ text: prompt }], schema);
  return data.results || [];
}

// 3) 辨識紙本考卷照片上的手寫答案
export async function readAnswerSheet(files, questions) {
  const schema = {
    type: Type.OBJECT,
    properties: {
      answers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { seq: { type: Type.INTEGER }, answer: { type: Type.STRING } },
          required: ['seq', 'answer'],
        },
      },
    },
    required: ['answers'],
  };
  const prompt = `圖片是一份學生已手寫作答的紙本考卷。請依題號讀出學生寫下的答案（不要更正，照實抄錄）。
選擇題請回傳選項字母 A/B/C/D（若學生寫 1/2/3/4 或 ①②③④，對應轉成 A/B/C/D）；是非題回傳 O 或 X（打勾✓視為 O）。
沒有作答的題目 answer 回傳空字串。
考卷題目清單：
${questions.map((q) => `第 ${q.seq} 題（${q.type}）：${q.content}`).join('\n')}`;
  const parts = [{ text: prompt }, ...files.map((f) => imagePart(f.path, f.mimetype))];
  const data = await generateJson(parts, schema);
  return data.answers || [];
}
