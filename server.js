// Backend: Giữ GEMINI_API_KEY ở server. Chạy: npm install && npm start
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import mammoth from 'mammoth';
import { GoogleGenAI, Type } from '@google/genai';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';

const app = express();
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Tăng giới hạn payload lên 20mb để tránh lỗi HTTP 413 khi nhận file PDF/DOCX dung lượng lớn
app.use(express.json({ limit: '20mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 30 }));
app.use(express.static(path.dirname(fileURLToPath(import.meta.url))));

const S = Type.STRING;
const entry = {
  type: Type.OBJECT,
  properties: {
    term: { type: S },
    lemma: { type: S },
    pos: { type: S },
    ipa: { type: S },
    vi: { type: S },
    ctx: { type: S },
    defEn: { type: S },
    exEn: { type: S },
    exVi: { type: S },
    syn: { type: Type.ARRAY, items: { type: S } },
    forms: { type: S }
  },
  required: ['term', 'pos', 'vi', 'ctx']
};

const gen = async (contents, schema) => {
  if (!ai) throw Object.assign(new Error('Chưa cấu hình GEMINI_API_KEY'), { code: 503 });
  const r = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { responseMimeType: 'application/json', responseSchema: schema }
  });
  return JSON.parse(r.text);
};

const RULES = 'Giữ nguyên bài đọc, không viết lại. Nghĩa tiếng Việt theo ngữ cảnh. Không bịa IPA hoặc thông tin từ điển khi không chắc chắn; để trống nếu không biết.';

app.post('/api/analyze', async (req, res) => {
  try {
    let { text = '', level = 'B1', title = '', file = null, fileName = '' } = req.body;
    let parts;

    // Sử dụng path.extname để lấy phần mở rộng file an toàn
    const ext = path.extname(String(fileName)).toLowerCase().replace('.', '');

    if (file && ext === 'docx') {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(file, 'base64') })).value;
    } else if (file && ext === 'doc') {
      return res.status(415).json({ error: 'Tệp DOC cũ chưa được hỗ trợ, hãy lưu thành DOCX.' });
    }

    const prompt = `Phân tích bài đọc tiếng Anh trình độ ${level} cho người học Việt Nam (IELTS). Chọn 10-25 từ/cụm hữu ích (học thuật, collocation, phrasal verb). ${RULES} Trả về title, originalText (nguyên văn) và vocabulary.`;

    parts = file && ext === 'pdf'
      ? [{ inlineData: { mimeType: 'application/pdf', data: file } }, { text: prompt }]
      : [{ text: prompt + '\n\n' + String(text).slice(0, 20000) }];

    const d = await gen(parts, {
      type: Type.OBJECT,
      properties: {
        title: { type: S },
        originalText: { type: S },
        vocabulary: { type: Type.ARRAY, items: entry }
      },
      required: ['title', 'originalText', 'vocabulary']
    });

    if (!d.originalText?.trim()) throw new Error('Không đọc được nội dung tệp.');
    res.json(d);
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
});

app.post('/api/lookup', async (req, res) => {
  try {
    const word = String(req.body.word || '').trim();
    const sentence = String(req.body.sentence || '').trim();
    res.json(await gen(`Từ: "${word}". Câu: "${sentence}". Giải nghĩa theo ngữ cảnh câu này. ${RULES}`, entry));
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
});

app.post('/api/translate', async (req, res) => {
  try {
    const text = String(req.body.text || '').slice(0, 1000);
    res.json(await gen(`Dịch sang tiếng Việt và giải thích ngắn ngữ cảnh: "${text}"`, {
      type: Type.OBJECT,
      properties: { translation: { type: S }, explanation: { type: S } },
      required: ['translation']
    }));
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
});

/* ===== Đề đọc hiểu: đáp án chuẩn chỉ nằm ở server cho tới khi nộp bài ===== */
const quizzes = new Map();
setInterval(() => {
  const n = Date.now();
  for (const [k, z] of quizzes) if (n - z.t > 6 * 3600e3) quizzes.delete(k);
}, 600e3).unref();

const L = ['A', 'B', 'C', 'D'];
const norm = s => String(s || '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

const quizSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: S },
          question: { type: S },
          options: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { id: { type: S }, text: { type: S } },
              required: ['id', 'text']
            }
          },
          correctAnswer: { type: S },
          explanation: { type: S },
          evidence: { type: S },
          explanationVi: { type: S },
          optionExplanations: {
            type: Type.OBJECT,
            properties: { A: { type: S }, B: { type: S }, C: { type: S }, D: { type: S } },
            required: ['A', 'B', 'C', 'D']
          }
        },
        required: ['question', 'options', 'correctAnswer', 'explanation', 'evidence', 'explanationVi', 'optionExplanations']
      }
    }
  },
  required: ['questions']
};

function checkQuiz(q, n, passage) {
  const qs = q.questions;
  if (!Array.isArray(qs) || qs.length !== n) return `sai số câu (${qs?.length} thay vì ${n})`;
  const P = norm(passage), seen = new Set();

  for (const x of qs) {
    if (x.options?.length !== 4 || x.options.some((o, i) => o.id !== L[i] || !o.text?.trim())) return 'thiếu phương án A-D';
    if (!L.includes(x.correctAnswer)) return 'đáp án không hợp lệ';
    if (new Set(x.options.map(o => norm(o.text))).size !== 4) return 'phương án trùng nhau';
    if (x.options.some(o => /all of the above|none of the above|tất cả các đáp án|không có đáp án nào/i.test(o.text))) return 'có phương án bị cấm';
    const k = norm(x.question);
    if (seen.has(k)) return 'câu hỏi trùng nhau';
    seen.add(k);
    if (!x.evidence || !P.includes(norm(x.evidence))) return 'bằng chứng không khớp nguyên văn bài đọc';
  }
  return '';
}

async function verifyQuiz(q, passage) {
  const list = q.questions.map(x => `${x.id}. ${x.question}\n` + x.options.map(o => `${o.id}. ${o.text}`).join('\n')).join('\n\n');
  const r = await gen(
    `Chỉ dựa vào bài đọc, chọn đáp án đúng duy nhất cho từng câu.\n\nBÀI ĐỌC:\n${passage}\n\nCÂU HỎI:\n${list}`,
    {
      type: Type.OBJECT,
      properties: {
        answers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { id: { type: S }, answer: { type: S } },
            required: ['id', 'answer']
          }
        }
      },
      required: ['answers']
    }
  );
  const m = new Map(r.answers.map(a => [a.id, a.answer]));
  return q.questions.every(x => m.get(x.id) === x.correctAnswer) ? '' : 'kiểm tra độc lập không đồng thuận về đáp án';
}

app.post('/api/quiz', async (req, res) => {
  try {
    const { level = 'B1', lang = 'en', difficulty = 'medium', title = 'Reading Comprehension Quiz' } = req.body;
    const text = String(req.body.text || '').slice(0, 20000);
    const n = Number(req.body.count);

    if (!Number.isInteger(n) || n < 1 || n > 10) return res.status(400).json({ error: 'Số câu phải từ 1 đến 10.' });

    const words = (text.match(/[A-Za-z]+/g) || []).length;
    const max = Math.floor(words / 20);
    if (n > max) return res.status(422).json({ error: `Nội dung chỉ đủ để tạo khoảng ${max} câu có căn cứ. Hãy giảm số câu hoặc chọn phạm vi dài hơn.` });

    let why = '';
    for (let a = 0; a < 3; a++) {
      const prompt = `Tạo đúng ${n} câu hỏi đọc hiểu trắc nghiệm kiểu IELTS Reading, trình độ ${level}, độ khó ${difficulty}, chỉ dựa trên bài đọc. Câu hỏi và các phương án viết bằng ${lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}; explanation bằng tiếng Anh, explanationVi bằng tiếng Việt. Mỗi câu có đúng 4 phương án id A,B,C,D, đúng một đáp án; nhiễu hợp lý, độ dài tương tương, không gợi đáp án; cấm "All of the above"/"None of the above". Không bịa sự kiện, số liệu, tên riêng. Chọn đa dạng dạng câu (main idea, detail, inference, vocabulary in context, reference, author's purpose, cause-effect, comparison) phù hợp độ dài bài, không lặp ý. evidence phải là câu sao chép NGUYÊN VĂN từ bài đọc. optionExplanations giải thích vì sao từng phương án đúng/sai.${why ? ' Lần trước bị loại vì: ' + why + '.' : ''}\n\nBÀI ĐỌC:\n${text}`;

      const q = await gen(prompt, quizSchema);
      q.questions?.forEach?.((x, i) => { x.id = 'q' + (i + 1); x.type = 'single_choice'; });
      why = checkQuiz(q, n, text) || await verifyQuiz(q, text);

      if (!why) {
        const quizId = randomUUID();
        quizzes.set(quizId, { t: Date.now(), questions: q.questions });
        return res.json({
          quizId,
          title,
          level,
          questionCount: n,
          questions: q.questions.map(({ id, type, question, options }) => ({ id, type, question, options }))
        });
      }
    }
    res.status(502).json({ error: `Chưa tạo được đề đạt yêu cầu (${why}). Hãy thử lại hoặc giảm số câu.` });
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
});

app.post('/api/quiz/grade', (req, res) => {
  const z = quizzes.get(req.body.quizId);
  if (!z) return res.status(404).json({ error: 'Đề đã hết hạn trên máy chủ, hãy tạo đề mới.' });

  const ans = req.body.answers || {};
  let correct = 0, wrong = 0, blank = 0;

  const details = z.questions.map(x => {
    const c = L.includes(ans[x.id]) ? ans[x.id] : null;
    const ok = c === x.correctAnswer;
    if (!c) blank++; else if (ok) correct++; else wrong++;

    return {
      id: x.id,
      chosen: c,
      correct: x.correctAnswer,
      isCorrect: ok,
      explanation: x.explanation,
      evidence: x.evidence,
      explanationVi: x.explanationVi,
      optionExplanations: x.optionExplanations
    };
  });

  const total = z.questions.length;
  res.json({
    total,
    correct,
    wrong,
    blank,
    percent: Math.round((correct / total) * 100),
    score: Math.round((correct / total) * 1000) / 100,
    details
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));