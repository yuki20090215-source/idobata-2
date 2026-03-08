const http  = require('http');
const https = require('https');

const PORT        = process.env.PORT || 3000;
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_KEY  = process.env.OPENAI_API_KEY || '';
const GEMINI_KEY  = process.env.GEMINI_API_KEY || '';

// ===== レート制限 =====
// IPごとに「ウィンドウ時間内のリクエスト数」を管理
const RATE_LIMIT_WINDOW_MS  = 60 * 1000; // 1分
const RATE_LIMIT_MAX_REQ    = 10;         // 1分あたり最大10回
const rateLimitMap = new Map();           // { ip -> { count, windowStart } }

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // 新規 or ウィンドウリセット
    entry = { count: 1, windowStart: now };
    rateLimitMap.set(ip, entry);
    return true; // OK
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQ) {
    return false; // 超過
  }
  return true;
}

// メモリリーク防止: 古いエントリを定期削除（5分ごと）
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 5) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ===== HTML =====
const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"ja\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0\">\n<title>\u3044\u3069\u3070\u305f \u2014 \u30d0\u30fc\u30c1\u30e3\u30eb\u4e95\u6238\u7aef\u4f1a\u8b70</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Zen+Maru+Gothic:wght@400;500;700&display=swap\" rel=\"stylesheet\">\n<style>\n:root {\n  --bg:#0f0f13;--sf:#1a1a22;--sf2:#22222e;--bd:#2e2e3e;\n  --tx:#f0f0f5;--sub:#8888aa;\n  --inf:#ff6b35;--men:#5b9cf6;--deb:#f43f5e;--leg:#a78bfa;\n  --acc:#ff6b35;--like:#ff4488;\n  --fn:'Zen Maru Gothic','Noto Sans JP',sans-serif;\n}\n*{margin:0;padding:0;box-sizing:border-box;}\nbody{background:var(--bg);color:var(--tx);font-family:var(--fn);min-height:100vh;display:flex;justify-content:center;}\n.phone{width:390px;min-height:100vh;background:var(--bg);display:flex;flex-direction:column;position:relative;}\n.screen{display:none;flex-direction:column;flex:1;}\n.screen.active{display:flex;}\n\n/* ===== SETUP ===== */\n#setupScreen{overflow-y:auto;padding-bottom:40px;}\n.s-hero{text-align:center;padding:48px 24px 28px;background:linear-gradient(160deg,#1a1a22 0%,#0f0f13 100%);}\n.s-logo{font-size:38px;font-weight:900;letter-spacing:-1px;margin-bottom:6px;}\n.s-logo span{color:var(--acc);}\n.s-sub{font-size:13px;color:var(--sub);line-height:1.7;}\n.s-mascot{font-size:60px;margin-top:16px;}\n.s-body{padding:24px 20px 0;}\n.s-sec{margin-bottom:22px;}\n.s-lbl{font-size:11px;font-weight:700;color:var(--sub);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;}\n.s-inp{width:100%;background:var(--sf);border:1.5px solid var(--bd);border-radius:12px;padding:12px 16px;color:var(--tx);font-size:15px;font-family:var(--fn);outline:none;transition:border-color .2s;}\n.s-inp:focus{border-color:var(--acc);}\n.s-inp::placeholder{color:var(--sub);}\n.av-grid{display:flex;flex-wrap:wrap;gap:10px;}\n.av-opt{width:48px;height:48px;border-radius:50%;background:var(--sf);border:2px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;transition:all .2s;}\n.av-opt.sel{border-color:var(--acc);background:rgba(255,107,53,.15);transform:scale(1.1);}\n.int-grid{display:flex;flex-wrap:wrap;gap:8px;}\n.i-tag{padding:7px 13px;border-radius:20px;border:1.5px solid var(--bd);font-size:12px;font-weight:700;color:var(--sub);cursor:pointer;transition:all .2s;font-family:var(--fn);}\n.i-tag.sel{border-color:var(--acc);color:var(--acc);background:rgba(255,107,53,.1);}\n.s-btn{width:100%;padding:15px;border-radius:14px;background:var(--acc);color:#fff;font-size:16px;font-weight:900;border:none;cursor:pointer;font-family:var(--fn);margin-top:4px;transition:transform .15s,opacity .15s;}\n.s-btn:hover{transform:translateY(-1px);}\n.s-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}\n\n/* ===== MAIN ===== */\n#mainScreen{position:relative;min-height:100vh;}\n.hdr{position:sticky;top:0;z-index:100;background:rgba(15,15,19,.97);backdrop-filter:blur(12px);border-bottom:1px solid var(--bd);padding:12px 16px 10px;}\n.hdr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}\n.logo{font-size:20px;font-weight:900;letter-spacing:-.5px;cursor:pointer;}\n.logo span{color:var(--acc);}\n.h-right{display:flex;align-items:center;gap:8px;}\n.mbadge{font-size:10px;font-weight:700;padding:4px 9px;border-radius:20px;background:var(--acc);color:#fff;transition:background .3s;white-space:nowrap;}\n.nav-btn{width:34px;height:34px;border-radius:50%;background:var(--sf);border:1.5px solid var(--bd);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .2s;position:relative;}\n.nav-btn:hover,.nav-btn.on{border-color:var(--acc);background:rgba(255,107,53,.1);}\n.notif-dot{position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:var(--like);border:2px solid var(--bg);display:none;}\n.notif-dot.show{display:block;}\n.m-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;}\n.m-tabs::-webkit-scrollbar{display:none;}\n.m-tab{flex-shrink:0;font-size:11px;font-weight:700;padding:5px 11px;border-radius:20px;border:1.5px solid var(--bd);background:transparent;color:var(--sub);cursor:pointer;transition:all .2s;font-family:var(--fn);}\n.m-tab.ai{border-color:var(--inf);color:var(--inf);background:rgba(255,107,53,.1);}\n.m-tab.am{border-color:var(--men);color:var(--men);background:rgba(91,156,246,.1);}\n.m-tab.ad{border-color:var(--deb);color:var(--deb);background:rgba(244,63,94,.1);}\n.m-tab.al{border-color:var(--leg);color:var(--leg);background:rgba(167,139,250,.1);}\n.m-hint{padding:9px 16px;font-size:12px;color:var(--sub);border-bottom:1px solid var(--bd);line-height:1.5;}\n.m-hint strong{color:var(--acc);}\n\n/* panels */\n.panel{display:none;flex:1;overflow-y:auto;padding-bottom:90px;scrollbar-width:thin;scrollbar-color:var(--bd) transparent;}\n.panel.on{display:block;}\n\n/* ===== NOTIFICATION PANEL ===== */\n#notifPanel{padding-bottom:90px;}\n.notif-hdr{padding:16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;}\n.notif-hdr h2{font-size:18px;font-weight:900;}\n.notif-clr{background:none;border:none;color:var(--sub);font-size:12px;cursor:pointer;font-family:var(--fn);}\n.notif-item{padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;gap:12px;align-items:flex-start;animation:fIn .3s ease;}\n.notif-item.unread{background:rgba(255,107,53,.05);}\n.notif-ico{font-size:24px;flex-shrink:0;}\n.notif-body{flex:1;}\n.notif-text{font-size:13px;line-height:1.6;margin-bottom:3px;}\n.notif-time{font-size:11px;color:var(--sub);}\n.no-notif{text-align:center;padding:48px 24px;color:var(--sub);font-size:13px;}\n\n/* posts */\n.post-card{padding:14px 16px;border-bottom:1px solid var(--bd);animation:fIn .35s ease;transition:background .15s;}\n.post-card:hover{background:var(--sf);}\n.post-card.up{background:var(--sf);}\n@keyframes fIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}\n.p-hd{display:flex;gap:10px;align-items:flex-start;}\n.av{width:42px;height:42px;border-radius:50%;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;border:2px solid transparent;}\n.av.u{border-color:var(--acc);}\n.p-mt{flex:1;min-width:0;}\n.m-row{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:2px;}\n.p-name{font-size:13px;font-weight:700;color:var(--tx);}\n.p-id{font-size:11px;color:var(--sub);}\n.ai-tag{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;}\n.ti{background:rgba(255,107,53,.2);color:var(--inf);}\n.tm{background:rgba(91,156,246,.2);color:var(--men);}\n.td{background:rgba(244,63,94,.2);color:var(--deb);}\n.tl{background:rgba(167,139,250,.2);color:var(--leg);}\n.p-body{font-size:14px;line-height:1.65;margin:6px 0 10px;color:var(--tx);word-break:break-word;}\n.p-acts{display:flex;gap:16px;align-items:center;}\n.act-btn{display:flex;align-items:center;gap:5px;background:none;border:none;color:var(--sub);font-size:12px;cursor:pointer;font-family:var(--fn);transition:color .2s;padding:4px 0;}\n.act-btn:hover{color:var(--tx);}\n.act-btn.liked{color:var(--like);}\n.act-icon{font-size:15px;}\n@keyframes likePop{0%{transform:scale(1);}40%{transform:scale(1.4);}100%{transform:scale(1);}}\n.like-pop{animation:likePop .3s ease;}\n\n/* comments */\n.cmt-wrap{display:none;background:var(--sf2);border-top:1px solid var(--bd);padding:10px 14px;}\n.cmt-wrap.open{display:block;animation:fIn .2s ease;}\n.cmt-item{padding:8px 0;border-bottom:1px solid var(--bd);font-size:13px;line-height:1.55;}\n.cmt-item:last-of-type{border:none;}\n.cmt-author{font-weight:700;font-size:12px;color:var(--acc);margin-bottom:3px;}\n.cmt-add{display:flex;gap:8px;margin-top:10px;}\n.cmt-inp{flex:1;background:var(--bg);border:1.5px solid var(--bd);border-radius:20px;padding:8px 14px;color:var(--tx);font-size:13px;font-family:var(--fn);outline:none;}\n.cmt-inp:focus{border-color:var(--acc);}\n.cmt-inp::placeholder{color:var(--sub);}\n.cmt-snd{width:32px;height:32px;border-radius:50%;background:var(--acc);border:none;cursor:pointer;color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;}\n\n/* typing */\n.typing{display:flex;align-items:center;gap:4px;padding:4px 0;}\n.dot{width:6px;height:6px;border-radius:50%;background:var(--sub);animation:bou 1.2s infinite;}\n.dot:nth-child(2){animation-delay:.2s;}\n.dot:nth-child(3){animation-delay:.4s;}\n@keyframes bou{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-5px);opacity:1;}}\n\n/* empty */\n.empty{text-align:center;padding:60px 30px;color:var(--sub);}\n.e-ico{font-size:48px;margin-bottom:16px;}\n.e-ttl{font-size:16px;font-weight:700;margin-bottom:8px;color:var(--tx);}\n.e-txt{font-size:13px;line-height:1.7;}\n\n/* trends */\n#trendsPanel{padding-bottom:90px;}\n.t-hdr{padding:16px 16px 12px;border-bottom:1px solid var(--bd);}\n.t-title{font-size:18px;font-weight:900;}\n.t-item{display:flex;align-items:center;padding:13px 16px;border-bottom:1px solid var(--bd);cursor:pointer;transition:background .15s;}\n.t-item:hover{background:var(--sf);}\n.t-rank{font-size:18px;font-weight:900;color:var(--sub);width:32px;flex-shrink:0;}\n.t-rank.top{color:var(--acc);}\n.t-con{flex:1;}\n.t-tag{font-size:15px;font-weight:700;margin-bottom:3px;}\n.t-mode{font-size:11px;color:var(--sub);}\n.t-cnt{font-size:12px;color:var(--sub);}\n\n/* profile */\n#profilePanel{padding-bottom:90px;}\n.pr-hero{padding:24px 20px;border-bottom:1px solid var(--bd);display:flex;gap:16px;align-items:center;}\n.pr-av{width:70px;height:70px;border-radius:50%;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:36px;border:3px solid var(--acc);}\n.pr-info{flex:1;}\n.pr-name{font-size:20px;font-weight:900;}\n.pr-id{font-size:13px;color:var(--sub);margin-bottom:8px;}\n.pr-stats{display:flex;gap:20px;}\n.stat{text-align:center;}\n.stat-n{font-size:16px;font-weight:900;color:var(--acc);}\n.stat-l{font-size:11px;color:var(--sub);}\n.pr-ints{padding:16px 20px;border-bottom:1px solid var(--bd);}\n.pi-ttl{font-size:11px;font-weight:700;color:var(--sub);letter-spacing:1.5px;margin-bottom:10px;}\n.pi-tags{display:flex;flex-wrap:wrap;gap:7px;}\n.pi-tag{padding:5px 12px;border-radius:20px;border:1.5px solid var(--acc);color:var(--acc);font-size:12px;font-weight:700;}\n.pr-acts{padding:16px 20px;display:flex;flex-direction:column;gap:10px;}\n.pr-btn{padding:12px;border-radius:12px;border:1.5px solid var(--bd);background:var(--sf);color:var(--tx);font-size:14px;font-family:var(--fn);cursor:pointer;text-align:left;transition:border-color .2s;}\n.pr-btn:hover{border-color:var(--acc);}\n.pr-btn.danger{color:var(--deb);border-color:rgba(244,63,94,.3);}\n\n/* compose */\n.compose{position:fixed;bottom:0;width:390px;background:rgba(15,15,19,.97);backdrop-filter:blur(12px);border-top:1px solid var(--bd);padding:10px 14px 20px;z-index:200;}\n.cmp-in{display:flex;gap:10px;align-items:flex-end;}\n.cmp-av{width:36px;height:36px;border-radius:50%;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;border:2px solid var(--acc);transition:border-color .3s;}\n.cmp-inp{flex:1;background:var(--sf);border:1.5px solid var(--bd);border-radius:22px;padding:10px 16px;color:var(--tx);font-size:14px;font-family:var(--fn);resize:none;outline:none;max-height:100px;line-height:1.5;transition:border-color .2s;}\n.cmp-inp:focus{border-color:var(--acc);}\n.cmp-inp::placeholder{color:var(--sub);}\n.snd-btn{width:40px;height:40px;border-radius:50%;background:var(--acc);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .2s;flex-shrink:0;color:#fff;}\n.snd-btn:hover{transform:scale(1.08);}\n.snd-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}\n\n/* toast */\n.toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--sf2);border:1px solid var(--bd);border-radius:12px;padding:10px 18px;font-size:13px;font-weight:700;opacity:0;transition:all .3s;z-index:300;pointer-events:none;white-space:nowrap;}\n.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}\n\n/* loading overlay */\n.loading-overlay{position:fixed;inset:0;background:rgba(15,15,19,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:500;gap:16px;}\n.loading-overlay.hide{display:none;}\n.loading-logo{font-size:32px;font-weight:900;}\n.loading-logo span{color:var(--acc);}\n.loading-txt{font-size:13px;color:var(--sub);}\n.spinner{width:36px;height:36px;border:3px solid var(--bd);border-top-color:var(--acc);border-radius:50%;animation:spin .8s linear infinite;}\n@keyframes spin{to{transform:rotate(360deg);}}\n\n/* like float animation */\n.like-float{position:fixed;pointer-events:none;font-size:18px;z-index:999;animation:floatUp 1.2s ease forwards;}\n@keyframes floatUp{0%{opacity:1;transform:translateY(0) scale(1);}100%{opacity:0;transform:translateY(-80px) scale(1.5);}}\n\n@media(max-width:420px){.phone,.compose{width:100vw;}}\n</style>\n</head>\n<body>\n<div class=\"phone\" id=\"app\">\n\n<!-- LOADING OVERLAY -->\n<div class=\"loading-overlay\" id=\"loadingOverlay\">\n  <div class=\"loading-logo\">\u3044\u3069<span>\u3070\u305f</span></div>\n  <div class=\"spinner\"></div>\n  <div class=\"loading-txt\" id=\"loadingTxt\">\u8d77\u52d5\u4e2d\u2026</div>\n</div>\n\n<!-- ====== SETUP ====== -->\n<div class=\"screen\" id=\"setupScreen\">\n  <div class=\"s-hero\">\n    <div class=\"s-logo\">\u3044\u3069<span>\u3070\u305f</span></div>\n    <div class=\"s-sub\">\u79c1\u4ee5\u5916\u5168\u54e1AI\u2049<br>\u3042\u306a\u305f\u3060\u3051\u306e\u7a76\u6975\u306b\u308f\u304c\u307e\u307e\u306aSNS</div>\n    <div class=\"s-mascot\">\ud83e\udea3</div>\n  </div>\n  <div class=\"s-body\">\n    <p style=\"text-align:center;font-size:13px;color:var(--sub);padding-bottom:20px;line-height:1.8;\">\n      \u300c\u3044\u3069\u3070\u305f\u300d\u3078\u3088\u3046\u3053\u305d\uff01<br>\u521d\u671f\u8a2d\u5b9a\u3092\u3057\u3066\u3001\u3042\u306a\u305f\u3060\u3051\u306e\u4e16\u754c\u3092\u4f5c\u308d\u3046\u3002\n    </p>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u30e6\u30fc\u30b6\u30fc\u540d</div>\n      <input class=\"s-inp\" id=\"sName\" type=\"text\" placeholder=\"\u4f8b\uff1a\u4e95\u6238\u7aef \u6cf0\u5e0c\" maxlength=\"20\" oninput=\"chkSetup()\">\n    </div>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u30ed\u30b0\u30a4\u30f3ID</div>\n      <input class=\"s-inp\" id=\"sId\" type=\"text\" placeholder=\"\u4f8b\uff1aidobata_taiki\uff08\u82f1\u6570\u5b57\uff09\" maxlength=\"20\" oninput=\"chkSetup()\">\n    </div>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u30a2\u30d0\u30bf\u30fc\u3092\u9078\u3076</div>\n      <div class=\"av-grid\">\n        <div class=\"av-opt sel\" data-av=\"\ud83d\ude0a\" onclick=\"selAv(this)\">\ud83d\ude0a</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\ude0e\" onclick=\"selAv(this)\">\ud83d\ude0e</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc36\" onclick=\"selAv(this)\">\ud83d\udc36</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc31\" onclick=\"selAv(this)\">\ud83d\udc31</div>\n        <div class=\"av-opt\" data-av=\"\ud83e\udd8a\" onclick=\"selAv(this)\">\ud83e\udd8a</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc38\" onclick=\"selAv(this)\">\ud83d\udc38</div>\n        <div class=\"av-opt\" data-av=\"\ud83e\udd84\" onclick=\"selAv(this)\">\ud83e\udd84</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc3c\" onclick=\"selAv(this)\">\ud83d\udc3c</div>\n        <div class=\"av-opt\" data-av=\"\ud83e\udd81\" onclick=\"selAv(this)\">\ud83e\udd81</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc2f\" onclick=\"selAv(this)\">\ud83d\udc2f</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc3b\" onclick=\"selAv(this)\">\ud83d\udc3b</div>\n        <div class=\"av-opt\" data-av=\"\ud83d\udc28\" onclick=\"selAv(this)\">\ud83d\udc28</div>\n      </div>\n    </div>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u8da3\u5473\u30fb\u8208\u5473\uff08\u8907\u6570\u9078\u629eOK\uff09</div>\n      <div class=\"int-grid\">\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udfb5 \u97f3\u697d</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udfac \u6620\u753b</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udfae \u30b2\u30fc\u30e0</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udf73 \u6599\u7406</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83d\udcbb \u30c6\u30af\u30ce\u30ed\u30b8\u30fc</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83d\udcda \u8aad\u66f8</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\u2708\ufe0f \u65c5\u884c</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83d\udc3e \u52d5\u7269</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\u26bd \u30b9\u30dd\u30fc\u30c4</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udf3f \u30e9\u30a4\u30d5\u30b9\u30bf\u30a4\u30eb</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udfad \u30a2\u30cb\u30e1</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83d\udcb0 \u30d3\u30b8\u30cd\u30b9</div>\n        <div class=\"i-tag\" onclick=\"togInt(this)\">\ud83c\udf1f \u63a8\u3057\u6d3b</div>\n      </div>\n    </div>\n    <button class=\"s-btn\" id=\"setupBtn\" onclick=\"doSetup()\" disabled>\u3044\u3069\u3070\u305f\u3092\u306f\u3058\u3081\u308b \u2192</button>\n  </div>\n</div>\n\n<!-- ====== MAIN ====== -->\n<div class=\"screen\" id=\"mainScreen\">\n  <div class=\"hdr\">\n    <div class=\"hdr-top\">\n      <div class=\"logo\" onclick=\"showPanel('timeline')\">\u3044\u3069<span>\u3070\u305f</span></div>\n      <div class=\"h-right\">\n        <div class=\"mbadge\" id=\"mBadge\">\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc</div>\n        <button class=\"nav-btn\" id=\"btnNotif\" onclick=\"showPanel('notif')\" title=\"\u901a\u77e5\">\n          \ud83d\udd14<div class=\"notif-dot\" id=\"notifDot\"></div>\n        </button>\n        <button class=\"nav-btn\" id=\"btnTrend\" onclick=\"showPanel('trends')\" title=\"\u30c8\u30ec\u30f3\u30c9\">\ud83d\udcc8</button>\n        <button class=\"nav-btn\" id=\"btnProfile\" onclick=\"showPanel('profile')\" title=\"\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\">\ud83d\udc64</button>\n      </div>\n    </div>\n    <div class=\"m-tabs\">\n      <button class=\"m-tab ai\" data-mode=\"influencer\" onclick=\"switchMode('influencer',this)\">\ud83d\udd25 \u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc</button>\n      <button class=\"m-tab\" data-mode=\"mental\" onclick=\"switchMode('mental',this)\">\ud83d\udc99 \u30e1\u30f3\u30bf\u30eb\u30b1\u30a2</button>\n      <button class=\"m-tab\" data-mode=\"debate\" onclick=\"switchMode('debate',this)\">\u26a1 \u30c7\u30a3\u30d9\u30fc\u30c8</button>\n      <button class=\"m-tab\" data-mode=\"legend\" onclick=\"switchMode('legend',this)\">\ud83d\udc51 \u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af</button>\n    </div>\n  </div>\n  <div class=\"m-hint\" id=\"mHint\"><strong>\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc\u30e2\u30fc\u30c9</strong>\uff1a\u3042\u306a\u305f\u306e\u6295\u7a3f\u306b\u307f\u3093\u306a\u304c\u71b1\u72c2\uff01\u30d0\u30ba\u308a\u4f53\u9a13\u3092\u3069\u3046\u305e\ud83d\udd25</div>\n\n  <div class=\"panel on\" id=\"tlPanel\"></div>\n\n  <div class=\"panel\" id=\"notifPanel\">\n    <div class=\"notif-hdr\">\n      <h2>\ud83d\udd14 \u901a\u77e5</h2>\n      <button class=\"notif-clr\" onclick=\"clearNotifs()\">\u3059\u3079\u3066\u65e2\u8aad</button>\n    </div>\n    <div id=\"notifList\"></div>\n  </div>\n\n  <div class=\"panel\" id=\"trendsPanel\">\n    <div class=\"t-hdr\"><div class=\"t-title\">\ud83d\udcc8 \u30c8\u30ec\u30f3\u30c9</div></div>\n    <div id=\"trendsList\"></div>\n  </div>\n\n  <div class=\"panel\" id=\"profilePanel\">\n    <div class=\"pr-hero\">\n      <div class=\"pr-av\" id=\"prAv\">\ud83d\ude0a</div>\n      <div class=\"pr-info\">\n        <div class=\"pr-name\" id=\"prName\">\u2014</div>\n        <div class=\"pr-id\" id=\"prId\">@\u2014</div>\n        <div class=\"pr-stats\">\n          <div class=\"stat\"><div class=\"stat-n\" id=\"stP\">0</div><div class=\"stat-l\">\u6295\u7a3f</div></div>\n          <div class=\"stat\"><div class=\"stat-n\" id=\"stL\">0</div><div class=\"stat-l\">\u3044\u3044\u306d</div></div>\n          <div class=\"stat\"><div class=\"stat-n\" id=\"stC\">0</div><div class=\"stat-l\">\u30b3\u30e1\u30f3\u30c8</div></div>\n        </div>\n      </div>\n    </div>\n    <div class=\"pr-ints\">\n      <div class=\"pi-ttl\">INTERESTS</div>\n      <div class=\"pi-tags\" id=\"prInts\"></div>\n    </div>\n    <div class=\"pr-acts\">\n      <button class=\"pr-btn\" onclick=\"editProfile()\">\u270f\ufe0f \u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\u3092\u7de8\u96c6</button>\n      <button class=\"pr-btn danger\" onclick=\"clearAll()\">\ud83d\uddd1\ufe0f \u30c7\u30fc\u30bf\u3092\u3059\u3079\u3066\u524a\u9664</button>\n    </div>\n  </div>\n\n  <div class=\"compose\" id=\"composeBar\">\n    <div class=\"cmp-in\">\n      <div class=\"cmp-av\" id=\"cmpAv\">\ud83d\ude0a</div>\n      <textarea class=\"cmp-inp\" id=\"postInput\" placeholder=\"\u3044\u307e\u3069\u3093\u306a\u6c17\u6301\u3061\uff1f\" rows=\"1\"\n        oninput=\"autoResize(this)\" onkeydown=\"handleKey(event)\"></textarea>\n      <button class=\"snd-btn\" id=\"sendBtn\" onclick=\"submitPost()\" disabled>\u27a4</button>\n    </div>\n  </div>\n</div>\n\n</div><!-- /phone -->\n<div class=\"toast\" id=\"toast\"></div>\n\n<script>\n// ===== STORAGE =====\nconst SK = 'idobata_v4';\nlet user = {name:'',id:'',avatar:'\ud83d\ude0a',interests:[]};\nlet posts = [];\nlet trends = [];\nlet notifs = [];\nlet curMode = 'influencer';\nlet curPanel = 'timeline';\nlet busy = false;\nlet pidCtr = 0;\nlet selAvatar = '\ud83d\ude0a';\nlet likeTimers = [];\nlet unreadNotifs = 0;\n\n// ===== MODE CONFIG =====\nconst MODES = {\n  influencer:{badge:'\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc',hint:'<strong>\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc\u30e2\u30fc\u30c9</strong>\uff1a\u3042\u306a\u305f\u306e\u6295\u7a3f\u306b\u307f\u3093\u306a\u304c\u71b1\u72c2\uff01\u30d0\u30ba\u308a\u4f53\u9a13\u3092\u3069\u3046\u305e\ud83d\udd25',ph:'\u30d0\u30ba\u3089\u305b\u305f\u3044\u3053\u3068\u3092\u3064\u3076\u3084\u3044\u3066\uff01',acc:'#ff6b35',tc:'ai',tg:'ti'},\n  mental:{badge:'\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2',hint:'<strong>\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2\u30e2\u30fc\u30c9</strong>\uff1a\u8ab0\u306b\u3082\u8a00\u3048\u306a\u3044\u60a9\u307f\u3092\u305d\u3063\u3068\u8a71\u3057\u3066\u307f\u3066\ud83d\udc99',ph:'\u60a9\u307f\u3092\u5171\u6709\u2026',acc:'#5b9cf6',tc:'am',tg:'tm'},\n  debate:{badge:'\u30c7\u30a3\u30d9\u30fc\u30c8',hint:'<strong>\u30c7\u30a3\u30d9\u30fc\u30c8\u30e2\u30fc\u30c9</strong>\uff1a\u610f\u898b\u3092\u3076\u3064\u3051\u3088\u3046\u3002\u8b70\u8ad6\u3067\u601d\u8003\u3092\u6df1\u3081\u308b\u26a1',ph:'\u610f\u898b\u3092\u3076\u3064\u3051\u3088\u3046\uff01',acc:'#f43f5e',tc:'ad',tg:'td'},\n  legend:{badge:'\u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af',hint:'<strong>\u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af\u30e2\u30fc\u30c9</strong>\uff1a\u6b74\u53f2\u4e0a\u306e\u5049\u4eba\u305f\u3061\u3068\u8a9e\u308a\u5408\u304a\u3046\ud83d\udc51',ph:'\u6b74\u53f2\u4e0a\u306e\u4eba\u3068\u8a71\u305d\u3046\u2026',acc:'#a78bfa',tc:'al',tg:'tl'}\n};\n\n// ===== SETUP =====\nfunction selAv(el){document.querySelectorAll('.av-opt').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');selAvatar=el.dataset.av;}\nfunction togInt(el){el.classList.toggle('sel');}\nfunction chkSetup(){\n  const n=document.getElementById('sName').value.trim();\n  const i=document.getElementById('sId').value.trim();\n  document.getElementById('setupBtn').disabled=!(n&&i);\n}\n\nasync function doSetup(){\n  const name=document.getElementById('sName').value.trim();\n  const id='@'+document.getElementById('sId').value.trim().replace(/^@/,'');\n  const interests=[...document.querySelectorAll('.i-tag.sel')].map(e=>e.textContent.trim());\n  user={name,id,avatar:selAvatar,interests};\n  saveData();\n  await toMain(true);\n}\n\nasync function toMain(isNew=false){\n  document.getElementById('setupScreen').classList.remove('active');\n  document.getElementById('mainScreen').classList.add('active');\n  applyMode(curMode);\n  updCmpAv();\n  renderPosts();\n  renderTrends();\n  updProfile();\n  renderNotifs();\n\n  if(isNew){\n    requestNotifPerm();\n    await loadAITimeline();\n  }\n  hideLoading();\n}\n\n// ===== AI TIMELINE ON STARTUP =====\nasync function loadAITimeline(){\n  if(user.interests.length === 0) return;\n  showLoading('\u3042\u306a\u305f\u306e\u8da3\u5473\u306b\u5408\u308f\u305b\u305f\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u3092\u6e96\u5099\u4e2d\u2026');\n  try{\n    const res = await fetch('/api/timeline', {\n      method:'POST', headers:{'Content-Type':'application/json'},\n      body: JSON.stringify({interests: user.interests, mode: curMode})\n    });\n    // ★修正: HTTPステータスを確認\n    if (!res.ok) throw new Error('HTTP ' + res.status);\n    const data = await res.json();\n    if(data.posts && data.posts.length > 0){\n      data.posts.forEach(r => {\n        const p = {\n          id:++pidCtr, type:'ai', text:r.comment, name:r.name, uid:r.id||'',\n          avatar:r.avatar||'\ud83c\udf1f', mode:curMode, tg:MODES[curMode].tg,\n          likes:r.likes||Math.floor(Math.random()*5000)+10,\n          liked:false, comments:[], ts:Date.now()\n        };\n        posts.push(p);\n      });\n      renderPosts();\n      scrollBot();\n      saveData();\n      startLikeSimulation();\n    }\n  }catch(e){\n    console.warn('Timeline load failed:', e);\n  }\n  hideLoading();\n}\n\n// ===== PANEL NAV =====\nfunction showPanel(p){\n  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('on'));\n  curPanel=p;\n  const map={timeline:'tlPanel',notif:'notifPanel',trends:'trendsPanel',profile:'profilePanel'};\n  document.getElementById(map[p]||'tlPanel').classList.add('on');\n  document.getElementById('composeBar').style.display=p==='timeline'?'':'none';\n  ['btnNotif','btnTrend','btnProfile'].forEach(id=>document.getElementById(id).classList.remove('on'));\n  if(p==='notif'){\n    document.getElementById('btnNotif').classList.add('on');\n    markNotifsRead();\n    renderNotifs();\n  }\n  if(p==='trends'){document.getElementById('btnTrend').classList.add('on');renderTrends();}\n  if(p==='profile'){document.getElementById('btnProfile').classList.add('on');updProfile();}\n}\n\n// ===== MODE =====\nfunction switchMode(mode,btn){\n  curMode=mode;\n  applyMode(mode);\n  document.querySelectorAll('.m-tab').forEach(t=>t.className='m-tab');\n  btn.classList.add(MODES[mode].tc);\n  showPanel('timeline');\n}\nfunction applyMode(mode){\n  const m=MODES[mode];\n  document.documentElement.style.setProperty('--acc',m.acc);\n  document.getElementById('mBadge').textContent=m.badge;\n  document.getElementById('mHint').innerHTML=m.hint;\n  const inp=document.getElementById('postInput');\n  if(inp)inp.placeholder=m.ph;\n  updCmpAv();\n}\nfunction updCmpAv(){\n  const el=document.getElementById('cmpAv');\n  if(el){el.textContent=user.avatar||'\ud83d\ude0a';el.style.borderColor=MODES[curMode].acc;}\n}\n\n// ===== COMPOSE =====\nfunction autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px';}\nfunction handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const sb=document.getElementById('sendBtn');if(!sb.disabled)submitPost();}}\n\ndocument.addEventListener('DOMContentLoaded',()=>{\n  const ta=document.getElementById('postInput');\n  if(ta)ta.addEventListener('input',()=>{document.getElementById('sendBtn').disabled=ta.value.trim()===''||busy;});\n});\n\nasync function submitPost(){\n  const ta=document.getElementById('postInput');\n  const text=ta.value.trim();if(!text||busy)return;\n  busy=true;document.getElementById('sendBtn').disabled=true;\n  ta.value='';ta.style.height='auto';\n  showPanel('timeline');\n\n  const pid=++pidCtr;\n  const up={id:pid,type:'user',text,name:user.name,uid:user.id,avatar:user.avatar,\n    mode:curMode,tg:'',likes:0,liked:false,comments:[],ts:Date.now()};\n  posts.push(up);\n  renderPosts();\n\n  const lids=['a','b','c'].map(x=>`ld-${pid}-${x}`);\n  lids.forEach(lid=>addLoadCard(lid));\n  scrollBot();\n\n  try{\n    const res = await fetch('/api/reply',{\n      method:'POST',headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({text,mode:curMode,interests:user.interests})\n    });\n\n    // ★修正: HTTPエラー(429 レート制限含む)を明示的にthrow\n    if (!res.ok) {\n      if (res.status === 429) throw new Error('RATE_LIMIT');\n      throw new Error('HTTP_' + res.status);\n    }\n\n    const data = await res.json();\n    const replies = data.replies || [];\n\n    // ★修正: repliesが空配列でもフォールバックへ\n    if (replies.length === 0) throw new Error('EMPTY_REPLY');\n\n    lids.forEach(lid=>{const e=document.getElementById(lid);if(e)e.remove();});\n    replies.forEach((r,i)=>{\n      const ap={id:++pidCtr,type:'ai',text:r.comment,name:r.name,uid:r.id||'',\n        avatar:r.avatar||'\ud83e\udd16',mode:curMode,tg:MODES[curMode].tg,\n        likes:r.likes||Math.floor(Math.random()*5000)+10,\n        liked:false,comments:[],ts:Date.now()+i};\n      posts.push(ap);\n      setTimeout(()=>{appendCard(ap);scrollBot();},i*250);\n    });\n\n    addHashtags(text);\n    setTimeout(()=>{saveData();renderTrends();},1500);\n    scheduleAutoLikes(pid);\n\n  }catch(err){\n    lids.forEach(lid=>{const e=document.getElementById(lid);if(e)e.remove();});\n    if (err.message === 'RATE_LIMIT') {\n      toast('\u26a0\ufe0f \u9001\u4fe1\u9593\u9694\u304c\u77ed\u3059\u304e\u307e\u3059\u3002\u5c11\u3057\u5f85\u3063\u3066\u304f\u3060\u3055\u3044');\n    } else {\n      console.warn('API error, using fallback:', err.message);\n      getFallback(curMode).forEach((r,i)=>{\n        const ap={id:++pidCtr,type:'ai',text:r.comment,name:r.name,uid:r.id||'',\n          avatar:r.avatar||'\ud83e\udd16',mode:curMode,tg:MODES[curMode].tg,\n          likes:r.likes||99,liked:false,comments:[],ts:Date.now()+i};\n        posts.push(ap);\n        setTimeout(()=>{appendCard(ap);scrollBot();},i*250);\n      });\n    }\n    scheduleAutoLikes(pid);\n    saveData();\n  }\n\n  busy=false;\n  document.getElementById('sendBtn').disabled=document.getElementById('postInput').value.trim()==='';\n  saveData();\n}\n\n// ===== AUTO LIKES SIMULATION =====\nconst AI_NAMES = ['\u8c61\u306e\u308a\u9020','\u7b4b\u8089\u5bff\u559c\u7537','\u30c1\u30ef\u30ef\u306b\u306a\u308a\u305f\u3044\u72ac','\u30d1\u30bd\u30b3\u30f3\u3081\u304c\u306d','\u3054\u98ef\u529b\u58eb','\u3089\u304f\u3060\u5c0f\u50e7','\u30bf\u30e9\u30d0\u30ac\u30cb','\u30d6\u30c3\u30c0','\u30bd\u30af\u30e9\u30c6\u30b9','\u5948\u826f\u3067\u9e7f\u3084\u3063\u3066\u307e\u3059','\u30e1\u30ed\u30f3\u30bd\u30fc\u30c0','\u30ed\u30dc\u30c3\u30c8\u30ea\u30ad\u30b7','\u7a7a\u304d\u5730\u306e\u54f2\u5b66\u8005','\u6df1\u591c\u306e\u4e3b\u5a66','\u5bdd\u8d77\u304d\u306e\u5927\u5b66\u751f'];\n\nfunction scheduleAutoLikes(postId){\n  const schedule = [\n    {delay: 30000, min:1, max:8},\n    {delay: 90000, min:5, max:30},\n    {delay: 180000, min:10, max:80},\n    {delay: 360000, min:20, max:200},\n    {delay: 600000, min:50, max:500},\n  ];\n  schedule.forEach(({delay, min, max}) => {\n    const t = setTimeout(()=>{\n      const count = Math.floor(Math.random()*(max-min)+min);\n      applyAutoLike(postId, count);\n    }, delay + Math.random()*30000);\n    likeTimers.push(t);\n  });\n}\n\nfunction applyAutoLike(postId, count){\n  const post = posts.find(p=>p.id===postId);\n  if(!post) return;\n\n  post.likes += count;\n  const lcEl = document.getElementById('lc-'+postId);\n  if(lcEl){ lcEl.textContent = fmt(post.likes); }\n  const lb = document.getElementById('lb-'+postId);\n  if(lb){ lb.classList.add('like-pop'); setTimeout(()=>lb.classList.remove('like-pop'),400); }\n\n  const notifierName = AI_NAMES[Math.floor(Math.random()*AI_NAMES.length)];\n  const msg = count >= 50\n    ? `\ud83d\udd25 ${notifierName}\u3055\u3093\u307b\u304b${fmt(count)}\u4eba\u304c\u3042\u306a\u305f\u306e\u6295\u7a3f\u3092\u3044\u3044\u306d\u3057\u307e\u3057\u305f\uff01`\n    : `\u2764\ufe0f ${notifierName}\u3055\u3093\u304c\u3042\u306a\u305f\u306e\u6295\u7a3f\u306b\u3044\u3044\u306d\u3057\u307e\u3057\u305f`;\n\n  addNotif(msg, post.text);\n  pushBrowserNotif('\u3044\u3069\u3070\u305f\u901a\u77e5', msg);\n  showLikeFloat();\n  saveData();\n}\n\nfunction showLikeFloat(){\n  const el = document.createElement('div');\n  el.className = 'like-float';\n  el.textContent = '\u2764\ufe0f';\n  el.style.left = (100 + Math.random()*180) + 'px';\n  el.style.bottom = '100px';\n  document.getElementById('app').appendChild(el);\n  setTimeout(()=>el.remove(), 1300);\n}\n\nfunction startLikeSimulation(){\n  const t = setInterval(()=>{\n    const myPosts = posts.filter(p=>p.type==='user');\n    if(myPosts.length===0) return;\n    const target = myPosts[Math.floor(Math.random()*myPosts.length)];\n    const count = Math.floor(Math.random()*50)+1;\n    applyAutoLike(target.id, count);\n  }, 120000 + Math.random()*120000);\n  likeTimers.push(t);\n}\n\n// ===== NOTIFICATIONS =====\nfunction requestNotifPerm(){\n  if('Notification' in window && Notification.permission === 'default'){\n    Notification.requestPermission();\n  }\n}\n\nfunction pushBrowserNotif(title, body){\n  if('Notification' in window && Notification.permission === 'granted'){\n    try{ new Notification(title, {body, icon:'/favicon.ico'}); }catch(e){}\n  }\n}\n\nfunction addNotif(text, postText=''){\n  notifs.unshift({text, postText:postText.slice(0,30)+(postText.length>30?'\u2026':''), ts:Date.now(), read:false});\n  unreadNotifs++;\n  document.getElementById('notifDot').classList.add('show');\n  if(curPanel==='notif') renderNotifs();\n  saveData();\n}\n\nfunction renderNotifs(){\n  const list = document.getElementById('notifList');\n  if(notifs.length===0){\n    list.innerHTML='<div class=\"no-notif\">\u307e\u3060\u901a\u77e5\u306f\u3042\u308a\u307e\u305b\u3093</div>';\n    return;\n  }\n  list.innerHTML = notifs.slice(0,30).map(n=>`\n    <div class=\"notif-item${n.read?'':' unread'}\">\n      <div class=\"notif-ico\">${n.text.startsWith('\ud83d\udd25')?'\ud83d\udd25':'\u2764\ufe0f'}</div>\n      <div class=\"notif-body\">\n        <div class=\"notif-text\">${esc(n.text)}</div>\n        ${n.postText?`<div class=\"notif-time\">\u300c${esc(n.postText)}\u300d\u3078\u306e\u53cd\u5fdc \u00b7 ${timeAgo(n.ts)}</div>`:`<div class=\"notif-time\">${timeAgo(n.ts)}</div>`}\n      </div>\n    </div>`).join('');\n}\n\nfunction markNotifsRead(){\n  notifs.forEach(n=>n.read=true);\n  unreadNotifs=0;\n  document.getElementById('notifDot').classList.remove('show');\n  saveData();\n}\n\nfunction clearNotifs(){\n  notifs=[];unreadNotifs=0;\n  document.getElementById('notifDot').classList.remove('show');\n  renderNotifs();\n  saveData();\n}\n\nfunction timeAgo(ts){\n  const s = Math.floor((Date.now()-ts)/1000);\n  if(s<60)return`${s}\u79d2\u524d`;if(s<3600)return`${Math.floor(s/60)}\u5206\u524d`;\n  if(s<86400)return`${Math.floor(s/3600)}\u6642\u9593\u524d`;return`${Math.floor(s/86400)}\u65e5\u524d`;\n}\n\n// ===== RENDER POSTS =====\nfunction renderPosts(){\n  const panel=document.getElementById('tlPanel');\n  panel.innerHTML='';\n  if(posts.length===0){\n    panel.innerHTML='<div class=\"empty\"><div class=\"e-ico\">\ud83e\udea3</div><div class=\"e-ttl\">\u4e95\u6238\u7aef\u4f1a\u8b70\u3078\u3088\u3046\u3053\u305d\uff01</div><div class=\"e-txt\">\u4f55\u3067\u3082\u3064\u3076\u3084\u3044\u3066\u307f\u3088\u3046\u3002<br>AI\u305f\u3061\u304c\u5fc5\u305a\u53cd\u5fdc\u3057\u3066\u304f\u308c\u308b\u3088\u2728</div></div>';\n    return;\n  }\n  posts.forEach(p=>appendCard(p,false));\n}\n\nfunction appendCard(p,anim=true){\n  const panel=document.getElementById('tlPanel');\n  const empty=panel.querySelector('.empty');if(empty)empty.remove();\n  const div=document.createElement('div');\n  div.className='post-card'+(p.type==='user'?' up':'');\n  div.id='pc-'+p.id;\n  if(!anim)div.style.animationDuration='0s';\n  const nc=p.type==='user'?'style=\"color:var(--acc)\"':'';\n  const tg=p.tg?`<span class=\"ai-tag ${p.tg}\">${MODES[p.mode]?.badge||''}</span>`:'';\n  const liIco=p.liked?'\u2764\ufe0f':'\ud83e\udd0d';\n  div.innerHTML=`\n    <div class=\"p-hd\">\n      <div class=\"av${p.type==='user'?' u':''}\">${p.avatar}</div>\n      <div class=\"p-mt\">\n        <div class=\"m-row\">\n          <span class=\"p-name\" ${nc}>${esc(p.name)}</span>\n          <span class=\"p-id\">${esc(p.uid)}</span>${tg}\n        </div>\n      </div>\n    </div>\n    <div class=\"p-body\">${esc(p.text)}</div>\n    <div class=\"p-acts\">\n      <button class=\"act-btn\" onclick=\"togCmt(${p.id})\"><span class=\"act-icon\">\ud83d\udcac</span> <span id=\"cc-${p.id}\">${p.comments?.length||0}</span></button>\n      <button class=\"act-btn${p.liked?' liked':''}\" id=\"lb-${p.id}\" onclick=\"togLike(${p.id})\"><span class=\"act-icon\">${liIco}</span> <span id=\"lc-${p.id}\">${fmt(p.likes)}</span></button>\n    </div>\n    <div class=\"cmt-wrap\" id=\"cw-${p.id}\">\n      <div id=\"cl-${p.id}\">${renderCmts(p.comments)}</div>\n      <div class=\"cmt-add\">\n        <input class=\"cmt-inp\" id=\"ci-${p.id}\" placeholder=\"\u30b3\u30e1\u30f3\u30c8\u3092\u5165\u529b\u2026\" onkeydown=\"cmtKey(event,${p.id})\">\n        <button class=\"cmt-snd\" onclick=\"addCmt(${p.id})\">\u27a4</button>\n      </div>\n    </div>`;\n  panel.appendChild(div);\n}\n\nfunction addLoadCard(lid){\n  const panel=document.getElementById('tlPanel');\n  const empty=panel.querySelector('.empty');if(empty)empty.remove();\n  const div=document.createElement('div');div.className='post-card';div.id=lid;\n  div.innerHTML='<div class=\"p-hd\"><div class=\"av\">\u23f3</div><div class=\"p-mt\"><div class=\"m-row\"><span class=\"p-name\" style=\"color:var(--sub)\">\u8003\u3048\u4e2d\u2026</span></div></div></div><div class=\"typing\"><div class=\"dot\"></div><div class=\"dot\"></div><div class=\"dot\"></div></div>';\n  panel.appendChild(div);\n}\n\nfunction renderCmts(cmts){\n  if(!cmts||!cmts.length)return'';\n  return cmts.map(c=>`<div class=\"cmt-item\"><div class=\"cmt-author\">${esc(c.a)}</div>${esc(c.t)}</div>`).join('');\n}\n\n// ===== INTERACTIONS =====\nfunction togLike(pid){\n  const p=posts.find(x=>x.id===pid);if(!p)return;\n  p.liked=!p.liked;p.likes+=p.liked?1:-1;\n  const btn=document.getElementById('lb-'+pid);\n  if(btn){btn.className='act-btn'+(p.liked?' liked':'');btn.innerHTML=`<span class=\"act-icon\">${p.liked?'\u2764\ufe0f':'\ud83e\udd0d'}</span> <span id=\"lc-${pid}\">${fmt(p.likes)}</span>`;}\n  if(p.liked) showLikeFloat();\n  saveData();\n}\n\nfunction togCmt(pid){const cw=document.getElementById('cw-'+pid);if(cw)cw.classList.toggle('open');}\nfunction cmtKey(e,pid){if(e.key==='Enter')addCmt(pid);}\nfunction addCmt(pid){\n  const inp=document.getElementById('ci-'+pid);if(!inp)return;\n  const t=inp.value.trim();if(!t)return;\n  const p=posts.find(x=>x.id===pid);if(!p)return;\n  p.comments.push({a:user.name||'\u3042\u306a\u305f',t});\n  inp.value='';\n  const cl=document.getElementById('cl-'+pid);if(cl)cl.innerHTML=renderCmts(p.comments);\n  const cc=document.getElementById('cc-'+pid);if(cc)cc.textContent=p.comments.length;\n  saveData();toast('\ud83d\udcac \u30b3\u30e1\u30f3\u30c8\u3057\u307e\u3057\u305f\uff01');\n}\n\n// ===== TRENDS =====\nconst DEF_TRENDS=[\n  {tag:'#\u3044\u3069\u3070\u305f',cnt:9821,mode:'influencer'},\n  {tag:'#\u5375\u304b\u3051\u3054\u98ef',cnt:4502,mode:'influencer'},\n  {tag:'#\u604b\u30d0\u30ca',cnt:3310,mode:'mental'},\n  {tag:'#TKG',cnt:2889,mode:'influencer'},\n  {tag:'#\u30d6\u30c3\u30c0',cnt:1740,mode:'legend'},\n  {tag:'#\u5bbf\u984c',cnt:933,mode:'debate'},\n  {tag:'#\u97f3\u697d',cnt:788,mode:'interest'},\n  {tag:'#\u3054\u306f\u3093',cnt:621,mode:'influencer'},\n  {tag:'#\u521d\u30c7\u30fc\u30c8',cnt:489,mode:'mental'},\n  {tag:'#\u6599\u7406',cnt:302,mode:'interest'},\n];\nfunction addHashtags(text){\n  (text.match(/#[\\w\\u3000-\\u9FFF\\uF900-\\uFAFF]+/g)||[]).forEach(tag=>{\n    const ex=trends.find(t=>t.tag===tag);\n    if(ex)ex.cnt++;else trends.push({tag,cnt:1,mode:curMode});\n  });\n}\nfunction renderTrends(){\n  DEF_TRENDS.forEach(d=>{if(!trends.find(t=>t.tag===d.tag))trends.push({...d});});\n  (user.interests||[]).forEach(int=>{\n    const tag='#'+int.replace(/^.+\\s/,'');\n    if(!trends.find(t=>t.tag===tag))trends.push({tag,cnt:Math.floor(Math.random()*200)+20,mode:'interest'});\n  });\n  const sorted=[...trends].sort((a,b)=>b.cnt-a.cnt).slice(0,15);\n  const mL={influencer:'\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc\u30e2\u30fc\u30c9',mental:'\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2\u30e2\u30fc\u30c9',debate:'\u30c7\u30a3\u30d9\u30fc\u30c8\u30e2\u30fc\u30c9',legend:'\u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af\u30e2\u30fc\u30c9',interest:'\u81ea\u5206\u306e\u8da3\u5473'};\n  document.getElementById('trendsList').innerHTML=sorted.map((t,i)=>`\n    <div class=\"t-item\" onclick=\"fromTrend('${t.tag}')\">\n      <div class=\"t-rank${i<3?' top':''}\">${i+1}</div>\n      <div class=\"t-con\"><div class=\"t-tag\">${esc(t.tag)}</div><div class=\"t-mode\">${mL[t.mode]||t.mode}</div></div>\n      <div class=\"t-cnt\">${fmt(t.cnt)}\u4ef6</div>\n    </div>`).join('');\n}\nfunction fromTrend(tag){\n  showPanel('timeline');\n  const inp=document.getElementById('postInput');\n  if(inp){inp.value=tag+' ';inp.focus();document.getElementById('sendBtn').disabled=false;}\n}\n\n// ===== PROFILE =====\nfunction updProfile(){\n  document.getElementById('prAv').textContent=user.avatar||'\ud83d\ude0a';\n  document.getElementById('prName').textContent=user.name||'\u2014';\n  document.getElementById('prId').textContent=user.id||'@\u2014';\n  document.getElementById('stP').textContent=posts.filter(p=>p.type==='user').length;\n  document.getElementById('stL').textContent=fmt(posts.reduce((s,p)=>s+(p.liked?1:0),0));\n  document.getElementById('stC').textContent=posts.reduce((s,p)=>s+(p.comments?.length||0),0);\n  const pi=document.getElementById('prInts');\n  pi.innerHTML=(user.interests||[]).map(i=>`<div class=\"pi-tag\">${esc(i)}</div>`).join('')||'<span style=\"color:var(--sub);font-size:13px;\">\u672a\u8a2d\u5b9a</span>';\n}\nfunction editProfile(){\n  document.getElementById('sName').value=user.name;\n  document.getElementById('sId').value=user.id.replace('@','');\n  document.querySelectorAll('.av-opt').forEach(e=>e.classList.toggle('sel',e.dataset.av===user.avatar));\n  document.querySelectorAll('.i-tag').forEach(e=>e.classList.toggle('sel',user.interests.includes(e.textContent.trim())));\n  selAvatar=user.avatar;\n  document.getElementById('setupBtn').textContent='\u66f4\u65b0\u3059\u308b \u2192';\n  document.getElementById('setupBtn').disabled=false;\n  document.getElementById('mainScreen').classList.remove('active');\n  document.getElementById('setupScreen').classList.add('active');\n}\nfunction clearAll(){\n  if(!confirm('\u3059\u3079\u3066\u306e\u30c7\u30fc\u30bf\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f'))return;\n  likeTimers.forEach(t=>clearTimeout(t));likeTimers=[];\n  localStorage.removeItem(SK);\n  posts=[];trends=[];notifs=[];pidCtr=0;unreadNotifs=0;\n  user={name:'',id:'',avatar:'\ud83d\ude0a',interests:[]};\n  document.getElementById('mainScreen').classList.remove('active');\n  document.getElementById('setupScreen').classList.add('active');\n  ['sName','sId'].forEach(id=>document.getElementById(id).value='');\n  document.getElementById('setupBtn').disabled=true;\n  document.getElementById('setupBtn').textContent='\u3044\u3069\u3070\u305f\u3092\u306f\u3058\u3081\u308b \u2192';\n  document.querySelectorAll('.i-tag,.av-opt').forEach(e=>e.classList.remove('sel'));\n  document.querySelector('.av-opt').classList.add('sel');\n  selAvatar='\ud83d\ude0a';\n}\n\n// ===== SAVE/LOAD =====\nfunction saveData(){\n  try{localStorage.setItem(SK,JSON.stringify({user,posts,trends,notifs,pidCtr,curMode,unreadNotifs}));}catch(e){}\n}\nfunction loadData(){\n  try{\n    const raw=localStorage.getItem(SK);if(!raw)return false;\n    const d=JSON.parse(raw);\n    user=d.user||user;posts=d.posts||[];trends=d.trends||[];\n    notifs=d.notifs||[];pidCtr=d.pidCtr||posts.length;\n    curMode=d.curMode||'influencer';unreadNotifs=d.unreadNotifs||0;\n    return true;\n  }catch(e){return false;}\n}\n\n// ===== UTILS =====\nfunction scrollBot(){const p=document.getElementById('tlPanel');if(p)setTimeout(()=>{p.scrollTop=p.scrollHeight;},120);}\nfunction fmt(n){n=Number(n)||0;if(n>=10000)return(n/10000).toFixed(1)+'\u4e07';return n.toLocaleString();}\nfunction esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>');}\nfunction toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200);}\nfunction showLoading(txt=''){document.getElementById('loadingOverlay').classList.remove('hide');if(txt)document.getElementById('loadingTxt').textContent=txt;}\nfunction hideLoading(){document.getElementById('loadingOverlay').classList.add('hide');}\n\nfunction getFallback(mode){\n  const sets={\n    influencer:[\n      {name:'\u8c61\u306e\u308a\u9020',id:'@zou_norizoo',avatar:'\ud83d\udc18',comment:'\u3053\u308c\u306f\u30d0\u30ba\u308b\u3084\u3064\uff01\uff01\u5b8c\u5168\u306b\u540c\u610f\u3067\u3059\ud83d\udd25',likes:2341},\n      {name:'\u7b4b\u8089\u5bff\u559c\u7537',id:'@kinniku_sukio',avatar:'\ud83d\udcaa',comment:'\u3081\u3061\u3083\u304f\u3061\u3083\u308f\u304b\u308b\u301c\uff01\u6bce\u65e5\u3053\u308c\u601d\u3063\u3066\u305f\u7b11',likes:887},\n      {name:'\u30c1\u30ef\u30ef\u306b\u306a\u308a\u305f\u3044\u72ac',id:'@want_to_be_chiwawa',avatar:'\ud83d\udc15',comment:'\u5929\u624d\u304b\uff1f\uff1f\u3053\u308cSNS\u306b\u6d41\u3057\u3066\u6b32\u3057\u3044',likes:321},\n    ],\n    mental:[\n      {name:'\u30d1\u30bd\u30b3\u30f3\u3081\u304c\u306d',id:'@pasokon_megane',avatar:'\ud83d\udc53',comment:'\u305d\u308c\u3001\u3059\u3054\u304f\u8f9b\u304b\u3063\u305f\u306d\u3002\u8a71\u3057\u3066\u304f\u308c\u3066\u3042\u308a\u304c\u3068\u3046\u3002',likes:102},\n      {name:'\u3054\u98ef\u529b\u58eb',id:'@gohaan_rikishi',avatar:'\ud83c\udf5a',comment:'\u3042\u306a\u305f\u306e\u6c17\u6301\u3061\u3001\u3061\u3083\u3093\u3068\u53d7\u3051\u53d6\u3063\u305f\u3088\u3002\u7121\u7406\u3057\u306a\u3044\u3067\u306d\u3002',likes:580},\n      {name:'\u30ed\u30dc\u30c3\u30c8\u30ea\u30ad\u30b7',id:'@robo_riki',avatar:'\ud83e\udd16',comment:'\u884c\u52d5\u3057\u306a\u304d\u3083\u59cb\u307e\u3089\u306a\u3044\u3088\uff01\u5fdc\u63f4\u3057\u3066\u308b\uff01\uff01\uff01\uff01\uff01',likes:30000},\n    ],\n    debate:[\n      {name:'\u3089\u304f\u3060\u5c0f\u50e7',id:'@rakuda_kozoo',avatar:'\ud83d\udc2a',comment:'\u4e00\u5ea6\u306f\u81ea\u5206\u3067\u8003\u3048\u308b\u3053\u3068\u3092\u304a\u52e7\u3081\u3057\u307e\u3059\uff01\u7b54\u3048\u306f\u81ea\u5206\u306e\u4e2d\u306b\u3042\u308a\u307e\u3059\u3002',likes:1572},\n      {name:'\u5f37\u9762\u304a\u3058\u3055\u3093',id:'@kowamote_ozi',avatar:'\ud83d\ude24',comment:'\u666e\u901a\u306b\u3084\u3063\u3066\u3066\u3082\u610f\u5473\u306a\u3044\u3063\u3066\u601d\u3063\u305f\u3089AI\u306b\u4e38\u6295\u3052\u3067\u3082\u3088\u304f\u306d\u3002',likes:294},\n      {name:'\u30bf\u30e9\u30d0\u30ac\u30cb',id:'@tarabagani_1726',avatar:'\ud83e\udd80',comment:'AI\u306f\u305f\u307e\u306b\u9593\u9055\u3046\u3057\u3001\u5206\u304b\u3089\u3093\u554f\u984c\u306f\u6559\u79d1\u66f8\u3067\u8abf\u3079\u308b\u3068\u304b\u304c\u304a\u3059\u3059\u3081\u3002',likes:423},\n    ],\n    legend:[\n      {name:'\u30d6\u30c3\u30c0',id:'@buddha',avatar:'\ud83e\uddd8',comment:'\u300c\u3044\u3044\u306d\u300d\u304c\u6b32\u3057\u304f\u3066\u5fc3\u304c\u3056\u308f\u3064\u304f\u306a\u3089\u3001\u30b9\u30de\u30db\u3092\u7f6e\u3044\u3066\u76ee\u3092\u9589\u3058\u306a\u3055\u3044\u3002\u4eca\u306e\u547c\u5438\u306e\u6570\u3092\u78ba\u8a8d\u3059\u308b\u306e\u3067\u3059\u3002',likes:78000},\n      {name:'\u30bd\u30af\u30e9\u30c6\u30b9',id:'@socrates',avatar:'\ud83c\udfdb\ufe0f',comment:'\u300c\u6b63\u7fa9\u300d\u306b\u3064\u3044\u3066\u8a9e\u308b\u7686\u3055\u3093\u306b\u805e\u304d\u305f\u3044\u3002\u6b63\u7fa9\u3068\u306f\u4f55\u3067\u3059\u304b\uff1f\u8ab0\u304b\u79c1\u306b\u6559\u3048\u3066\u304f\u308c\u307e\u305b\u3093\u304b\uff1f',likes:990},\n      {name:'\u5fb3\u5ddd\u5bb6\u5eb7',id:'@ieyasu_tokugawa',avatar:'\u2694\ufe0f',comment:'\u4eba\u751f\u306f\u91cd\u8377\u3092\u8ca0\u3046\u3066\u9060\u304d\u9053\u3092\u884c\u304f\u5982\u3057\u3002\u6025\u3050\u3079\u304b\u3089\u305a\u3002#\u5fcd\u8010 #\u5065\u5eb7\u7b2c\u4e00',likes:30000},\n    ]\n  };\n  return sets[mode]||sets.influencer;\n}\n\n// ===== INIT =====\n(function(){\n  showLoading('\u8d77\u52d5\u4e2d\u2026');\n  const ok=loadData();\n  if(ok&&user.name&&user.id){\n    toMain(false).then(()=>{\n      if(unreadNotifs>0) document.getElementById('notifDot').classList.add('show');\n      if(posts.some(p=>p.type==='user')) startLikeSimulation();\n      const m=MODES[curMode];\n      document.documentElement.style.setProperty('--acc',m.acc);\n      document.querySelectorAll('.m-tab').forEach(t=>t.className='m-tab');\n      const activeTab=document.querySelector(`.m-tab[data-mode=\"${curMode}\"]`);\n      if(activeTab)activeTab.classList.add(m.tc);\n    });\n  }else{\n    hideLoading();\n    document.getElementById('setupScreen').classList.add('active');\n  }\n  const ta=document.getElementById('postInput');\n  if(ta)ta.addEventListener('input',()=>{document.getElementById('sendBtn').disabled=ta.value.trim()===''||busy;});\n\n  let hiddenAt=null;\n  document.addEventListener('visibilitychange',()=>{\n    if(document.hidden){hiddenAt=Date.now();}\n    else if(hiddenAt){\n      const elapsed=Date.now()-hiddenAt;hiddenAt=null;\n      if(elapsed>10000){\n        const myPosts=posts.filter(p=>p.type==='user');\n        if(myPosts.length===0)return;\n        const mins=Math.max(1,Math.floor(elapsed/60000));\n        myPosts.forEach(post=>{\n          const count=Math.floor(Math.random()*mins*40)+mins*2;\n          applyAutoLike(post.id,count);\n        });\n      }\n    }\n  });\n})();\n</script>\n</body>\n</html>\n";

// ===== ユーティリティ =====
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(_){ resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // レート制限情報をヘッダーで返す
    ...(status === 429 ? { 'Retry-After': '60' } : {})
  });
  res.end(body);
}

function httpsPost(hostname, reqPath, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = https.request(
      { hostname, path: reqPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers } },
      (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
            return;
          }
          try { resolve(JSON.parse(raw)); }
          catch(e) { reject(new Error('JSONパース失敗: ' + raw.slice(0, 200))); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ===== ★修正: parseAI — 多段階フォールバックで堅牢に =====
function parseAI(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('AIから空のレスポンスが返りました');
  }

  // Step1: コードフェンス・前後の余分な文字を除去
  let cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Step2: まず JSON 配列としてそのままパースを試みる
  try {
    const result = JSON.parse(cleaned);
    // 配列ならそのまま返す
    if (Array.isArray(result)) return result;
    // オブジェクトで replies/posts キーがある場合はその配列を返す
    if (result && Array.isArray(result.replies)) return result.replies;
    if (result && Array.isArray(result.posts))   return result.posts;
    // それ以外のオブジェクトは単体なので配列に包む
    if (result && typeof result === 'object') return [result];
  } catch (_) {
    // Step2 失敗 → Step3へ
  }

  // Step3: 文字列中から [...] を正規表現で抽出して再パース
  const arrMatch = cleaned.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    try {
      const result = JSON.parse(arrMatch[0]);
      if (Array.isArray(result) && result.length > 0) return result;
    } catch (_) {
      // Step3 失敗 → Step4へ
    }
  }

  // Step4: 個々のオブジェクト {} を全部拾って配列を組み立てる
  const objects = [];
  const objRegex = /\{[^{}]*\}/g;
  let match;
  while ((match = objRegex.exec(cleaned)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && (obj.name || obj.comment)) objects.push(obj);
    } catch (_) { /* 無視 */ }
  }
  if (objects.length > 0) return objects;

  // 全ステップ失敗
  throw new Error(`AIレスポンスをJSONとして解釈できませんでした: ${raw.slice(0, 200)}`);
}

// ===== AI呼び出し =====
async function callOpenAI(sys, userMsg) {
  const d = await httpsPost('api.openai.com', '/v1/chat/completions',
    { Authorization: 'Bearer ' + OPENAI_KEY },
    {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user',   content: userMsg }
      ],
      // ★ JSON モードを有効化: より確実なJSON出力
      response_format: { type: 'json_object' },
      max_tokens: 1200,
      temperature: 0.9
    });
  const text = d.choices?.[0]?.message?.content || '{}';
  // json_objectモードはオブジェクトを返すので、中の配列を取り出す
  let parsed;
  try { parsed = JSON.parse(text); } catch(_) { return parseAI(text); }
  // replies / posts / items など最初に見つかった配列を返す
  for (const key of Object.keys(parsed)) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  return parseAI(text);
}

async function callGemini(sys, userMsg) {
  const d = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {},
    {
      // ★ systemInstruction を使い、システムプロンプトを明確に分離
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ parts: [{ text: userMsg }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 1200,
        // ★ JSON出力を強制
        responseMimeType: 'application/json'
      }
    }
  );
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  return parseAI(text);
}

async function callAI(sys, userMsg) {
  if (AI_PROVIDER === 'gemini' && GEMINI_KEY) return callGemini(sys, userMsg);
  if (OPENAI_KEY) return callOpenAI(sys, userMsg);
  throw new Error('APIキーが設定されていません (OPENAI_API_KEY または GEMINI_API_KEY を設定してください)');
}

// ===== プロンプト =====
// ★修正: postText を引数に追加し、投稿内容をプロンプトに直接埋め込む
function replyPrompt(mode, interests, postText) {
  const int = interests.length ? interests.join('、') : '未設定';

  // モードごとのキャラクター設定と返信スタイル
  const modeConfig = {
    influencer: {
      desc: '熱狂的なSNSユーザー3〜5人',
      style: '上記の投稿を絶賛・共感・拡散したがる反応。投稿の具体的な内容（キーワード・話題）に直接言及すること。バズりそうなコメントで盛り上げる。likes:100〜99999。',
    },
    mental: {
      desc: '優しく共感してくれる3〜4人',
      style: '上記の投稿の悩みや気持ちに寄り添い、投稿の具体的な内容を受け止めて温かく返す。「それは辛かったね」「わかるよ」など共感の言葉を含める。likes:10〜2000。',
    },
    debate: {
      desc: '賛成派・反対派・中立派が混在する3〜5人',
      style: '上記の投稿の主張や意見に対して、それぞれ異なる立場から具体的に反論・賛同・補足する。投稿のキーワードや論点を必ず使うこと。likes:10〜5000。',
    },
    legend: {
      desc: '歴史上の偉人3〜4人（名前とidは実在の人物にすること）',
      style: '上記の投稿テーマに関連した名言や哲学を交えて返信する。投稿の内容・テーマに具体的に言及し、その偉人らしい視点でコメントする。likes:1000〜100000。',
    },
  };

  const cfg = modeConfig[mode] || modeConfig.influencer;

  return `あなたは日本語SNS「いどばた」のAIキャラクター生成エンジンです。

【返信対象の投稿】
"${postText}"

【ユーザーの趣味】: ${int}

【登場キャラクター】: ${cfg.desc}
【返信スタイル】: ${cfg.style}

絶対ルール:
- 各キャラのcommentは必ず上記の【返信対象の投稿】の内容・キーワード・感情に直接反応すること
- 投稿と無関係な汎用コメント（「すごいですね！」だけなど）は禁止
- 返信は自然な日本語口語で、SNSらしい短め〜中程度の長さにすること

各キャラのフィールド: name(日本語), id(@英数字), avatar(絵文字1個), comment(返信文), likes(整数)
必ず {"replies": [...]} の形式のJSONのみ返してください。説明文は不要です。
例: {"replies":[{"name":"象のり造","id":"@zou","avatar":"🐘","comment":"これまじでわかる！昨日も同じこと思ってた笑","likes":2341}]}`;
}

function timelinePrompt(interests, mode) {
  const int = interests.length ? interests.join('、') : '未設定';
  return `あなたは日本語SNS「いどばた」のAIです。
趣味: ${int} / モード: ${mode}
趣味に関連したSNS投稿を6〜8件生成してください。
各投稿のフィールド: name, id(@英数字), avatar(絵文字1個), comment(ハッシュタグOK), likes(100〜50000)
必ず {"posts": [...]} の形式のJSONで返してください。説明文は不要です。`;
}

// ===== HTTPサーバー =====
http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const ip   = req.headers['x-forwarded-for']?.split(',')[0].trim()
             || req.socket.remoteAddress
             || 'unknown';

  res.setHeader('Access-Control-Allow-Origin', '*');

  // プリフライト
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  // ヘルスチェック
  if (path === '/api/health') {
    const hasKey = AI_PROVIDER === 'gemini' ? !!GEMINI_KEY : !!OPENAI_KEY;
    sendJSON(res, 200, { status: 'ok', provider: AI_PROVIDER, hasKey });
    return;
  }

  // ===== /api/reply =====
  if (req.method === 'POST' && path === '/api/reply') {

    // ★ レート制限チェック
    if (!checkRateLimit(ip)) {
      console.warn(`[rate-limit] IP: ${ip}`);
      sendJSON(res, 429, { error: 'リクエストが多すぎます。1分後に再試行してください。', replies: [] });
      return;
    }

    try {
      const { text, mode = 'influencer', interests = [] } = await readBody(req);
      if (!text) { sendJSON(res, 400, { error: 'text required', replies: [] }); return; }

      const vm = ['influencer','mental','debate','legend'].includes(mode) ? mode : 'influencer';
      console.log(`[reply] mode=${vm} ip=${ip} text="${text.slice(0,40)}"`);

      // ★修正: postTextをプロンプトに埋め込み、userMsgは指示のみにする
      const replies = await callAI(
        replyPrompt(vm, interests, text),
        '上記の投稿への返信キャラクターを生成してください。'
      );
      sendJSON(res, 200, { replies });
    } catch(e) {
      console.error('[reply error]', e.message);
      sendJSON(res, 500, { error: e.message, replies: [] });
    }
    return;
  }

  // ===== /api/timeline =====
  if (req.method === 'POST' && path === '/api/timeline') {

    // タイムラインにもレート制限を適用（replierより緩め: 5回/分）
    if (!checkRateLimit('timeline_' + ip)) {
      sendJSON(res, 429, { error: 'リクエストが多すぎます。', posts: [] });
      return;
    }

    try {
      const { interests = [], mode = 'influencer' } = await readBody(req);
      console.log(`[timeline] mode=${mode} ip=${ip}`);

      const posts = await callAI(timelinePrompt(interests, mode), 'タイムライン投稿を生成してください。');
      sendJSON(res, 200, { posts });
    } catch(e) {
      console.error('[timeline error]', e.message);
      sendJSON(res, 500, { error: e.message, posts: [] });
    }
    return;
  }

  // ===== index.html =====
  const html = Buffer.from(INDEX_HTML);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': html.length
  });
  res.end(html);

}).listen(PORT, () => {
  console.log(`✅ いどばたサーバー起動 ポート: ${PORT}`);
  console.log(`🤖 AI: ${AI_PROVIDER} / キー: ${(AI_PROVIDER==='gemini'?GEMINI_KEY:OPENAI_KEY) ? '設定済み✅' : '未設定❌'}`);
  console.log(`🛡️  レート制限: ${RATE_LIMIT_MAX_REQ}回/${RATE_LIMIT_WINDOW_MS/1000}秒 (per IP)`);
});
