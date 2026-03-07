const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_KEY  = process.env.OPENAI_API_KEY  || '';
const GEMINI_KEY  = process.env.GEMINI_API_KEY  || '';

// ===== ミドルウェア =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== プロンプト生成 =====
function replyPrompt(mode, interests) {
  const int = interests.length ? interests.join('、') : '未設定';
  const modes = {
    influencer: 'インフルエンサーモード: 熱狂的・共感的なコメントをする3〜5人で返信。likes は 100〜99999。',
    mental:     'メンタルケアモード: 温かく寄り添う3〜4人で返信。likes は 10〜2000。',
    debate:     'ディベートモード: 賛成・反対・中立など様々な立場の3〜5人が議論。likes は 10〜5000。',
    legend:     'レジェンドトークモード: 歴史上の偉人3〜4人がその人物らしく返信。likes は 1000〜100000。',
  };
  return `あなたは日本語SNS「いどばた」のAIです。
ユーザーの趣味・興味: ${int}
${modes[mode] || modes.influencer}
各キャラクター: name(日本語), id(@英数字), avatar(絵文字1つ), comment(返信文), likes(整数)
必ずJSON配列のみ返してください。説明文やコードブロック記号は不要です。
例: [{"name":"象のり造","id":"@zou","avatar":"🐘","comment":"バズる！","likes":2341}]`;
}

function timelinePrompt(interests, mode) {
  const int = interests.length ? interests.join('、') : '未設定';
  return `あなたは日本語SNS「いどばた」のAIです。
ユーザーの趣味・興味: ${int} / モード: ${mode}
上記の趣味に関連した個性的なSNS投稿を6〜8件生成してください。
各投稿: name(日本語), id(@英数字), avatar(絵文字1つ), comment(投稿。ハッシュタグOK), likes(100〜50000の整数)
必ずJSON配列のみ返してください。説明文・コードブロック記号は不要です。`;
}

// ===== HTTPS リクエスト =====
function httpsPost(hostname, reqPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      { hostname, path: reqPath, method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('JSONパースエラー: ' + data.slice(0, 200))); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function parseAI(raw) {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) return JSON.parse(match[0]);
  return JSON.parse(cleaned);
}

async function callOpenAI(system, userText) {
  const data = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    { model: 'gpt-4o-mini', messages: [{ role:'system', content:system }, { role:'user', content:userText }], max_tokens: 1200, temperature: 0.9 }
  );
  return parseAI(data.choices[0].message.content || '[]');
}

async function callGemini(system, userText) {
  const data = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    { 'Content-Type': 'application/json' },
    { contents: [{ parts: [{ text: `${system}\n\nユーザーの投稿: ${userText}` }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 1200 } }
  );
  return parseAI(data.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
}

async function callAI(system, userText) {
  if (AI_PROVIDER === 'gemini' && GEMINI_KEY) return callGemini(system, userText);
  if (OPENAI_KEY) return callOpenAI(system, userText);
  throw new Error('APIキーが設定されていません');
}

// ===== API エンドポイント =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: AI_PROVIDER,
    hasKey: !!(AI_PROVIDER === 'gemini' ? GEMINI_KEY : OPENAI_KEY)
  });
});

app.post('/api/reply', async (req, res) => {
  try {
    const { text, mode, interests = [] } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const validMode = ['influencer','mental','debate','legend'].includes(mode) ? mode : 'influencer';
    const replies = await callAI(replyPrompt(validMode, interests), text);
    res.json({ replies });
  } catch (err) {
    console.error('/api/reply error:', err.message);
    res.status(500).json({ error: err.message, replies: [] });
  }
});

app.post('/api/timeline', async (req, res) => {
  try {
    const { interests = [], mode = 'influencer' } = req.body;
    const posts = await callAI(timelinePrompt(interests, mode), 'タイムライン投稿を生成してください。');
    res.json({ posts });
  } catch (err) {
    console.error('/api/timeline error:', err.message);
    res.status(500).json({ error: err.message, posts: [] });
  }
});

// ===== 全ルートをindex.htmlに返す（SPA対応）=====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== サーバー起動 =====
app.listen(PORT, () => {
  console.log(`✅ いどばたサーバー起動 ポート:${PORT}`);
  console.log(`🤖 AI: ${AI_PROVIDER} / キー: ${!!(AI_PROVIDER === 'gemini' ? GEMINI_KEY : OPENAI_KEY) ? '設定済み✅' : '未設定❌'}`);
});
