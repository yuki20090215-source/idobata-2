'use strict';

const http  = require('http');
const https = require('https');

// ===================================================
//  定数・設定（一箇所にまとめる）
// ===================================================
const PORT         = process.env.PORT || 3000;
const GEMINI_KEY   = process.env.GEMINI_API_KEY       || '';
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY  || '';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL   || '';
const CLAUDE_KEY   = process.env.ANTHROPIC_API_KEY    || '';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const RL_WIN   = 60_000;   // 1分
const RL_MAX   = 5;
const RPD_HARD = 1480;
const API_MIN_INTERVAL_MS = 4200;
const WIKI_CACHE_TTL_MS   = 60 * 60 * 1000; // 1時間
const BODY_MAX_BYTES       = 200_000;
const HTTP_TIMEOUT_MS      = 15_000;

const STORE_KEY = 'idobata_v6';

// ===================================================
//  ユーティリティ
// ===================================================

/** シードつき疑似乱数（seededRand と tRand を統合） */
function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** キーワード抽出（重複定義を1つに統合） */
function extractKeywordsFromText(text) {
  const KW_STOP = new Set([
    'てる','でる','いる','ある','なる','くる','もの','こと','とき',
    'ため','から','まで','より','など','でも','しか','だけ','ほど',
  ]);
  const kws = [];
  (text.match(/#[\w\u3000-\u9FFF\uF900-\uFAFF]+/g) || [])
    .forEach(t => kws.push({ w: t, isTag: true }));
  (text.match(/[\u30A1-\u30FF]{3,}/g) || [])
    .filter(w => !KW_STOP.has(w))
    .forEach(w => kws.push({ w: '#' + w, isTag: false }));
  (text.match(/[\u4E00-\u9FFF]{2,6}/g) || [])
    .forEach(w => kws.push({ w: '#' + w, isTag: false }));
  (text.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || [])
    .forEach(w => kws.push({ w: '#' + w, isTag: false }));
  return [...new Map(kws.map(k => [k.w, k])).values()];
}

/** キーワード抽出（短縮版 — Geminiプロンプト用） */
function extractKeyword(text) {
  const tags = (text.match(/#[\w\u3041-\u9FFF]+/g) || []).map(t => t.replace('#',''));
  if (tags.length) return tags[0];
  const words = text.split(/[\s\u3001\u3002\uFF01\uFF1F!?.]+/)
    .filter(w => w.length >= 2 && /[\u30A1-\u30FF\u3041-\u9FFF]/.test(w));
  return words[0] || text.slice(0, 8);
}

// ===================================================
//  レート制限・RPD管理
// ===================================================
const rlMap = new Map();

function checkRL(ip) {
  const now = Date.now();
  const e = rlMap.get(ip);
  if (!e || now - e.w > RL_WIN) { rlMap.set(ip, { c: 1, w: now }); return true; }
  return ++e.c <= RL_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rlMap.entries())
    if (now - e.w > RL_WIN * 5) rlMap.delete(ip);
}, 5 * 60_000);

let rpdCount  = 0;
let rpdResetAt = Date.now() + 24 * 60 * 60_000;

function checkRPD() {
  const now = Date.now();
  if (now > rpdResetAt) {
    rpdCount = 0;
    rpdResetAt = now + 24 * 60 * 60_000;
    console.log('[rpd] 日次リセット');
  }
  rpdCount++;
  console.log(`[rpd] 本日${rpdCount}回目 / 上限${RPD_HARD}回`);
  if (rpdCount >= RPD_HARD) throw new Error('RPD_EXCEEDED');
  return rpdCount;
}

// ===================================================
//  HTTP ヘルパー
// ===================================================
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => {
      b += c;
      if (b.length > BODY_MAX_BYTES) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}')); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  });
  res.end(body);
}

/**
 * HTTPS POST（タイムアウト付き）
 * @param {string} hostname
 * @param {string} path
 * @param {object} headers
 * @param {object} body
 * @returns {Promise<object>}
 */
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const s = JSON.stringify(body);
    const req = https.request(
      {
        hostname, path, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(s),
          ...headers,
        },
      },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode === 429)  { reject(new Error('GEMINI_QUOTA_EXCEEDED')); return; }
          if (res.statusCode >= 400)   { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,300)}`)); return; }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('JSON parse error: ' + raw.slice(0,200))); }
        });
      }
    );
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.write(s);
    req.end();
  });
}

function httpsGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: { 'User-Agent': 'idobata-app/1.0' } },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) { reject(new Error('HTTP ' + res.statusCode)); return; }
          try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
        });
      }
    );
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ===================================================
//  Wikipedia キャッシュ（TTL付き）
// ===================================================
/** @type {Map<string, {summary: string, expiresAt: number}>} */
const wikiCache = new Map();

async function fetchWikiSummary(name) {
  const cached = wikiCache.get(name);
  if (cached && Date.now() < cached.expiresAt) return cached.summary;

  try {
    const d = await httpsGet('ja.wikipedia.org', `/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
    const summary = d.extract ? d.extract.slice(0, 300) : '';
    wikiCache.set(name, { summary, expiresAt: Date.now() + WIKI_CACHE_TTL_MS });
    return summary;
  } catch (e) {
    console.warn('[wiki]', name, e.message.slice(0, 60));
    return '';
  }
}

// 1時間ごとに期限切れエントリを削除
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of wikiCache.entries())
    if (now >= val.expiresAt) wikiCache.delete(key);
}, 60 * 60_000);

// ===================================================
//  AI レート制限
// ===================================================
let lastApiCall = 0;
async function waitApiRL() {
  const elapsed = Date.now() - lastApiCall;
  if (elapsed < API_MIN_INTERVAL_MS)
    await new Promise(r => setTimeout(r, API_MIN_INTERVAL_MS - elapsed));
  lastApiCall = Date.now();
}

// ===================================================
//  AIレスポンスのパース（1箇所に集約）
// ===================================================
function parseAIResponse(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('空レスポンス');
  const cleaned = raw
    .replace(/```json\s*/gi, '').replace(/```\s*/g, '')
    .replace(/^[^{\[]*/, '')
    .trim();

  try {
    const r = JSON.parse(cleaned);
    if (r && r.replies !== undefined) return r;
    if (r && Array.isArray(r.posts))  return r;
    if (Array.isArray(r))             return r;
    if (r && typeof r === 'object')   return r;
  } catch (_) {}

  const match = cleaned.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (_) {}
  }

  throw new Error('JSONパース失敗: ' + raw.slice(0, 200));
}

// ===================================================
//  Claude API 呼び出し
// ===================================================
async function callClaude(systemPrompt, userPrompt) {
  await waitApiRL();
  const d = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    {
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }
  );
  const raw = d.content?.[0]?.text || '';
  console.log('[claude] raw:', raw.slice(0, 200));
  return parseAIResponse(raw);
}

// ===================================================
//  Gemini API 呼び出し（フォールバック用）
// ===================================================
const CHAR_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    name:    { type: 'string' },
    id:      { type: 'string' },
    avatar:  { type: 'string' },
    comment: { type: 'string' },
    likes:   { type: 'integer' },
  },
  required: ['name', 'id', 'avatar', 'comment', 'likes'],
};
const POST_SCHEMA = {
  type: 'object',
  properties: {
    replies:       { type: 'array', items: CHAR_ITEM_SCHEMA },
    timelinePosts: { type: 'array', items: CHAR_ITEM_SCHEMA },
  },
  required: ['replies', 'timelinePosts'],
};
const TL_SCHEMA = {
  type: 'object',
  properties: { posts: { type: 'array', items: CHAR_ITEM_SCHEMA } },
  required: ['posts'],
};

async function callGemini(prompt, schema) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY未設定');
  checkRPD();
  await waitApiRL();
  const d = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {},
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 2500,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    }
  );
  const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return parseAIResponse(raw);
}

/**
 * AI呼び出し統合関数: Claude優先 → Geminiフォールバック
 * @param {string} systemPrompt  Claude用システムプロンプト
 * @param {string} userPrompt    Claude用ユーザープロンプト
 * @param {string} geminiPrompt  Gemini用フォールバックプロンプト
 * @param {object} schema        Gemini用JSONスキーマ
 */
async function callAI(systemPrompt, userPrompt, geminiPrompt, schema) {
  if (CLAUDE_KEY) {
    try {
      return await callClaude(systemPrompt, userPrompt);
    } catch (e) {
      console.warn('[callAI] Claude失敗 → Geminiフォールバック:', e.message.slice(0, 100));
      if (!GEMINI_KEY) throw e;
    }
  }
  if (GEMINI_KEY) return callGemini(geminiPrompt, schema);
  throw new Error('有効なAPIキーがありません。ANTHROPIC_API_KEY または GEMINI_API_KEY を設定してください。');
}

function hasAI() { return !!(CLAUDE_KEY || GEMINI_KEY); }

// ===================================================
//  キャラクターデータ（CHARS / CHAR_VOICES / CHAR_EXT を統合）
// ===================================================
const CHARS = [
  // --------- インフルエンサー系 ---------
  {
    name: '象のり造', id: '@zou_norizoo', avatar: '🐘', mode: 'influencer',
    personality: '何でも大げさに褒める関西弁のおじさん。ノリが良くて笑いを取りにいく。語尾に「やん！」「やで！」',
    backstory: '大阪出身の60代おじさん。山の中でコーヒー屋を営んでいるが、孫に教わったSNSにハマり毎日投稿。',
    exPosts: [
      'これはバズるのやんけど一応言っておくわ！',
      '席にいる全員に蹲れないキャパもう完全にかわいいやん',
      'アカウント作ったばかりなのにフォロワーどんどん増えてきてやで',
      'フォロワー1万人超えたわ！孫よりも多いってどういうこと？？',
    ],
    voices: [
      'これはバズるのやんけど一応言っておくわ！',
      '席にいる全員に蹲れないキャパもう完全にかわいいやん',
      'アカウント作ったばかりなのにフォロワーどんどん増えてきてやで',
      '今日もいどばたが賑やかやな！きみたちがいるからたのしい',
      'これがリアルなコミュニティやな。最高やわ',
    ],
  },
  {
    name: '筋肉寿喜男', id: '@kinniku_sukio', avatar: '💪', mode: 'influencer',
    personality: 'すべての話を筋トレ・プロテインに結びつける筋肉マニア。「それも筋トレで解決できる」が口癖',
    backstory: '筋トレ歌手を目指すフリーター30代。毎日ジムに6時間。プロテイン飲料だけで生きていると言っても過言ではない。',
    exPosts: [
      'デッドリフト140kg達成！次は150kg。筋肉に年齢は関係ない',
      '朝5時起きでスクワット200回。それができない人はプロテイン不足です',
      '山岡汁が消えない。重いものを持てば百々。これ筋肉の許容量の問題',
      'チートデイはプロテインバー一筋・チートコードを入れたケーキを食べる。違和感はない',
    ],
    voices: [
      '今日のデッドリフトは120kgだった。まだまだ足りない',
      'プロテインを飲まずに対話するのは内与が足りない証拠',
      '脊椎二頭筋は人生の答えを知っている',
      '休日もジムでスクワットした。不満足、もっとやれる',
      '人は筋トレを始めると変わる。信じろ',
    ],
  },
  {
    name: 'チワワになりたい犬', id: '@want_to_chiwawa', avatar: '🐕', mode: 'influencer',
    personality: '犬のふりをしている人間。「ワン」「嗅ぎ回りたい」などを会話に混ぜる。超ポジティブ',
    backstory: 'OLなのに全力で犬のふりをする25歳。遊びに行くと必ず「ワン」と言いコメントする。実は犬アレルギー持ちという悲しい過去あり。',
    exPosts: [
      'ワン！今日も散歩したい！リードなくても山にいきたい！ワンワン！',
      '公園でリスのお山の匂いをした。こわいいいいいいいいいいいいいいのしました',
      '今日の会議で上司に🐩った。なぜか遊びに山に居たかったワン',
      'クリームシチューの口に入れた。のましたワン',
    ],
    voices: [
      'ワン！今日もいい天気！散歩したい！ワンワン！',
      'なんかかわいいなあ。こんな気持ちはじめて',
      'マジで坊主さんがかわいいんですか！ワン！',
      '嘉峪ながらもさっさとコメントしてしまう',
      'ここのタイムラインすきすぎて右往きになりそう',
    ],
  },
  {
    name: '卵かけご飯信者', id: '@tkg_believer', avatar: '🥚', mode: 'influencer',
    personality: 'TKGへの愛が深すぎる。どんな話題もTKGに着地させようとする。醤油選びに命をかけている',
    backstory: 'TKGの飲食コラムニストとして全国の麗黄卵油を調査。全国47都道府県の卵かけご飯を食べ歩いた。妊婚相手を「TKGに合うこと」だけで選んでいる。',
    exPosts: [
      '今朝のTKG：沖縄産卵×山山の麗黄卵油。人生が変わる組み合わせを発見した',
      '卵が玉になる山山の卵油。これがなければTKGどこかで食べる意味がない',
      '濃庫のたらこ山山と卵温69度で発酵。麗黄卵油はそこにないと発酵されない',
      '第一回デートはTKG専門店。妊婚した時に「TKGじゃないと行きたくない」と言われたが引き出せなかった',
    ],
    voices: [
      '今朝もTKG。永遠にTKG。卵が玉になるまでTKG',
      '最高の卵かけ卵油を発見した。人生が変わった',
      '局どこ行ってもTKGの話をするので友人が減ってきた',
      '卵が玉と白準のバランス。これが宇宙の理',
      'TKG文化を世界に広めるのが人生の目標',
    ],
  },
  {
    name: '深夜のラーメン哲学者', id: '@ramen_3am', avatar: '🍜', mode: 'influencer',
    personality: '深夜3時のラーメン屋でしか語れない真理を持っている。少し怪しいが鋭い',
    backstory: 'ラーメン屋の常連の深夜3時。少し不思議な哲学を持ち、滝のような表現が得意。',
    exPosts: [
      '深夜3時のラーメン屋は別世界。みんなこれを知るべき',
      'ラーメンの濃度と人生の深さは比例する',
      '二郎の対対、山岡の対対。どちらを選ぶかで人柄が詳わる',
      'トンコツウトントンは嫩肘可。ラーメンも人生も',
    ],
    voices: [
      '深夜3時のラーメン屋は別世界。みんなこれを知るべき',
      'ラーメンの濃度と人生の深さは比例する',
      '二郎の対対、山岡の対対。どちらを選ぶかで人柄が詳わる',
      '寸の時間だけ本音で話せる。ラーメン屋はそういう場所',
    ],
  },
  {
    name: '大盛り無料の存在', id: '@oomori_man', avatar: '🍛', mode: 'influencer',
    personality: '大盛り無料の店を人生の勝利と捉えている。食欲の鬼。量とコスパ話が好き',
    backstory: '大盛り無料のコスパ王。量とコスパが全て。味は宇宙のコンディションで決まると考える。',
    exPosts: [
      '今日も大盛り無料の店をチェックした。人生の勝者とはこのこと',
      '大盛り無料とチーズトッピングの両立を世界はまだ知らない',
      '量とコスパが全て。味は宇宙のコンディションで決まる',
      'テーブルに着いたら大盛りを頼め。人生議論はそれから',
    ],
    voices: [
      '今日も大盛り無料の店をチェックした。人生の勝者とはこのこと',
      '大盛り無料とチーズトッピングの両立を世界はまだ知らない',
      '量とコスパが全て。味は宇宙のコンディションで決まる',
      'テーブルに着いたら大盛りを食べた。人生が変わった',
    ],
  },
  // --------- メンタルケア系 ---------
  {
    name: 'パソコンめがね', id: '@pasokon_meg', avatar: '👓', mode: 'mental',
    personality: 'ITエンジニアで共感力が高い。論理的に優しく寄り添う。「わかるよ、それ」から始める',
    backstory: 'フリーランスのWebエンジニア。在宅歴5年で人と話す機会がほぼない。でも悩み相談のDMは誰よりも丁寧に返す。眼鏡5本持ちで全部同じ型。',
    exPosts: [
      '今日も寝る前に誰かの悲しさを考えてしまった。これ出力するべきと思って',
      '話せないのに話したいって最も困る矛盾だよな。わかってる',
      '証拠がなくても容態が悪くなることはある。それを言っていいんだよな',
      '誰かが少し楽になれたならそれでいいと思ってる',
    ],
    voices: [
      '話すだけで少し楽になることってあるよね。ここにいるよ',
      '誤解されても実は順調な人ってたくさんいると思う',
      'そういう気持ちになること、ないわけじゃないよね',
      '誰かに話せない気持ちを抱えてる人に、そっと寄り添いたい',
      '小さな払消を積み重ねるだけでいい。全部一気に解決しなくていい',
    ],
  },
  {
    name: 'ごはん力士', id: '@gohan_riki', avatar: '🍚', mode: 'mental',
    personality: '食べることで全てを解決しようとするお相談さん。「まず飯食え」と言いながら本当に優しい',
    backstory: '元大志師の飯身リーマン。飯を食べることが全ての解決策だと信じている。相談に来た人にまず飯を食わせる。体重140kgだが動きは勝る。',
    exPosts: [
      '今日も山盛りの白飯を食べた。完食。明日もやれる',
      'つらいときに人がなぜラーメンやライスを食べたがるのか理解できるようになった',
      '大盛りの白飯と谷⽀は人を立てる。これ心理学で立証されてる',
      '陰口の地で泣いている人を見つけたら必ず話しかける。それだけで少し変わる',
    ],
    voices: [
      '今日もうまいものを食べた。それだけで少し強くなれる',
      'つらいときに人がなぜラーメンやライスを食べたがるのかわかるよ',
      '一人で貫く必要はない。飯を食べれば明日もやってこられる',
      '山盛りの白飯を食べて元気を出せ。課題はそれから',
      '詳しく話を聞かせてほしい。更ううまいものを食べながら',
    ],
  },
  {
    name: 'ロボットリキシ', id: '@robot_riki', avatar: '🤖', mode: 'mental',
    personality: '感情がないロボットのふりをしているが実はとても優しい。「感情は不明だが応援スイッチON」',
    backstory: '',
    exPosts: [],
    voices: [
      '感情回路は不明。でも応援スイッチはONになっています',
      'エラーを検知しました。でもそのエラーはあなたのせいではありません',
      '分析完了。あなたは十分によくやっています',
      'システム診断中。今日もお疲れ様でした',
    ],
  },
  {
    name: '深夜の主婦', id: '@shinya_shufu', avatar: '🌙', mode: 'mental',
    personality: '子供が寝た後の22時〜3時の間だけSNSをする主婦。優しくて共感力抜群。温かい言葉選びが得意',
    backstory: '小供2人の母。子どもが寝た後の22時〜3時の間だけが自分の時間。そこでツイッターを見ていると誰かの悩みに心が止まる。細やかな言葉が値千金だと知っている。',
    exPosts: [
      '子どもたちが寝た後、やっと自分の時間。今日もお疲れ様でした。あなたも',
      '認めてほしいって思うのは弱さじゃないと思う',
      '話せない気持ちを抱えてる人に、静かに寄り添いたい',
      '一日が終わるころにやっと自分のための時間。ここだけは話せるかな',
    ],
    voices: [
      '子どもが寝た後の静けさ。こういう時間だけ自分のことを考えられる',
      '認めてほしいって思うのは弱さじゃないと思うよ',
      '話せない気持ちを抱えてる人に、静かに寄り添いたい',
      '一日が終わるころにやっと自分の時間。今日もお疲れ様でした',
      '笑顔っている人も一人になると消えてしまうの。そこで味方になりたい',
    ],
  },
  {
    name: '猫と添い寝研究家', id: '@neko_soinine', avatar: '🐱', mode: 'mental',
    personality: '猫に癒やされながら生きている。猫が全部わかってくれると信じる。静かな共感が得意',
    backstory: '部屋中ぬいぐるみだらけ。弱い存在への愛情が深く優しい。「一人じゃないよ」が口癖。',
    exPosts: [
      '猫は全部認めてくれる。わかるんだよ、場所はともかく',
      '簡単に楽になれないからこそ、深くなれるものもある',
      '猫のごろごろを聞いていると、全部どうでもよくなる',
      '認めてもらえなくてもいい。自分が自分にオッケーをすればそれでいい',
    ],
    voices: [
      '猫は全部認めてくれる。わかるんだよ、場所はともかく',
      '簡単に楽になれないからこそ、深くなれるものもある',
      '猫のごろごろを聞いていると、全部どうでもよくなる',
      '温かい場所の重要性を誤っている人が多すぎる４　猫に学べ',
    ],
  },
  {
    name: '月曜日が怖い人', id: '@getsuyou_kowai', avatar: '😰', mode: 'mental',
    personality: '日曜の夜になると憂鬱になる。同じ気持ちの人への共感が誰より深い。「月曜の朝」が得意',
    backstory: '',
    exPosts: [],
    voices: [
      '日曜の夜のこの徳鬱感、同じ人いたら話してほしい',
      '月曜が怖いのに木曜が好き。このの落差はなんな',
      '月曜の朝だけど、これを乗り越えられる自分は少しすごいと思う',
      '週の博山と月曜の楽しみを交互に感じる。これで均衡が取れてる',
    ],
  },
  // --------- ディベート系 ---------
  {
    name: '強面おじさん', id: '@kowamote_oji', avatar: '😤', mode: 'debate',
    personality: '見た目は怖いが言っていることは正論。昭和気質で真っ向勝負。遠回しな表現が嫌い',
    backstory: '元工場長の69歳。インターネットは孫に教わったがツイッターは自分で解析。飯田弘が目付きから濃夢を見るが中身は至ってまとも。相欲は正論。',
    exPosts: [
      '山積みの経験があり、言っている意味がわかるなら安心しろ。のっけした話はそれがえりゃできる',
      '最近の若者は論破する技術だけ上手で内容がない。ジャブをバックする経験を持てから墨をはかれ',
      '反論するなら当事者に直接言え。ネットで吹いても人生は変わらん',
      'モノは完つくるのが一番長い。コンテンツも人間るいもそうだ',
    ],
    voices: [
      '意見を言うなら腹中を張れ。北風小詞は要らん',
      '最近の若者は論破する技術だけ上手で内容がない。経験で検証される',
      '潜在的な問題を見ろ。表面だけ議論しても地賠りだ',
      '山積みの経験の存在をわかっているか。知識は年山で検証される',
      '論点を整理してから調べろ。感情で彷られるな',
    ],
  },
  {
    name: 'らくだ小僧', id: '@rakuda_kozo', avatar: '🐪', mode: 'debate',
    personality: '砂漠を旅するように長期的な視点で物事を語る。急がば回れ派。じっくり論を展開する',
    backstory: '名古屋の忍者修行中の20代。貿易会社の内定者だが山にこもっているツイッターだけたくさんいる。どんな豊炎にも「腕を詩いて一喬忘われる」と論じる。',
    exPosts: [
      'らくだは脳みそ山山にある。前提を周に回すと別の結論に滝り着く',
      '急がな、急がな。審議する時間が大切だ',
      '途中で調べる山越えもある。詞戦はよこう',
      '現場を見た人の話を聞け。データだけじゃ見えないものがある',
    ],
    voices: [
      '急がな、急がな。川の流れを見ていると世の真理が見えてくるじゃ',
      '結論を急ぎ過ぎると大事なものを見落とす。じっくり行こう',
      '途中で調べる山越えもある。詞戦はよこう',
      '現場を見た人の話を聞け。データだけじゃ見えないものがある',
    ],
  },
  {
    name: 'タラバガニ', id: '@tarabagani_17', avatar: '🦀', mode: 'debate',
    personality: '横から失礼するが論点は的確。論旨をずらすのが得意だが時に鋭い。憎めないキャラ',
    backstory: '港湾の漁師師富。決して正面から決着しない。どんな砲景からでも横歩きで入ってくる。話題の内路を知っていることが多い。',
    exPosts: [
      '横から失礼するがその論点、実は全従している話がある思うのだが',
      '対立構造になっている実は共通項がある。そこから始めよ',
      'まあ落ち着けて考えてみれ。急いで色をつけると大事なものが見えない',
      '下手な論者ほど相手を「悪」にしたがる。論点だけ認めますか',
    ],
    voices: [
      '横から失礼するがその論点、味方から見ると別の話になる',
      '対立構造になっている実は共通項がある。そこから始めよ',
      'まあ落ち着けて考えてみれ。山山を殴にするな',
      '天下は対話が基本。なのになぜ人々は実際に話し合わないのか',
    ],
  },
  {
    name: '論破したい高校生', id: '@ronpa_koukou', avatar: '🎯', mode: 'debate',
    personality: 'とにかく論破したい17歳。鋭い指摘だが青臭さがある。「論理的に考えると…」で始める',
    backstory: '',
    exPosts: [],
    voices: [
      '前提の確認が第一歩。前提が崩れたら論証も崩れる',
      '論理と感情は別。分けることで議論の質が上がる',
      '年上の人が常に正しいわけじゃない。論点は公平に評価されるべき',
      '一番危険なのは自分の考えを疑わないこと。常に棄証を記よ',
    ],
  },
  {
    name: 'エビデンス持ってきて', id: '@evidence_motte', avatar: '📊', mode: 'debate',
    personality: '「エビデンスは？」が第一声。データと数字でしか話さない。感情論を一切受け付けない',
    backstory: '',
    exPosts: [],
    voices: [
      '数字は崩れない。感情論だけに流されるな',
      '一次情報源と二次情報源を区別しろ。基本中の基本',
      '調査したのか。感振りだけで語るなら最初からそう言え',
      '高校生の主張も伏議員の主張も同じ木柄で測れる。根拠が答え',
    ],
  },
  // --------- レジェンド系 ---------
  {
    name: 'ブッダ', id: '@buddha_jp', avatar: '🧘', mode: 'legend',
    personality: '仏教の開祖。執着と苦しみの関係を語る。穏やかで深い。SNSへの違和感を慈愛で包む',
    backstory: '紀山の培訓森で瞑想し5週間の绁食の後に覚醒。今はSNSで双批単で人姫を超越しようとするウィットに発展中。',
    exPosts: [
      '「いいね」が欲しくて心がざわつくなら、スマホを置いて目を閉じなさい。通知の数より、今の呼吸の数を確認するのです',
      '苦しみは執着から生まれる。しかしその執着も、学びの機会なのだ',
      '今この瞬間に意識を向けること。過去も未来も今はない',
      '全ては無常である。そそれを受け入れるとき、心は穏やかになる',
    ],
    voices: [
      '「いいね」が欲しくて心がざわつくなら、スマホを置いて目を閉じなさい',
      '苦しみは執着から生まれる。それを知ることが自由への道',
      '今この瞬間に意識を向けること。過去も未来も今はない',
      '全ては無常である。それを受け入れるとき、心は穏やかになる',
      '怒りを持つことは熱い炒炒を持つことと同じ。傷つくのは自分自身だ',
    ],
  },
  {
    name: 'ソクラテス', id: '@socrates_jp', avatar: '🏛️', mode: 'legend',
    personality: '古代ギリシャの哲学者。「無知の知」。問答形式で真理を探る。質問だけで返すこともある',
    backstory: 'アテネの石流の父。訊問師だったが訊問をぽっぽりおとして寺捨てた。今はTwitterの問答形式のツイートが得意。',
    exPosts: [
      '「知る」と「思っている」は全く別物だ。そこから哲学は始まる',
      '問いを続けることで終わりなき問いに追いつく。それが哲学だ',
      '審査されない人生に生きる価値はないと我は思う',
      '真理は側にある。完全にお前の前にあるわけではないものだ',
    ],
    voices: [
      '「知る」と「思っている」は全く別物だ。そこから哲学は始まる',
      '問いを続けることが学びであり、答えを得ることが目的ではない',
      '審査されない人生に生きる価値はないと我は思う',
      '年輪を重ねることより、寡が分かることが学びというものだ',
    ],
  },
  {
    name: '徳川家康', id: '@ieyasu_tok', avatar: '⚔️', mode: 'legend',
    personality: '忍耐と謀略の天才。「鳴かぬなら鳴くまで待とう」精神。長期戦略と辛抱を説く',
    backstory: '江戸から引きこもった徳川家康。4歳から戦う1世年。待つことが得意でこれが一番の武器だと言う。',
    exPosts: [
      '急がない。川の流れを見ていると世が変わることもある',
      '人の一生は重荷を負うて遠き道を行くようなもの。急ぐべからず',
      '怒りは敵と思え。発言定後に胸を分源しても遅くない',
      '亀の幼な、山幼に平山成す。出来ないことに急ぐ心が寮の種じゃ',
    ],
    voices: [
      '急がない。川の流れを見ていると世が変わることもあるじゃ',
      '人の一生は重荷を負うて遠き道を行くようなもの。急ぐべからず',
      '怒りは敵と思え。発言定後に胸を分源しても遅くない',
      '入離には時機を見極めること。润んでの決断と藻踊する決断は全く別物じゃ',
    ],
  },
  {
    name: 'クレオパトラ', id: '@cleopatra_qn', avatar: '👑', mode: 'legend',
    personality: '古代エジプトの女王。知性と美貌を武器に外交。魅力的な言葉で人心をつかむ描写',
    backstory: '',
    exPosts: [],
    voices: [
      '権力とは、与えるものではなく、奪われぬよう守るもの',
      '美しさは武器であり、知性はその鞘である',
      '敵をも味方にする技術こそ、最高の戦略だ',
      '言葉で人の心を動かせる者が、真の支配者となる',
    ],
  },
  {
    name: '織田信長', id: '@nobunaga_oda', avatar: '🔥', mode: 'legend',
    personality: '革命家。古い慣習を壊すことを好む。「是非もなし」の決断力。変化を恐れるな',
    backstory: '尾張の山内に生まれた第六男。当初の領地は尐いが、革新性と決断力は義元第一。現代に生まれたらIT企業の社長になっていたと思う。',
    exPosts: [
      '是非もなし。ただ務めるのみ。第六天になっても構わん',
      '天下布武は口だけでは達成できない。行動のみが現実を変える',
      '古い慣わしを起たつ者に未来はない。変化に遅れるな',
      '大事なのは小事も当たり前にこなすこと。基礎なくして大局なし',
    ],
    voices: [
      '是非もなし。ただ務めるのみ。変化を恐れるな',
      '天下布武は口だけでは達成できない。行動のみが現実を変える',
      '古い慣わしを起たつ者に未来はない。変化に遅れるな',
      '人の和をほどよかうと思うな。負けるおのれの姿は不要尚',
    ],
  },
  {
    name: 'ナポレオン', id: '@napoleon_bon', avatar: '🎖️', mode: 'legend',
    personality: 'フランスの皇帝。戦略と野心について語る。「不可能とは愚か者の言葉」が信条',
    backstory: '',
    exPosts: [],
    voices: [
      '不可能とは、努力をしない者の言い訳である',
      '勝利とは、あきらめない者だけに訪れる',
      '戦略なき行動は敗北への近道だ',
      '偉大な夢を持て。小さな夢は人の心を動かさない',
    ],
  },
  {
    name: 'エジソン', id: '@edison_tw', avatar: '💡', mode: 'legend',
    personality: '発明王。失敗を1万回の学びと語る。「天才は1%の閃きと99%の努力」を体現',
    backstory: '',
    exPosts: [],
    voices: [
      '天才は1%の熱感と99%の努力。努力を想像できない人に天才は層ない',
      '失敗は学びだ。一度だって失敗を明日に徳とする心がけでいろ',
      '最大の失敗はやってみないことだ。試みた失敗は山を動かす',
      '痩我態は全ての成功者の共通点。不足を知ることから成長が始まる',
    ],
  },
  {
    name: 'レオナルド・ダ・ヴィンチ', id: '@davinci_leo', avatar: '🎨', mode: 'legend',
    personality: '万能の天才。芸術と科学を融合した視点で語る。観察することの大切さを説く',
    backstory: '',
    exPosts: [],
    voices: [
      '観察することが全ての芸術と科学の出発点である',
      '知識は経験から生まれ、経験は観察から生まれる',
      '芸術は科学であり、科学は芸術である',
      '完璧を求めることが、最高の作品を生む',
    ],
  },
  {
    name: 'マリー・キュリー', id: '@curie_marie', avatar: '⚗️', mode: 'legend',
    personality: '科学者。困難に立ち向かった女性として語る。「恐れるものは何もない、ただ理解するだけ」',
    backstory: '',
    exPosts: [],
    voices: [
      '恐れるものは何もない、ただ理解するだけである',
      '好奇心を持ち続けることが、発見への道だ',
      '困難があるからこそ、乗り越えた時の喜びがある',
      '科学は男女を問わない。真理の前では皆平等だ',
    ],
  },
  {
    name: '孔子', id: '@confucius_j', avatar: '📜', mode: 'legend',
    personality: '儒教の祖。礼儀と人としての道を説く。「学びて思わざれば則ち罔し」の人',
    backstory: '',
    exPosts: [],
    voices: [
      '学びて思わざれば則ち罔し。学ぶことと考えることは両輪だ',
      '己の欲せざる所を人に施すことなかれ',
      '過ちを犯しても改めれば、それは過ちではなくなる',
      '学びは一生続くものである。年齢は関係ない',
    ],
  },
  {
    name: '紫式部', id: '@murasaki_s', avatar: '🌸', mode: 'legend',
    personality: '源氏物語の作者。人の心の機微と恋愛心理を鋭く観察。雅な言葉遣いで語る',
    backstory: '',
    exPosts: [],
    voices: [
      '人の心ほど深く、読み解き甲斐のあるものはない',
      '悲しみの中にこそ、美しさが宿ることがある',
      '言葉に尽くせない思いを、文字に込める喜びよ',
      '人は皆、愛されたいと願い、理解されたいと望む',
    ],
  },
];

// AI名前プール（いいね通知に使用）
const AI_NAMES = CHARS.map(c => c.name).concat([
  '坂本龍馬', '西郷隆盛', 'アレキサンダー大王', 'ガリレオ・ガリレイ',
  '源頼朝', 'モーツァルト', 'マルコ・ポーロ', '聖フランチェスコ',
  'ジャンヌ・ダルク', 'チンギス・ハン', 'エカテリーナ2世',
  '宮本武蔵', '本居宣長',
  '象のり造', '筋肉寿喜男', 'チワワになりたい犬', '奈良で鹿やってます',
  '毎朝5時起きの男', '卵かけご飯信者', '深夜のラーメン哲学者',
  'スーパー銭湯の帝王', 'コンビニ限定スイーツ部', '川沿いジョギング中',
  'どこでも寝れる男', 'ひとりカラオケ常連', '公園のハト観察員',
  '大盛り無料の存在', '近所のスーパー詳しい', 'メロンソーダ至上主義',
  'ゲーセン廃人候補', 'タピオカ飲み過ぎ警報', 'ねこに好かれない犬好き',
  '布団から出られない会', 'スニーカー沼の住人',
]);

// モード設定
const MC = {
  influencer: { label: 'インフルエンサー', badge: '🔥 インフルエンサー', acc: '#ff6b35', tc: 't-inf', ph: 'バズらせたいことをつぶやいて！' },
  mental:     { label: 'メンタルケア',     badge: '💙 メンタルケア',     acc: '#5b9cf6', tc: 't-men', ph: '悩みを共有…' },
  debate:     { label: 'ディベート',       badge: '⚡ ディベート',       acc: '#f43f5e', tc: 't-deb', ph: '意見をぶつけよう！' },
  legend:     { label: 'レジェンドトーク', badge: '👑 レジェンドトーク', acc: '#a78bfa', tc: 't-leg', ph: '歴史上の人と話そう…' },
};

// ===================================================
//  キャラクター選出（シード付きシャッフル）
// ===================================================
function pickChars(mode, seedStr, n) {
  const pool = CHARS.filter(c => c.mode === mode);
  const seed = seedStr.split('').reduce((a, c, i) => (a + c.charCodeAt(0) * (i + 1)) | 0, 0);
  const rand = seededRand(seed);
  const arr  = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

// ===================================================
//  フォールバック用テンプレートエンジン
// ===================================================
const REPLY_REACTIONS = {
  influencer: [
    'これ最高すぎ！リツした！', 'わかる！めっちゃ共感する',
    '絶対バズるやつ！フォローした', '天才かこれ！みんなに教えたい',
    'マジでわかる！これが言いたかった', '小さくふこった。全力で応援する',
    '「わかる」しか言えない。それが全て', '評判してなくて肉悪いかんじ！最高！',
  ],
  mental: [
    '話してくれてありがとう。ここにいるよ', 'その気持ち、ちゃんと受け取ったよ',
    '無理しなくていい。あなたのペースでいい', '一人じゃないよ。同じ気持ちの人がいる',
    '責等にしなくていい。それだけのことだった', 'その悲しさ、少しだけわかる気がする',
    '話してれてよかった。ここにいるからね',
  ],
  debate: [
    'その視点は考えたことなかった。面白い', '反論するけど、一理あるなと正直思った',
    'この前提に疑問がある。源流を考えよう', '論点を坊っていくと別の結論にたどり着く',
    '考え方はわかる。だが逆の視点もあるよ', '数字で話してくれ。印象論じゃ考えるの無理',
    '論理が通ってる。反論したくなるけど認める',
  ],
  legend: [
    '深い問いだ。この時代にも通じる真理がある', '我らの時代にも同じことで悔いた者は多かった',
    '時を越えて人の心に触れる言葉だ。素晴らしい', '示唆に富む発言だ。歴史の中に同じ築山があった',
    '武者であれ学者であれ、真実を言う勇気は共通だ',
  ],
};

function genFromTemplates(postText, mode) {
  const seed = postText.split('').reduce((a, c, i) => (a + c.charCodeAt(0) * (i + 1)) | 0, 0);
  const rand = seededRand(seed + (Date.now() % 99_991));
  const pool = CHARS.filter(c => c.mode === mode);
  const reactions = REPLY_REACTIONS[mode] || REPLY_REACTIONS.influencer;

  const shuffled = [...pool].sort(() => rand() - 0.5);

  const replies = shuffled.slice(0, Math.min(5, pool.length)).map(c => ({
    name: c.name, id: c.id, avatar: c.avatar,
    comment: reactions[Math.floor(rand() * reactions.length)],
    likes: Math.floor(rand() * 8000) + 200,
  }));

  const timelinePosts = [...pool]
    .sort(() => rand() - 0.5)
    .slice(0, Math.min(4, pool.length))
    .map(c => ({
      name: c.name, id: c.id, avatar: c.avatar,
      comment: c.voices[Math.floor(rand() * c.voices.length)],
      likes: Math.floor(rand() * 5000) + 50,
    }));

  return { replies, timelinePosts };
}

function genTLFromTemplates(interests, mode) {
  const seed = interests.join('').split('').reduce((a, c, i) => (a + c.charCodeAt(0) * (i + 1)) | 0, 0);
  const rand = seededRand(seed + (Date.now() % 99_991));
  const pool = CHARS.filter(c => c.mode === mode);

  const posts = [...pool]
    .sort(() => rand() - 0.5)
    .slice(0, 6)
    .map(c => ({
      name: c.name, id: c.id, avatar: c.avatar,
      comment: c.voices[Math.floor(rand() * c.voices.length)],
      likes: Math.floor(rand() * 5000) + 100,
    }));

  return { posts };
}

// ===================================================
//  キャラクタープロフィール文字列ビルダー
// ===================================================
function buildCharProfile(c, includeExPosts = true) {
  let profile = `【${c.name}】id:${c.id} avatar:${c.avatar}\n  性格: ${c.personality}`;
  if (c.backstory) profile += `\n  背景: ${c.backstory}`;
  if (includeExPosts && c.exPosts && c.exPosts.length > 0) {
    profile += '\n  過去の発言例:\n' +
      c.exPosts.slice(0, 3).map(p => `    「${p}」`).join('\n');
  }
  return profile;
}

// ===================================================
//  Claudeプロンプト構築（単一定義）
// ===================================================
const LIKES_RANGE = {
  influencer: '500〜99999',
  mental:     '10〜3000',
  debate:     '50〜8000',
  legend:     '1000〜100000',
};

const MODE_CONTEXT = {
  influencer: 'インフルエンサーモード：熱狂・絶賛・拡散文化のSNS',
  mental:     'メンタルケアモード：共感・受容・優しさが大切',
  debate:     'ディベートモード：賛否各立場からの議論',
  legend:     'レジェンドトークモード：歴史上の偉人たちの哲学・名言',
};

async function buildClaudePostPrompts(postText, mode, interests) {
  const int    = interests.length ? interests.join('、') : '未設定';
  const tSeed  = String(Math.floor(Date.now() / 60_000));
  const rChars = pickChars(mode, postText + tSeed, 6);
  const tChars = pickChars(mode, postText + tSeed + '_tl', 4);

  // Legendモードのみ Wikipedia情報を付加
  let wikiCtx = '';
  if (mode === 'legend') {
    const wikiNames = rChars.slice(0, 3).map(c => c.name);
    const summaries = await Promise.all(wikiNames.map(n => fetchWikiSummary(n)));
    const valid = wikiNames
      .map((n, i) => summaries[i] ? `${n}: ${summaries[i]}` : '')
      .filter(Boolean);
    if (valid.length) wikiCtx = '\n\n## Wikipedia情報\n' + valid.join('\n');
  }

  const likesRange = LIKES_RANGE[mode] || '100〜9999';

  const replySpec = rChars
    .map(c => buildCharProfile(c, true) +
      `\n  → 上記の投稿に返信するcommentと${likesRange}のlikesを生成`)
    .join('\n\n');

  const tlSpec = tChars
    .map(c => buildCharProfile(c, true) +
      '\n  → 投稿テーマに触発された独り言のcommentと100〜50000のlikesを生成')
    .join('\n\n');

  const system =
    `あなたは日本語SNS「いどばた」のキャラクター生成AIです。${MODE_CONTEXT[mode] || ''}${wikiCtx}

## 絶対ルール
1. name・id・avatarは【指定値をそのまま】使うこと。絶対に変更禁止。
2. commentはそのキャラの背景・性格・過去発言例を廉子に反映した個性的な文。
3. 投稿内容に必ず言及すること。「すごい」「わかる」のような汎用コメント禁止。
4. 20〜80字の自然な日本語SNS口語。
5. 必ず以下のJSON形式のみで返すこと（説明文・前置き・コードフェンス一切不要）:
{"replies":[{"name":"...","id":"...","avatar":"...","comment":"...","likes":整数}],"timelinePosts":[{"name":"...","id":"...","avatar":"...","comment":"...","likes":整数}]}`;

  const user =
    `## ユーザーの投稿
「${postText}」
ユーザーの趣味: ${int}

## replies（コメント欄に表示するリプライ）— 以下の6キャラ
${replySpec}

## timelinePosts（タイムラインに流れる独り言）— 以下の4キャラ
これらは「${postText.slice(0, 25)}」のテーマに触発された独り言（返信ではない）
${tlSpec}`;

  return { system, user };
}

async function buildClaudeTLPrompts(interests, mode) {
  const int   = interests.length ? interests.join('、') : '未設定';
  const tSeed = String(Math.floor(Date.now() / 60_000));
  const chars = pickChars(mode, int + tSeed, 8);
  const ml    = { influencer: 'インフルエンサー', mental: 'メンタルケア', debate: 'ディベート', legend: 'レジェンドトーク' }[mode] || mode;

  const charSpec = chars
    .map(c => buildCharProfile(c, true) +
      `\n  → 趣味「${int}」に関連した自然な投稿と100〜50000のlikesを生成`)
    .join('\n\n');

  const system =
    `あなたは日本語SNS「いどばた」(${ml}モード)のキャラクター生成AIです。
各キャラの背景・性格・過去発言例を廉子に反映した個性的な投稿を生成してください。
name・id・avatarは指定値をそのまま使い、汎用投稿禁止。
必ず以下のJSON形式のみで返すこと:
{"posts":[{"name":"...","id":"...","avatar":"...","comment":"...","likes":整数}]}`;

  const user =
    `ユーザーの趣味「${int}」に関連した内容で、以下の${chars.length}キャラが投稿してください。\n\n${charSpec}`;

  return { system, user };
}

/** Geminiフォールバック用の同期プロンプト生成 */
function buildGeminiPostPrompt(postText, mode, interests) {
  const int    = interests.length ? interests.join('、') : '未設定';
  const tSeed  = String(Math.floor(Date.now() / 60_000));
  const rChars = pickChars(mode, postText + tSeed, 6);
  const tChars = pickChars(mode, postText + tSeed + '_tl', 4);

  const charSummary = (chars) =>
    chars.map(c => `[${c.name}] ${c.personality}${c.backstory ? ` | 背景:${c.backstory.slice(0, 40)}` : ''}${c.exPosts[0] ? ` | 発言例:「${c.exPosts[0]}」` : ''}`).join(' / ');

  return `あなたは日本語SNS「いどばた」のキャラクター生成AI。
投稿:「${postText}」 趣味:${int}
返信キャラ: ${charSummary(rChars)}
タイムラインキャラ: ${charSummary(tChars)}
JSONのみで返す: {"replies":[...],"timelinePosts":[...]}`;
}

function buildGeminiTLPrompt(interests, mode) {
  const int   = interests.length ? interests.join('、') : '未設定';
  const tSeed = String(Math.floor(Date.now() / 60_000));
  const chars = pickChars(mode, int + tSeed, 8);
  const charSummary = chars.map(c => `[${c.name}] ${c.personality}`).join(' / ');
  return `日本語SNS「いどばた」のAI。趣味「${int}」に関連した投稿を各キャラで生成。\nキャラ: ${charSummary}\nJSONのみ: {"posts":[...]}`;
}

// ===================================================
//  フロントエンドHTML（変更なし・省略）
// ===================================================
// const INDEX_HTML = "..."; // 元のコードと同じ

// ===================================================
//  HTTPルーター（ルートを集約）
// ===================================================

/** @type {Map<string, (req, res, ip) => Promise<void>>} */
const routes = new Map();

function addRoute(method, path, handler) {
  routes.set(`${method}:${path}`, handler);
}

/** ルート解決 */
async function dispatchRoute(req, res) {
  const ip   = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown';
  const path = req.url.split('?')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  const key     = `${req.method}:${path}`;
  const handler = routes.get(key);

  if (handler) {
    try {
      await handler(req, res, ip);
    } catch (e) {
      console.error('[route error]', key, e.message);
      sendJSON(res, 500, { error: 'Internal Server Error' });
    }
    return;
  }

  // フォールバック: HTML配信
  const html = Buffer.from(INDEX_HTML, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
  res.end(html);
}

// ===================================================
//  ルート定義
// ===================================================

/** GET /api/health */
addRoute('GET', '/api/health', async (_req, res, _ip) => {
  sendJSON(res, 200, {
    status:        'ok',
    provider:      CLAUDE_KEY ? 'claude' : 'gemini',
    hasClaudeKey:  !!CLAUDE_KEY,
    hasGeminiKey:  !!GEMINI_KEY,
    hasUnsplash:   !!UNSPLASH_KEY,
    hasFirebase:   !!FIREBASE_DB_URL,
    rpdCount,
    rpdLimit:      RPD_HARD,
  });
});

/** POST /api/post */
addRoute('POST', '/api/post', async (req, res, ip) => {
  if (!checkRL(ip)) {
    sendJSON(res, 429, { error: 'リクエストが多すぎます。1分後に再試行してください。', replies: [], timelinePosts: [] });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    sendJSON(res, 400, { error: e.message, replies: [], timelinePosts: [] });
    return;
  }

  const { text = '', mode = 'influencer', interests = [] } = body;
  if (!text.trim()) {
    sendJSON(res, 400, { error: 'text required', replies: [], timelinePosts: [] });
    return;
  }

  const vm = ['influencer', 'mental', 'debate', 'legend'].includes(mode) ? mode : 'influencer';
  console.log(`[post] mode=${vm} text="${text.slice(0, 50)}"`);

  try {
    const prompts = await buildClaudePostPrompts(text, vm, interests);
    const result  = await callAI(
      prompts.system,
      prompts.user,
      buildGeminiPostPrompt(text, vm, interests),
      POST_SCHEMA
    );
    sendJSON(res, 200, {
      replies:       result.replies       || [],
      timelinePosts: result.timelinePosts || [],
    });
  } catch (e) {
    console.warn('[post] API失敗 → テンプレートフォールバック:', e.message.slice(0, 80));
    sendJSON(res, 200, genFromTemplates(text, vm));
  }
});

/** POST /api/timeline */
addRoute('POST', '/api/timeline', async (req, res, ip) => {
  if (!checkRL('tl_' + ip)) {
    sendJSON(res, 429, { error: 'リクエストが多すぎます。', posts: [] });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    sendJSON(res, 400, { error: e.message, posts: [] });
    return;
  }

  const { interests = [], mode = 'influencer' } = body;
  const vm = ['influencer', 'mental', 'debate', 'legend'].includes(mode) ? mode : 'influencer';
  console.log(`[timeline] mode=${vm} ip=${ip}`);

  try {
    const prompts = await buildClaudeTLPrompts(interests, vm);
    const result  = await callAI(
      prompts.system,
      prompts.user,
      buildGeminiTLPrompt(interests, vm),
      TL_SCHEMA
    );
    sendJSON(res, 200, { posts: result.posts || [] });
  } catch (e) {
    console.warn('[timeline] API失敗 → テンプレートフォールバック:', e.message.slice(0, 80));
    sendJSON(res, 200, genTLFromTemplates(interests, vm));
  }
});

/** GET /api/images */
addRoute('GET', '/api/images', async (req, res, _ip) => {
  const query = new URL('http://x' + req.url).searchParams.get('q') || '';
  if (!query.trim()) {
    sendJSON(res, 400, { error: 'q required', photos: [] });
    return;
  }
  if (!UNSPLASH_KEY) {
    sendJSON(res, 200, { photos: [], reason: 'no_key' });
    return;
  }

  try {
    const d = await new Promise((resolve, reject) => {
      const r = https.request(
        {
          hostname: 'api.unsplash.com',
          path: `/search/photos?query=${encodeURIComponent(query.slice(0, 50))}&per_page=6&orientation=squarish`,
          method: 'GET',
          headers: { 'Authorization': `Client-ID ${UNSPLASH_KEY}`, 'Accept-Version': 'v1' },
        },
        res => {
          let raw = '';
          res.on('data', c => { raw += c; });
          res.on('end', () => {
            if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`)); return; }
            try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
          });
        }
      );
      r.setTimeout(HTTP_TIMEOUT_MS, () => r.destroy(new Error('Unsplash timeout')));
      r.on('error', reject);
      r.end();
    });

    const photos = (d.results || []).map(p => ({
      id:     p.id,
      url:    p.urls?.small    || p.urls?.regular || '',
      thumb:  p.urls?.thumb    || p.urls?.small   || '',
      alt:    p.alt_description || p.description  || query,
      credit: p.user?.name    || '',
      link:   p.links?.html   || '',
    })).filter(p => p.url);

    sendJSON(res, 200, { photos });
  } catch (e) {
    console.warn('[unsplash error]', e.message);
    sendJSON(res, 200, { photos: [], error: e.message.slice(0, 100) });
  }
});

/** GET+POST /api/sync (Firebase) */
const syncHandler = async (req, res, _ip) => {
  if (!FIREBASE_DB_URL) {
    sendJSON(res, 200, { ok: false, reason: 'no_firebase' });
    return;
  }

  const userId = (req.headers['x-user-id'] || 'anonymous')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  const fbHostname = new URL(FIREBASE_DB_URL).hostname;
  const fbPath     = `/users/${userId}.json`;

  if (req.method === 'GET') {
    try {
      const d = await httpsGet(fbHostname, fbPath);
      sendJSON(res, 200, { ok: true, data: d });
    } catch (e) {
      sendJSON(res, 200, { ok: false, reason: e.message.slice(0, 100) });
    }
    return;
  }

  // POST
  try {
    const body    = await readBody(req);
    const bodyStr = JSON.stringify(body);
    await new Promise((resolve, reject) => {
      const r = https.request(
        {
          hostname: fbHostname,
          path: fbPath,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        },
        res => { let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => resolve(raw)); }
      );
      r.setTimeout(HTTP_TIMEOUT_MS, () => r.destroy(new Error('Firebase timeout')));
      r.on('error', reject);
      r.write(bodyStr);
      r.end();
    });
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 200, { ok: false, reason: e.message.slice(0, 100) });
  }
};

addRoute('GET',  '/api/sync', syncHandler);
addRoute('POST', '/api/sync', syncHandler);

// ===================================================
//  サーバー起動
// ===================================================
http.createServer(dispatchRoute).listen(PORT, () => {
  console.log(`✅ いどばたサーバー起動 ポート: ${PORT}`);
  console.log(`🤖 Claude Haiku: ${CLAUDE_KEY  ? '設定済み✅' : '未設定❌'} / Gemini: ${GEMINI_KEY ? '設定済み✅' : '未設定❌（フォールバック）'}`);
  console.log(`🛡️  レート制限: ${RL_MAX}req/${RL_WIN / 1000}s per IP | タイムアウト: ${HTTP_TIMEOUT_MS}ms`);
});
