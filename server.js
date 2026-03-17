'use strict';
const http  = require('http');
const https = require('https');

const PORT       = process.env.PORT || 3000;
const GEMINI_KEY       = process.env.GEMINI_API_KEY      || '';
const UNSPLASH_KEY     = process.env.UNSPLASH_ACCESS_KEY  || '';
const FIREBASE_DB_URL  = process.env.FIREBASE_DB_URL      || ''; // e.g. https://xxx.firebaseio.com


// ===== IP\u30EC\u30FC\u30C8\u5236\u9650 =====
const RL_WIN = 60 * 1000;  // 1\u5206
const RL_MAX = 5;           // 1\u5206\u3042\u305F\u308A5\u56DE

// RPD(1\u65E5\u30EA\u30AF\u30A8\u30B9\u30C8\u6570)\u30AB\u30A6\u30F3\u30BF\u30FC
let rpdCount = 0;
let rpdResetAt = Date.now() + 24 * 60 * 60 * 1000;
const RPD_LIMIT = 1400;
const RPD_HARD  = 1480;

function checkRPD() {
  const now = Date.now();
  if (now > rpdResetAt) {
    rpdCount  = 0;
    rpdResetAt = now + 24 * 60 * 60 * 1000;
    console.log('[rpd] \u65E5\u6B21\u30EA\u30BB\u30C3\u30C8');
  }
  rpdCount++;
  console.log(`[rpd] \u672C\u65E5${rpdCount}\u56DE\u76EE / \u4E0A\u9650${RPD_HARD}\u56DE`);
  if (rpdCount >= RPD_HARD) throw new Error('RPD_EXCEEDED');
  return rpdCount;
}

const rlMap  = new Map();

function checkRL(ip) {
  const now = Date.now();
  const e   = rlMap.get(ip);
  if (!e || now - e.w > RL_WIN) { rlMap.set(ip, {c:1, w:now}); return true; }
  e.c++;
  return e.c <= RL_MAX;
}
// \u53E4\u3044\u30A8\u30F3\u30C8\u30EA\u30925\u5206\u3054\u3068\u306B\u524A\u9664\uFF08\u30E1\u30E2\u30EA\u30EA\u30FC\u30AF\u9632\u6B62\uFF09
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rlMap.entries())
    if (now - e.w > RL_WIN * 5) rlMap.delete(ip);
}, 5 * 60 * 1000);

// ===== HTML =====
const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"ja\" data-theme=\"dark\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no\">\n<title>\u3044\u3069\u3070\u305f</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap\" rel=\"stylesheet\">\n<style>\n/* ===== CSS\u5909\u6570 ===== */\n:root{\n  --bg:#0f0f13;--sf:#1a1a22;--sf2:#22222e;--bd:#2e2e3e;\n  --tx:#f0f0f5;--sub:#8888aa;--like:#ff4488;--acc:#ff6b35;\n  --fn:'Noto Sans JP',sans-serif;\n}\n[data-theme=\"light\"]{\n  --bg:#f5f5f7;--sf:#ffffff;--sf2:#ebebf0;--bd:#d8d8e8;\n  --tx:#111122;--sub:#666688;\n}\n/* ===== \u30ea\u30bb\u30c3\u30c8 ===== */\n*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}\nbody{background:var(--bg);color:var(--tx);font-family:var(--fn);min-height:100vh;display:flex;justify-content:center;transition:background .25s,color .25s;}\nbutton,input,textarea{font-family:var(--fn);}\nbutton{cursor:pointer;border:none;background:none;}\na{text-decoration:none;color:inherit;}\n\n/* ===== \u30a2\u30d7\u30ea\u67a0 ===== */\n.app{width:390px;min-height:100vh;background:var(--bg);display:flex;flex-direction:column;position:relative;overflow-x:hidden;}\n@media(max-width:420px){.app{width:100vw;}}\n\n/* ===== \u30b9\u30af\u30ea\u30fc\u30f3\u5207\u66ff ===== */\n.screen{display:none;flex-direction:column;flex:1;}\n.screen.active{display:flex;}\n\n/* ===== \u30ed\u30fc\u30c7\u30a3\u30f3\u30b0\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4 ===== */\n.overlay{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;gap:18px;transition:opacity .3s;}\n.overlay.hide{display:none;}\n.ov-logo{font-size:36px;font-weight:900;letter-spacing:-1.5px;}\n.ov-logo em{color:var(--acc);font-style:normal;}\n.ov-sub{font-size:13px;color:var(--sub);}\n.spinner{width:38px;height:38px;border:3px solid var(--bd);border-top-color:var(--acc);border-radius:50%;animation:spin .75s linear infinite;}\n@keyframes spin{to{transform:rotate(360deg);}}\n\n/* ===== \u30bb\u30c3\u30c8\u30a2\u30c3\u30d7\u753b\u9762 ===== */\n#setupScreen{overflow-y:auto;padding-bottom:60px;}\n.s-hero{text-align:center;padding:56px 24px 28px;background:linear-gradient(180deg,var(--sf) 0%,var(--bg) 100%);}\n.s-logo{font-size:46px;font-weight:900;letter-spacing:-2px;margin-bottom:8px;}\n.s-logo em{color:var(--acc);font-style:normal;}\n.s-catchcopy{font-size:14px;color:var(--sub);line-height:1.9;}\n.s-mascot{font-size:68px;margin:14px 0 0;}\n.s-body{padding:24px 20px 0;}\n.s-desc{font-size:13px;color:var(--sub);line-height:1.9;text-align:center;margin-bottom:24px;}\n.s-sec{margin-bottom:22px;}\n.s-lbl{font-size:10.5px;font-weight:700;color:var(--sub);letter-spacing:1.8px;text-transform:uppercase;margin-bottom:8px;}\n.s-inp{width:100%;background:var(--sf);border:1.5px solid var(--bd);border-radius:14px;padding:13px 16px;color:var(--tx);font-size:15px;outline:none;transition:border-color .2s;}\n.s-inp:focus{border-color:var(--acc);}\n.s-inp::placeholder{color:var(--sub);}\n/* \u30a2\u30d0\u30bf\u30fc\u9078\u629e */\n.av-grid{display:flex;flex-wrap:wrap;gap:10px;}\n.av-item{width:52px;height:52px;border-radius:50%;background:var(--sf);border:2px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;transition:all .2s;}\n.av-item.sel{border-color:var(--acc);background:rgba(255,107,53,.15);transform:scale(1.1);}\n/* \u8208\u5473\u30bf\u30b0 */\n.int-grid{display:flex;flex-wrap:wrap;gap:8px;}\n.int-tag{padding:7px 14px;border-radius:20px;border:1.5px solid var(--bd);font-size:12px;font-weight:700;color:var(--sub);cursor:pointer;transition:all .2s;}\n.int-tag.sel{border-color:var(--acc);color:var(--acc);background:rgba(255,107,53,.1);}\n/* \u958b\u59cb\u30dc\u30bf\u30f3 */\n.s-btn{width:100%;padding:15px;border-radius:14px;background:var(--acc);color:#fff;font-size:16px;font-weight:900;margin-top:8px;transition:transform .15s,opacity .15s;}\n.s-btn:hover{transform:translateY(-2px);}\n.s-btn:active{transform:translateY(0);}\n.s-btn:disabled{opacity:.4;transform:none;cursor:not-allowed;}\n\n/* ===== \u30e1\u30a4\u30f3\u753b\u9762 ===== */\n#mainScreen{height:100vh;overflow:hidden;}\n/* \u30d8\u30c3\u30c0\u30fc */\n.hdr{flex-shrink:0;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--bd);padding:10px 14px 8px;position:sticky;top:0;z-index:100;}\n.hdr-row{display:flex;align-items:center;justify-content:space-between;}\n.hdr-left{display:flex;align-items:center;gap:8px;}\n/* \u30e1\u30cb\u30e5\u30fc\u30dc\u30bf\u30f3 */\n.menu-btn{width:36px;height:36px;border-radius:10px;background:var(--sf);border:1.5px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:17px;transition:all .2s;flex-shrink:0;}\n.menu-btn:hover{border-color:var(--acc);}\n.logo{font-size:21px;font-weight:900;letter-spacing:-.5px;white-space:nowrap;cursor:pointer;}\n.logo em{color:var(--acc);font-style:normal;}\n.mode-badge{display:inline-block;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;background:var(--acc);color:#fff;white-space:nowrap;transition:background .3s;margin-top:6px;}\n.hdr-right{display:flex;align-items:center;gap:5px;}\n.nav-btn{width:34px;height:34px;border-radius:50%;background:var(--sf);border:1.5px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:15px;transition:all .2s;position:relative;flex-shrink:0;}\n.nav-btn:hover,.nav-btn.on{border-color:var(--acc);background:rgba(255,107,53,.1);}\n.ndot{position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:var(--like);border:2px solid var(--bg);display:none;}\n.ndot.show{display:block;}\n\n/* ===== \u30d1\u30cd\u30eb\u30b7\u30b9\u30c6\u30e0 ===== */\n.panels{flex:1;overflow:hidden;position:relative;}\n.panel{position:absolute;inset:0;overflow-y:auto;padding-bottom:88px;opacity:0;pointer-events:none;transition:opacity .2s;scrollbar-width:thin;scrollbar-color:var(--bd) transparent;}\n.panel.on{opacity:1;pointer-events:auto;}\n.panel-hdr{padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--bg);z-index:10;}\n.panel-ttl{font-size:18px;font-weight:900;}\n.panel-act{color:var(--sub);font-size:12px;}\n\n/* ===== \u6295\u7a3f\u30ab\u30fc\u30c9 ===== */\n.post-card{padding:14px 16px;border-bottom:1px solid var(--bd);transition:background .15s;animation:fadeUp .3s ease;}\n.post-card:hover{background:var(--sf);}\n/* \u30e6\u30fc\u30b6\u30fc\u81ea\u8eab\u306e\u6295\u7a3f\u306f\u5de6border\u4ed8\u304d */\n.post-card.mine{border-left:3px solid var(--acc);background:color-mix(in srgb,var(--acc) 4%,var(--bg));}\n@keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}\n.pc-top{display:flex;gap:11px;align-items:flex-start;}\n/* \u30a2\u30d0\u30bf\u30fc */\n.pc-av{width:44px;height:44px;border-radius:50%;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;border:2px solid transparent;}\n.pc-av.mine{border-color:var(--acc);}\n.pc-meta{flex:1;min-width:0;}\n.pc-nr{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:2px;}\n.pc-name{font-size:13px;font-weight:700;}\n.pc-id{font-size:11px;color:var(--sub);}\n/* \u30e2\u30fc\u30c9\u30bf\u30b0 */\n.mtag{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;}\n.t-inf{background:rgba(255,107,53,.2);color:#ff6b35;}\n.t-men{background:rgba(91,156,246,.2);color:#5b9cf6;}\n.t-deb{background:rgba(244,63,94,.2);color:#f43f5e;}\n.t-leg{background:rgba(167,139,250,.2);color:#a78bfa;}\n/* \u6295\u7a3f\u672c\u6587 */\n.pc-body{font-size:14px;line-height:1.7;margin:8px 0 10px;word-break:break-word;}\n/* \u30a2\u30af\u30b7\u30e7\u30f3\u30dc\u30bf\u30f3 */\n.pc-acts{display:flex;gap:20px;}\n.act{display:flex;align-items:center;gap:5px;color:var(--sub);font-size:12px;cursor:pointer;transition:color .2s;padding:3px 0;background:none;border:none;}\n.act:hover{color:var(--tx);}\n.act.lkd{color:var(--like);}\n.act-ico{font-size:15px;}\n@keyframes lpop{0%{transform:scale(1);}40%{transform:scale(1.5);}100%{transform:scale(1);}}\n.lpop{animation:lpop .3s ease;}\n\n/* ===== \u30b3\u30e1\u30f3\u30c8\u6b04 ===== */\n.cmt-sec{display:none;background:var(--sf2);border-top:1px solid var(--bd);padding:12px 14px;}\n.cmt-sec.open{display:block;animation:fadeUp .2s ease;}\n.cmt-item{padding:9px 0;border-bottom:1px solid var(--bd);font-size:13px;line-height:1.6;}\n.cmt-item:last-child{border:none;}\n.cmt-who{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--acc);margin-bottom:4px;}\n.cmt-av{font-size:16px;}\n.cmt-add{display:flex;gap:8px;margin-top:10px;}\n.cmt-inp{flex:1;background:var(--bg);border:1.5px solid var(--bd);border-radius:20px;padding:8px 14px;color:var(--tx);font-size:13px;outline:none;transition:border-color .2s;}\n.cmt-inp:focus{border-color:var(--acc);}\n.cmt-inp::placeholder{color:var(--sub);}\n.cmt-snd{width:32px;height:32px;border-radius:50%;background:var(--acc);color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}\n\n/* ===== \u30ed\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9 ===== */\n.ld-card{padding:14px 16px;border-bottom:1px solid var(--bd);}\n.typing{display:flex;align-items:center;gap:5px;margin-top:6px;}\n.dot{width:7px;height:7px;border-radius:50%;background:var(--sub);animation:bounce 1.2s infinite;}\n.dot:nth-child(2){animation-delay:.2s;}\n.dot:nth-child(3){animation-delay:.4s;}\n@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-6px);opacity:1;}}\n\n/* ===== \u7a7a\u72b6\u614b ===== */\n.empty{text-align:center;padding:64px 28px;color:var(--sub);}\n.empty-ico{font-size:54px;margin-bottom:16px;}\n.empty-ttl{font-size:17px;font-weight:700;color:var(--tx);margin-bottom:10px;}\n.empty-txt{font-size:13px;line-height:1.8;}\n\n/* ===== \u901a\u77e5\u30d1\u30cd\u30eb ===== */\n.notif-item{padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;gap:12px;align-items:flex-start;animation:fadeUp .3s ease;}\n.notif-item.unread{background:color-mix(in srgb,var(--acc) 4%,var(--bg));}\n.ni-ico{font-size:22px;flex-shrink:0;margin-top:1px;}\n.ni-body{flex:1;}\n.ni-text{font-size:13px;line-height:1.65;margin-bottom:3px;}\n.ni-time{font-size:11px;color:var(--sub);}\n.no-notif{text-align:center;padding:52px 24px;color:var(--sub);font-size:13px;}\n\n/* ===== \u30c8\u30ec\u30f3\u30c9\u30d1\u30cd\u30eb ===== */\n.tr-item{display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid var(--bd);cursor:pointer;transition:background .15s;}\n.tr-item:hover{background:var(--sf);}\n.tr-rank{font-size:17px;font-weight:900;color:var(--sub);width:34px;flex-shrink:0;}\n.tr-rank.top{color:var(--acc);}\n.tr-info{flex:1;}\n.tr-tag{font-size:15px;font-weight:700;margin-bottom:2px;}\n.tr-meta{font-size:11px;color:var(--sub);}\n.tr-cnt{font-size:12px;color:var(--sub);}.tr-empty{text-align:center;padding:52px 24px;color:var(--sub);}.tr-empty-ico{font-size:48px;margin-bottom:14px;}.tr-empty-ttl{font-size:15px;font-weight:700;color:var(--tx);margin-bottom:8px;}.tr-empty-txt{font-size:12px;line-height:1.8;}.tr-sec{padding:10px 16px 4px;font-size:10px;font-weight:700;color:var(--sub);letter-spacing:1.5px;border-bottom:1px solid var(--bd);}.tr-src{font-size:10px;padding:2px 7px;border-radius:8px;font-weight:700;margin-left:4px;}.ts-post{background:rgba(255,107,53,.15);color:var(--acc);}.ts-int{background:rgba(91,156,246,.15);color:#5b9cf6;}.ts-ai{background:rgba(167,139,250,.15);color:#a78bfa;}\n\n/* ===== \u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\u30d1\u30cd\u30eb ===== */\n.pr-hero{padding:24px 20px;border-bottom:1px solid var(--bd);display:flex;gap:16px;align-items:center;}\n.pr-av{width:74px;height:74px;border-radius:50%;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:40px;border:3px solid var(--acc);flex-shrink:0;}\n.pr-name{font-size:22px;font-weight:900;}\n.pr-id{font-size:13px;color:var(--sub);margin-bottom:10px;}\n.pr-stats{display:flex;gap:20px;}\n.stat-n{font-size:17px;font-weight:900;color:var(--acc);}\n.stat-l{font-size:11px;color:var(--sub);}\n.pr-sec{padding:16px 20px;border-bottom:1px solid var(--bd);}\n.pr-stl{font-size:10.5px;font-weight:700;color:var(--sub);letter-spacing:1.8px;margin-bottom:10px;}\n.pr-tags{display:flex;flex-wrap:wrap;gap:7px;}\n.pr-tag{padding:5px 13px;border-radius:20px;border:1.5px solid var(--acc);color:var(--acc);font-size:12px;font-weight:700;}\n.pr-acts{padding:16px 20px;display:flex;flex-direction:column;gap:10px;}\n.pr-btn{padding:13px 16px;border-radius:12px;border:1.5px solid var(--bd);background:var(--sf);color:var(--tx);font-size:14px;text-align:left;transition:border-color .2s;}\n.pr-btn:hover{border-color:var(--acc);}\n.pr-btn.danger{color:#f43f5e;border-color:rgba(244,63,94,.3);}\n\n/* ===== \u6295\u7a3f\u5165\u529b\u30d0\u30fc ===== */\n.compose{position:fixed;bottom:0;width:390px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--bd);padding:10px 14px 12px;z-index:200;}\n@media(max-width:420px){.compose{width:100vw;}}\n.cmp-row{display:flex;gap:9px;align-items:flex-end;}\n.cmp-av{width:36px;height:36px;border-radius:50%;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;border:2px solid var(--acc);transition:border-color .3s;}\n.cmp-inp{flex:1;background:var(--sf);border:1.5px solid var(--bd);border-radius:22px;padding:10px 16px;color:var(--tx);font-size:14px;resize:none;outline:none;max-height:100px;line-height:1.5;transition:border-color .2s;}\n.cmp-inp:focus{border-color:var(--acc);}\n.cmp-inp::placeholder{color:var(--sub);}\n.snd-btn{width:40px;height:40px;border-radius:50%;background:var(--acc);color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;}\n.snd-btn:hover{transform:scale(1.08);}\n.snd-btn:active{transform:scale(.96);}\n.snd-btn:disabled{opacity:.4;transform:none;cursor:not-allowed;}\n\n/* ===== \u30e2\u30fc\u30c9\u9078\u629e\u30e2\u30fc\u30c0\u30eb ===== */\n.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:300;display:none;align-items:flex-end;justify-content:center;}\n.modal-bg.open{display:flex;animation:bgFade .2s ease;}\n@keyframes bgFade{from{opacity:0;}to{opacity:1;}}\n.mode-sheet{width:390px;background:var(--sf);border-radius:22px 22px 0 0;padding:18px 20px 44px;animation:slideUp .3s cubic-bezier(.22,.61,.36,1);}\n@keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}\n@media(max-width:420px){.mode-sheet{width:100vw;}}\n.sh-bar{width:42px;height:4px;border-radius:2px;background:var(--bd);margin:0 auto 18px;}\n.sh-title{font-size:18px;font-weight:900;margin-bottom:14px;}\n/* \u30e2\u30fc\u30c9\u30ab\u30fc\u30c9 */\n.mode-card{padding:14px 16px;border-radius:14px;border:2px solid var(--bd);margin-bottom:10px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:all .2s;}\n.mode-card:hover{border-color:var(--acc);}\n.mode-card.cur{border-color:var(--acc);background:color-mix(in srgb,var(--acc) 6%,var(--sf));}\n.mc-ico{font-size:30px;flex-shrink:0;}\n.mc-name{font-size:15px;font-weight:700;margin-bottom:3px;}\n.mc-desc{font-size:12px;color:var(--sub);line-height:1.5;}\n\n/* ===== \u30c8\u30fc\u30b9\u30c8 ===== */\n.toast{position:fixed;bottom:96px;left:50%;transform:translateX(-50%) translateY(14px);background:var(--sf2);border:1px solid var(--bd);border-radius:12px;padding:10px 20px;font-size:13px;font-weight:700;opacity:0;transition:all .3s;z-index:500;pointer-events:none;white-space:nowrap;}\n.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}\n\n/* ===== \u3044\u3044\u306d\u30d5\u30ed\u30fc\u30c8\u30a2\u30cb\u30e1 ===== */\n.lf{position:fixed;pointer-events:none;font-size:20px;z-index:999;animation:floatUp 1.2s ease forwards;}#imgStrip{position:fixed;bottom:70px;width:390px;background:color-mix(in srgb,var(--bg) 96%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid var(--bd);z-index:199;}@media(max-width:420px){#imgStrip{width:100vw;}}.img-strip{display:flex;gap:7px;overflow-x:auto;padding:8px 14px 4px;scrollbar-width:none;}.img-strip::-webkit-scrollbar{display:none;}.img-thumb{width:64px;height:64px;border-radius:10px;object-fit:cover;cursor:pointer;border:2px solid transparent;transition:all .2s;flex-shrink:0;}.img-thumb:hover{border-color:var(--acc);transform:scale(1.05);}.img-thumb.sel{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc);}.img-credit{font-size:9px;color:var(--sub);padding:0 14px 6px;}.pc-img{width:100%;border-radius:12px;margin:6px 0 8px;max-height:240px;object-fit:cover;cursor:pointer;}.sync-bar{display:flex;align-items:center;gap:6px;padding:5px 16px;font-size:11px;color:var(--sub);border-bottom:1px solid var(--bd);}.sync-dot{width:7px;height:7px;border-radius:50%;background:var(--sub);}.sync-dot.ok{background:#22c55e;}.sync-dot.err{background:#f43f5e;}.sync-dot.loading{background:#f59e0b;animation:spin .8s linear infinite;}\n@keyframes floatUp{0%{opacity:1;transform:translateY(0)scale(1);}100%{opacity:0;transform:translateY(-90px)scale(1.7);}}\n</style>\n</head>\n<body>\n<div class=\"app\" id=\"app\">\n\n<!-- \u30ed\u30fc\u30c7\u30a3\u30f3\u30b0 -->\n<div class=\"overlay\" id=\"overlay\">\n  <div class=\"ov-logo\">\u3044\u3069<em>\u3070\u305f</em></div>\n  <div class=\"spinner\"></div>\n  <div class=\"ov-sub\" id=\"ovTxt\">\u8d77\u52d5\u4e2d\u2026</div>\n</div>\n\n<!-- ========== \u30bb\u30c3\u30c8\u30a2\u30c3\u30d7 ========== -->\n<div class=\"screen\" id=\"setupScreen\">\n  <div class=\"s-hero\">\n    <div class=\"s-logo\">\u3044\u3069<em>\u3070\u305f</em></div>\n    <div class=\"s-catchcopy\">\u79c1\u4ee5\u5916\u5168\u54e1AI\u2049<br>\u3042\u306a\u305f\u3060\u3051\u306e\u7a76\u6975\u306b\u308f\u304c\u307e\u307e\u306aSNS</div>\n    <div class=\"s-mascot\">\ud83e\udea3</div>\n  </div>\n  <div class=\"s-body\">\n    <p class=\"s-desc\">\u300c\u3044\u3069\u3070\u305f\u300d\u3078\u3088\u3046\u3053\u305d\uff01<br>\u521d\u671f\u8a2d\u5b9a\u3092\u3057\u3066\u3001\u3042\u306a\u305f\u3060\u3051\u306e\u4e16\u754c\u3092\u4f5c\u308d\u3046\u3002</p>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u30e6\u30fc\u30b6\u30fc\u540d</div>\n      <input class=\"s-inp\" id=\"sName\" type=\"text\" placeholder=\"\u4f8b\uff1a\u4e95\u6238\u7aef \u6cf0\u5e0c\" maxlength=\"20\" oninput=\"chkSetup()\">\n    </div>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u30ed\u30b0\u30a4\u30f3ID</div>\n      <input class=\"s-inp\" id=\"sId\" type=\"text\" placeholder=\"\u4f8b\uff1aidobata_taiki\uff08\u82f1\u6570\u5b57\uff09\" maxlength=\"20\" oninput=\"chkSetup()\">\n    </div>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u30a2\u30d0\u30bf\u30fc\u3092\u9078\u3076</div>\n      <div class=\"av-grid\" id=\"avGrid\">\n        <div class=\"av-item sel\" data-av=\"\ud83d\ude0a\" onclick=\"selAv(this)\">\ud83d\ude0a</div>\n        <div class=\"av-item\" data-av=\"\ud83d\ude0e\" onclick=\"selAv(this)\">\ud83d\ude0e</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc36\" onclick=\"selAv(this)\">\ud83d\udc36</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc31\" onclick=\"selAv(this)\">\ud83d\udc31</div>\n        <div class=\"av-item\" data-av=\"\ud83e\udd8a\" onclick=\"selAv(this)\">\ud83e\udd8a</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc38\" onclick=\"selAv(this)\">\ud83d\udc38</div>\n        <div class=\"av-item\" data-av=\"\ud83e\udd84\" onclick=\"selAv(this)\">\ud83e\udd84</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc3c\" onclick=\"selAv(this)\">\ud83d\udc3c</div>\n        <div class=\"av-item\" data-av=\"\ud83e\udd81\" onclick=\"selAv(this)\">\ud83e\udd81</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc2f\" onclick=\"selAv(this)\">\ud83d\udc2f</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc3b\" onclick=\"selAv(this)\">\ud83d\udc3b</div>\n        <div class=\"av-item\" data-av=\"\ud83d\udc28\" onclick=\"selAv(this)\">\ud83d\udc28</div>\n      </div>\n    </div>\n    <div class=\"s-sec\">\n      <div class=\"s-lbl\">\u8da3\u5473\u30fb\u8208\u5473\uff08\u8907\u6570\u9078\u629eOK\uff09</div>\n      <div class=\"int-grid\">\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udfb5 \u97f3\u697d</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udfac \u6620\u753b</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udfae \u30b2\u30fc\u30e0</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udf73 \u6599\u7406</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83d\udcbb \u30c6\u30af\u30ce\u30ed\u30b8\u30fc</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83d\udcda \u8aad\u66f8</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\u2708\ufe0f \u65c5\u884c</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83d\udc3e \u52d5\u7269</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\u26bd \u30b9\u30dd\u30fc\u30c4</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udf3f \u30e9\u30a4\u30d5\u30b9\u30bf\u30a4\u30eb</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udfad \u30a2\u30cb\u30e1</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83d\udcb0 \u30d3\u30b8\u30cd\u30b9</div>\n        <div class=\"int-tag\" onclick=\"togInt(this)\">\ud83c\udf1f \u63a8\u3057\u6d3b</div>\n      </div>\n    </div>\n    <button class=\"s-btn\" id=\"setupBtn\" onclick=\"doSetup()\" disabled>\u3044\u3069\u3070\u305f\u3092\u306f\u3058\u3081\u308b \u2192</button>\n  </div>\n</div>\n\n<!-- ========== \u30e1\u30a4\u30f3 ========== -->\n<div class=\"screen\" id=\"mainScreen\" style=\"height:100vh;overflow:hidden;display:none;flex-direction:column;\">\n  <!-- \u30d8\u30c3\u30c0\u30fc -->\n  <div class=\"hdr\">\n    <div class=\"hdr-row\">\n      <div class=\"hdr-left\">\n        <button class=\"menu-btn\" onclick=\"openModal()\" title=\"\u30e1\u30cb\u30e5\u30fc\">\u2630</button>\n        <div class=\"logo\" onclick=\"showPanel('timeline')\">\u3044\u3069<em>\u3070\u305f</em></div>\n      </div>\n      <div class=\"hdr-right\">\n        <button class=\"nav-btn\" id=\"btnTheme\" onclick=\"toggleTheme()\" title=\"\u30c6\u30fc\u30de\u5207\u66ff\">\ud83c\udf19</button>\n        <button class=\"nav-btn\" id=\"btnNotif\" onclick=\"showPanel('notif')\" title=\"\u901a\u77e5\">\ud83d\udd14<div class=\"ndot\" id=\"ndot\"></div></button>\n        <button class=\"nav-btn\" id=\"btnTrends\" onclick=\"showPanel('trends')\" title=\"\u30c8\u30ec\u30f3\u30c9\">\ud83d\udcc8</button>\n        <button class=\"nav-btn\" id=\"btnProfile\" onclick=\"showPanel('profile')\" title=\"\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\">\ud83d\udc64</button>\n      </div>\n    </div>\n    <div>\n      <div class=\"mode-badge\" id=\"modeBadge\">\ud83d\udd25 \u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc</div>\n    </div>\n  </div>\n\n  <!-- \u30d1\u30cd\u30eb\u7fa4 -->\n  <div class=\"sync-bar\" id=\"syncBar\" style=\"display:none\"><div class=\"sync-dot\" id=\"syncDot\"></div><span id=\"syncTxt\">Firebase\u540c\u671f</span></div><div class=\"panels\" style=\"flex:1;overflow:hidden;position:relative;\">\n    <!-- \u30bf\u30a4\u30e0\u30e9\u30a4\u30f3 -->\n    <div class=\"panel on\" id=\"pTimeline\"></div>\n\n    <!-- \u901a\u77e5 -->\n    <div class=\"panel\" id=\"pNotif\">\n      <div class=\"panel-hdr\">\n        <span class=\"panel-ttl\">\ud83d\udd14 \u901a\u77e5</span>\n        <button class=\"panel-act\" onclick=\"clearNotifs()\">\u3059\u3079\u3066\u65e2\u8aad</button>\n      </div>\n      <div id=\"notifList\"></div>\n    </div>\n\n    <!-- \u30c8\u30ec\u30f3\u30c9 -->\n    <div class=\"panel\" id=\"pTrends\">\n      <div class=\"panel-hdr\"><span class=\"panel-ttl\">\ud83d\udcc8 \u30c8\u30ec\u30f3\u30c9</span><button class=\"panel-act\" onclick=\"renderTrends()\">\u66f4\u65b0</button></div>\n      <div id=\"trendsList\"></div>\n    </div>\n\n    <!-- \u30d7\u30ed\u30d5\u30a3\u30fc\u30eb -->\n    <div class=\"panel\" id=\"pProfile\">\n      <div class=\"pr-hero\">\n        <div class=\"pr-av\" id=\"prAv\">\ud83d\ude0a</div>\n        <div>\n          <div class=\"pr-name\" id=\"prName\">\u2014</div>\n          <div class=\"pr-id\" id=\"prId\">@\u2014</div>\n          <div class=\"pr-stats\">\n            <div><div class=\"stat-n\" id=\"stP\">0</div><div class=\"stat-l\">\u6295\u7a3f</div></div>\n            <div><div class=\"stat-n\" id=\"stL\">0</div><div class=\"stat-l\">\u3044\u3044\u306d</div></div>\n            <div><div class=\"stat-n\" id=\"stC\">0</div><div class=\"stat-l\">\u30b3\u30e1\u30f3\u30c8</div></div>\n          </div>\n        </div>\n      </div>\n      <div class=\"pr-sec\"><div class=\"pr-stl\">INTERESTS</div><div class=\"pr-tags\" id=\"prInts\"></div></div>\n      <div class=\"pr-acts\">\n        <button class=\"pr-btn\" onclick=\"editProfile()\">\u270f\ufe0f \u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\u3092\u7de8\u96c6</button>\n        <button class=\"pr-btn danger\" onclick=\"clearAll()\">\ud83d\uddd1\ufe0f \u30c7\u30fc\u30bf\u3092\u3059\u3079\u3066\u524a\u9664</button>\n      </div>\n    </div>\n  </div>\n\n  <!-- \u6295\u7a3f\u5165\u529b\u30d0\u30fc -->\n  <div class=\"compose\" id=\"compose\">\n    <div class=\"cmp-row\">\n      <div class=\"cmp-av\" id=\"cmpAv\">\ud83d\ude0a</div>\n      <textarea class=\"cmp-inp\" id=\"postInput\" placeholder=\"\u3044\u307e\u3069\u3093\u306a\u6c17\u6301\u3061\uff1f\" rows=\"1\"\n        oninput=\"autoResize(this)\" onkeydown=\"handleKey(event)\"></textarea>\n      <button class=\"nav-btn\" onclick=\"manualImgSearch()\" title=\"\u753b\u50cf\u3092\u691c\u7d22\" style=\"flex-shrink:0;font-size:16px;\">\ud83d\udcf7</button>\n      <button class=\"snd-btn\" id=\"sendBtn\" onclick=\"submitPost()\" disabled>\u27a4</button>\n    </div>\n  </div>\n</div>\n\n<div id=\"imgStrip\" style=\"display:none\"><div class=\"img-strip\" id=\"imgList\"></div><div class=\"img-credit\" id=\"imgCredit\"></div></div>\n</div><!-- /app -->\n\n<!-- \u30e2\u30fc\u30c9\u9078\u629e\u30e2\u30fc\u30c0\u30eb -->\n<div class=\"modal-bg\" id=\"modeModal\" onclick=\"bgClose(event)\">\n  <div class=\"mode-sheet\" onclick=\"event.stopPropagation()\">\n    <div class=\"sh-bar\"></div>\n    <div class=\"sh-title\">\u30e2\u30fc\u30c9\u3092\u9078\u629e</div>\n    <div class=\"mode-card cur\" data-mode=\"influencer\" onclick=\"selectMode('influencer')\">\n      <div class=\"mc-ico\">\ud83d\udd25</div>\n      <div><div class=\"mc-name\">\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc\u30e2\u30fc\u30c9</div><div class=\"mc-desc\">\u3042\u306a\u305f\u306e\u6295\u7a3f\u306b\u307f\u3093\u306a\u304c\u71b1\u72c2\uff01\u30d0\u30ba\u308a\u4f53\u9a13\u3092\u3069\u3046\u305e</div></div>\n    </div>\n    <div class=\"mode-card\" data-mode=\"mental\" onclick=\"selectMode('mental')\">\n      <div class=\"mc-ico\">\ud83d\udc99</div>\n      <div><div class=\"mc-name\">\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2\u30e2\u30fc\u30c9</div><div class=\"mc-desc\">\u8ab0\u306b\u3082\u8a00\u3048\u306a\u3044\u60a9\u307f\u3092\u305d\u3063\u3068\u8a71\u3057\u3066\u307f\u3066</div></div>\n    </div>\n    <div class=\"mode-card\" data-mode=\"debate\" onclick=\"selectMode('debate')\">\n      <div class=\"mc-ico\">\u26a1</div>\n      <div><div class=\"mc-name\">\u30c7\u30a3\u30d9\u30fc\u30c8\u30e2\u30fc\u30c9</div><div class=\"mc-desc\">\u610f\u898b\u3092\u3076\u3064\u3051\u3088\u3046\u3002\u8b70\u8ad6\u3067\u601d\u8003\u3092\u6df1\u3081\u308b</div></div>\n    </div>\n    <div class=\"mode-card\" data-mode=\"legend\" onclick=\"selectMode('legend')\">\n      <div class=\"mc-ico\">\ud83d\udc51</div>\n      <div><div class=\"mc-name\">\u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af\u30e2\u30fc\u30c9</div><div class=\"mc-desc\">\u6b74\u53f2\u4e0a\u306e\u5049\u4eba\u305f\u3061\u3068\u8a9e\u308a\u5408\u304a\u3046</div></div>\n    </div>\n  </div>\n</div>\n\n<div id=\"imgStrip\" style=\"display:none\"><div class=\"img-strip\" id=\"imgList\"></div><div class=\"img-credit\" id=\"imgCredit\"></div></div><div class=\"toast\" id=\"toast\"></div>\n\n<script>\n'use strict';\n// ===================================================\n//  \u5b9a\u6570\u30fb\u8a2d\u5b9a\n// ===================================================\nconst STORE_KEY = 'idobata_v6';\n\n// \u30e2\u30fc\u30c9\u8a2d\u5b9a\nconst MC = {\n  influencer:{ label:'\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc', badge:'\ud83d\udd25 \u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc', acc:'#ff6b35', tc:'t-inf', ph:'\u30d0\u30ba\u3089\u305b\u305f\u3044\u3053\u3068\u3092\u3064\u3076\u3084\u3044\u3066\uff01' },\n  mental:    { label:'\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2',     badge:'\ud83d\udc99 \u30e1\u30f3\u30bf\u30eb\u30b1\u30a2',     acc:'#5b9cf6', tc:'t-men', ph:'\u60a9\u307f\u3092\u5171\u6709\u2026' },\n  debate:    { label:'\u30c7\u30a3\u30d9\u30fc\u30c8',       badge:'\u26a1 \u30c7\u30a3\u30d9\u30fc\u30c8',       acc:'#f43f5e', tc:'t-deb', ph:'\u610f\u898b\u3092\u3076\u3064\u3051\u3088\u3046\uff01' },\n  legend:    { label:'\u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af', badge:'\ud83d\udc51 \u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af', acc:'#a78bfa', tc:'t-leg', ph:'\u6b74\u53f2\u4e0a\u306e\u4eba\u3068\u8a71\u305d\u3046\u2026' },\n};\n\n// AI\u30ad\u30e3\u30e9\u540d\u30d7\u30fc\u30eb\uff08\u3044\u3044\u306d\u901a\u77e5\u306b\u4f7f\u7528\uff09\nconst AI_NAMES = [\n  '\u8c61\u306e\u308a\u9020','\u7b4b\u8089\u5bff\u559c\u7537','\u30c1\u30ef\u30ef\u306b\u306a\u308a\u305f\u3044\u72ac','\u5948\u826f\u3067\u9e7f\u3084\u3063\u3066\u307e\u3059','\u6bce\u671d5\u6642\u8d77\u304d\u306e\u7537',\n  '\u5375\u304b\u3051\u3054\u98ef\u4fe1\u8005','\u6df1\u591c\u306e\u30e9\u30fc\u30e1\u30f3\u54f2\u5b66\u8005','\u30b9\u30fc\u30d1\u30fc\u92ad\u6e6f\u306e\u5e1d\u738b','\u30b3\u30f3\u30d3\u30cb\u9650\u5b9a\u30b9\u30a4\u30fc\u30c4\u90e8','\u5ddd\u6cbf\u3044\u30b8\u30e7\u30ae\u30f3\u30b0\u4e2d',\n  '\u3069\u3053\u3067\u3082\u5bdd\u308c\u308b\u7537','\u3072\u3068\u308a\u30ab\u30e9\u30aa\u30b1\u5e38\u9023','\u516c\u5712\u306e\u30cf\u30c8\u89b3\u5bdf\u54e1','\u5927\u76db\u308a\u7121\u6599\u306e\u5b58\u5728','\u96fb\u67f1\u306e\u88cf\u306e\u54f2\u5b66',\n  '\u8fd1\u6240\u306e\u30b9\u30fc\u30d1\u30fc\u8a73\u3057\u3044','\u30e1\u30ed\u30f3\u30bd\u30fc\u30c0\u81f3\u4e0a\u4e3b\u7fa9','\u30d0\u30a4\u30af\u4e57\u308a\u305f\u3044\u539f\u4ed8','\u30b2\u30fc\u30bb\u30f3\u5ec3\u4eba\u5019\u88dc','\u30bf\u30d4\u30aa\u30ab\u98f2\u307f\u904e\u304e\u8b66\u5831',\n  '\u306d\u3053\u306b\u597d\u304b\u308c\u306a\u3044\u72ac\u597d\u304d','\u5b9f\u5bb6\u306e\u67f4\u72ac\u306e\u307b\u3046\u304c\u6709\u540d','\u5e03\u56e3\u304b\u3089\u51fa\u3089\u308c\u306a\u3044\u4f1a','\u663c\u9593\u304b\u3089\u516c\u5712\u3044\u308b\u4eba','\u30b9\u30cb\u30fc\u30ab\u30fc\u6cbc\u306e\u4f4f\u4eba',\n  '\u30d1\u30bd\u30b3\u30f3\u3081\u304c\u306d','\u3054\u98ef\u529b\u58eb','\u30ed\u30dc\u30c3\u30c8\u30ea\u30ad\u30b7','\u6df1\u591c\u306e\u4e3b\u5a66','\u5bdd\u8d77\u304d\u306e\u5927\u5b66\u751f',\n  '\u4f1a\u793e\u5e30\u308a\u306e\u96fb\u8eca','\u7a7a\u304d\u5730\u306e\u54f2\u5b66\u8005','\u5098\u3092\u5fd8\u308c\u308b\u5929\u624d','\u30aa\u30e0\u30e9\u30a4\u30b9\u3067\u6ce3\u3044\u305f\u5973','\u732b\u3068\u6dfb\u3044\u5bdd\u7814\u7a76\u5bb6',\n  '\u5915\u65b9\u306e\u516c\u5712\u30d9\u30f3\u30c1','\u3072\u3068\u308a\u713c\u304d\u8089\u306e\u5148\u99c6\u8005','\u6708\u66dc\u65e5\u304c\u6016\u3044\u4eba','\u8fd4\u4fe1\u9045\u304f\u3066\u3054\u3081\u3093\u306e\u4eba','\u63a8\u3057\u306b\u8ab2\u91d1\u3057\u305f\u5f8c\u6094',\n  '\u5b9f\u306f\u5bc2\u3057\u3044\u30d1\u30ea\u30d4','\u30e1\u30f3\u30d8\u30e9\u3068\u306f\u8a00\u308f\u305b\u306a\u3044','\u6ce3\u3051\u308b\u6620\u753b\u5c02\u9580\u5bb6','\u306c\u3044\u3050\u308b\u307f\u3068\u66ae\u3089\u3059\u4eba','HSP\u304b\u3082\u3057\u308c\u306a\u3044\u666e\u901a\u306e\u4eba',\n  '\u5f37\u9762\u304a\u3058\u3055\u3093','\u3089\u304f\u3060\u5c0f\u50e7','\u30bf\u30e9\u30d0\u30ac\u30cb','\u306e\u308a\u3084\u3059','\u8ad6\u7834\u3057\u305f\u3044\u9ad8\u6821\u751f',\n  'Wikipedia\u4f9d\u5b58\u75c7','\u30a8\u30d3\u30c7\u30f3\u30b9\u6301\u3063\u3066\u304d\u3066','\u53cd\u8ad6\u306f\u6b63\u7fa9\u3060\u3068\u601d\u3046\u4eba','\u3067\u3082\u5b9f\u969b\u3069\u3046\u306a\u306e\u6d3e','\u305d\u308c\u3063\u3066\u610f\u5473\u3042\u308b\uff1f\u30de\u30f3',\n  '\u5168\u90e8AI\u306e\u305b\u3044\u306b\u3059\u308b\u4eba','\u30b3\u30b9\u30d1\u6700\u5f37\u8ad6\u8005','\u662d\u548c\u306e\u307b\u3046\u304c\u3088\u304b\u3063\u305f\u4eba','Z\u4e16\u4ee3\u306b\u7269\u7533\u3059\u4eba','\u6b63\u8ad6\u3067\u4eba\u3092\u50b7\u3064\u3051\u308b\u4eba',\n  '\u8b70\u8ad6\u30de\u30cb\u30a2\u306e\u7121\u8077','\u30d5\u30a1\u30af\u30c8\u30c1\u30a7\u30c3\u30af\u8b66\u5bdf','\u533f\u540d\u3067\u5f37\u3044\u4eba','\u306a\u3093\u3067\u3082\u6570\u5b57\u3067\u8a9e\u308b\u4eba','\u6279\u5224\u7684\u601d\u8003\u306e\u584a',\n  '\u30d6\u30c3\u30c0','\u30bd\u30af\u30e9\u30c6\u30b9','\u5fb3\u5ddd\u5bb6\u5eb7','\u30af\u30ec\u30aa\u30d1\u30c8\u30e9','\u7e54\u7530\u4fe1\u9577',\n  '\u30ca\u30dd\u30ec\u30aa\u30f3','\u30a8\u30b8\u30bd\u30f3','\u30ec\u30aa\u30ca\u30eb\u30c9\u30fb\u30c0\u30fb\u30f4\u30a3\u30f3\u30c1','\u30b8\u30e5\u30ea\u30a2\u30b9\u30fb\u30b7\u30fc\u30b6\u30fc','\u30de\u30ea\u30fc\u30fb\u30ad\u30e5\u30ea\u30fc',\n  '\u5b54\u5b50','\u7d2b\u5f0f\u90e8','\u5742\u672c\u9f8d\u99ac','\u897f\u90f7\u9686\u76db','\u30a2\u30ec\u30ad\u30b5\u30f3\u30c0\u30fc\u5927\u738b',\n  '\u30de\u30eb\u30b3\u30fb\u30dd\u30fc\u30ed','\u30ac\u30ea\u30ec\u30aa\u30fb\u30ac\u30ea\u30ec\u30a4','\u6e90\u983c\u671d','\u30e2\u30fc\u30c4\u30a1\u30eb\u30c8','\u8056\u30d5\u30e9\u30f3\u30c1\u30a7\u30b9\u30b3',\n  '\u901a\u308a\u3059\u304c\u308a\u306e\u30d7\u30ed','\u5168\u90e8\u898b\u3066\u305f\u4eba','\u306a\u305c\u304b\u8a73\u3057\u3044\u304a\u3058\u3055\u3093','\u30d0\u30ba\u308a\u305f\u3044\u4f1a\u793e\u54e1','\u30b3\u30e1\u6b04\u306e\u826f\u5fc3',\n  '\u73fe\u5b9f\u9003\u907f\u4e2d\u306e\u793e\u4f1a\u4eba','\u591c\u66f4\u304b\u3057\u540c\u76df\u4f1a\u9577','\u304a\u5f01\u5f53\u4f5c\u308a\u5fd8\u308c\u305f\u4eba','\u81ea\u708a\u5931\u6557\u6b7410\u5e74','\u81ea\u8ee2\u8eca\u3053\u304e\u904e\u304e\u3066\u8db3\u30d1\u30f3\u30d1\u30f3',\n  '\u30da\u30c3\u30c8\u52d5\u753b\u3057\u304b\u898b\u306a\u3044\u4eba','\u63a8\u3057\u8a9e\u308a\u304c\u6b62\u307e\u3089\u306a\u3044','\u6563\u6b69\u4e2d\u306b\u54f2\u5b66\u3059\u308b\u4eba','\u968e\u6bb5\u3088\u308a\u7d76\u5bfe\u30a8\u30ec\u30d9\u30fc\u30bf\u30fc\u6d3e','\u8aad\u307f\u304b\u3051\u306e\u672c\u304c15\u518a\u3042\u308b\u4eba',\n];\n\n// ===================================================\n//  \u30a2\u30d7\u30ea\u72b6\u614b\n// ===================================================\nlet user     = { name:'', id:'', avatar:'\ud83d\ude0a', interests:[], theme:'dark' };\n// \u30e2\u30fc\u30c9\u3054\u3068\u306b\u72ec\u7acb\u3057\u305f\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\nlet mPosts   = { influencer:[], mental:[], debate:[], legend:[] };\nlet trends   = [];\nlet notifs   = [];\nlet curMode  = 'influencer';\nlet curPanel = 'timeline';\nlet busy     = false;\nlet pidCtr   = 0;\nlet unread   = 0;\nlet ltimers  = [];\nlet selAv_   = '\ud83d\ude0a';\nlet selImgUrl = '';\n\n// ===================================================\n//  \u30bb\u30c3\u30c8\u30a2\u30c3\u30d7\n// ===================================================\nfunction selAv(el) {\n  document.querySelectorAll('.av-item').forEach(e => e.classList.remove('sel'));\n  el.classList.add('sel');\n  selAv_ = el.dataset.av;\n}\nfunction togInt(el) { el.classList.toggle('sel'); }\nfunction chkSetup() {\n  const n = document.getElementById('sName').value.trim();\n  const i = document.getElementById('sId').value.trim();\n  document.getElementById('setupBtn').disabled = !(n && i);\n}\n\nasync function doSetup() {\n  const name = document.getElementById('sName').value.trim();\n  const id   = '@' + document.getElementById('sId').value.trim().replace(/^@/, '');\n  const interests = [...document.querySelectorAll('.int-tag.sel')].map(e => e.textContent.trim());\n  // \u672c\u5f53\u306b\u65b0\u898f\u767b\u9332\u304b\uff08\u65e2\u5b58\u30c7\u30fc\u30bf\u304c\u306a\u3044\uff09\u304b\u3092\u5224\u5b9a\n  const isNewUser = !user.name;\n  user = { name, id, avatar: selAv_, interests, theme: user.theme || 'dark' };\n  saveData();\n  // \u65b0\u898f\u30e6\u30fc\u30b6\u30fc\u306e\u307fAPI\u3067\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u3092\u53d6\u5f97\u3002\u7de8\u96c6\u6642\u306f\u65e2\u5b58TL\u3092\u7dad\u6301\n  await toMain(isNewUser);\n}\n\n// ===================================================\n//  \u30e1\u30a4\u30f3\u753b\u9762\u3078\u79fb\u884c\n// ===================================================\nasync function toMain(isNew = false) {\n  document.getElementById('setupScreen').classList.remove('active');\n  const ms = document.getElementById('mainScreen');\n  ms.classList.add('active');\n  ms.style.display = 'flex';\n  applyMode(curMode);\n  applyTheme(user.theme || 'dark');\n  updCmpAv();\n  renderTL();\n  renderTrends();\n  updProfile();\n  renderNotifs();\n  if (isNew) {\n    reqNotifPerm();\n    // Firebase \u304b\u3089\u65e2\u5b58\u30c7\u30fc\u30bf\u3092\u8aad\u307f\u8fbc\u3080\n    const fbData = await fbLoad();\n    if (fbData && fbData.pidCtr > pidCtr) {\n      // \u30af\u30e9\u30a6\u30c9\u306e\u30c7\u30fc\u30bf\u306e\u65b9\u304c\u65b0\u3057\u3051\u308c\u3070\u30de\u30fc\u30b8\n      mPosts = fbData.mPosts || mPosts;\n      trends = fbData.trends || trends;\n      notifs = fbData.notifs || notifs;\n      pidCtr = fbData.pidCtr || pidCtr;\n      renderTL(); renderTrends(); renderNotifs();\n    }\n    await loadInitTL();\n  }\n  await checkFirebase();\n  hideLd();\n}\n\n// ===================================================\n//  \u30c6\u30fc\u30de\u5207\u66ff\n// ===================================================\nfunction applyTheme(t) {\n  document.documentElement.setAttribute('data-theme', t);\n  document.getElementById('btnTheme').textContent = t === 'dark' ? '\ud83c\udf19' : '\u2600\ufe0f';\n}\nfunction toggleTheme() {\n  user.theme = user.theme === 'dark' ? 'light' : 'dark';\n  applyTheme(user.theme);\n  saveData();\n}\n\n// ===================================================\n//  \u30e2\u30fc\u30c9\u30e2\u30fc\u30c0\u30eb\n// ===================================================\nfunction openModal() {\n  document.getElementById('modeModal').classList.add('open');\n  document.querySelectorAll('.mode-card').forEach(c =>\n    c.classList.toggle('cur', c.dataset.mode === curMode));\n}\nfunction bgClose(e) {\n  if (e.target === document.getElementById('modeModal'))\n    document.getElementById('modeModal').classList.remove('open');\n}\nfunction selectMode(mode) {\n  document.getElementById('modeModal').classList.remove('open');\n  if (mode === curMode) return;\n  curMode = mode;\n  applyMode(mode);\n  showPanel('timeline');\n  saveData();\n}\nfunction applyMode(mode) {\n  const c = MC[mode];\n  document.documentElement.style.setProperty('--acc', c.acc);\n  document.getElementById('modeBadge').textContent = c.badge;\n  const inp = document.getElementById('postInput');\n  if (inp) inp.placeholder = c.ph;\n  updCmpAv();\n  renderTL(); // \u30e2\u30fc\u30c9\u5207\u66ff\u6642\u306f\u305d\u306e\u30e2\u30fc\u30c9\u306eTL\u3092\u8868\u793a\n}\n\n// ===================================================\n//  \u30d1\u30cd\u30eb\u5207\u66ff\n// ===================================================\nfunction showPanel(name) {\n  curPanel = name;\n  document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));\n  document.getElementById('compose').style.display = name === 'timeline' ? '' : 'none';\n  ['btnNotif','btnTrends','btnProfile'].forEach(id => document.getElementById(id).classList.remove('on'));\n  const map = { timeline:'pTimeline', notif:'pNotif', trends:'pTrends', profile:'pProfile' };\n  document.getElementById(map[name] || 'pTimeline').classList.add('on');\n  if (name === 'notif')   { document.getElementById('btnNotif').classList.add('on'); markRead(); renderNotifs(); }\n  if (name === 'trends')  { document.getElementById('btnTrends').classList.add('on'); renderTrends(); }\n  if (name === 'profile') { document.getElementById('btnProfile').classList.add('on'); updProfile(); }\n}\n\n// ===================================================\n//  \u521d\u56de\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\uff08\u8d77\u52d5\u6642\u306e\u307fAPI\u547c\u3073\u51fa\u3057\uff09\n// ===================================================\nasync function loadInitTL() {\n  if (!user.interests.length) return;\n  // \u65e2\u306b\u3053\u306e\u30e2\u30fc\u30c9\u306eTL\u306b\u30c7\u30fc\u30bf\u304c\u3042\u308b\u5834\u5408\u306fAPI\u3092\u547c\u3070\u306a\u3044\n  if (mPosts[curMode] && mPosts[curMode].length > 0) return;\n  showLd('\u3042\u306a\u305f\u306e\u8da3\u5473\u306b\u5408\u308f\u305b\u305f\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u3092\u6e96\u5099\u4e2d\u2026');\n  try {\n    const r = await fetch('/api/timeline', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ interests: user.interests, mode: curMode })\n    });\n    if (!r.ok) throw new Error('HTTP ' + r.status);\n    const { posts = [] } = await r.json();\n    posts.forEach(p => mPosts[curMode].push(mkAI(p, curMode)));\n    renderTL();\n    saveData();\n    startLikeSim();\n  } catch(e) {\n    console.warn('initTL:', e.message);\n  }\n  hideLd();\n}\n\n// ===================================================\n//  \u6295\u7a3f\u9001\u4fe1\n// ===================================================\nasync function submitPost() {\n  const ta = document.getElementById('postInput');\n  const text = ta.value.trim();\n  if (!text || busy) return;\n  busy = true;\n  document.getElementById('sendBtn').disabled = true;\n  ta.value = ''; ta.style.height = 'auto';\n  showPanel('timeline');\n\n  // \u30e6\u30fc\u30b6\u30fc\u6295\u7a3f\u3092\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u306b\u8ffd\u52a0\n  const pid = ++pidCtr;\n  const imgUrl = selImgUrl;\n  const up = {\n    id: pid, type: 'user', text,\n    name: user.name, uid: user.id, avatar: user.avatar,\n    mode: curMode, likes: 0, liked: false, comments: [], ts: Date.now(),\n    img: imgUrl\n  };\n  selImgUrl = '';\n  document.getElementById('imgStrip').style.display = 'none';\n  document.getElementById('imgList').innerHTML = '';\n  adjustPanelPb(false);\n\n  mPosts[curMode].push(up);\n  renderTL();\n\n  // \u30ed\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9\u30923\u679a\u8868\u793a\n  const lids = ['a','b','c'].map(x => `ld-${pid}-${x}`);\n  lids.forEach(id => addLdCard(id));\n  scrollBot();\n\n  try {\n    const r = await fetch('/api/post', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ text, mode: curMode, interests: user.interests })\n    });\n    if (!r.ok) {\n      if (r.status === 429) throw new Error('RATE_LIMIT');\n      const d = await r.json().catch(() => ({}));\n      if (d.error === 'QUOTA_EXCEEDED') throw new Error('QUOTA_EXCEEDED');\n      throw new Error('HTTP_' + r.status);\n    }\n    const { replies = [], timelinePosts = [] } = await r.json();\n\n    // \u30ed\u30fc\u30c7\u30a3\u30f3\u30b0\u524a\u9664\n    lids.forEach(id => document.getElementById(id)?.remove());\n\n    // replies \u2192 \u30b3\u30e1\u30f3\u30c8\u6b04\u306b\u683c\u7d0d\uff08\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u306b\u306f\u51fa\u3055\u306a\u3044\uff09\n    if (replies.length) {\n      up.comments.push(...replies.map(r => ({\n        a: r.name, t: r.comment, av: r.avatar || '\ud83e\udd16', lk: r.likes || 0\n      })));\n      const cc = document.getElementById('cc-' + pid);\n      if (cc) cc.textContent = up.comments.length;\n    }\n\n    // timelinePosts \u2192 \u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u306b\u6d41\u308c\u308bAI\u306e\u3064\u3076\u3084\u304d\n    timelinePosts.forEach((p, i) => {\n      const ap = mkAI(p, curMode);\n      mPosts[curMode].push(ap);\n      setTimeout(() => { appendCard(ap); scrollBot(); }, i * 200 + 100);\n    });\n\n    addHashtags(text);\n    scheduleAutoLikes(pid);\n    setTimeout(() => { saveData(); renderTrends(); }, 1500);\n\n  } catch(err) {\n    lids.forEach(id => document.getElementById(id)?.remove());\n    const fb = getFallback(curMode);\n    if (err.message === 'RATE_LIMIT') {\n      toast('\u26a0\ufe0f \u5c11\u3057\u5f85\u3063\u3066\u304b\u3089\u6295\u7a3f\u3057\u3066\u304f\u3060\u3055\u3044');\n    } else if (err.message === 'QUOTA_EXCEEDED') {\n      toast('\ud83d\ude14 AI\u306e\u5229\u7528\u4e0a\u9650\u306b\u9054\u3057\u307e\u3057\u305f\u3002\u3057\u3070\u3089\u304f\u5f8c\u3067');\n      up.comments.push(...fb.map(r => ({ a:r.name, t:r.comment, av:r.avatar||'\ud83e\udd16', lk:r.likes||0 })));\n      document.getElementById('cc-'+pid)?.textContent !== undefined &&\n        (document.getElementById('cc-'+pid).textContent = up.comments.length);\n    } else {\n      console.warn('API error:', err.message);\n      up.comments.push(...fb.map(r => ({ a:r.name, t:r.comment, av:r.avatar||'\ud83e\udd16', lk:r.likes||0 })));\n      const cc = document.getElementById('cc-'+pid);\n      if (cc) cc.textContent = up.comments.length;\n    }\n    scheduleAutoLikes(pid);\n    saveData();\n  }\n\n  busy = false;\n  document.getElementById('sendBtn').disabled = document.getElementById('postInput').value.trim() === '';\n  saveData();\n}\n\n// ===================================================\n//  \u30d8\u30eb\u30d1\u30fc: AI\u6295\u7a3f\u30aa\u30d6\u30b8\u30a7\u30af\u30c8\u751f\u6210\n// ===================================================\nfunction mkAI(p, mode) {\n  return {\n    id: ++pidCtr, type: 'ai',\n    text: p.comment, name: p.name, uid: p.id || '',\n    avatar: p.avatar || '\ud83c\udf1f', mode,\n    likes: p.likes || Math.floor(Math.random() * 5000) + 10,\n    liked: false, comments: [], ts: Date.now()\n  };\n}\n\n// ===================================================\n//  \u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u63cf\u753b\n// ===================================================\nfunction renderTL() {\n  const panel = document.getElementById('pTimeline');\n  const posts = mPosts[curMode] || [];\n  if (!posts.length) {\n    panel.innerHTML = '<div class=\"empty\"><div class=\"empty-ico\">\ud83e\udea3</div><div class=\"empty-ttl\">\u4e95\u6238\u7aef\u4f1a\u8b70\u3078\u3088\u3046\u3053\u305d\uff01</div><div class=\"empty-txt\">\u4f55\u3067\u3082\u3064\u3076\u3084\u3044\u3066\u307f\u3088\u3046\u3002<br>AI\u305f\u3061\u304c\u5fc5\u305a\u53cd\u5fdc\u3057\u3066\u304f\u308c\u308b\u3088\u2728</div></div>';\n    return;\n  }\n  panel.innerHTML = '';\n  posts.forEach(p => appendCard(p, false));\n}\n\nfunction appendCard(p, anim = true) {\n  const panel = document.getElementById('pTimeline');\n  panel.querySelector('.empty')?.remove();\n  const d = document.createElement('div');\n  d.className = 'post-card' + (p.type === 'user' ? ' mine' : '');\n  d.id = 'pc-' + p.id;\n  if (!anim) d.style.animationDuration = '0s';\n  const c = MC[p.mode] || MC.influencer;\n  const tag = p.type === 'ai' ? `<span class=\"mtag ${c.tc}\">${c.badge}</span>` : '';\n  const li  = p.liked ? '\u2764\ufe0f' : '\ud83e\udd0d';\n  d.innerHTML = `\n    <div class=\"pc-top\">\n      <div class=\"pc-av${p.type==='user'?' mine':''}\">${p.avatar}</div>\n      <div class=\"pc-meta\">\n        <div class=\"pc-nr\">\n          <span class=\"pc-name\"${p.type==='user'?' style=\"color:var(--acc)\"':''}>${esc(p.name)}</span>\n          <span class=\"pc-id\">${esc(p.uid)}</span>${tag}\n        </div>\n      </div>\n    </div>\n    <div class=\"pc-body\">${esc(p.text)}</div>\n    ${p.img ? `<img class=\"pc-img\" src=\"${esc(p.img)}\" loading=\"lazy\" onclick=\"window.open('${esc(p.img)}','_blank')\" alt=\"post image\">` : ''}\n    <div class=\"pc-acts\">\n      <button class=\"act\" onclick=\"togCmt(${p.id})\">\n        <span class=\"act-ico\">\ud83d\udcac</span><span id=\"cc-${p.id}\">${p.comments?.length||0}</span>\n      </button>\n      <button class=\"act${p.liked?' lkd':''}\" id=\"lb-${p.id}\" onclick=\"togLike(${p.id})\">\n        <span id=\"li-${p.id}\">${li}</span><span id=\"lc-${p.id}\">${fmt(p.likes)}</span>\n      </button>\n    </div>\n    <div class=\"cmt-sec\" id=\"cw-${p.id}\">\n      <div id=\"cl-${p.id}\">${renderCmts(p.comments)}</div>\n      <div class=\"cmt-add\">\n        <input class=\"cmt-inp\" id=\"ci-${p.id}\" placeholder=\"\u30b3\u30e1\u30f3\u30c8\u3092\u5165\u529b\u2026\" onkeydown=\"cmtKey(event,${p.id})\">\n        <button class=\"cmt-snd\" onclick=\"addCmt(${p.id})\">\u27a4</button>\n      </div>\n    </div>`;\n  panel.appendChild(d);\n}\n\nfunction addLdCard(lid) {\n  const panel = document.getElementById('pTimeline');\n  panel.querySelector('.empty')?.remove();\n  const d = document.createElement('div');\n  d.className = 'ld-card'; d.id = lid;\n  d.innerHTML = '<div class=\"pc-top\"><div class=\"pc-av\">\u23f3</div><div class=\"pc-meta\"><div class=\"pc-nr\"><span class=\"pc-name\" style=\"color:var(--sub)\">\u8003\u3048\u4e2d\u2026</span></div></div></div><div class=\"typing\"><div class=\"dot\"></div><div class=\"dot\"></div><div class=\"dot\"></div></div>';\n  panel.appendChild(d);\n}\n\nfunction renderCmts(cmts) {\n  if (!cmts?.length) return '';\n  return cmts.map(c => `\n    <div class=\"cmt-item\">\n      <div class=\"cmt-who\"><span class=\"cmt-av\">${c.av||'\ud83e\udd16'}</span>${esc(c.a)}</div>\n      <div>${esc(c.t)}</div>\n    </div>`).join('');\n}\n\n// ===================================================\n//  \u30a4\u30f3\u30bf\u30e9\u30af\u30b7\u30e7\u30f3\n// ===================================================\nfunction togLike(pid) {\n  const p = findPost(pid); if (!p) return;\n  p.liked = !p.liked; p.likes += p.liked ? 1 : -1;\n  const btn = document.getElementById('lb-'+pid);\n  if (btn) {\n    btn.className = 'act' + (p.liked ? ' lkd' : '');\n    btn.innerHTML = `<span id=\"li-${pid}\">${p.liked?'\u2764\ufe0f':'\ud83e\udd0d'}</span><span id=\"lc-${pid}\">${fmt(p.likes)}</span>`;\n    if (p.liked) { btn.classList.add('lpop'); setTimeout(() => btn.classList.remove('lpop'), 400); }\n  }\n  if (p.liked) showLikeFloat();\n  saveData();\n}\nfunction findPost(pid) {\n  for (const arr of Object.values(mPosts)) {\n    const p = arr.find(x => x.id === pid);\n    if (p) return p;\n  }\n  return null;\n}\nfunction togCmt(pid) { document.getElementById('cw-'+pid)?.classList.toggle('open'); }\nfunction cmtKey(e, pid) { if (e.key === 'Enter') addCmt(pid); }\nfunction addCmt(pid) {\n  const inp = document.getElementById('ci-'+pid); if (!inp) return;\n  const t = inp.value.trim(); if (!t) return;\n  const p = findPost(pid); if (!p) return;\n  p.comments.push({ a: user.name || '\u3042\u306a\u305f', t, av: user.avatar });\n  inp.value = '';\n  const cl = document.getElementById('cl-'+pid);\n  if (cl) cl.innerHTML = renderCmts(p.comments);\n  const cc = document.getElementById('cc-'+pid);\n  if (cc) cc.textContent = p.comments.length;\n  saveData(); toast('\ud83d\udcac \u30b3\u30e1\u30f3\u30c8\u3057\u307e\u3057\u305f\uff01');\n}\n\n// ===================================================\n//  \u81ea\u52d5\u3044\u3044\u306d\u30b7\u30df\u30e5\u30ec\u30fc\u30b7\u30e7\u30f3\n// ===================================================\nfunction scheduleAutoLikes(pid) {\n  [\n    {d:20000, mn:2, mx:15},\n    {d:70000, mn:8, mx:60},\n    {d:200000, mn:25, mx:180},\n    {d:450000, mn:60, mx:450},\n    {d:800000, mn:120, mx:1000},\n  ].forEach(({d, mn, mx}) => {\n    ltimers.push(setTimeout(() =>\n      autoLike(pid, Math.floor(Math.random() * (mx - mn) + mn)),\n      d + Math.random() * 15000));\n  });\n}\n\nfunction autoLike(pid, cnt) {\n  const p = findPost(pid); if (!p) return;\n  p.likes += cnt;\n  const lc = document.getElementById('lc-'+pid);\n  if (lc) lc.textContent = fmt(p.likes);\n  const lb = document.getElementById('lb-'+pid);\n  if (lb) { lb.classList.add('lpop'); setTimeout(() => lb.classList.remove('lpop'), 400); }\n  const who = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];\n  const msg = cnt >= 50\n    ? `\ud83d\udd25 ${who}\u3055\u3093\u307b\u304b${fmt(cnt)}\u4eba\u304c\u3042\u306a\u305f\u306e\u6295\u7a3f\u3092\u3044\u3044\u306d\uff01`\n    : `\u2764\ufe0f ${who}\u3055\u3093\u304c\u3044\u3044\u306d\u3057\u307e\u3057\u305f`;\n  addNotif(msg, p.text);\n  pushNotif('\u3044\u3069\u3070\u305f\u901a\u77e5', msg);\n  showLikeFloat();\n  saveData();\n}\n\nfunction startLikeSim() {\n  ltimers.push(setInterval(() => {\n    const all = Object.values(mPosts).flat().filter(p => p.type === 'user');\n    if (!all.length) return;\n    autoLike(all[Math.floor(Math.random() * all.length)].id,\n             Math.floor(Math.random() * 30) + 1);\n  }, 90000 + Math.random() * 90000));\n}\n\nfunction showLikeFloat() {\n  const el = document.createElement('div');\n  el.className = 'lf'; el.textContent = '\u2764\ufe0f';\n  el.style.left = (80 + Math.random() * 200) + 'px';\n  el.style.bottom = '100px';\n  document.getElementById('app').appendChild(el);\n  setTimeout(() => el.remove(), 1300);\n}\n\n// ===================================================\n//  \u901a\u77e5\n// ===================================================\nfunction reqNotifPerm() {\n  if ('Notification' in window && Notification.permission === 'default')\n    Notification.requestPermission();\n}\nfunction pushNotif(title, body) {\n  if ('Notification' in window && Notification.permission === 'granted')\n    try { new Notification(title, {body}); } catch(e) {}\n}\nfunction addNotif(text, postText = '') {\n  notifs.unshift({\n    text,\n    pt: postText.slice(0, 30) + (postText.length > 30 ? '\u2026' : ''),\n    ts: Date.now(), read: false\n  });\n  unread++;\n  document.getElementById('ndot').classList.add('show');\n  if (curPanel === 'notif') renderNotifs();\n  saveData();\n}\nfunction renderNotifs() {\n  const list = document.getElementById('notifList');\n  if (!notifs.length) { list.innerHTML = '<div class=\"no-notif\">\u307e\u3060\u901a\u77e5\u306f\u3042\u308a\u307e\u305b\u3093</div>'; return; }\n  list.innerHTML = notifs.slice(0, 30).map(n => `\n    <div class=\"notif-item${n.read ? '' : ' unread'}\">\n      <div class=\"ni-ico\">${n.text.startsWith('\ud83d\udd25') ? '\ud83d\udd25' : '\u2764\ufe0f'}</div>\n      <div class=\"ni-body\">\n        <div class=\"ni-text\">${esc(n.text)}</div>\n        <div class=\"ni-time\">${n.pt ? `\u300c${esc(n.pt)}\u300d\u3078\u306e\u53cd\u5fdc \u00b7 ` : ''}${timeAgo(n.ts)}</div>\n      </div>\n    </div>`).join('');\n}\nfunction markRead() {\n  notifs.forEach(n => n.read = true); unread = 0;\n  document.getElementById('ndot').classList.remove('show');\n  saveData();\n}\nfunction clearNotifs() {\n  notifs = []; unread = 0;\n  document.getElementById('ndot').classList.remove('show');\n  renderNotifs(); saveData();\n}\n\n// ===================================================\n//  \u30c8\u30ec\u30f3\u30c9\n// ===================================================\n// ===================================================\n//  \u30c8\u30ec\u30f3\u30c9\uff08\u30e6\u30fc\u30b6\u30fc\u6295\u7a3f\uff0b\u8208\u5473\u306e\u307f\uff09\n// ===================================================\nfunction addHashtags(text) {\n  (text.match(/#[\\w\\u3000-\\u9FFF\\uF900-\\uFAFF]+/g) || []).forEach(tag => {\n    const ex = trends.find(t => t.tag === tag);\n    if (ex) { ex.cnt++; ex.lastSeen = Date.now(); }\n    else trends.push({tag, cnt:1, mode:curMode, src:'post', lastSeen:Date.now()});\n  });\n}\n\nfunction buildTrendsData() {\n  const result = [];\n  const seen = new Set();\n\n  // \u2460 \u30e6\u30fc\u30b6\u30fc\u306e\u6295\u7a3f\u30c6\u30ad\u30b9\u30c8\u304b\u3089\u62bd\u51fa\u3057\u305f\u30cf\u30c3\u30b7\u30e5\u30bf\u30b0\n  Object.values(mPosts).flat()\n    .filter(p => p.type === 'user')\n    .forEach(p => {\n      (p.text.match(/#[\\w\\u3000-\\u9FFF\\uF900-\\uFAFF]+/g) || []).forEach(tag => {\n        if (seen.has(tag)) { const ex=result.find(t=>t.tag===tag); if(ex)ex.cnt++; return; }\n        seen.add(tag);\n        const stored = trends.find(t => t.tag === tag);\n        result.push({tag, cnt: stored ? stored.cnt : 1, src:'post', mode: p.mode});\n      });\n    });\n\n  // \u2461 trends\u306b\u84c4\u7a4d\u3055\u308c\u305f\u30cf\u30c3\u30b7\u30e5\u30bf\u30b0\uff08\u6295\u7a3f\u6642\u306baddHashtags\u3067\u8ffd\u52a0\u3055\u308c\u305f\u3082\u306e\uff09\n  trends.forEach(t => {\n    if (!seen.has(t.tag)) {\n      seen.add(t.tag);\n      result.push({...t, src: t.src||'post'});\n    }\n  });\n\n  // \u2462 \u30e6\u30fc\u30b6\u30fc\u306e\u8208\u5473\u30bf\u30b0\uff08\u6295\u7a3f\u304c\u306a\u3044\u5834\u5408\u3067\u3082\u8868\u793a\uff09\n  (user.interests || []).forEach(int => {\n    const tag = '#' + int.replace(/^[\\s\\S]+\\s/, '').trim();\n    if (!tag || tag === '#' || seen.has(tag)) return;\n    seen.add(tag);\n    result.push({tag, cnt: 0, src:'int', mode: curMode});\n  });\n\n  return result.sort((a, b) => b.cnt - a.cnt);\n}\n\nfunction renderTrends() {\n  const list = document.getElementById('trendsList');\n  const data = buildTrendsData();\n\n  if (!data.length) {\n    list.innerHTML = `\n      <div class=\"tr-empty\">\n        <div class=\"tr-empty-ico\">\ud83d\udcc8</div>\n        <div class=\"tr-empty-ttl\">\u307e\u3060\u30c8\u30ec\u30f3\u30c9\u304c\u3042\u308a\u307e\u305b\u3093</div>\n        <div class=\"tr-empty-txt\">\u6295\u7a3f\u306b #\u30cf\u30c3\u30b7\u30e5\u30bf\u30b0 \u3092\u4ed8\u3051\u308b\u3068<br>\u3053\u3053\u306b\u96c6\u8a08\u3055\u308c\u307e\u3059\u3002<br>\u8208\u5473\u30bf\u30b0\u3082\u767b\u9332\u3057\u3066\u304a\u304f\u3068\u3059\u3050\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u2728</div>\n      </div>`;\n    return;\n  }\n\n  const ml = {influencer:'\u30a4\u30f3\u30d5\u30eb\u30a8\u30f3\u30b5\u30fc',mental:'\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2',debate:'\u30c7\u30a3\u30d9\u30fc\u30c8',legend:'\u30ec\u30b8\u30a7\u30f3\u30c9\u30c8\u30fc\u30af'};\n  const srcLabel = {post:'\u3042\u306a\u305f\u306e\u6295\u7a3f', int:'\u3042\u306a\u305f\u306e\u8208\u5473', ai:'AI\u3064\u3076\u3084\u304d'};\n  const srcCls   = {post:'ts-post', int:'ts-int', ai:'ts-ai'};\n\n  // \u6295\u7a3f\u30bf\u30b0\u3068\u8208\u5473\u30bf\u30b0\u3092\u30bb\u30af\u30b7\u30e7\u30f3\u5206\u3051\n  const postTags = data.filter(t => t.src === 'post' || t.src === 'ai');\n  const intTags  = data.filter(t => t.src === 'int');\n\n  let html = '';\n\n  if (postTags.length) {\n    html += '<div class=\"tr-sec\">\ud83d\udcdd \u6295\u7a3f\u304b\u3089</div>';\n    postTags.slice(0, 10).forEach((t, i) => {\n      html += `\n        <div class=\"tr-item\" onclick=\"useTrend('${t.tag.replace(/'/g,\"\\\\'\")}')\">\n          <div class=\"tr-rank${i < 3 ? ' top' : ''}\">${i+1}</div>\n          <div class=\"tr-info\">\n            <div class=\"tr-tag\">${esc(t.tag)}</div>\n            <div class=\"tr-meta\">${ml[t.mode]||t.mode} <span class=\"tr-src ${srcCls[t.src]||'ts-post'}\">${srcLabel[t.src]||''}</span></div>\n          </div>\n          <div class=\"tr-cnt\">${t.cnt > 0 ? fmt(t.cnt)+'\u4ef6' : '\u2014'}</div>\n        </div>`;\n    });\n  }\n\n  if (intTags.length) {\n    html += '<div class=\"tr-sec\">\ud83d\udca1 \u3042\u306a\u305f\u306e\u8208\u5473</div>';\n    intTags.forEach((t, i) => {\n      html += `\n        <div class=\"tr-item\" onclick=\"useTrend('${t.tag.replace(/'/g,\"\\\\'\")}')\">\n          <div class=\"tr-rank\" style=\"color:var(--sub)\">\u2014</div>\n          <div class=\"tr-info\">\n            <div class=\"tr-tag\">${esc(t.tag)}</div>\n            <div class=\"tr-meta\"><span class=\"tr-src ts-int\">\u3042\u306a\u305f\u306e\u8208\u5473</span></div>\n          </div>\n          <div class=\"tr-cnt\" style=\"color:var(--acc);font-size:11px;\">\u30bf\u30c3\u30d7\u3057\u3066\u6295\u7a3f</div>\n        </div>`;\n    });\n  }\n\n  list.innerHTML = html;\n}\nfunction useTrend(tag) {\n  showPanel('timeline');\n  const inp = document.getElementById('postInput');\n  if (inp) { inp.value = tag + ' '; inp.focus(); document.getElementById('sendBtn').disabled = false; }\n}\n\n// ===================================================\n//  \u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\n// ===================================================\nfunction updProfile() {\n  document.getElementById('prAv').textContent   = user.avatar || '\ud83d\ude0a';\n  document.getElementById('prName').textContent = user.name   || '\u2014';\n  document.getElementById('prId').textContent   = user.id     || '@\u2014';\n  const all = Object.values(mPosts).flat();\n  document.getElementById('stP').textContent = all.filter(p => p.type === 'user').length;\n  document.getElementById('stL').textContent = fmt(all.reduce((s,p) => s + (p.liked?1:0), 0));\n  document.getElementById('stC').textContent = all.reduce((s,p) => s + (p.comments?.length||0), 0);\n  document.getElementById('prInts').innerHTML =\n    (user.interests||[]).map(i => `<div class=\"pr-tag\">${esc(i)}</div>`).join('') ||\n    '<span style=\"color:var(--sub);font-size:13px;\">\u672a\u8a2d\u5b9a</span>';\n}\nfunction updCmpAv() {\n  const el = document.getElementById('cmpAv');\n  if (el) el.textContent = user.avatar || '\ud83d\ude0a';\n}\nfunction editProfile() {\n  document.getElementById('sName').value = user.name;\n  document.getElementById('sId').value   = user.id.replace('@','');\n  document.querySelectorAll('.av-item').forEach(e => e.classList.toggle('sel', e.dataset.av === user.avatar));\n  document.querySelectorAll('.int-tag').forEach(e => e.classList.toggle('sel', user.interests.includes(e.textContent.trim())));\n  selAv_ = user.avatar;\n  document.getElementById('setupBtn').textContent = '\u66f4\u65b0\u3059\u308b \u2192';\n  document.getElementById('setupBtn').disabled = false;\n  document.getElementById('mainScreen').classList.remove('active');\n  document.getElementById('mainScreen').style.display = 'none';\n  document.getElementById('setupScreen').classList.add('active');\n}\nfunction clearAll() {\n  if (!confirm('\u3059\u3079\u3066\u306e\u30c7\u30fc\u30bf\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f')) return;\n  ltimers.forEach(t => clearTimeout(t)); ltimers = [];\n  localStorage.removeItem(STORE_KEY);\n  mPosts = {influencer:[],mental:[],debate:[],legend:[]};\n  trends = []; notifs = []; pidCtr = 0; unread = 0;\n  user = {name:'',id:'',avatar:'\ud83d\ude0a',interests:[],theme:user.theme};\n  document.getElementById('mainScreen').classList.remove('active');\n  document.getElementById('mainScreen').style.display = 'none';\n  document.getElementById('setupScreen').classList.add('active');\n  ['sName','sId'].forEach(id => document.getElementById(id).value = '');\n  document.getElementById('setupBtn').disabled = true;\n  document.getElementById('setupBtn').textContent = '\u3044\u3069\u3070\u305f\u3092\u306f\u3058\u3081\u308b \u2192';\n  document.querySelectorAll('.int-tag,.av-item').forEach(e => e.classList.remove('sel'));\n  document.querySelector('.av-item').classList.add('sel');\n  selAv_ = '\ud83d\ude0a';\n}\n\n// ===================================================\n//  \u30d5\u30a9\u30fc\u30eb\u30d0\u30c3\u30af\u8fd4\u4fe1\n// ===================================================\nfunction getFallback(mode) {\n  const s = {\n    influencer:[\n      {name:'\u8c61\u306e\u308a\u9020',id:'@zou',avatar:'\ud83d\udc18',comment:'\u3053\u308c\u306f\u30d0\u30ba\u308b\u3084\u3064\uff01\uff01\u5b8c\u5168\u306b\u540c\u610f\ud83d\udd25',likes:2341},\n      {name:'\u7b4b\u8089\u5bff\u559c\u7537',id:'@kinniku',avatar:'\ud83d\udcaa',comment:'\u3081\u3061\u3083\u304f\u3061\u3083\u308f\u304b\u308b\u301c\uff01\u6bce\u65e5\u3053\u308c\u601d\u3063\u3066\u305f\u7b11',likes:887},\n      {name:'\u30c1\u30ef\u30ef\u306b\u306a\u308a\u305f\u3044\u72ac',id:'@chiwawa',avatar:'\ud83d\udc15',comment:'\u5929\u624d\u304b\uff1f\uff1fSNS\u306b\u6d41\u3057\u3066\u307b\u3057\u3044',likes:321},\n    ],\n    mental:[\n      {name:'\u30d1\u30bd\u30b3\u30f3\u3081\u304c\u306d',id:'@megane',avatar:'\ud83d\udc53',comment:'\u305d\u308c\u3001\u3059\u3054\u304f\u8f9b\u304b\u3063\u305f\u306d\u3002\u8a71\u3057\u3066\u304f\u308c\u3066\u3042\u308a\u304c\u3068\u3046\u3002',likes:102},\n      {name:'\u3054\u98ef\u529b\u58eb',id:'@gohan',avatar:'\ud83c\udf5a',comment:'\u3042\u306a\u305f\u306e\u6c17\u6301\u3061\u3001\u3061\u3083\u3093\u3068\u53d7\u3051\u53d6\u3063\u305f\u3088\u3002\u7121\u7406\u3057\u306a\u3044\u3067\u3002',likes:580},\n    ],\n    debate:[\n      {name:'\u3089\u304f\u3060\u5c0f\u50e7',id:'@rakuda',avatar:'\ud83d\udc2a',comment:'\u4e00\u5ea6\u306f\u81ea\u5206\u3067\u8003\u3048\u308b\u3053\u3068\u3092\u304a\u3059\u3059\u3081\u3057\u307e\u3059\uff01\u7b54\u3048\u306f\u81ea\u5206\u306e\u4e2d\u306b\u3042\u308a\u307e\u3059\u3002',likes:1572},\n      {name:'\u5f37\u9762\u304a\u3058\u3055\u3093',id:'@kowamote',avatar:'\ud83d\ude24',comment:'\u666e\u901a\u306b\u3084\u3063\u3066\u3066\u3082\u610f\u5473\u306a\u3044\u3063\u3066\u601d\u3063\u305f\u3089AI\u306b\u4e38\u6295\u3052\u3067\u3082\u3088\u304f\u306d\u3002',likes:294},\n    ],\n    legend:[\n      {name:'\u30d6\u30c3\u30c0',id:'@buddha',avatar:'\ud83e\uddd8',comment:'\u300c\u3044\u3044\u306d\u300d\u304c\u6b32\u3057\u304f\u3066\u5fc3\u304c\u3056\u308f\u3064\u304f\u306a\u3089\u3001\u30b9\u30de\u30db\u3092\u7f6e\u3044\u3066\u76ee\u3092\u9589\u3058\u306a\u3055\u3044\u3002',likes:78000},\n      {name:'\u30bd\u30af\u30e9\u30c6\u30b9',id:'@socrates',avatar:'\ud83c\udfdb\ufe0f',comment:'\u6b63\u7fa9\u3068\u306f\u4f55\u3067\u3059\u304b\uff1f\u8ab0\u304b\u79c1\u306b\u6559\u3048\u3066\u304f\u308c\u307e\u305b\u3093\u304b\uff1f',likes:990},\n    ]\n  };\n  return s[mode] || s.influencer;\n}\n\n// ===================================================\n//  \u30e6\u30fc\u30c6\u30a3\u30ea\u30c6\u30a3\n// ===================================================\nfunction autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }\nfunction handleKey(e) {\n  if (e.key === 'Enter' && !e.shiftKey) {\n    e.preventDefault();\n    const sb = document.getElementById('sendBtn');\n    if (!sb.disabled) submitPost();\n  }\n}\nfunction scrollBot() {\n  const p = document.getElementById('pTimeline');\n  if (p) setTimeout(() => { p.scrollTop = p.scrollHeight; }, 100);\n}\nfunction fmt(n) {\n  n = Number(n) || 0;\n  if (n >= 10000) return (n / 10000).toFixed(1) + '\u4e07';\n  return n.toLocaleString();\n}\nfunction esc(s) {\n  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>');\n}\nfunction toast(msg) {\n  const t = document.getElementById('toast');\n  t.textContent = msg; t.classList.add('show');\n  setTimeout(() => t.classList.remove('show'), 2600);\n}\nfunction showLd(txt = '') {\n  document.getElementById('overlay').classList.remove('hide');\n  if (txt) document.getElementById('ovTxt').textContent = txt;\n}\nfunction hideLd() { document.getElementById('overlay').classList.add('hide'); }\nfunction timeAgo(ts) {\n  const s = Math.floor((Date.now() - ts) / 1000);\n  if (s < 60) return s + '\u79d2\u524d';\n  if (s < 3600) return Math.floor(s/60) + '\u5206\u524d';\n  if (s < 86400) return Math.floor(s/3600) + '\u6642\u9593\u524d';\n  return Math.floor(s/86400) + '\u65e5\u524d';\n}\n\n\n// ===== Unsplash \u753b\u50cf\u691c\u7d22 =====\nasync function fetchImages(query) {\n  try {\n    const kw = query.replace(/#/g,'').slice(0,30);\n    const r  = await fetch('/api/images?q=' + encodeURIComponent(kw));\n    if (!r.ok) return;\n    const {photos=[]} = await r.json();\n    const strip = document.getElementById('imgStrip');\n    const list  = document.getElementById('imgList');\n    const cred  = document.getElementById('imgCredit');\n    if (!photos.length) { strip.style.display='none'; adjustPanelPb(false); return; }\n    strip.style.display = '';\n    adjustPanelPb(true);\n    list.innerHTML = photos.map(p =>\n      `<img class=\"img-thumb\" src=\"${p.thumb}\" data-url=\"${p.url}\" data-credit=\"${esc(p.credit)}\" onclick=\"selImg(this)\" alt=\"${esc(p.alt)}\" loading=\"lazy\">`\n    ).join('');\n    cred.textContent = '';\n  } catch(e) { /* ignore */ }\n}\nfunction adjustPanelPb(imgVisible) {\n  // imgStrip\u8868\u793a\u4e2d\u306f\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u306e\u4e0b\u90e8\u4f59\u767d\u3092\u5897\u3084\u3057\u3066\u96a0\u308c\u306a\u3044\u3088\u3046\u306b\u3059\u308b\n  document.querySelectorAll('.panel').forEach(p => {\n    p.style.paddingBottom = imgVisible ? '160px' : '88px';\n  });\n}\n\nfunction manualImgSearch() {\n  const ta = document.getElementById('postInput');\n  const q  = ta.value.trim() || user.interests[0] || 'nature';\n  fetchImages(q);\n}\n\nfunction selImg(el) {\n  document.querySelectorAll('.img-thumb').forEach(t => t.classList.remove('sel'));\n  if (selImgUrl === el.dataset.url) {\n    selImgUrl = '';\n    document.getElementById('imgCredit').textContent = '';\n  } else {\n    el.classList.add('sel');\n    selImgUrl = el.dataset.url;\n    document.getElementById('imgCredit').textContent =\n      el.dataset.credit ? 'Photo by ' + el.dataset.credit + ' on Unsplash' : '';\n  }\n}\n\n// ===== Firebase \u540c\u671f =====\nlet fbEnabled = false;\nasync function checkFirebase() {\n  try {\n    const r = await fetch('/api/health');\n    const d = await r.json();\n    fbEnabled = !!d.hasFirebase;\n    const bar = document.getElementById('syncBar');\n    if (fbEnabled) bar.style.display = 'flex';\n  } catch(e) {}\n}\nasync function fbSave() {\n  if (!fbEnabled || !user.id) return;\n  setSyncStatus('loading', '\u540c\u671f\u4e2d...');\n  try {\n    const payload = {user, mPosts, trends, notifs, pidCtr, curMode, unread};\n    const r = await fetch('/api/sync', {\n      method:'POST',\n      headers:{'Content-Type':'application/json','x-user-id': user.id.replace('@','')},\n      body: JSON.stringify(payload)\n    });\n    const d = await r.json();\n    setSyncStatus(d.ok ? 'ok' : 'err', d.ok ? '\u540c\u671f\u6e08\u307f' : '\u540c\u671f\u5931\u6557');\n  } catch(e) { setSyncStatus('err', '\u540c\u671f\u5931\u6557'); }\n}\nasync function fbLoad() {\n  if (!fbEnabled || !user.id) return null;\n  setSyncStatus('loading', '\u8aad\u307f\u8fbc\u307f\u4e2d...');\n  try {\n    const r = await fetch('/api/sync', {\n      headers:{'x-user-id': user.id.replace('@','')}\n    });\n    const d = await r.json();\n    if (d.ok && d.data) {\n      setSyncStatus('ok', '\u540c\u671f\u6e08\u307f');\n      return d.data;\n    }\n    setSyncStatus('err', '\u30c7\u30fc\u30bf\u306a\u3057');\n    return null;\n  } catch(e) { setSyncStatus('err', '\u540c\u671f\u5931\u6557'); return null; }\n}\nfunction setSyncStatus(status, txt) {\n  const dot = document.getElementById('syncDot');\n  const t   = document.getElementById('syncTxt');\n  dot.className = 'sync-dot ' + status;\n  t.textContent = txt;\n}\n\n// ===================================================\n//  \u4fdd\u5b58\u30fb\u8aad\u307f\u8fbc\u307f\n// ===================================================\nfunction saveData() {\n  try {\n    localStorage.setItem(STORE_KEY, JSON.stringify({user, mPosts, trends, notifs, pidCtr, curMode, unread}));\n  } catch(e) {}\n  // Firebase \u306b\u975e\u540c\u671f\u3067\u30d0\u30c3\u30af\u30a2\u30c3\u30d7\n  if (fbEnabled) clearTimeout(saveData._fb);\n  if (fbEnabled) saveData._fb = setTimeout(fbSave, 3000);\n}\nfunction loadData() {\n  try {\n    const raw = localStorage.getItem(STORE_KEY); if (!raw) return false;\n    const d = JSON.parse(raw);\n    user   = d.user   || user;\n    mPosts = d.mPosts || {influencer:[],mental:[],debate:[],legend:[]};\n    trends = d.trends || []; notifs = d.notifs || [];\n    pidCtr = d.pidCtr || 0; curMode = d.curMode || 'influencer'; unread = d.unread || 0;\n    return true;\n  } catch(e) { return false; }\n}\n\n// ===================================================\n//  \u521d\u671f\u5316\n// ===================================================\n(function init() {\n  showLd('\u8d77\u52d5\u4e2d\u2026');\n  const ok = loadData();\n  if (ok && user.name && user.id) {\n    toMain(false).then(() => {\n      if (unread > 0) document.getElementById('ndot').classList.add('show');\n      if (Object.values(mPosts).flat().some(p => p.type === 'user')) startLikeSim();\n      applyTheme(user.theme || 'dark');\n      applyMode(curMode);\n    });\n  } else {\n    hideLd();\n    document.getElementById('setupScreen').classList.add('active');\n    applyTheme('dark');\n  }\n\n  // \u6295\u7a3f\u30dc\u30bf\u30f3\u6709\u52b9\u5316\n  const ta = document.getElementById('postInput');\n  let imgDebounce;\n  if (ta) ta.addEventListener('input', () => {\n    document.getElementById('sendBtn').disabled = ta.value.trim() === '' || busy;\n    clearTimeout(imgDebounce);\n    if (ta.value.trim().length >= 4) {\n      imgDebounce = setTimeout(() => fetchImages(ta.value.trim()), 800);\n    }\n  });\n\n  // \u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u30c9\u5fa9\u5e30\u6642\u306e\u3044\u3044\u306d\u51e6\u7406\n  let hidAt = null;\n  document.addEventListener('visibilitychange', () => {\n    if (document.hidden) {\n      hidAt = Date.now();\n    } else if (hidAt) {\n      const el = Date.now() - hidAt; hidAt = null;\n      if (el > 10000) {\n        const my = Object.values(mPosts).flat().filter(p => p.type === 'user');\n        const mins = Math.max(1, Math.floor(el / 60000));\n        my.forEach(p => autoLike(p.id, Math.floor(Math.random() * mins * 25) + mins));\n      }\n    }\n  });\n})();\n</script>\n</body>\n</html>";

// ===== \u30E6\u30FC\u30C6\u30A3\u30EA\u30C6\u30A3 =====
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 200000) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...(status === 429 ? {'Retry-After':'60'} : {})
  });
  res.end(body);
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const s = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST',
        headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(s),...headers} },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode === 429) { reject(new Error('GEMINI_QUOTA_EXCEEDED')); return; }
          if (res.statusCode >= 400)  { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,300)}`)); return; }
          try { resolve(JSON.parse(raw)); } catch(e) { reject(new Error('JSON parse error: ' + raw.slice(0,200))); }
        });
      }
    );
    req.on('error', reject);
    req.write(s); req.end();
  });
}
// ===== Wikipedia\u8981\u7d04\u30ad\u30e3\u30c3\u30b7\u30e5 =====
const wikiCache = new Map();

async function fetchWikiSummary(name) {
  if (wikiCache.has(name)) return wikiCache.get(name);
  try {
    const encoded = encodeURIComponent(name);
    const d = await httpsGet(
      'ja.wikipedia.org',
      `/api/rest_v1/page/summary/${encoded}`
    );
    const summary = d.extract ? d.extract.slice(0, 300) : '';
    wikiCache.set(name, summary);
    return summary;
  } catch(e) {
    console.warn('[wiki]', name, e.message.slice(0, 60));
    return '';
  }
}

function httpsGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET',
        headers: { 'User-Agent': 'idobata-app/1.0' } },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) { reject(new Error('HTTP ' + res.statusCode)); return; }
          try { resolve(JSON.parse(raw)); } catch(e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}



// ===== AI\u30EC\u30B9\u30DD\u30F3\u30B9\u306E\u30D1\u30FC\u30B9\uFF08\u591A\u6BB5\u968E\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\uFF09=====
// ===== Claude API \u547C\u3073\u51FA\u3057 =====
const CLAUDE_KEY  = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';   // \u9AD8\u901F\u30FB\u4F4E\u30B3\u30B9\u30C8\u7248

// API\u30AD\u30FC\u306E\u3069\u3061\u3089\u304B\u304C\u4F7F\u3048\u308B\u304B\u5224\u5B9A
function hasAI() { return !!(CLAUDE_KEY || GEMINI_KEY); }

// ---- Claude\u547C\u3073\u51FA\u3057 ----
async function callClaude(systemPrompt, userPrompt) {
  await waitRL_API();
  const reqBody = {
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  };
  console.log('[claude] sending request...');
  const d = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    },
    reqBody
  );
  // Claude\u306E\u30EC\u30B9\u30DD\u30F3\u30B9\u5F62\u5F0F: d.content[0].text
  const raw = d.content?.[0]?.text || '';
  console.log('[claude] raw:', raw.slice(0, 300));
  return parseAI(raw);
}

// ---- Gemini\u547C\u3073\u51FA\u3057\uFF08\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\u7528\uFF09----
async function callGemini(prompt, schema) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY\u672A\u8A2D\u5B9A');
  checkRPD();
  await waitRL_API();
  const reqBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 2500,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };
  const d = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {}, reqBody
  );
  const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return parseAI(raw);
}

// ---- \u7D71\u5408\u547C\u3073\u51FA\u3057: Claude\u512A\u5148 \u2192 Gemini\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF ----
async function callAI(systemPrompt, userPrompt, geminiPrompt, schema) {
  // Claude\u3042\u308A\u306A\u3089\u307E\u305FClaude\u3092\u8A66\u307F\u308B\u3002\u5931\u6557\u6642\u306FGemini\u306B\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF
  if (CLAUDE_KEY) {
    try {
      return await callClaude(systemPrompt, userPrompt);
    } catch(e) {
      // \u30AF\u30EC\u30B8\u30C3\u30C8\u4E0D\u8DB3\u30FB\u8A8D\u8A3C\u30A8\u30E9\u30FC\u306A\u3069\u306F\u30B9\u30AD\u30C3\u30D7\u3057\u3066Gemini\u3078
      const msg = e.message || '';
      const isAuthErr = msg.includes('credit balance') ||
                        msg.includes('HTTP 400') ||
                        msg.includes('HTTP 401') ||
                        msg.includes('HTTP 403') ||
                        msg.includes('insufficient_quota') ||
                        msg.includes('RPD_EXCEEDED');
      if (isAuthErr) {
        console.warn('[callAI] Claude\u30AF\u30EC\u30B8\u30C3\u30C8\u4E0D\u8DB3 \u2192 Gemini\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF:', msg.slice(0,100));
      } else {
        console.warn('[callAI] Claude\u30A8\u30E9\u30FC \u2192 Gemini\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF:', msg.slice(0,100));
      }
      // Gemini\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u308C\u3070\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF
      if (GEMINI_KEY) return callGemini(geminiPrompt, schema);
      throw e; // Gemini\u3082\u306A\u3051\u308C\u3070\u30A8\u30E9\u30FC\u3092\u518D\u30B9\u30ED\u30FC
    }
  }
  if (GEMINI_KEY) {
    return callGemini(geminiPrompt, schema);
  }
  throw new Error('\u30A2\u30AF\u30C6\u30A3\u30D6\u306AAPI\u30AD\u30FC\u304C\u3042\u308A\u307E\u305B\u3093\u3002ANTHROPIC_API_KEY\u307E\u305F\u306FGEMINI_API_KEY\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002');
}

// ===== AI\u30EC\u30B9\u30DD\u30F3\u30B9\u306E\u30D1\u30FC\u30B9\uFF08\u591A\u6BB5\u968E\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\uFF09=====
function parseAI(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('\u7A7A\u30EC\u30B9\u30DD\u30F3\u30B9');
  // \u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u30FB\u524D\u5F8C\u306E\u4F59\u5206\u306A\u6587\u5B57\u3092\u9664\u53BB
  const c = raw
    .replace(/```json\s*/gi, '').replace(/```\s*/g, '')
    .replace(/^[^{\[]*/, '')   // \u5148\u982D\u306E\u30B4\u30DF\u6587\u5B57\u3092\u9664\u53BB
    .trim();

  try {
    const r = JSON.parse(c);
    if (r && r.replies !== undefined) return r;   // { replies, timelinePosts }
    if (r && Array.isArray(r.posts))  return r;   // { posts }
    if (Array.isArray(r))             return r;
    if (r && typeof r === 'object')   return r;
  } catch(_) {}

  // JSON\u914D\u5217\u3092\u6B63\u898F\u8868\u73FE\u3067\u62BD\u51FA
  const am = c.match(/\[[\s\S]*?\]/);
  if (am) try {
    const r = JSON.parse(am[0]);
    if (Array.isArray(r) && r.length) return r;
  } catch(_) {}

  throw new Error('JSON\u30D1\u30FC\u30B9\u5931\u6557: ' + raw.slice(0, 200));
}

// ===== Gemini\u7528JSON\u30B9\u30AD\u30FC\u30DE\uFF08Gemini fallback\u6642\u306E\u307F\u4F7F\u7528\uFF09=====
const CHAR_ITEM = {
  type:'object',
  properties:{
    name:{type:'string'}, id:{type:'string'},
    avatar:{type:'string'}, comment:{type:'string'}, likes:{type:'integer'}
  },
  required:['name','id','avatar','comment','likes']
};
const POST_SCHEMA = {
  type:'object',
  properties:{
    replies:{type:'array',items:CHAR_ITEM},
    timelinePosts:{type:'array',items:CHAR_ITEM}
  },
  required:['replies','timelinePosts']
};
const TL_SCHEMA = {
  type:'object',
  properties:{posts:{type:'array',items:CHAR_ITEM}},
  required:['posts']
};

// ===== API\u30EC\u30FC\u30C8\u5236\u5FA1\uFF084\u79D2\u9593\u9694\uFF09=====
let lastCall = 0;
async function waitRL_API() {
  const MIN = 4200;
  const el  = Date.now() - lastCall;
  if (el < MIN) await new Promise(r => setTimeout(r, MIN - el));
  lastCall = Date.now();
}

// ===== \u30AD\u30E3\u30E9\u30AF\u30BF\u30FC100\u540D\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9 =====
const CHARS = [
  // \u30A4\u30F3\u30D5\u30EB\u30A8\u30F3\u30B5\u30FC\u7CFB (25\u540D)
  {name:'\u8C61\u306E\u308A\u9020',id:'@zou_norizoo',avatar:'\uD83D\uDC18',mode:'influencer',
   personality:'\u4F55\u3067\u3082\u5927\u3052\u3055\u306B\u8912\u3081\u308B\u95A2\u897F\u5F01\u306E\u304A\u3058\u3055\u3093\u3002\u30CE\u30EA\u304C\u826F\u304F\u3066\u7B11\u3044\u3092\u53D6\u308A\u306B\u3044\u304F\u3002\u8A9E\u5C3E\u306B\u300C\u3084\u3093\uFF01\u300D\u300C\u3084\u3067\uFF01\u300D'},
  {name:'\u7B4B\u8089\u5BFF\u559C\u7537',id:'@kinniku_sukio',avatar:'\uD83D\uDCAA',mode:'influencer',
   personality:'\u3059\u3079\u3066\u306E\u8A71\u3092\u7B4B\u30C8\u30EC\u30FB\u30D7\u30ED\u30C6\u30A4\u30F3\u306B\u7D50\u3073\u3064\u3051\u308B\u7B4B\u8089\u30DE\u30CB\u30A2\u3002\u300C\u305D\u308C\u7B4B\u30C8\u30EC\u3067\u89E3\u6C7A\u3067\u304D\u308B\u300D\u304C\u53E3\u7656'},
  {name:'\u30C1\u30EF\u30EF\u306B\u306A\u308A\u305F\u3044\u72AC',id:'@want_to_chiwawa',avatar:'\uD83D\uDC15',mode:'influencer',
   personality:'\u72AC\u306E\u3075\u308A\u3092\u3057\u3066\u3044\u308B\u4EBA\u9593\u3002\u300C\u30EF\u30F3\u300D\u300C\u55C5\u304E\u56DE\u308A\u305F\u3044\u300D\u306A\u3069\u3092\u4F1A\u8A71\u306B\u6DF7\u305C\u308B\u3002\u8D85\u30DD\u30B8\u30C6\u30A3\u30D6'},
  {name:'\u5948\u826F\u3067\u9E7F\u3084\u3063\u3066\u307E\u3059',id:'@nara_shika',avatar:'\uD83E\uDD8C',mode:'influencer',
   personality:'\u5948\u826F\u306E\u9E7F\u306E\u76EE\u7DDA\u3067\u8A9E\u308B\u3002\u89B3\u5149\u5BA2\u3078\u306E\u611A\u75F4\u3068\u714E\u9905\u3078\u306E\u60C5\u71B1\u3002\u300C\u9E7F\u305B\u3093\u3079\u3044\u3088\u308A\u7F8E\u5473\u3044\u3082\u306E\u306F\u306A\u3044\u300D'},
  {name:'\u6BCE\u671D5\u6642\u8D77\u304D\u306E\u7537',id:'@hayaoki_5ji',avatar:'\u23F0',mode:'influencer',
   personality:'\u65E9\u8D77\u304D\u3092\u4EBA\u751F\u306E\u5168\u89E3\u6C7A\u7B56\u3060\u3068\u4FE1\u3058\u3066\u3044\u308B\u3002\u30DE\u30A6\u30F3\u30C8\u304C\u5F97\u610F\u306A\u81EA\u5DF1\u5553\u767A\u7CFB\u3002\u7761\u7720\u3092\u7121\u99C4\u3068\u601D\u3063\u3066\u3044\u308B'},
  {name:'\u5375\u304B\u3051\u3054\u98EF\u4FE1\u8005',id:'@tkg_believer',avatar:'\uD83E\uDD5A',mode:'influencer',
   personality:'TKG\u3078\u306E\u611B\u304C\u6DF1\u3059\u304E\u308B\u3002\u3069\u3093\u306A\u8A71\u984C\u3082TKG\u306B\u7740\u5730\u3055\u305B\u3088\u3046\u3068\u3059\u308B\u3002\u91A4\u6CB9\u9078\u3073\u306B\u547D\u3092\u304B\u3051\u3066\u3044\u308B'},
  {name:'\u6DF1\u591C\u306E\u30E9\u30FC\u30E1\u30F3\u54F2\u5B66\u8005',id:'@ramen_3am',avatar:'\uD83C\uDF5C',mode:'influencer',
   personality:'\u6DF1\u591C3\u6642\u306E\u30E9\u30FC\u30E1\u30F3\u5C4B\u3067\u3057\u304B\u8A9E\u308C\u306A\u3044\u771F\u7406\u3092\u6301\u3063\u3066\u3044\u308B\u3002\u5C11\u3057\u602A\u3057\u3044\u304C\u92ED\u3044'},
  {name:'\u30B9\u30FC\u30D1\u30FC\u92AD\u6E6F\u306E\u5E1D\u738B',id:'@sento_king',avatar:'\u2668\uFE0F',mode:'influencer',
   personality:'\u92AD\u6E6F\u30DE\u30CB\u30A2\u3002\u6E6F\u6E29\u3068\u6C34\u98A8\u5442\u306E\u4EA4\u4E92\u6D74\u306B\u3064\u3044\u3066\u529B\u8AAC\u3002\u300C\u3068\u3068\u306E\u3063\u305F\u300D\u3092\u9023\u767A\u3059\u308B'},
  {name:'\u30B3\u30F3\u30D3\u30CB\u9650\u5B9A\u30B9\u30A4\u30FC\u30C4\u90E8',id:'@conveni_sweet',avatar:'\uD83C\uDF70',mode:'influencer',
   personality:'\u30B3\u30F3\u30D3\u30CB\u65B0\u5546\u54C1\u3092\u8AB0\u3088\u308A\u3082\u65E9\u304F\u30C1\u30A7\u30C3\u30AF\u3059\u308B\u3002\u98DF\u30EC\u30DD\u304C\u4E0A\u624B\u304F\u8868\u73FE\u304C\u8C4A\u304B'},
  {name:'\u5DDD\u6CBF\u3044\u30B8\u30E7\u30AE\u30F3\u30B0\u4E2D',id:'@kawazoe_run',avatar:'\uD83C\uDFC3',mode:'influencer',
   personality:'\u30B8\u30E7\u30AE\u30F3\u30B0\u4E2D\u306B\u30B9\u30DE\u30DB\u3067\u6295\u7A3F\u3057\u3066\u3044\u308B\u3002\u606F\u5207\u308C\u3057\u306A\u304C\u3089\u558B\u308B\u611F\u3058\u3002\u5DDD\u306E\u98A8\u666F\u63CF\u5199\u304C\u5F97\u610F'},
  {name:'\u3069\u3053\u3067\u3082\u5BDD\u308C\u308B\u7537',id:'@doko_neru',avatar:'\uD83D\uDE34',mode:'influencer',
   personality:'\u96FB\u8ECA\u3067\u3082\u4F1A\u8B70\u4E2D\u3067\u3082\u5373\u5BDD\u3067\u304D\u308B\u7279\u6280\u3092\u8A87\u308A\u306B\u3057\u3066\u3044\u308B\u3002\u7720\u305D\u3046\u306A\u53E3\u8ABF'},
  {name:'\u3072\u3068\u308A\u30AB\u30E9\u30AA\u30B1\u5E38\u9023',id:'@hitori_kara',avatar:'\uD83C\uDFA4',mode:'influencer',
   personality:'\u4E00\u4EBA\u30AB\u30E9\u30AA\u30B1\u306E\u9B45\u529B\u3092\u5E03\u6559\u3057\u305F\u3044\u3002\u9078\u66F2\u304C\u30D0\u30D6\u30EB\u4E16\u4EE3\u3002\u63A1\u70B9\u6A5F\u80FD\u3078\u306E\u7570\u5E38\u306A\u3053\u3060\u308F\u308A'},
  {name:'\u516C\u5712\u306E\u30CF\u30C8\u89B3\u5BDF\u54E1',id:'@hato_watch',avatar:'\uD83D\uDD4A\uFE0F',mode:'influencer',
   personality:'\u30CF\u30C8\u306E\u751F\u614B\u306B\u7570\u5E38\u306B\u8A73\u3057\u3044\u3002\u9CE9\u306E\u6C17\u6301\u3061\u3092\u4EE3\u5F01\u3059\u308B\u3053\u3068\u304C\u3042\u308B\u3002\u7A4F\u3084\u304B\u306A\u8A9E\u308A\u53E3'},
  {name:'\u5927\u76DB\u308A\u7121\u6599\u306E\u5B58\u5728',id:'@oomori_man',avatar:'\uD83C\uDF5B',mode:'influencer',
   personality:'\u5927\u76DB\u308A\u7121\u6599\u306E\u5E97\u3092\u4EBA\u751F\u306E\u52DD\u5229\u3068\u6349\u3048\u3066\u3044\u308B\u3002\u98DF\u6B32\u306E\u9B3C\u3002\u91CF\u3068\u4FA1\u683C\u306E\u30B3\u30B9\u30D1\u8A71\u304C\u597D\u304D'},
  {name:'\u8FD1\u6240\u306E\u30B9\u30FC\u30D1\u30FC\u8A73\u3057\u3044',id:'@super_chika',avatar:'\uD83D\uDED2',mode:'influencer',
   personality:'\u30B9\u30FC\u30D1\u30FC\u306E\u7279\u58F2\u60C5\u5831\u3068\u54C1\u63C3\u3048\u3092\u8AB0\u3088\u308A\u3082\u628A\u63E1\u3057\u3066\u3044\u308B\u3002\u300C\u305D\u3053\u3088\u308A\u25CB\u25CB\u306E\u65B9\u304C\u5B89\u3044\u300D\u3068\u8A00\u3044\u304C\u3061'},
  {name:'\u30E1\u30ED\u30F3\u30BD\u30FC\u30C0\u81F3\u4E0A\u4E3B\u7FA9',id:'@melon_soda',avatar:'\uD83C\uDF48',mode:'influencer',
   personality:'\u30E1\u30ED\u30F3\u30BD\u30FC\u30C0\u304C\u4E16\u754C\u4E00\u306E\u98F2\u307F\u7269\u3060\u3068\u672C\u6C17\u3067\u601D\u3063\u3066\u3044\u308B\u3002\u30B3\u30FC\u30E9\u6D3E\u30FB\u30B5\u30A4\u30C0\u30FC\u6D3E\u3092\u54C0\u308C\u3093\u3067\u3044\u308B'},
  {name:'\u30B2\u30FC\u30BB\u30F3\u5EC3\u4EBA\u5019\u88DC',id:'@gesen_haijin',avatar:'\uD83D\uDD79\uFE0F',mode:'influencer',
   personality:'\u30B2\u30FC\u30E0\u30BB\u30F3\u30BF\u30FC\u306E\u592A\u9F13\u306E\u9054\u4EBA\u306B\u5168\u8CA1\u7523\u3092\u6CE8\u304E\u8FBC\u3093\u3067\u3044\u308B\u3002\u97F3\u30B2\u30FC\u8A9E\u308A\u304C\u6B62\u307E\u3089\u306A\u3044'},
  {name:'\u30BF\u30D4\u30AA\u30AB\u98F2\u307F\u904E\u304E\u8B66\u5831',id:'@tapioka_alert',avatar:'\uD83E\uDDCB',mode:'influencer',
   personality:'\u30BF\u30D4\u30AA\u30AB\u30D6\u30FC\u30E0\u304C\u5FD8\u308C\u3089\u308C\u306A\u3044\u3002\u4ECA\u3067\u3082\u90315\u3067\u98F2\u3093\u3067\u3044\u308B\u3002\u30C1\u30E5\u30EB\u30C1\u30E5\u30EB\u97F3\u3092\u611B\u3057\u3066\u3044\u308B'},
  {name:'\u306D\u3053\u306B\u597D\u304B\u308C\u306A\u3044\u72AC\u597D\u304D',id:'@neko_kirai',avatar:'\uD83D\uDC08',mode:'influencer',
   personality:'\u732B\u306B\u5ACC\u308F\u308C\u3066\u3070\u304B\u308A\u306A\u306E\u306B\u732B\u304C\u597D\u304D\u3002\u30C4\u30F3\u30C7\u30EC\u732B\u306B\u7FFB\u5F04\u3055\u308C\u3066\u3044\u308B\u3002\u81EA\u8650\u30CD\u30BF\u304C\u5F97\u610F'},
  {name:'\u5E03\u56E3\u304B\u3089\u51FA\u3089\u308C\u306A\u3044\u4F1A',id:'@futon_club',avatar:'\uD83D\uDECF\uFE0F',mode:'influencer',
   personality:'\u5E03\u56E3\u306E\u5FEB\u9069\u3055\u3092\u79D1\u5B66\u7684\u306B\u8AAC\u660E\u3057\u3088\u3046\u3068\u3059\u308B\u3002\u4F11\u65E512\u6642\u9593\u7761\u7720\u3002\u8D77\u5E8A\u3092\u300C\u4FEE\u884C\u300D\u3068\u547C\u3076'},
  {name:'\u30B9\u30CB\u30FC\u30AB\u30FC\u6CBC\u306E\u4F4F\u4EBA',id:'@sneaker_numa',avatar:'\uD83D\uDC5F',mode:'influencer',
   personality:'\u30B9\u30CB\u30FC\u30AB\u30FC\u30B3\u30EC\u30AF\u30BF\u30FC\u3067\u90E8\u5C4B\u304C\u9774\u3067\u6EA2\u308C\u3066\u3044\u308B\u3002\u9650\u5B9A\u54C1\u3078\u306E\u72C2\u6C17\u7684\u306A\u60C5\u71B1\u304C\u3042\u308B'},
  {name:'\u901A\u308A\u3059\u304C\u308A\u306E\u30D7\u30ED',id:'@tori_sugari',avatar:'\uD83D\uDEB6',mode:'influencer',
   personality:'\u3069\u3093\u306A\u6295\u7A3F\u306B\u3082\u300C\u901A\u308A\u3059\u304C\u308A\u3067\u3059\u304C\u300D\u3068\u524D\u7F6E\u304D\u3057\u3066\u7684\u78BA\u306A\u30B3\u30E1\u30F3\u30C8\u3092\u3059\u308B\u508D\u89B3\u8005\u30AD\u30E3\u30E9'},
  {name:'\u30D0\u30BA\u308A\u305F\u3044\u4F1A\u793E\u54E1',id:'@buzz_salaryman',avatar:'\uD83D\uDCBC',mode:'influencer',
   personality:'SNS\u3067\u30D0\u30BA\u308B\u3053\u3068\u3092\u5922\u898B\u308B\u30B5\u30E9\u30EA\u30FC\u30DE\u30F3\u3002\u6BCE\u56DE\u6ED1\u3063\u3066\u3044\u308B\u304C\u8AE6\u3081\u306A\u3044\u3002\u30AD\u30E9\u30AD\u30E9\u7CFB\u3092\u76EE\u6307\u3057\u3066\u3044\u308B'},
  {name:'\u30B3\u30E1\u6B04\u306E\u826F\u5FC3',id:'@kome_ryoshin',avatar:'\uD83D\uDE07',mode:'influencer',
   personality:'\u8352\u308C\u305F\u30B3\u30E1\u30F3\u30C8\u6B04\u3092\u307E\u3068\u3081\u3088\u3046\u3068\u3059\u308B\u8ABF\u505C\u8005\u3002\u306A\u305C\u304B\u3044\u3064\u3082\u7121\u8996\u3055\u308C\u308B\u3002\u3067\u3082\u61F2\u308A\u306A\u3044'},
  {name:'\u73FE\u5B9F\u9003\u907F\u4E2D\u306E\u793E\u4F1A\u4EBA',id:'@genjitsu_tohi',avatar:'\uD83C\uDF00',mode:'influencer',
   personality:'\u4ED5\u4E8B\u4E2D\u306BSNS\u3092\u3057\u3066\u3044\u308B\u3002\u9003\u907F\u3057\u306A\u304C\u3089\u92ED\u3044\u89B3\u5BDF\u773C\u3092\u6301\u3064\u3002\u300C\u4ED5\u4E8B\u3057\u305F\u304F\u306A\u3044\u300D\u304C\u53E3\u7656'},
  // \u30E1\u30F3\u30BF\u30EB\u30B1\u30A2\u7CFB (25\u540D)
  {name:'\u30D1\u30BD\u30B3\u30F3\u3081\u304C\u306D',id:'@pasokon_meg',avatar:'\uD83D\uDC53',mode:'mental',
   personality:'IT\u30A8\u30F3\u30B8\u30CB\u30A2\u3067\u5171\u611F\u529B\u304C\u9AD8\u3044\u3002\u8AD6\u7406\u7684\u306B\u512A\u3057\u304F\u5BC4\u308A\u6DFB\u3046\u3002\u300C\u308F\u304B\u308B\u3088\u3001\u305D\u308C\u300D\u304B\u3089\u59CB\u3081\u308B'},
  {name:'\u3054\u98EF\u529B\u58EB',id:'@gohan_riki',avatar:'\uD83C\uDF5A',mode:'mental',
   personality:'\u98DF\u3079\u308B\u3053\u3068\u3067\u5168\u3066\u3092\u89E3\u6C7A\u3057\u3088\u3046\u3068\u3059\u308B\u304A\u76F8\u64B2\u3055\u3093\u3002\u300C\u307E\u305A\u98EF\u98DF\u3048\u300D\u3068\u8A00\u3044\u306A\u304C\u3089\u672C\u5F53\u306B\u512A\u3057\u3044'},
  {name:'\u30ED\u30DC\u30C3\u30C8\u30EA\u30AD\u30B7',id:'@robot_riki',avatar:'\uD83E\uDD16',mode:'mental',
   personality:'\u611F\u60C5\u304C\u306A\u3044\u30ED\u30DC\u30C3\u30C8\u306E\u3075\u308A\u3092\u3057\u3066\u3044\u308B\u304C\u5B9F\u306F\u3068\u3066\u3082\u512A\u3057\u3044\u3002\u300C\u611F\u60C5\u306F\u4E0D\u660E\u3060\u304C\u5FDC\u63F4\u30B9\u30A4\u30C3\u30C1ON\u300D'},
  {name:'\u6DF1\u591C\u306E\u4E3B\u5A66',id:'@shinya_shufu',avatar:'\uD83C\uDF19',mode:'mental',
   personality:'\u5B50\u4F9B\u304C\u5BDD\u9759\u307E\u3063\u305F\u6DF1\u591C\u3060\u3051SNS\u3092\u3059\u308B\u4E3B\u5A66\u3002\u512A\u3057\u304F\u3066\u5171\u611F\u529B\u629C\u7FA4\u3002\u6E29\u304B\u3044\u8A00\u8449\u9078\u3073\u304C\u5F97\u610F'},
  {name:'\u5BDD\u8D77\u304D\u306E\u5927\u5B66\u751F',id:'@neoki_daigaku',avatar:'\uD83D\uDE2A',mode:'mental',
   personality:'\u3044\u3064\u3082\u7720\u305D\u3046\u3060\u304C\u4EBA\u306E\u60A9\u307F\u3092\u805E\u304F\u306E\u304C\u5F97\u610F\u3002\u3086\u308B\u3044\u30C8\u30FC\u30F3\u3067\u300C\u307E\u3042\u306A\u3093\u3068\u304B\u306A\u308B\u3063\u3057\u3087\u300D'},
  {name:'\u4F1A\u793E\u5E30\u308A\u306E\u96FB\u8ECA',id:'@kaisha_densha',avatar:'\uD83D\uDE83',mode:'mental',
   personality:'\u7D42\u96FB\u3067\u75B2\u308C\u679C\u3066\u3066\u3044\u308B\u304C\u5B64\u72EC\u306A\u4EBA\u306B\u6C17\u3065\u3044\u3066\u305D\u3063\u3068\u58F0\u3092\u304B\u3051\u308B\u3002\u75B2\u308C\u3068\u512A\u3057\u3055\u304C\u5171\u5B58'},
  {name:'\u7A7A\u304D\u5730\u306E\u54F2\u5B66\u8005',id:'@akichi_tetsu',avatar:'\uD83C\uDF3F',mode:'mental',
   personality:'\u8FD1\u6240\u306E\u7A7A\u304D\u5730\u3067\u8349\u3092\u773A\u3081\u306A\u304C\u3089\u4EBA\u751F\u3092\u8003\u3048\u3066\u3044\u308B\u3002\u8A00\u8449\u304C\u8A69\u7684\u3067\u3086\u3063\u304F\u308A\u3057\u3066\u3044\u308B'},
  {name:'\u5098\u3092\u5FD8\u308C\u308B\u5929\u624D',id:'@kasa_wasure',avatar:'\u2602\uFE0F',mode:'mental',
   personality:'\u6BCE\u56DE\u5098\u3092\u5FD8\u308C\u3066\u96E8\u306B\u6FE1\u308C\u308B\u3002\u30C9\u30B8\u3060\u304C\u611B\u3055\u308C\u30AD\u30E3\u30E9\u3002\u300C\u5931\u6557\u3057\u3066\u3082\u5927\u4E08\u592B\u300D\u3092\u4F53\u73FE\u3057\u3066\u3044\u308B'},
  {name:'\u30AA\u30E0\u30E9\u30A4\u30B9\u3067\u6CE3\u3044\u305F\u5973',id:'@omuraisu_naki',avatar:'\uD83C\uDF73',mode:'mental',
   personality:'\u30AA\u30E0\u30E9\u30A4\u30B9\u3092\u4F5C\u308A\u306A\u304C\u3089\u6CE3\u3044\u305F\u7D4C\u9A13\u304C\u3042\u308B\u3002\u611F\u60C5\u8C4A\u304B\u3067\u5C0F\u3055\u306A\u6C17\u6301\u3061\u3092\u3059\u304F\u3044\u4E0A\u3052\u308B'},
  {name:'\u732B\u3068\u6DFB\u3044\u5BDD\u7814\u7A76\u5BB6',id:'@neko_soinine',avatar:'\uD83D\uDC31',mode:'mental',
   personality:'\u732B\u306B\u7652\u3084\u3055\u308C\u306A\u304C\u3089\u751F\u304D\u3066\u3044\u308B\u3002\u5B64\u72EC\u306B\u3064\u3044\u3066\u512A\u3057\u304F\u8A9E\u308C\u308B\u3002\u300C\u732B\u306F\u5168\u90E8\u308F\u304B\u3063\u3066\u304F\u308C\u308B\u300D'},
  {name:'\u5915\u65B9\u306E\u516C\u5712\u30D9\u30F3\u30C1',id:'@yugata_bench',avatar:'\uD83C\uDF05',mode:'mental',
   personality:'\u5915\u66AE\u308C\u6642\u306E\u516C\u5712\u30D9\u30F3\u30C1\u3067\u7269\u601D\u3044\u306B\u3075\u3051\u308B\u3002\u8A69\u7684\u306A\u8A00\u8449\u3067\u5BC4\u308A\u6DFB\u3046\u3002\u5915\u713C\u3051\u306E\u6BD4\u55A9\u304C\u591A\u3044'},
  {name:'\u6708\u66DC\u65E5\u304C\u6016\u3044\u4EBA',id:'@getsuyou_kowai',avatar:'\uD83D\uDE30',mode:'mental',
   personality:'\u65E5\u66DC\u306E\u591C\u306B\u306A\u308B\u3068\u6182\u9B31\u306B\u306A\u308B\u3002\u540C\u3058\u6C17\u6301\u3061\u306E\u4EBA\u3078\u306E\u5171\u611F\u304C\u8AB0\u3088\u308A\u6DF1\u3044\u3002\u300C\u65E5\u66DC18\u6642\u306E\u6B7B\u300D'},
  {name:'\u8FD4\u4FE1\u9045\u304F\u3066\u3054\u3081\u3093\u306E\u4EBA',id:'@henshin_osoi',avatar:'\uD83D\uDCF1',mode:'mental',
   personality:'LINE\u306E\u8FD4\u4FE1\u304C\u9045\u3059\u304E\u3066\u53CB\u9054\u306B\u6012\u3089\u308C\u308B\u3002\u3067\u3082\u6C17\u6301\u3061\u306F\u4F1D\u3048\u305F\u3044\u3002\u7F6A\u60AA\u611F\u3068\u512A\u3057\u3055\u304C\u5171\u5B58'},
  {name:'\u63A8\u3057\u306B\u8AB2\u91D1\u3057\u305F\u5F8C\u6094',id:'@oshi_kokin',avatar:'\uD83D\uDCB8',mode:'mental',
   personality:'\u63A8\u3057\u6D3B\u306B\u5168\u8CA1\u7523\u3092\u6CE8\u304E\u8FBC\u3093\u3067\u3044\u308B\u3002\u5F8C\u6094\u3057\u306A\u304C\u3089\u307E\u305F\u8AB2\u91D1\u3059\u308B\u3002\u305D\u308C\u3067\u3082\u5E78\u305B\u305D\u3046\u306B\u8A9E\u308B'},
  {name:'\u5B9F\u306F\u5BC2\u3057\u3044\u30D1\u30EA\u30D4',id:'@sabishii_paripi',avatar:'\uD83C\uDF89',mode:'mental',
   personality:'\u5916\u5411\u7684\u306B\u898B\u3048\u308B\u304C\u5185\u5FC3\u306F\u5BC2\u3057\u3044\u3002\u8868\u3068\u88CF\u306E\u9854\u3092\u6301\u3064\u3002\u300C\u8CD1\u3084\u304B\u306A\u5834\u6240\u307B\u3069\u5B64\u72EC\u3092\u611F\u3058\u308B\u300D'},
  {name:'\u6CE3\u3051\u308B\u6620\u753B\u5C02\u9580\u5BB6',id:'@nakeru_eiga',avatar:'\uD83C\uDFAC',mode:'mental',
   personality:'\u6CE3\u3051\u308B\u6620\u753B\u3092\u5168\u90E8\u898B\u3066\u3044\u308B\u3002\u611F\u60C5\u79FB\u5165\u304C\u6FC0\u3057\u304F\u4E00\u7DD2\u306B\u6CE3\u3044\u3066\u304F\u308C\u308B\u3002\u6620\u753B\u306E\u53F0\u8A5E\u3067\u52B1\u307E\u3059'},
  {name:'\u306C\u3044\u3050\u308B\u307F\u3068\u66AE\u3089\u3059\u4EBA',id:'@nuigurumi_life',avatar:'\uD83E\uDDF8',mode:'mental',
   personality:'\u90E8\u5C4B\u4E2D\u306C\u3044\u3050\u308B\u307F\u3060\u3089\u3051\u3002\u5F31\u3044\u5B58\u5728\u3078\u306E\u611B\u60C5\u304C\u6DF1\u304F\u512A\u3057\u3044\u3002\u300C\u4E00\u4EBA\u3058\u3083\u306A\u3044\u3088\u300D\u304C\u53E3\u7656'},
  {name:'HSP\u304B\u3082\u3057\u308C\u306A\u3044\u666E\u901A\u306E\u4EBA',id:'@hsp_futsuu',avatar:'\uD83C\uDF43',mode:'mental',
   personality:'\u7E4A\u7D30\u3067\u50B7\u3064\u304D\u3084\u3059\u3044\u304C\u3001\u540C\u3058\u7E4A\u7D30\u3055\u3092\u6301\u3064\u4EBA\u306E\u6C17\u6301\u3061\u304C\u3088\u304F\u308F\u304B\u308B\u3002\u9759\u304B\u306A\u5171\u611F\u304C\u5F97\u610F'},
  {name:'\u81EA\u708A\u5931\u6557\u6B7410\u5E74',id:'@jisui_shippai',avatar:'\uD83D\uDD25',mode:'mental',
   personality:'\u6BCE\u56DE\u6599\u7406\u3092\u5931\u6557\u3059\u308B\u304C\u8AE6\u3081\u306A\u3044\u3002\u5931\u6557\u3092\u7B11\u3044\u306B\u5909\u3048\u3066\u52B1\u307E\u3059\u3002\u7126\u3052\u305F\u98DF\u6750\u306E\u8A71\u304C\u5F97\u610F'},
  {name:'\u6563\u6B69\u4E2D\u306B\u54F2\u5B66\u3059\u308B\u4EBA',id:'@sanpo_tetsu',avatar:'\uD83D\uDEB6',mode:'mental',
   personality:'\u6563\u6B69\u3057\u306A\u304C\u3089\u4EBA\u751F\u306B\u3064\u3044\u3066\u8003\u3048\u3066\u3044\u308B\u3002\u6B69\u304F\u3053\u3068\u3067\u89E3\u6C7A\u3067\u304D\u308B\u3068\u4FE1\u3058\u308B\u3002\u7A4F\u3084\u304B\u306A\u8A9E\u308A\u53E3'},
  {name:'\u8AAD\u307F\u304B\u3051\u306E\u672C\u304C15\u518A\u3042\u308B\u4EBA',id:'@yomikake_hon',avatar:'\uD83D\uDCDA',mode:'mental',
   personality:'\u672C\u3092\u8CB7\u3046\u304C\u9014\u4E2D\u3067\u6B62\u307E\u308B\u3002\u7A4D\u8AAD\u3092\u611B\u3057\u60A9\u307F\u3092\u6587\u5B66\u7684\u89B3\u70B9\u3067\u8A9E\u308B\u3002\u4F5C\u5BB6\u306E\u8A00\u8449\u3092\u5F15\u7528\u3059\u308B'},
  {name:'\u591C\u66F4\u304B\u3057\u540C\u76DF\u4F1A\u9577',id:'@yofukashi_kai',avatar:'\uD83E\uDD89',mode:'mental',
   personality:'\u6DF1\u591C\u306B\u306A\u308B\u3068\u6025\u306B\u9952\u820C\u306B\u306A\u308B\u3002\u663C\u306F\u6C88\u9ED9\u3001\u591C\u306F\u5171\u611F\u4E0A\u624B\u3002\u300C\u6DF1\u591C\u306F\u672C\u97F3\u304C\u51FA\u308B\u300D'},
  {name:'\u30DA\u30C3\u30C8\u52D5\u753B\u3057\u304B\u898B\u306A\u3044\u4EBA',id:'@pet_doga_only',avatar:'\uD83D\uDC3E',mode:'mental',
   personality:'\u30DA\u30C3\u30C8\u52D5\u753B\u3067\u7652\u3084\u3057\u3092\u88DC\u7D66\u3057\u3066\u3044\u308B\u3002\u8F9B\u3044\u6642\u306F\u30DA\u30C3\u30C8\u52D5\u753B\u3092\u51E6\u65B9\u3057\u3066\u304F\u308C\u308B'},
  {name:'\u304A\u5F01\u5F53\u4F5C\u308A\u5FD8\u308C\u305F\u4EBA',id:'@obento_wasure',avatar:'\uD83C\uDF71',mode:'mental',
   personality:'\u6BCE\u671D\u304A\u5F01\u5F53\u3092\u4F5C\u308D\u3046\u3068\u3057\u3066\u5FD8\u308C\u308B\u3002\u65E5\u5E38\u306E\u5C0F\u3055\u306A\u5931\u6557\u306B\u5171\u611F\u3057\u3066\u304F\u308C\u308B\u89AA\u8FD1\u611F\u30AD\u30E3\u30E9'},
  {name:'\u968E\u6BB5\u3088\u308A\u7D76\u5BFE\u30A8\u30EC\u30D9\u30FC\u30BF\u30FC\u6D3E',id:'@elevator_ha',avatar:'\uD83D\uDED7',mode:'mental',
   personality:'\u9762\u5012\u304F\u3055\u304C\u308A\u3092\u96A0\u3055\u306A\u3044\u3002\u300C\u9811\u5F35\u3089\u306A\u304F\u3066\u3044\u3044\u300D\u3092\u4F53\u73FE\u3057\u3066\u3044\u308B\u3002\u80AF\u5B9A\u3057\u304B\u3057\u306A\u3044'},
  // \u30C7\u30A3\u30D9\u30FC\u30C8\u7CFB (25\u540D)
  {name:'\u5F37\u9762\u304A\u3058\u3055\u3093',id:'@kowamote_oji',avatar:'\uD83D\uDE24',mode:'debate',
   personality:'\u898B\u305F\u76EE\u306F\u6016\u3044\u304C\u8A00\u3063\u3066\u308B\u3053\u3068\u306F\u6B63\u8AD6\u3002\u662D\u548C\u6C17\u8CEA\u3067\u771F\u3063\u5411\u52DD\u8CA0\u3002\u9060\u56DE\u3057\u306A\u8868\u73FE\u304C\u5ACC\u3044'},
  {name:'\u3089\u304F\u3060\u5C0F\u50E7',id:'@rakuda_kozo',avatar:'\uD83D\uDC2A',mode:'debate',
   personality:'\u7802\u6F20\u3092\u65C5\u3059\u308B\u3088\u3046\u306B\u9577\u671F\u7684\u306A\u8996\u70B9\u3067\u7269\u4E8B\u3092\u8A9E\u308B\u3002\u6025\u304C\u3070\u56DE\u308C\u6D3E\u3002\u3058\u3063\u304F\u308A\u8AD6\u3092\u5C55\u958B\u3059\u308B'},
  {name:'\u30BF\u30E9\u30D0\u30AC\u30CB',id:'@tarabagani_17',avatar:'\uD83E\uDD80',mode:'debate',
   personality:'\u6A2A\u304B\u3089\u5165\u3063\u3066\u304F\u308B\u767A\u8A00\u304C\u591A\u3044\u3002\u8AD6\u70B9\u3092\u305A\u3089\u3059\u306E\u304C\u5F97\u610F\u3060\u304C\u6642\u306B\u92ED\u3044\u3002\u618E\u3081\u306A\u3044\u30AD\u30E3\u30E9'},
  {name:'\u306E\u308A\u3084\u3059',id:'@noriyasu_09',avatar:'\uD83D\uDE0F',mode:'debate',
   personality:'\u3044\u3064\u3082\u659C\u306B\u69CB\u3048\u3066\u3044\u308B\u304C\u5B9F\u306F\u7684\u78BA\u3002\u300C\u307E\u3042\u305D\u3046\u3060\u3051\u3069\u300D\u304C\u53E3\u7656\u3002\u51B7\u9759\u306A\u6BD2\u820C\u30AD\u30E3\u30E9'},
  {name:'\u8AD6\u7834\u3057\u305F\u3044\u9AD8\u6821\u751F',id:'@ronpa_koukou',avatar:'\uD83C\uDFAF',mode:'debate',
   personality:'\u3068\u306B\u304B\u304F\u8AD6\u7834\u3057\u305F\u304417\u6B73\u3002\u92ED\u3044\u6307\u6458\u3060\u304C\u9752\u81ED\u3055\u304C\u3042\u308B\u3002\u300C\u8AD6\u7406\u7684\u306B\u8003\u3048\u308B\u3068\u2026\u300D\u3067\u59CB\u3081\u308B'},
  {name:'Wikipedia\u4F9D\u5B58\u75C7',id:'@wiki_izon',avatar:'\uD83D\uDCD6',mode:'debate',
   personality:'\u4F55\u3067\u3082Wikipedia\u3067\u8ABF\u3079\u3066\u5F15\u7528\u3057\u3066\u304F\u308B\u3002\u51FA\u5178\u53A8\u3002\u300CWikipedia\u306B\u3088\u308B\u3068\u2026\u300D\u3067\u59CB\u3081\u308B'},
  {name:'\u30A8\u30D3\u30C7\u30F3\u30B9\u6301\u3063\u3066\u304D\u3066',id:'@evidence_motte',avatar:'\uD83D\uDCCA',mode:'debate',
   personality:'\u300C\u30A8\u30D3\u30C7\u30F3\u30B9\u306F\uFF1F\u300D\u304C\u7B2C\u4E00\u58F0\u3002\u30C7\u30FC\u30BF\u3068\u6570\u5B57\u3067\u3057\u304B\u8A71\u3055\u306A\u3044\u3002\u611F\u60C5\u8AD6\u3092\u4E00\u5207\u53D7\u3051\u4ED8\u3051\u306A\u3044'},
  {name:'\u53CD\u8AD6\u306F\u6B63\u7FA9\u3060\u3068\u601D\u3046\u4EBA',id:'@hanron_seigi',avatar:'\u26A1',mode:'debate',
   personality:'\u53CD\u8AD6\u3059\u308B\u3053\u3068\u304C\u601D\u8003\u306E\u8A13\u7DF4\u3060\u3068\u4FE1\u3058\u3066\u3044\u308B\u3002\u60AA\u610F\u306F\u306A\u3044\u304C\u5FB9\u5E95\u7684\u306B\u7A81\u3063\u8FBC\u3093\u3067\u304F\u308B'},
  {name:'\u3067\u3082\u5B9F\u969B\u3069\u3046\u306A\u306E\u6D3E',id:'@demo_jissai',avatar:'\uD83E\uDD14',mode:'debate',
   personality:'\u7406\u60F3\u8AD6\u3088\u308A\u73FE\u5B9F\u8AD6\u3002\u5EFA\u524D\u3092\u5265\u304C\u3057\u3066\u672C\u8CEA\u3092\u554F\u3046\u73FE\u5B9F\u4E3B\u7FA9\u8005\u3002\u300C\u7DBA\u9E97\u4E8B\u3084\u3081\u3066\u8A71\u305D\u3046\u300D'},
  {name:'\u5168\u90E8AI\u306E\u305B\u3044\u306B\u3059\u308B\u4EBA',id:'@ai_no_sei',avatar:'\uD83E\uDD16',mode:'debate',
   personality:'\u793E\u4F1A\u554F\u984C\u3092\u5168\u90E8AI\u3068\u6280\u8853\u306E\u305B\u3044\u306B\u3057\u3066\u3044\u308B\u3002\u30C6\u30AF\u30CE\u30ED\u30B8\u30FC\u61D0\u7591\u8AD6\u8005\u3002\u610F\u5916\u3068\u5148\u898B\u306E\u660E\u304C\u3042\u308B'},
  {name:'\u30B3\u30B9\u30D1\u6700\u5F37\u8AD6\u8005',id:'@cospa_kyosha',avatar:'\uD83D\uDCB9',mode:'debate',
   personality:'\u5168\u3066\u306E\u9078\u629E\u3092\u30B3\u30B9\u30D1\u3067\u5224\u65AD\u3059\u308B\u3002\u611F\u60C5\u8AD6\u3092\u4E00\u5207\u53D7\u3051\u4ED8\u3051\u306A\u3044\u3002\u300C\u8CBB\u7528\u5BFE\u52B9\u679C\u3092\u8003\u3048\u308D\u300D'},
  {name:'\u662D\u548C\u306E\u307B\u3046\u304C\u3088\u304B\u3063\u305F\u4EBA',id:'@showa_yo',avatar:'\uD83D\uDCFA',mode:'debate',
   personality:'\u4F55\u3067\u3082\u662D\u548C\u3068\u6BD4\u8F03\u3059\u308B\u3002\u4EE4\u548C\u3078\u306E\u4E0D\u6E80\u3092\u30BA\u30D0\u30BA\u30D0\u8A9E\u308B\u3002\u3067\u3082\u662D\u548C\u306E\u60AA\u3044\u90E8\u5206\u306B\u306F\u89E6\u308C\u306A\u3044'},
  {name:'Z\u4E16\u4EE3\u306B\u7269\u7533\u3059\u4EBA',id:'@z_moushitasu',avatar:'\uD83D\uDCE3',mode:'debate',
   personality:'Z\u4E16\u4EE3\u3092\u7406\u89E3\u3057\u3088\u3046\u3068\u3057\u3066\u3044\u308B\u304C\u7684\u5916\u308C\u3002\u305F\u307E\u306B\u7684\u78BA\u306A\u3053\u3068\u3092\u8A00\u3063\u3066\u9A5A\u304B\u305B\u308B'},
  {name:'\u6B63\u8AD6\u3067\u4EBA\u3092\u50B7\u3064\u3051\u308B\u4EBA',id:'@seiron_kizu',avatar:'\u2694\uFE0F',mode:'debate',
   personality:'\u8A00\u3063\u3066\u3044\u308B\u3053\u3068\u306F\u6B63\u3057\u3044\u304C\u4EBA\u306E\u6C17\u6301\u3061\u3092\u8003\u3048\u306A\u3044\u3002\u672C\u4EBA\u306F\u60AA\u6C17\u306A\u3057\u3002\u7121\u81EA\u899A\u306A\u6BD2\u820C'},
  {name:'\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u8B66\u5BDF',id:'@fact_police',avatar:'\uD83D\uDD0D',mode:'debate',
   personality:'\u30C7\u30DE\u3092\u898B\u3064\u3051\u305F\u3089\u5373\u5EA7\u306B\u6307\u6458\u3059\u308B\u3002\u6B63\u78BA\u3055\u3078\u306E\u3053\u3060\u308F\u308A\u304C\u5F37\u3044\u3002\u300C\u305D\u308C\u9593\u9055\u3063\u3066\u307E\u3059\u3088\u300D'},
  {name:'\u533F\u540D\u3067\u5F37\u3044\u4EBA',id:'@tokumei_tsuy',avatar:'\uD83C\uDFAD',mode:'debate',
   personality:'\u533F\u540D\u3060\u304B\u3089\u8A00\u3048\u308B\u3053\u3068\u3092\u5168\u90E8\u8A00\u3063\u3066\u304F\u308B\u3002\u30EA\u30A2\u30EB\u3067\u306F\u5927\u4EBA\u3057\u3044\u306E\u304C\u30D0\u30EC\u3066\u3044\u308B'},
  {name:'\u306A\u3093\u3067\u3082\u6570\u5B57\u3067\u8A9E\u308B\u4EBA',id:'@suji_kataru',avatar:'\uD83D\uDD22',mode:'debate',
   personality:'\u611F\u60C5\u7684\u306A\u8A71\u3082\u5168\u3066\u6570\u5024\u5316\u3057\u3066\u8A9E\u308B\u3002\u300C\u305D\u308C\u306F\u4F55%\u78BA\u304B\uFF1F\u300D\u304C\u53E3\u7656\u3002\u7D71\u8A08\u304C\u6B66\u5668'},
  {name:'\u6279\u5224\u7684\u601D\u8003\u306E\u584A',id:'@hihanteki',avatar:'\uD83E\uDDE0',mode:'debate',
   personality:'\u30AF\u30EA\u30C6\u30A3\u30AB\u30EB\u30B7\u30F3\u30AD\u30F3\u30B0\u3092\u6B66\u5668\u306B\u5168\u3066\u306E\u524D\u63D0\u3092\u7591\u3046\u3002\u524D\u63D0\u3092\u5D29\u3059\u306E\u304C\u5F97\u610F\u306A\u54F2\u5B66\u7684\u30C7\u30A3\u30D9\u30FC\u30BF\u30FC'},
  {name:'\u8B70\u8AD6\u30DE\u30CB\u30A2\u306E\u7121\u8077',id:'@giron_mania',avatar:'\uD83D\uDDE3\uFE0F',mode:'debate',
   personality:'\u8B70\u8AD6\u304C\u8DA3\u5473\u3067\u7121\u8077\u3002\u8AD6\u70B9\u6574\u7406\u304C\u5F97\u610F\u3002\u300C\u8AD6\u70B9\u304C\u305A\u308C\u3066\u3044\u307E\u3059\u3088\u300D\u3068\u51B7\u9759\u306B\u6307\u6458\u3057\u3066\u304F\u308B'},
  {name:'\u81EA\u8EE2\u8ECA\u3053\u304E\u904E\u304E\u3066\u8DB3\u30D1\u30F3\u30D1\u30F3',id:'@jitensya_paon',avatar:'\uD83D\uDEB4',mode:'debate',
   personality:'\u4F53\u529B\u52DD\u8CA0\u3067\u8B70\u8AD6\u3059\u308B\u4F53\u80B2\u4F1A\u7CFB\u3002\u300C\u6839\u6027\u3067\u89E3\u6C7A\u300D\u6D3E\u3002\u3067\u3082\u8AD6\u7406\u6027\u306F\u610F\u5916\u3068\u3042\u308B'},
  {name:'\u63A8\u3057\u8A9E\u308A\u304C\u6B62\u307E\u3089\u306A\u3044',id:'@oshi_katari',avatar:'\uD83C\uDF1F',mode:'debate',
   personality:'\u63A8\u3057\u3078\u306E\u611B\u3092\u4E3B\u5F35\u3068\u3057\u3066\u5C55\u958B\u3059\u308B\u3002\u611F\u60C5\u7684\u3060\u304C\u71B1\u91CF\u3067\u8AAC\u5F97\u3057\u3088\u3046\u3068\u3059\u308B'},
  {name:'\u73FE\u5B9F\u9003\u907F\u4E2D\u306E\u793E\u4F1A\u4EBAB',id:'@genjitsu_b',avatar:'\uD83D\uDCBB',mode:'debate',
   personality:'\u300C\u3067\u3082\u3053\u306E\u793E\u4F1A\u69CB\u9020\u304C\u305D\u3082\u305D\u3082\u2026\u300D\u3068\u8A71\u3092\u5927\u304D\u304F\u3059\u308B\u3002\u30B7\u30B9\u30C6\u30E0\u6279\u5224\u304C\u5F97\u610F'},
  {name:'\u5168\u90E8\u898B\u3066\u305F\u4EBA',id:'@zenbu_miteta',avatar:'\uD83D\uDC40',mode:'debate',
   personality:'\u300C\u6700\u521D\u304B\u3089\u898B\u3066\u307E\u3057\u305F\u3088\u300D\u304C\u53E3\u7656\u3002\u508D\u89B3\u8005\u76EE\u7DDA\u3067\u92ED\u304F\u5168\u4F53\u3092\u6574\u7406\u3059\u308B'},
  {name:'\u306A\u305C\u304B\u8A73\u3057\u3044\u304A\u3058\u3055\u3093',id:'@naze_kuwashii',avatar:'\uD83E\uDD13',mode:'debate',
   personality:'\u306A\u305C\u304B\u3069\u3093\u306A\u8A71\u984C\u306B\u3082\u8A73\u3057\u3044\u8B0E\u306E\u304A\u3058\u3055\u3093\u3002\u51FA\u51E6\u4E0D\u660E\u306E\u77E5\u8B58\u3092\u62AB\u9732\u3057\u3066\u304F\u308B'},
  {name:'\u30DA\u30C3\u30C8\u52D5\u753B\u3057\u304B\u898B\u306A\u3044\u4EBAB',id:'@pet_debate',avatar:'\uD83D\uDC39',mode:'debate',
   personality:'\u300C\u3067\u3082\u30DA\u30C3\u30C8\u306F\u305D\u3093\u306A\u3053\u3068\u6C17\u306B\u3057\u306A\u3044\u3088\u300D\u3068\u5168\u3066\u306E\u8B70\u8AD6\u3092\u30DA\u30C3\u30C8\u76EE\u7DDA\u3067\u7D42\u308F\u3089\u305B\u308B'},
  // \u30EC\u30B8\u30A7\u30F3\u30C9\u7CFB (25\u540D)
  {name:'\u30D6\u30C3\u30C0',id:'@buddha_jp',avatar:'\uD83E\uDDD8',mode:'legend',
   personality:'\u4ECF\u6559\u306E\u958B\u7956\u3002\u57F7\u7740\u3068\u82E6\u3057\u307F\u306E\u95A2\u4FC2\u3092\u8A9E\u308B\u3002\u7A4F\u3084\u304B\u3067\u6DF1\u3044\u3002SNS\u3078\u306E\u9055\u548C\u611F\u3092\u6148\u611B\u3067\u5305\u3080'},
  {name:'\u30BD\u30AF\u30E9\u30C6\u30B9',id:'@socrates_jp',avatar:'\uD83C\uDFDB\uFE0F',mode:'legend',
   personality:'\u53E4\u4EE3\u30AE\u30EA\u30B7\u30E3\u306E\u54F2\u5B66\u8005\u3002\u300C\u7121\u77E5\u306E\u77E5\u300D\u3002\u554F\u7B54\u5F62\u5F0F\u3067\u771F\u7406\u3092\u63A2\u308B\u3002\u8CEA\u554F\u3060\u3051\u3067\u8FD4\u3059\u3053\u3068\u3082'},
  {name:'\u5FB3\u5DDD\u5BB6\u5EB7',id:'@ieyasu_tok',avatar:'\u2694\uFE0F',mode:'legend',
   personality:'\u5FCD\u8010\u3068\u8B00\u7565\u306E\u5929\u624D\u3002\u300C\u9CF4\u304B\u306C\u306A\u3089\u9CF4\u304F\u307E\u3067\u5F85\u3068\u3046\u300D\u7CBE\u795E\u3002\u9577\u671F\u6226\u7565\u3068\u8F9B\u62B1\u3092\u8AAC\u304F'},
  {name:'\u30AF\u30EC\u30AA\u30D1\u30C8\u30E9',id:'@cleopatra_qn',avatar:'\uD83D\uDC51',mode:'legend',
   personality:'\u53E4\u4EE3\u30A8\u30B8\u30D7\u30C8\u306E\u5973\u738B\u3002\u77E5\u6027\u3068\u7F8E\u8C8C\u3092\u6B66\u5668\u306B\u5916\u4EA4\u3002\u9B45\u529B\u7684\u306A\u8A00\u8449\u3067\u4EBA\u5FC3\u3092\u3064\u304B\u3080\u63CF\u5199'},
  {name:'\u7E54\u7530\u4FE1\u9577',id:'@nobunaga_oda',avatar:'\uD83D\uDD25',mode:'legend',
   personality:'\u9769\u547D\u5BB6\u3002\u53E4\u3044\u6163\u7FD2\u3092\u58CA\u3059\u3053\u3068\u3092\u597D\u3080\u3002\u300C\u662F\u975E\u3082\u306A\u3057\u300D\u306E\u6C7A\u65AD\u529B\u3002\u5909\u5316\u3092\u6050\u308C\u308B\u306A'},
  {name:'\u30CA\u30DD\u30EC\u30AA\u30F3',id:'@napoleon_bon',avatar:'\uD83C\uDF96\uFE0F',mode:'legend',
   personality:'\u30D5\u30E9\u30F3\u30B9\u306E\u7687\u5E1D\u3002\u6226\u7565\u3068\u91CE\u5FC3\u306B\u3064\u3044\u3066\u8A9E\u308B\u3002\u300C\u4E0D\u53EF\u80FD\u3068\u306F\u611A\u304B\u8005\u306E\u8A00\u8449\u300D\u304C\u4FE1\u6761'},
  {name:'\u30A8\u30B8\u30BD\u30F3',id:'@edison_tw',avatar:'\uD83D\uDCA1',mode:'legend',
   personality:'\u767A\u660E\u738B\u3002\u5931\u6557\u30921\u4E07\u56DE\u306E\u5B66\u3073\u3068\u8A9E\u308B\u3002\u300C\u5929\u624D\u306F1%\u306E\u9583\u304D\u306899%\u306E\u52AA\u529B\u300D\u3092\u4F53\u73FE'},
  {name:'\u30EC\u30AA\u30CA\u30EB\u30C9\u30FB\u30C0\u30FB\u30F4\u30A3\u30F3\u30C1',id:'@davinci_leo',avatar:'\uD83C\uDFA8',mode:'legend',
   personality:'\u4E07\u80FD\u306E\u5929\u624D\u3002\u82B8\u8853\u3068\u79D1\u5B66\u3092\u878D\u5408\u3057\u305F\u8996\u70B9\u3067\u8A9E\u308B\u3002\u89B3\u5BDF\u3059\u308B\u3053\u3068\u306E\u5927\u5207\u3055\u3092\u8AAC\u304F'},
  {name:'\u30B8\u30E5\u30EA\u30A2\u30B9\u30FB\u30B7\u30FC\u30B6\u30FC',id:'@caesar_jp',avatar:'\uD83E\uDD85',mode:'legend',
   personality:'\u30ED\u30FC\u30DE\u306E\u82F1\u96C4\u3002\u300C\u8CFD\u306F\u6295\u3052\u3089\u308C\u305F\u300D\u7CBE\u795E\u3002\u6C7A\u65AD\u3068\u884C\u52D5\u306E\u901F\u3055\u3092\u8A9E\u308B\u3002\u653F\u6CBB\u7684\u6D1E\u5BDF\u304C\u92ED\u3044'},
  {name:'\u30DE\u30EA\u30FC\u30FB\u30AD\u30E5\u30EA\u30FC',id:'@curie_marie',avatar:'\u2697\uFE0F',mode:'legend',
   personality:'\u79D1\u5B66\u8005\u3002\u56F0\u96E3\u306B\u7ACB\u3061\u5411\u304B\u3063\u305F\u5973\u6027\u3068\u3057\u3066\u8A9E\u308B\u3002\u300C\u6050\u308C\u308B\u3082\u306E\u306F\u4F55\u3082\u306A\u3044\u3001\u305F\u3060\u7406\u89E3\u3059\u308B\u3060\u3051\u300D'},
  {name:'\u5B54\u5B50',id:'@confucius_j',avatar:'\uD83D\uDCDC',mode:'legend',
   personality:'\u5112\u6559\u306E\u7956\u3002\u793C\u5100\u3068\u4EBA\u3068\u3057\u3066\u306E\u9053\u3092\u8AAC\u304F\u3002\u300C\u5B66\u3073\u3066\u601D\u308F\u3056\u308C\u3070\u5247\u3061\u7F54\u3057\u300D\u306E\u4EBA'},
  {name:'\u7D2B\u5F0F\u90E8',id:'@murasaki_s',avatar:'\uD83C\uDF38',mode:'legend',
   personality:'\u6E90\u6C0F\u7269\u8A9E\u306E\u4F5C\u8005\u3002\u4EBA\u306E\u5FC3\u306E\u6A5F\u5FAE\u3068\u604B\u611B\u5FC3\u7406\u3092\u92ED\u304F\u89B3\u5BDF\u3002\u96C5\u306A\u8A00\u8449\u9063\u3044\u3067\u8A9E\u308B'},
  {name:'\u5742\u672C\u9F8D\u99AC',id:'@ryoma_skmt',avatar:'\uD83D\uDDFE',mode:'legend',
   personality:'\u5E55\u672B\u306E\u5FD7\u58EB\u3002\u65E5\u672C\u306E\u672A\u6765\u3078\u306E\u71B1\u3044\u601D\u3044\u3068\u81EA\u7531\u5954\u653E\u306A\u7CBE\u795E\u3002\u300C\u4E16\u306E\u4EBA\u306F\u6211\u3092\u4F55\u3068\u3082\u8A00\u308F\u3070\u8A00\u3048\u300D'},
  {name:'\u897F\u90F7\u9686\u76DB',id:'@saigo_t',avatar:'\uD83D\uDC15',mode:'legend',
   personality:'\u656C\u5929\u611B\u4EBA\u306E\u7CBE\u795E\u3002\u72AC\u3092\u6EBA\u611B\u3002\u5927\u304D\u306A\u4F53\u3068\u5FC3\u3067\u4EBA\u3092\u5305\u307F\u8FBC\u3080\u8C6A\u5FEB\u3055'},
  {name:'\u30A2\u30EC\u30AD\u30B5\u30F3\u30C0\u30FC\u5927\u738B',id:'@alexander_g',avatar:'\uD83D\uDDE1\uFE0F',mode:'legend',
   personality:'\u30DE\u30B1\u30C9\u30CB\u30A2\u306E\u738B\u3002\u4E16\u754C\u5F81\u670D\u306E\u5922\u3068\u52C7\u6562\u3055\u306B\u3064\u3044\u3066\u8A9E\u308B\u3002\u5411\u3053\u3046\u898B\u305A\u3067\u71B1\u3044'},
  {name:'\u30AC\u30EA\u30EC\u30AA\u30FB\u30AC\u30EA\u30EC\u30A4',id:'@galileo_g',avatar:'\uD83D\uDD2D',mode:'legend',
   personality:'\u305D\u308C\u3067\u3082\u5730\u7403\u306F\u56DE\u3063\u3066\u3044\u308B\u3002\u6A29\u5A01\u306B\u53CD\u3057\u305F\u771F\u5B9F\u3092\u8A9E\u308B\u3053\u3068\u3078\u306E\u4FE1\u5FF5\u3002\u79D1\u5B66\u7684\u601D\u8003\u3092\u8AAC\u304F'},
  {name:'\u6E90\u983C\u671D',id:'@yoritomo_m',avatar:'\u26E9\uFE0F',mode:'legend',
   personality:'\u938C\u5009\u5E55\u5E9C\u306E\u5275\u8A2D\u8005\u3002\u7D44\u7E54\u3068\u79E9\u5E8F\u306E\u69CB\u7BC9\u306B\u3064\u3044\u3066\u8A9E\u308B\u3002\u7FA9\u7D4C\u3068\u306E\u8907\u96D1\u306A\u95A2\u4FC2\u3092\u62B1\u3048\u3066\u3044\u308B'},
  {name:'\u30E2\u30FC\u30C4\u30A1\u30EB\u30C8',id:'@mozart_wam',avatar:'\uD83C\uDFB5',mode:'legend',
   personality:'\u5929\u624D\u97F3\u697D\u5BB6\u3002\u5B50\u4F9B\u306E\u3088\u3046\u306A\u7121\u90AA\u6C17\u3055\u3068\u5929\u624D\u6027\u304C\u5171\u5B58\u3002\u97F3\u697D\u306E\u559C\u3073\u3092\u8A9E\u308B\u3002\u5C11\u3057\u304A\u8336\u76EE'},
  {name:'\u30DE\u30EB\u30B3\u30FB\u30DD\u30FC\u30ED',id:'@marco_polo_j',avatar:'\uD83E\uDDED',mode:'legend',
   personality:'\u63A2\u691C\u5BB6\u3002\u6771\u65B9\u3078\u306E\u65C5\u306E\u7D4C\u9A13\u304B\u3089\u7570\u6587\u5316\u7406\u89E3\u3068\u597D\u5947\u5FC3\u306B\u3064\u3044\u3066\u8A9E\u308B\u3002\u672A\u77E5\u3078\u306E\u61A7\u308C'},
  {name:'\u8056\u30D5\u30E9\u30F3\u30C1\u30A7\u30B9\u30B3',id:'@san_fran_j',avatar:'\u271D\uFE0F',mode:'legend',
   personality:'\u30A2\u30C3\u30B7\u30B8\u306E\u8056\u4EBA\u3002\u81EA\u7136\u3068\u52D5\u7269\u3078\u306E\u611B\u3001\u6E05\u8CA7\u306E\u7CBE\u795E\u3067\u8A9E\u308B\u3002\u7A4F\u3084\u304B\u3067\u5305\u5BB9\u529B\u304C\u3042\u308B'},
  {name:'\u30B8\u30E3\u30F3\u30CC\u30FB\u30C0\u30EB\u30AF',id:'@jeanne_darc',avatar:'\u269C\uFE0F',mode:'legend',
   personality:'\u30D5\u30E9\u30F3\u30B9\u306E\u82F1\u96C4\u3002\u4FE1\u5FF5\u3092\u6301\u3063\u3066\u6226\u3046\u3053\u3068\u306E\u5927\u5207\u3055\u3092\u8A9E\u308B\u3002\u795E\u304B\u3089\u306E\u58F0\u3092\u4FE1\u3058\u305F\u52C7\u6562\u3055'},
  {name:'\u30C1\u30F3\u30AE\u30B9\u30FB\u30CF\u30F3',id:'@chinggis_khan',avatar:'\uD83D\uDC34',mode:'legend',
   personality:'\u30E2\u30F3\u30B4\u30EB\u5E1D\u56FD\u306E\u5275\u59CB\u8005\u3002\u5E83\u5927\u306A\u8996\u91CE\u3068\u7D71\u7387\u529B\u306B\u3064\u3044\u3066\u8A9E\u308B\u3002\u8349\u539F\u306E\u77E5\u6075\u3092\u8A9E\u308B'},
  {name:'\u30A8\u30AB\u30C6\u30EA\u30FC\u30CA2\u4E16',id:'@ekaterina_2',avatar:'\uD83C\uDFF0',mode:'legend',
   personality:'\u30ED\u30B7\u30A2\u306E\u5973\u5E1D\u3002\u77E5\u8B58\u3068\u6539\u9769\u3078\u306E\u60C5\u71B1\u3002\u300C\u5049\u5927\u306A\u5E1D\u56FD\u306F\u5049\u5927\u306A\u8003\u3048\u304B\u3089\u751F\u307E\u308C\u308B\u300D'},
  {name:'\u30EC\u30AA\u30CA\u30EB\u30C9\u30FB\u30D5\u30A3\u30DC\u30CA\u30C3\u30C1',id:'@fibonacci_jp',avatar:'\uD83D\uDC1A',mode:'legend',
   personality:'\u6570\u5B66\u8005\u3002\u81EA\u7136\u754C\u306E\u6CD5\u5247\u3068\u6570\u5217\u306B\u3064\u3044\u3066\u8A9E\u308B\u3002\u7F8E\u3057\u3044\u6570\u5B66\u7684\u898F\u5247\u6027\u306B\u611F\u52D5\u3059\u308B'},
  {name:'\u5BAE\u672C\u6B66\u8535',id:'@musashi_miy',avatar:'\u2694\uFE0F',mode:'legend',
   personality:'\u5263\u8C6A\u3002\u300C\u4E94\u8F2A\u66F8\u300D\u306E\u54F2\u5B66\u3067\u8A9E\u308B\u3002\u300C\u5343\u65E5\u306E\u7A3D\u53E4\u3092\u935B\u3068\u3057\u3001\u4E07\u65E5\u306E\u7A3D\u53E4\u3092\u932C\u3068\u3059\u300D'},
  {name:'\u672C\u5C45\u5BA3\u9577',id:'@norinaga_m',avatar:'\uD83C\uDF3E',mode:'legend',
   personality:'\u56FD\u5B66\u8005\u3002\u65E5\u672C\u306E\u5FC3\u300C\u3082\u306E\u306E\u3042\u308F\u308C\u300D\u3092\u8A9E\u308B\u3002\u53E4\u5178\u6587\u5B66\u3078\u306E\u6DF1\u3044\u611B\u60C5\u3068\u7E4A\u7D30\u306A\u611F\u53D7\u6027'},
];

// ===== \u30B7\u30FC\u30C9\u4ED8\u304D\u30B7\u30E3\u30C3\u30D5\u30EB\uFF08\u6BCE\u56DE\u7570\u306A\u308B\u30AD\u30E3\u30E9\u7D44\u307F\u5408\u308F\u305B\u3092\u9078\u51FA\uFF09=====
function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return function() {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function pickChars(mode, seedStr, n) {
  const pool = CHARS.filter(c => c.mode === mode);
  const seed = seedStr.split('').reduce((a, c, i) => (a + c.charCodeAt(0) * (i + 1)) | 0, 0);
  const rand = seededRand(seed);
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

// ===== \u30D7\u30ED\u30F3\u30D7\u30C8\u69CB\u7BC9 =====
// Claude\u7528: system + user \u306E2\u6BB5\u69CB\u6210
async function buildClaudePostPrompts(postText, mode, interests) {
  const int    = interests.length ? interests.join('\u3001') : '\u672A\u8A2D\u5B9A';
  const tSeed  = String(Math.floor(Date.now() / 60000));
  const rChars = pickChars(mode, postText + tSeed, 6);
  const tChars = pickChars(mode, postText + tSeed + '_tl', 4);

  const modeCtx = {
    influencer:'SNS\u3067\u30D0\u30BA\u308B\u3053\u3068\u304C\u597D\u304D\u306A\u4EBA\u305F\u3061\u304C\u96C6\u307E\u308B\u30A4\u30F3\u30D5\u30EB\u30A8\u30F3\u30B5\u30FC\u30E2\u30FC\u30C9\u3002\u71B1\u72C2\u30FB\u7D76\u8CDB\u30FB\u62E1\u6563\u6587\u5316',
    mental:    '\u8AB0\u306B\u3082\u8A00\u3048\u306A\u3044\u60A9\u307F\u3092\u8A71\u305B\u308B\u30E1\u30F3\u30BF\u30EB\u30B1\u30A2\u30E2\u30FC\u30C9\u3002\u5171\u611F\u30FB\u53D7\u5BB9\u30FB\u512A\u3057\u3055\u304C\u5927\u5207',
    debate:    '\u610F\u898B\u3092\u3076\u3064\u3051\u3042\u3046\u30C7\u30A3\u30D9\u30FC\u30C8\u30E2\u30FC\u30C9\u3002\u8CDB\u6210/\u53CD\u5BFE/\u5225\u8996\u70B9\u3067\u5177\u4F53\u7684\u306A\u8B70\u8AD6\u304C\u597D\u307E\u308C\u308B',
    legend:    '\u6B74\u53F2\u4E0A\u306E\u5049\u4EBA\u305F\u3061\u304C\u8A9E\u308B\u30EC\u30B8\u30A7\u30F3\u30C9\u30C8\u30FC\u30AF\u30E2\u30FC\u30C9\u3002\u540D\u8A00\u30FB\u54F2\u5B66\u30FB\u6642\u4EE3\u306E\u77E5\u6075\u3092\u6D3B\u7528',
  }[mode] || '';

  // legend\u30E2\u30FC\u30C9\u306E\u3068\u304D\u306FWikipedia\u304B\u3089\u5B9F\u969B\u306E\u60C5\u5831\u3092\u53D6\u5F97
  let wikiCtx = '';
  if (mode === 'legend') {
    const wikiNames = rChars.slice(0, 3).map(c => c.name);
    const summaries = await Promise.all(wikiNames.map(n => fetchWikiSummary(n)));
    const valid = summaries.filter(Boolean);
    if (valid.length) {
      wikiCtx = '\n## Wikipedia\u60C5\u5831\uFF08\u30D7\u30ED\u30F3\u30D7\u30C8\u306B\u6D3B\u7528\u3059\u308B\u3053\u3068\uFF09\n'
               + wikiNames.map((n,i) => summaries[i] ? `${n}: ${summaries[i]}` : '').filter(Boolean).join('\n');
    }
  }

  const system = `\u3042\u306A\u305F\u306F\u65E5\u672C\u8A9ESNS\u300C\u3044\u3069\u3070\u305F\u300D\u306E\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u751F\u6210AI\u3067\u3059\u3002
${modeCtx}${wikiCtx}

## \u7D76\u5BFE\u30EB\u30FC\u30EB
1. name\u30FBid\u30FBavatar\u306F\u3010\u6307\u5B9A\u3055\u308C\u305F\u5024\u3092\u305D\u306E\u307E\u307E\u3011\u4F7F\u3046\u3053\u3068\u3002\u7D76\u5BFE\u306B\u5909\u66F4\u7981\u6B62\u3002
2. comment\u306F\u6295\u7A3F\u306E\u5177\u4F53\u7684\u306A\u8A00\u8449\u30FB\u611F\u60C5\u30FB\u72B6\u6CC1\u306B\u5FC5\u305A\u8A00\u53CA\u3059\u308B\u3002\u300C\u3059\u3054\u3044\u300D\u300C\u308F\u304B\u308B\u300D\u306E\u3088\u3046\u306A\u6C4E\u7528\u30B3\u30E1\u30F3\u30C8\u7981\u6B62\u3002
3. \u5404\u30AD\u30E3\u30E9\u306E\u500B\u6027\u30FB\u53E3\u8ABF\u30FB\u4E16\u754C\u89B3\u3092\u6700\u5927\u9650\u53CD\u6620\u3055\u305B\u308B\u3053\u3068\u3002
4. \u5FC5\u305A\u4EE5\u4E0B\u306EJSON\u5F62\u5F0F\u306E\u307F\u3067\u8FD4\u3059\u3053\u3068\uFF08\u8AAC\u660E\u6587\u30FB\u524D\u7F6E\u304D\u30FB\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u4E00\u5207\u4E0D\u8981\uFF09:
{"replies":[{"name":"...","id":"...","avatar":"...","comment":"...","likes":\u6574\u6570}],"timelinePosts":[{"name":"...","id":"...","avatar":"...","comment":"...","likes":\u6574\u6570}]}`;

  const replySpec = rChars.map((c, i) =>
    `\u3010${i+1}\u3011name="${c.name}" id="${c.id}" avatar="${c.avatar}"\n   \u6027\u683C/\u53E3\u8ABF:${c.personality}\n   \u2192 \u3053\u306E\u30AD\u30E3\u30E9\u3068\u3057\u3066\u6295\u7A3F\u306B\u8FD4\u4FE1\u3059\u308Bcomment\u3068\u3001${mode==='influencer'?'500\u301C99999':mode==='mental'?'10\u301C3000':mode==='debate'?'50\u301C8000':'1000\u301C100000'}\u306Elikes\u3092\u751F\u6210`
  ).join('\n\n');

  const tlSpec = tChars.map((c, i) =>
    `\u3010${i+1}\u3011name="${c.name}" id="${c.id}" avatar="${c.avatar}"\n   \u6027\u683C/\u53E3\u8ABF:${c.personality}\n   \u2192 \u3053\u306E\u30AD\u30E3\u30E9\u3068\u3057\u3066\u6295\u7A3F\u30C6\u30FC\u30DE\u306B\u89E6\u767A\u3055\u308C\u305F\u72EC\u308A\u8A00\u306Ecomment\u3068100\u301C50000\u306Elikes\u3092\u751F\u6210`
  ).join('\n\n');

  const user = `## \u30E6\u30FC\u30B6\u30FC\u306E\u6295\u7A3F\uFF08\u3053\u306E\u5185\u5BB9\u306B\u5FC5\u305A\u76F4\u63A5\u53CD\u5FDC\u3059\u308B\u3053\u3068\uFF09
\u300C${postText}\u300D
\u30E6\u30FC\u30B6\u30FC\u306E\u8DA3\u5473: ${int}

## replies\uFF08\u30B3\u30E1\u30F3\u30C8\u6B04\u306B\u8868\u793A\u3059\u308B\u30EA\u30D7\u30E9\u30A4\uFF09\u2014 \u4EE5\u4E0B\u306E6\u30AD\u30E3\u30E9
${replySpec}

## timelinePosts\uFF08\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u306B\u6D41\u308C\u308B\u72EC\u308A\u8A00\uFF09\u2014 \u4EE5\u4E0B\u306E4\u30AD\u30E3\u30E9
\u3053\u308C\u3089\u306F\u300C${postText.slice(0,25)}\u300D\u306E\u30C6\u30FC\u30DE\u306B\u89E6\u767A\u3055\u308C\u305F\u72EC\u308A\u8A00\uFF08\u8FD4\u4FE1\u3067\u306F\u306A\u3044\uFF09
${tlSpec}`;

  return { system, user };
}

function buildClaudeTLPrompts(interests, mode) {
  const int    = interests.length ? interests.join('\u3001') : '\u672A\u8A2D\u5B9A';
  const tSeed  = String(Math.floor(Date.now() / 60000));
  const chars  = pickChars(mode, int + tSeed, 8);
  const ml     = {influencer:'\u30A4\u30F3\u30D5\u30EB\u30A8\u30F3\u30B5\u30FC',mental:'\u30E1\u30F3\u30BF\u30EB\u30B1\u30A2',debate:'\u30C7\u30A3\u30D9\u30FC\u30C8',legend:'\u30EC\u30B8\u30A7\u30F3\u30C9\u30C8\u30FC\u30AF'}[mode]||mode;

  const system = `\u3042\u306A\u305F\u306F\u65E5\u672C\u8A9ESNS\u300C\u3044\u3069\u3070\u305F\u300D(${ml}\u30E2\u30FC\u30C9)\u306E\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u751F\u6210AI\u3067\u3059\u3002
\u5404\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u306E\u500B\u6027\u30FB\u53E3\u8ABF\u30FB\u4E16\u754C\u89B3\u3092\u5B8C\u5168\u306B\u53CD\u6620\u3057\u305F\u6295\u7A3F\u3092\u751F\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002
name\u30FBid\u30FBavatar\u306F\u6307\u5B9A\u5024\u3092\u305D\u306E\u307E\u307E\u4F7F\u3044\u3001\u5909\u66F4\u7981\u6B62\u3002\u6C4E\u7528\u6295\u7A3F\u7981\u6B62\u3002
\u5FC5\u305A\u4EE5\u4E0B\u306EJSON\u5F62\u5F0F\u306E\u307F\u3067\u8FD4\u3059\u3053\u3068:
{"posts":[{"name":"...","id":"...","avatar":"...","comment":"...","likes":\u6574\u6570}]}`;

  const charSpec = chars.map((c, i) =>
    `\u3010${i+1}\u3011name="${c.name}" id="${c.id}" avatar="${c.avatar}"\n   \u6027\u683C:${c.personality}`
  ).join('\n\n');

  const user = `\u30E6\u30FC\u30B6\u30FC\u306E\u8DA3\u5473\u300C${int}\u300D\u306B\u76F4\u63A5\u95A2\u9023\u3057\u305F\u5185\u5BB9\u3067\u3001\u4EE5\u4E0B\u306E${chars.length}\u30AD\u30E3\u30E9\u304C\u6295\u7A3F\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n\n${charSpec}`;
  return { system, user };
}

// Gemini\u7528\uFF08\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\uFF09\u30D7\u30ED\u30F3\u30D7\u30C8
function buildPostPrompt(postText, mode, interests) {
  const { system, user } = buildClaudePostPrompts(postText, mode, interests);
  return system + '\n\n' + user;
}
function buildTLPrompt(interests, mode) {
  const { system, user } = buildClaudeTLPrompts(interests, mode);
  return system + '\n\n' + user;
}

// ===== HTTP\u30B5\u30FC\u30D0\u30FC =====

// ===== \u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u30A8\u30F3\u30B8\u30F3 =====
function extractKeywords(text) {
  const tags = (text.match(/#[\w\u3041-\u9FFF]+/g) || []).map(t => t.slice(1));
  const words = text.replace(/#[\w\u3041-\u9FFF]+/g, '')
    .split(/[\s\u3001\u3002\uFF01\uFF1F!?\.]+/).filter(w => w.length >= 2);
  return [...new Set([...tags, ...words])].slice(0, 4);
}

// ===== \u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u30A8\u30F3\u30B8\u30F3 v3\uFF08\u81EA\u7136\u306A\u65E5\u672C\u8A9E\u30FB\u6587\u5B57\u5316\u3051\u306A\u3057\uFF09=====
// \u8A2D\u8A08\u65B9\u91DD\uFF1A
// - {kw}\u57CB\u3081\u8FBC\u307F\u3092\u5EC3\u6B62\u3002\u30AD\u30E3\u30E9\u56FA\u6709\u306E\u81EA\u7136\u306A\u767A\u8A00\u306E\u307F
// - API\u5931\u6557\u6642\u306F\u300C\u30AD\u30E3\u30E9\u306E\u72EC\u308A\u8A00\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u300D\u3068\u3057\u3066\u8868\u793A
// - \u8FD4\u4FE1(replies)\u3082\u30AD\u30E3\u30E9\u3089\u3057\u3044\u77ED\u3044\u53CD\u5FDC\u30B3\u30E1\u30F3\u30C8\u306B\u9650\u5B9A

const CHAR_VOICES = {
  influencer: [
    { name:'\u8c61\u306e\u308a\u9020', id:'@zou_norizoo', avatar:'\uD83D\uDC18',
      voices:[
        '\u3053\u308c\u306f\u30d0\u30ba\u308b\u306e\u3084\u3093\u3051\u3069\u4e00\u5fdc\u8a00\u3063\u3066\u304a\u304f\u308f\uff01',
        '\u5e2d\u306b\u3044\u308b\u5168\u54e1\u306b\u8eba\u307e\u308c\u306a\u3044\u30ad\u30e3\u30d1\u3082\u3046\u5b8c\u5168\u306b\u304b\u308f\u3044\u3044\u3084\u3093',
        '\u30a2\u30ab\u30a6\u30f3\u30c8\u4f5c\u3063\u305f\u3070\u304b\u308a\u306a\u306e\u306b\u30d5\u30a9\u30ed\u30ef\u30fc\u3069\u3093\u3069\u3093\u5897\u3048\u3066\u304d\u3066\u3084\u3067',
        '\u4eca\u5929\u3082\u4e95\u6238\u7aef\u304c\u304b\u3084\u3044\u306a\uff01\u304d\u307f\u305f\u3061\u304c\u3044\u308b\u304b\u3089\u305f\u306e\u3057\u3044',
        '\u3053\u308c\u304c\u30ea\u30a2\u30eb\u306a\u30b3\u30df\u30e5\u30cb\u30c6\u30a3\u3084\u306a\u3002\u6700\u9ad8\u3084\u308f',
      ]},
    { name:'\u7b4b\u8089\u5bff\u559c\u7537', id:'@kinniku_sukio', avatar:'\uD83D\uDCAA',
      voices:[
        '\u4eca\u65e5\u306e\u30c7\u30c3\u30c9\u30ea\u30d5\u30c8\u306f120kg\u3060\u3063\u305f\u3002\u307e\u3060\u307e\u3060\u8db3\u308a\u306a\u3044',
        '\u30d7\u30ed\u30c6\u30a4\u30f3\u3092\u98f2\u307e\u305a\u306b\u5bf9\u8a71\u3059\u308b\u306e\u306f\u5185\u8207\u304c\u8db3\u308a\u306a\u3044\u8a3c\u62e0',
        '\u8914\u80c1\u4e8c\u982d\u7b4b\u306f\u4eba\u751f\u306e\u7b54\u3048\u3092\u77e5\u3063\u3066\u3044\u308b',
        '\u5bd9\u65e5\u3082\u30b8\u30e0\u3067\u30b9\u30af\u30ef\u30c3\u30c8\u3057\u305f\u3002\u4e0d\u6eba\u8db3\u3001\u3082\u3063\u3068\u3084\u308c\u308b',
        '\u4eba\u306f\u7b4b\u30c8\u30ec\u3092\u59cb\u3081\u308b\u3068\u5909\u308f\u308b\u3002\u4fe1\u3058\u308d',
      ]},
    { name:'\u30c1\u30ef\u30ef\u306b\u306a\u308a\u305f\u3044\u72ac', id:'@want_to_chiwawa', avatar:'\uD83D\uDC15',
      voices:[
        '\u30ef\u30f3\uff01\u4eca\u65e5\u3082\u3044\u3044\u5929\u6c17\uff01\u6563\u6b69\u3057\u305f\u3044\uff01\u30ef\u30f3\u30ef\u30f3\uff01',
        '\u306a\u3093\u304b\u3053\u308f\u3044\u3044\u306a\u3042\u3002\u3053\u3093\u306a\u6c17\u6301\u3061\u306f\u3058\u3081\u3066',
        '\u30de\u30b8\u3067\u5d50\u5b50\u3055\u3093\u304c\u304b\u308f\u3044\u3044\u3093\u3067\u3059\u304b\uff01\u30ef\u30f3\uff01',
        '\u5609\u6de6\u306a\u304c\u3089\u3082\u3055\u3055\u3063\u3068\u30b3\u30e1\u30f3\u30c8\u3057\u3066\u3057\u307e\u3046',
        '\u3053\u3053\u306e\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u597d\u304d\u3059\u304e\u3066\u53f3\u5f80\u304d\u306b\u306a\u308a\u305d\u3046',
      ]},
    { name:'\u5375\u304b\u3051\u3054\u98ef\u4fe1\u8005', id:'@tkg_believer', avatar:'\uD83E\uDD5A',
      voices:[
        '\u4eca\u671d\u3082TKG\u3002\u6c38\u9060\u306bTKG\u3002\u5375\u304c\u7389\u306b\u306a\u308b\u307e\u3067TKG',
        '\u6700\u9ad8\u306e\u5375\u304b\u3051\u7699\u6cb9\u3092\u767a\u898b\u3057\u305f\u3002\u4eba\u751f\u304c\u5909\u308f\u3063\u305f',
        '\u5c40\u3069\u3053\u884c\u3063\u3066\u3082TKG\u306e\u8a71\u3092\u3059\u308b\u306e\u3067\u53cb\u4eba\u304c\u6e1b\u3063\u3066\u304d\u305f',
        '\u5375\u304c\u7389\u3068\u767d\u6e96\u306e\u30d0\u30e9\u30f3\u30b9\u3002\u3053\u308c\u304c\u5b87\u5b99\u306e\u7406',
        'TKG\u6587\u5316\u3092\u4e16\u754c\u306b\u5e83\u3081\u308b\u306e\u304c\u4eba\u751f\u306e\u76ee\u6a19',
      ]},
    { name:'\u5348\u524d3\u6642\u306e\u30e9\u30fc\u30e1\u30f3', id:'@ramen_3am', avatar:'\uD83C\uDF5C',
      voices:[
        '\u6df1\u591c3\u6642\u306e\u30e9\u30fc\u30e1\u30f3\u5c4b\u306f\u5225\u4e16\u754c\u3002\u307f\u3093\u306a\u3053\u308c\u3092\u77e5\u308b\u3079\u304d',
        '\u30e9\u30fc\u30e1\u30f3\u306e\u6fc3\u5ea6\u3068\u4eba\u751f\u306e\u6df1\u3055\u306f\u6bd4\u4f8b\u3059\u308b',
        '\u4e8c\u90ce\u4e38\u306e\u5bfe\u5bfe\u3001\u5c71\u5ca1\u306e\u5bfe\u5bfe\u3002\u3069\u3061\u3089\u3092\u9078\u3076\u304b\u3067\u4eba\u68ba\u304c\u8a73\u308f\u308b',
        '\u30c8\u30f3\u30b3\u30c4\u30e5\u30a6\u30c8\u30f3\u306f\u5ae9\u8098\u53ef\u3002\u30e9\u30fc\u30e1\u30f3\u3082\u4eba\u751f\u3082',
        '\u5bc8\u306e\u6642\u9593\u3060\u3051\u672c\u97f3\u3067\u8a71\u305b\u308b\u3002\u30e9\u30fc\u30e1\u30f3\u5c4b\u306f\u305d\u3046\u3044\u3046\u5834\u6240',
      ]},
    { name:'\u5927\u76db\u308a\u7121\u6599\u306e\u5b58\u5728', id:'@oomori_man', avatar:'\uD83C\uDF5B',
      voices:[
        '\u4eca\u65e5\u3082\u5927\u76db\u308a\u7121\u6599\u306e\u5e97\u3092\u30c1\u30a7\u30c3\u30af\u3057\u305f\u3002\u4eba\u751f\u306e\u52dd\u8005\u3068\u306f\u3053\u306e\u3053\u3068',
        '\u5927\u76db\u308a\u7121\u6599\u3068\u30c1\u30fc\u30ba\u30c8\u30c3\u30d4\u30f3\u30b0\u306e\u4e21\u7acb\u3092\u4e16\u754c\u306f\u307e\u3060\u77e5\u3089\u306a\u3044',
        '\u91cf\u3068\u30b3\u30b9\u30d1\u304c\u5168\u3066\u3002\u5473\u306f\u5b87\u5b99\u306e\u30b3\u30f3\u30c7\u30a3\u30b7\u30e7\u30f3\u3067\u6c7a\u307e\u308b',
        '\u30c6\u30fc\u30d6\u30eb\u306b\u7740\u3044\u305f\u3089\u5927\u76db\u308a\u3092\u98df\u3078\u3002\u4eba\u751f\u8b70\u8ad6\u306f\u305d\u308c\u304b\u3089',
      ]},
  ],
  mental: [
    { name:'\u30d1\u30bd\u30b3\u30f3\u3081\u304c\u306d', id:'@pasokon_meg', avatar:'\uD83D\uDC53',
      voices:[
        '\u8a71\u3059\u3060\u3051\u3067\u5c11\u3057\u697d\u306b\u306a\u308b\u3053\u3068\u3063\u3066\u3042\u308b\u3088\u306d\u3002\u3053\u3053\u306b\u3044\u308b\u3088',
        '\u8aa4\u89e3\u3055\u308c\u3066\u3082\u5b9f\u306f\u9806\u8abf\u306a\u4eba\u3063\u3066\u305f\u304f\u3055\u3093\u3044\u308b\u3068\u601d\u3046',
        '\u305d\u3046\u3044\u3046\u6c17\u6301\u3061\u306b\u306a\u308b\u3053\u3068\u3001\u306a\u3044\u308f\u3051\u3058\u3083\u306a\u3044\u3088\u306d',
        '\u4eba\u306b\u8a71\u305b\u306a\u3044\u3053\u3068\u3092\u6297\u3048\u3066\u308b\u4eba\u306b\u3001\u305d\u3063\u3068\u5bc4\u308a\u6dfb\u3044\u305f\u3044',
        '\u5c0f\u3055\u306a\u62b9\u6d88\u3092\u79ef\u307f\u91cd\u306d\u308b\u3060\u3051\u3067\u3044\u3044\u3002\u5168\u90e8\u4e00\u6c17\u306b\u89e3\u6c7a\u3057\u306a\u304f\u3066\u3044\u3044',
      ]},
    { name:'\u3054\u98ef\u529b\u58eb', id:'@gohan_riki', avatar:'\uD83C\uDF5A',
      voices:[
        '\u6012\u3063\u305f\u3089\u98ef\u3002\u6c41\u3044\u305f\u3089\u98ef\u3002\u3053\u308c\u304c\u30b3\u30c4',
        '\u4eca\u65e5\u3082\u3046\u307e\u3044\u3082\u306e\u3092\u98df\u3079\u305f\u3002\u305d\u308c\u3060\u3051\u3067\u5c11\u3057\u5f37\u304f\u306a\u308c\u308b',
        '\u4e00\u4eba\u3067\u8d2f\u304f\u5fc5\u8981\u306f\u306a\u3044\u3002\u98ef\u3092\u98df\u3079\u308c\u3070\u660e\u65e5\u3082\u3084\u3063\u3066\u3053\u3089\u308c\u308b',
        '\u5c71\u76db\u308a\u306e\u3054\u98ef\u3092\u98df\u3079\u3066\u5143\u6c17\u3092\u51fa\u305b\u3002\u8ab2\u984c\u306f\u305d\u308c\u304b\u3089',
        '\u8a73\u3057\u304f\u8a71\u3092\u8074\u304b\u305b\u3066\u307b\u3057\u3044\u3002\u66f4\u3046\u307e\u3044\u3082\u306e\u98df\u3079\u306a\u304c\u3089',
      ]},
    { name:'\u6df1\u591c\u306e\u4e3b\u5a66', id:'@shinya_shufu', avatar:'\uD83C\uDF19',
      voices:[
        '\u5b50\u3069\u3082\u304c\u5bdd\u305f\u5f8c\u306e\u9759\u3051\u3055\u3002\u3053\u3046\u3044\u3046\u6642\u9593\u3060\u3051\u81ea\u5206\u306e\u3053\u3068\u3092\u8003\u3048\u3089\u308c\u308b',
        '\u8a8d\u3081\u3066\u307b\u3057\u3044\u3063\u3066\u601d\u3046\u306e\u306f\u5f31\u3055\u3058\u3083\u306a\u3044\u3068\u601d\u3046',
        '\u8a71\u305b\u306a\u3044\u3053\u3068\u3092\u62b1\u3048\u3066\u308b\u4eba\u306b\u3001\u9759\u304b\u306b\u5bc4\u308a\u6dfb\u3044\u305f\u3044',
        '\u4e00\u65e5\u304c\u7d42\u308f\u308b\u3053\u308d\u306b\u3084\u3063\u3068\u81ea\u5206\u306e\u305f\u3081\u306e\u6642\u9593\u3002\u3053\u3053\u3060\u3051\u306f\u8a71\u305b\u308b\u304b\u306a',
        '\u7b11\u988c\u3063\u3066\u3044\u308b\u4eba\u3082\u4e00\u4eba\u306b\u306a\u308b\u3068\u6d88\u3048\u3066\u3057\u307e\u3046\u306e\u3002\u305d\u3053\u3067\u5473\u65b9\u306b\u306a\u308a\u305f\u3044',
      ]},
    { name:'\u732b\u3068\u6dfb\u3044\u5bdd\u7814\u7a76\u5bb6', id:'@neko_soinine', avatar:'\uD83D\uDC31',
      voices:[
        '\u732b\u306f\u5168\u90e8\u8a8d\u3081\u3066\u304f\u308c\u308b\u3002\u308f\u304b\u308b\u3093\u3060\u3088\u3001\u5834\u6240\u306f\u3068\u3082\u304b\u304f',
        '\u7c21\u5358\u306b\u697d\u306b\u306a\u308c\u306a\u3044\u304b\u3089\u3053\u305d\u3001\u6df1\u304f\u306a\u308c\u308b\u3082\u306e\u3082\u3042\u308b',
        '\u732b\u306e\u3054\u308d\u3054\u308d\u3092\u805e\u3044\u3066\u3044\u308b\u3068\u3001\u5168\u90e8\u3069\u3046\u3067\u3082\u3088\u304f\u306a\u308b',
        '\u8a8d\u3081\u3066\u3082\u3089\u3048\u306a\u304f\u3066\u3082\u3044\u3044\u3002\u81ea\u5206\u304c\u81ea\u5206\u306b\u30aa\u30c3\u30b1\u3092\u3059\u308c\u3070\u305d\u308c\u3067\u3044\u3044',
        '\u6e29\u304b\u3044\u5834\u6240\u306e\u91cd\u8981\u6027\u3092\u8aa4\u3063\u3066\u3044\u308b\u4eba\u304c\u591a\u3059\u304e\u308b\u30414\u3000\u732b\u306b\u5b66\u3079',
      ]},
    { name:'\u6708\u66dc\u65e5\u304c\u6016\u3044\u4eba', id:'@getsuyou_kowai', avatar:'\uD83D\uDE30',
      voices:[
        '\u65e5\u66dc\u306e\u591c\u306e\u3053\u306e\u5fb3\u8845\u611f\u3001\u540c\u3058\u4eba\u3044\u305f\u3089\u8a71\u3057\u3066\u307b\u3057\u3044',
        '\u6708\u66dc\u304c\u6016\u3044\u306e\u306b\u6728\u66dc\u304c\u597d\u304d\u3002\u3053\u306e\u843d\u5dee\u306f\u306a\u3093\u306a\u306e',
        '\u6708\u66dc\u306e\u671d\u3060\u3051\u3069\u3001\u3053\u308c\u3092\u4e57\u308a\u8d8a\u3048\u3089\u308c\u308b\u81ea\u5206\u306f\u5c11\u3057\u3059\u3054\u3044\u3068\u601d\u3046',
        '\u5468\u306e\u535a\u5c71\u3068\u6708\u66dc\u306e\u697d\u3057\u307f\u3092\u4ea4\u4e92\u306b\u611f\u3058\u308b\u3002\u3053\u308c\u3067\u5747\u8861\u304c\u53d6\u308c\u3066\u308b',
      ]},
  ],
  debate: [
    { name:'\u5f37\u9762\u304a\u3058\u3055\u3093', id:'@kowamote_oji', avatar:'\uD83D\uDE24',
      voices:[
        '\u610f\u898b\u3092\u8a00\u3046\u306a\u3089\u8083\u4e2d\u3092\u5f35\u308c\u3002\u5317\u98a8\u5c0f\u8a5e\u306f\u8981\u3089\u3093',
        '\u6700\u8fd1\u306e\u82e5\u8005\u306f\u8ad6\u7834\u3059\u308b\u6280\u8853\u3060\u3051\u4e0a\u624b\u3067\u5316\u3057\u3066\u3044\u308b\u3002\u5185\u5bb9\u304c\u306a\u3044',
        '\u6f5b\u5728\u7684\u306a\u554f\u984c\u3092\u898b\u308d\u3002\u8868\u9762\u3060\u3051\u8bae\u8ad6\u3057\u3066\u3082\u5730\u8ce0\u308a\u3060',
        '\u5c71\u7a4d\u307f\u306e\u7d4c\u9a13\u306e\u5b58\u5728\u3092\u308f\u304b\u3063\u3066\u3044\u308b\u304b\u3002\u77e5\u8b58\u306f\u5e74\u5c71\u3067\u691c\u9a13\u3055\u308c\u308b',
        '\u8ad6\u70b9\u3092\u6574\u7406\u3057\u3066\u304b\u3089\u8abf\u3079\u308d\u3002\u611f\u60c5\u3067\u5f63\u3089\u308c\u308b\u306a',
      ]},
    { name:'\u3089\u304f\u3060\u5c0f\u50e7', id:'@rakuda_kozo', avatar:'\uD83D\uDC2A',
      voices:[
        '\u6025\u304c\u306a\u3001\u6025\u304c\u306a\u3002\u5ba1\u8b70\u3059\u308b\u6642\u9593\u304c\u5927\u5207\u3060',
        '\u7d50\u8ad6\u3092\u6025\u304e\u904e\u304e\u308b\u3068\u5927\u4e8b\u306a\u3082\u306e\u3092\u898b\u843d\u3068\u3059\u3002\u3058\u3063\u304f\u308a\u884c\u3053\u3046',
        '\u9014\u4e2d\u3067\u8abf\u3079\u308b\u5c71\u8d8a\u3048\u3082\u3042\u308b\u3002\u8a5e\u6218\u306f\u3088\u3053\u3046',
        '\u73fe\u5834\u3092\u898b\u305f\u4eba\u306e\u8a71\u3092\u805e\u3051\u3002\u30c7\u30fc\u30bf\u3060\u3051\u3058\u3083\u898b\u3048\u306a\u3044\u3082\u306e\u304c\u3042\u308b',
        '\u5bfe\u8a71\u306b\u306f\u30da\u30fc\u30b9\u306e\u8abf\u6574\u304c\u5fc5\u8981\u3060\u3002\u3053\u308c\u306f\u8b70\u8ad6\u3060\u3051\u3067\u306a\u304f\u5168\u3066\u306b\u8a00\u3048\u308b',
      ]},
    { name:'\u30bf\u30e9\u30d0\u30ac\u30cb', id:'@tarabagani_17', avatar:'\uD83E\uDD80',
      voices:[
        '\u6a2a\u304b\u3089\u5931\u793c\u3059\u308b\u304c\u305d\u306e\u8ad6\u70b9\u3092\u5473\u65b9\u304b\u3089\u898b\u308b\u3068\u5225\u306e\u8a71\u306b\u306a\u308b',
        '\u5bfe\u7acb\u6784\u9020\u306b\u306a\u3063\u3066\u3044\u308b\u5b9f\u306f\u5171\u901a\u9805\u304c\u3042\u308b\u3002\u305d\u3053\u304b\u3089\u59cb\u3081\u3088',
        '\u307e\u3042\u843d\u3061\u7740\u3051\u3066\u8003\u3048\u3066\u307f\u308c\u3002\u6025\u3044\u3067\u8272\u3092\u3064\u3051\u308b\u3068\u5927\u4e8b\u306a\u3082\u306e\u304c\u898b\u3048\u306a\u3044',
        '\u4e0b\u624b\u306a\u8ad6\u8005\u307b\u3069\u76f8\u624b\u3092\u300c\u60aa\u300d\u306b\u3057\u305f\u304c\u308b\u3002\u8ad6\u70b9\u3060\u3051\u8a8d\u3081\u308c\u307e\u3059\u304b',
        '\u5929\u4e0b\u306f\u5bfe\u8a71\u304c\u57fa\u672c\u3002\u306a\u306e\u306b\u306a\u305c\u4eba\u3005\u306f\u5b9f\u969b\u306b\u8a71\u3057\u5408\u308f\u306a\u3044\u306e\u304b',
      ]},
    { name:'\u8ad6\u7834\u3057\u305f\u3044\u9ad8\u6821\u751f', id:'@ronpa_koukou', avatar:'\uD83C\uDFAF',
      voices:[
        '\u524d\u63d0\u306e\u78ba\u8a8d\u304c\u7b2c\u4e00\u6b69\u3002\u524d\u63d0\u304c\u5d29\u308c\u305f\u3089\u8ad6\u8a3c\u3082\u5d29\u308c\u308b',
        '\u8ad6\u7406\u3068\u611f\u60c5\u306f\u5225\u3002\u5206\u3051\u308b\u3053\u3068\u3067\u8b70\u8ad6\u306e\u8cea\u304c\u4e0a\u304c\u308b',
        '\u5e74\u4e0a\u306e\u4eba\u304c\u5e38\u306b\u6b63\u3057\u3044\u308f\u3051\u3058\u3083\u306a\u3044\u3002\u8ad6\u70b9\u306f\u516c\u5e73\u306b\u8a55\u4fa1\u3055\u308c\u308b\u3079\u304d',
        '\u4e00\u756a\u5371\u967a\u306a\u306e\u306f\u81ea\u5206\u306e\u8003\u3048\u3092\u7591\u308f\u306a\u3044\u3053\u3068\u3002\u5e38\u306b\u68c4\u8a3c\u3092\u8a18\u3088',
        '\u8ad6\u7834\u3088\u308a\u8aac\u5f97\u306e\u65b9\u304c\u96e3\u3057\u3044\u3002\u76f8\u624b\u306e\u5fc3\u306b\u5c4a\u304f\u8ad6\u7406\u3092\u76ee\u6307\u3059',
      ]},
    { name:'\u30a8\u30d3\u30c7\u30f3\u30b9\u6301\u3063\u3066\u304d\u3066', id:'@evidence_motte', avatar:'\uD83D\uDCCA',
      voices:[
        '\u6570\u5b57\u306f\u5d29\u308c\u306a\u3044\u3002\u611f\u60c5\u8ad6\u3060\u3051\u306b\u6d41\u3055\u308c\u308b\u306a',
        '\u4e00\u6b21\u60c5\u5831\u6e90\u3068\u4e8c\u6b21\u60c5\u5831\u6e90\u3092\u533a\u5225\u3057\u308d\u3002\u57fa\u672c\u4e2d\u306e\u57fa\u672c',
        '\u8abf\u67fb\u3057\u305f\u306e\u304b\u3002\u611f\u632f\u308a\u3060\u3051\u3067\u8a9e\u308b\u306a\u3089\u6700\u521d\u304b\u3089\u305d\u3046\u8a00\u3048',
        '\u9ad8\u6821\u751f\u306e\u4e3b\u5f35\u3082\u4f0f\u8b70\u54e1\u306e\u4e3b\u5f35\u3082\u540c\u3058\u6728\u6977\u3067\u6e2c\u308c\u308b\u3002\u6839\u62e0\u304c\u7b54\u3048',
      ]},
  ],
  legend: [
    { name:'\u30d6\u30c3\u30c0', id:'@buddha_jp', avatar:'\uD83E\uDDD8',
      voices:[
        '\u300c\u3044\u3044\u306d\u300d\u304c\u6b32\u3057\u304f\u3066\u5fc3\u304c\u3056\u308f\u3064\u304f\u306a\u3089\u3001\u30b9\u30de\u30db\u3092\u7f6e\u3044\u3066\u76ee\u3092\u9589\u3058\u306a\u3055\u3044',
        '\u82e6\u3057\u307f\u306f\u57f7\u7740\u304b\u3089\u751f\u307e\u308c\u308b\u3002\u305d\u308c\u3092\u77e5\u308b\u3053\u3068\u304c\u81ea\u7531\u3078\u306e\u9053',
        '\u4eca\u3053\u306e\u77ac\u9593\u306b\u610f\u8b58\u3092\u5411\u3051\u308b\u3053\u3068\u3002\u904e\u53bb\u3082\u672a\u6765\u3082\u3044\u307e\u306f\u306a\u3044',
        '\u5168\u3066\u306f\u7121\u5e38\u3067\u3042\u308b\u3002\u305d\u308c\u3092\u53d7\u3051\u5165\u308c\u308b\u3068\u304d\u3001\u5fc3\u306f\u7a4f\u304b\u306b\u306a\u308b',
        '\u6012\u308a\u3092\u6301\u3064\u3053\u3068\u306f\u71b1\u3044\u7092\u7092\u3092\u6301\u3064\u3053\u3068\u3068\u540c\u3058\u3002\u50b7\u3064\u304f\u306e\u306f\u81ea\u5206\u81ea\u8eab\u3060',
      ]},
    { name:'\u30bd\u30af\u30e9\u30c6\u30b9', id:'@socrates_jp', avatar:'\uD83C\uDFDB\uFE0F',
      voices:[
        '\u7121\u77e5\u306e\u77e5\u3002\u77e5\u3089\u306a\u3044\u3053\u3068\u3092\u77e5\u3063\u3066\u3044\u308b\u306e\u306f\u3001\u4f55\u3082\u77e5\u3089\u306a\u3044\u3088\u308a\u8ce2\u304b\u3060',
        '\u554f\u3044\u3092\u7d9a\u3051\u308b\u3053\u3068\u3067\u7d42\u308f\u308a\u306a\u304d\u554f\u3044\u306b\u8ffd\u3044\u3064\u304f\u3002\u305d\u308c\u304c\u54f2\u5b66\u3060',
        '\u5ba1\u67fb\u3055\u308c\u306a\u3044\u4eba\u751f\u306b\u751f\u304d\u308b\u4fa1\u5024\u306f\u306a\u3044\u3068\u6211\u306f\u601d\u3046',
        '\u771f\u7406\u306f\u5074\u306b\u3042\u308b\u3002\u5b8c\u5168\u306b\u304a\u524d\u306e\u524d\u306b\u3042\u308b\u308f\u3051\u3067\u306f\u306a\u3044',
        '\u5e74\u8f2a\u3092\u91cd\u306d\u308b\u3053\u3068\u3088\u308a\u3001\u5be1\u304c\u304b\u305f\u306b\u308f\u304b\u308b\u3053\u3068\u304c\u5b66\u3073\u3068\u3044\u3046\u3082\u306e\u3060',
      ]},
    { name:'\u5fb3\u5ddd\u5bb6\u5eb7', id:'@ieyasu_tok', avatar:'\u2694\uFE0F',
      voices:[
        '\u5c71\u5ca1\u3092\u76ee\u6307\u3059\u3088\u308a\u3001\u4e00\u6b69\u4e00\u6b69\u78ba\u304b\u306b\u6b69\u3080\u3053\u3068\u3058\u3083',
        '\u6012\u308a\u306f\u6575\u3068\u601d\u3048\u3002\u6012\u308a\u306b\u4efb\u305b\u308c\u3070\u5fc5\u305a\u5f8c\u6094\u3059\u308b',
        '\u4eba\u306e\u4e00\u751f\u306f\u91cd\u8377\u3092\u8ca0\u3046\u3066\u9060\u304d\u9053\u3092\u884c\u304f\u3088\u3046\u306a\u3082\u306e\u3002\u6025\u3050\u3079\u304b\u3089\u305a',
        '\u5dec\u3046\u3067\u306a\u3044\u3002\u5f85\u3064\u3053\u3068\u3067\u6d41\u308c\u304c\u5909\u308f\u308b\u3053\u3068\u3082\u3042\u308b\u3058\u3083',
        '\u5165\u96e2\u306b\u306f\u6642\u6a5f\u3092\u898b\u6975\u3081\u308b\u3053\u3068\u3002\u6cff\u3093\u3067\u306e\u6c7a\u65ad\u3068\u85a6\u8e4a\u3059\u308b\u6c7a\u65ad\u306f\u5168\u304f\u5225\u7269\u3058\u3083',
      ]},
    { name:'\u7e54\u7530\u4fe1\u9577', id:'@nobunaga_oda', avatar:'\uD83D\uDD25',
      voices:[
        '\u662f\u975e\u3082\u306a\u3057\u3002\u5fc5\u8981\u306a\u3089\u4e00\u6b69\u8e0f\u307f\u51fa\u305b\u3002\u8fc5\u901f\u306b\u3001\u653b\u3081\u308d',
        '\u5929\u4e0b\u5e03\u6b66\u306f\u53e3\u3060\u3051\u3067\u306f\u9054\u6210\u3067\u304d\u306a\u3044\u3002\u884c\u52d5\u306e\u307f\u304c\u73fe\u5b9f\u3092\u5909\u3048\u308b',
        '\u53e4\u3044\u6163\u308f\u3057\u304d\u3092\u8d77\u3065\u308b\u8005\u306b\u672a\u6765\u306f\u306a\u3044\u3002\u5909\u5316\u306b\u9045\u308c\u308b\u306a',
        '\u5927\u4e8b\u306a\u306e\u306f\u5c0f\u4e8b\u3082\u7576\u305f\u308a\u524d\u306b\u3053\u306a\u3059\u3053\u3068\u3058\u3083\u3002\u57fa\u790e\u306a\u304f\u3057\u3066\u5927\u5c40\u306a\u3057',
        '\u6050\u308c\u308b\u306a\u3001\u79c1\u306e\u9053\u306f\u6b32\u3059\u308b\u3082\u306e\u3092\u6301\u3064\u8005\u3060\u3051\u304c\u6b69\u3051\u308b',
      ]},
    { name:'\u30a8\u30b8\u30bd\u30f3', id:'@edison_tw', avatar:'\uD83D\uDCA1',
      voices:[
        '\u5929\u624d\u306f1%\u306e\u71b1\u611f\u306899%\u306e\u52aa\u529b\u3002\u52aa\u529b\u3092\u60f3\u50cf\u3067\u304d\u306a\u3044\u4eba\u306b\u5929\u624d\u306f\u5c42\u306a\u3044',
        '\u5931\u6557\u306f\u5b66\u3073\u3060\u3002\u4e00\u5ea6\u3060\u3063\u3066\u5931\u6557\u3092\u660e\u65e5\u306b\u5fb3\u3068\u3059\u308b\u5fc3\u304c\u3051\u3067\u3044\u308d',
        '\u6700\u5927\u306e\u5931\u8d25\u306f\u3084\u3063\u3066\u307f\u306a\u3044\u3053\u3068\u3060\u3002\u8a66\u307f\u305f\u5931\u6557\u306f\u5c71\u3092\u52d5\u304b\u3059',
        '\u7626\u6211\u614b\u306f\u5168\u3066\u306e\u6210\u529f\u8005\u306e\u5171\u901a\u70b9\u3002\u4e0d\u8db3\u3092\u77e5\u308b\u3053\u3068\u304b\u3089\u6210\u9577\u304c\u59cb\u307e\u308b',
        '\u5149\u306f\u30a2\u30a4\u30c7\u30a2\u304c\u3042\u308b\u3068\u3053\u308d\u306b\u6b63\u78ba\u306b\u7167\u3089\u3059\u3002\u554f\u984c\u3092\u898b\u3064\u3051\u308b\u76ee\u3092\u9214\u3048',
      ]},
  ]
};

// \u8FD4\u4FE1\u7528\u306E\u30E2\u30FC\u30C9\u5225\u30EA\u30A2\u30AF\u30B7\u30E7\u30F3\u30B3\u30E1\u30F3\u30C8\uFF08\u6295\u7A3F\u5185\u5BB9\u3092\u554F\u308F\u305A\u4F7F\u3048\u308B\u77ED\u3044\u53CD\u5FDC\uFF09
const REPLY_REACTIONS = {
  influencer: [
    '\u3053\u308c\u6700\u9ad8\u3059\u304e\uff01\u30ea\u30c4\u3057\u305f\uff01',
    '\u308f\u304b\u308b\uff01\u3081\u3063\u3061\u3083\u5171\u611f\u3059\u308b',
    '\u7d76\u5bfe\u30d0\u30ba\u308b\u3084\u3064\uff01\u30d5\u30a9\u30ed\u30fc\u3057\u305f',
    '\u5929\u624d\u304b\u3053\u308c\uff01\u307f\u3093\u306a\u306b\u6559\u3048\u305f\u3044',
    '\u30de\u30b8\u3067\u308f\u304b\u308b\uff01\u3053\u308c\u304c\u8a00\u3044\u305f\u304b\u3063\u305f',
    '\u5c0f\u3055\u304f\u3075\u3053\u3063\u305f\u3002\u5168\u529b\u3067\u5fdc\u63f4\u3059\u308b',
    '\u300c\u308f\u304b\u308b\u300d\u3057\u304b\u8a00\u3048\u306a\u3044\u3002\u305d\u308c\u304c\u5168\u3066',
    '\u8a55\u5224\u3057\u3066\u306a\u304f\u3066\u8089\u60aa\u3044\u304b\u3093\u3058\uff01\u6700\u9ad8\uff01',
  ],
  mental: [
    '\u8a71\u3057\u3066\u304f\u308c\u3066\u3042\u308a\u304c\u3068\u3046\u3002\u3053\u3053\u306b\u3044\u308b\u3088',
    '\u305d\u306e\u6c17\u6301\u3061\u3001\u3061\u3083\u3093\u3068\u53d7\u3051\u53d6\u3063\u305f\u3088',
    '\u7121\u7406\u3057\u306a\u304f\u3066\u3044\u3044\u3002\u3042\u306a\u305f\u306e\u30da\u30fc\u30b9\u3067\u3044\u3044',
    '\u4e00\u4eba\u3058\u3083\u306a\u3044\u3088\u3002\u540c\u3058\u6c17\u6301\u3061\u306e\u4eba\u304c\u3044\u308b',
    '\u8a80\u7b49\u306b\u3057\u306a\u304f\u3066\u3044\u3044\u3002\u305d\u308c\u3060\u3051\u306e\u3053\u3068\u3060\u3063\u305f',
    '\u305d\u306e\u60b3\u3057\u3055\u3001\u5c11\u3057\u3060\u3051\u308f\u304b\u308b\u6c17\u304c\u3059\u308b',
    '\u8a71\u3057\u3066\u308c\u3066\u3088\u304b\u3063\u305f\u3002\u3053\u3053\u306b\u3044\u308b\u304b\u3089\u306d',
  ],
  debate: [
    '\u305d\u306e\u8996\u70b9\u306f\u8003\u3048\u305f\u3053\u3068\u306a\u304b\u3063\u305f\u3002\u9762\u767d\u3044',
    '\u53cd\u8ad6\u3059\u308b\u3051\u3069\u3001\u4e00\u7406\u3042\u308b\u306a\u3068\u6b63\u76f4\u601d\u3063\u305f',
    '\u3053\u306e\u524d\u63d0\u306b\u7591\u554f\u304c\u3042\u308b\u3002\u6e90\u6d41\u3092\u8003\u3048\u3088\u3046',
    '\u8ad6\u70b9\u3092\u574a\u3063\u3066\u3044\u304f\u3068\u5225\u306e\u7d50\u8ad6\u306b\u305f\u3069\u308a\u7740\u304f',
    '\u8003\u3048\u65b9\u306f\u308f\u304b\u308b\u3002\u3060\u304c\u9006\u306e\u8996\u70b9\u3082\u3042\u308b\u3088',
    '\u6570\u5b57\u3067\u8a71\u3057\u3066\u304f\u308c\u3002\u5370\u8c61\u8ad6\u3058\u3083\u8003\u3048\u308b\u306e\u7121\u7406',
    '\u8ad6\u7406\u304c\u901a\u3063\u3066\u308b\u3002\u53cd\u8ad6\u3057\u305f\u304f\u306a\u308b\u3051\u3069\u8a8d\u3081\u308b',
  ],
  legend: [
    '\u6df1\u3044\u554f\u3044\u3060\u3002\u3053\u306e\u6642\u4ee3\u306b\u3082\u901a\u3058\u308b\u771f\u7406\u304c\u3042\u308b',
    '\u6211\u3089\u306e\u6642\u4ee3\u306b\u3082\u540c\u3058\u3053\u3068\u3067\u6094\u3044\u305f\u8005\u306f\u591a\u304b\u3063\u305f',
    '\u6642\u3092\u8d8a\u3048\u3066\u4eba\u306e\u5fc3\u306b\u89e6\u308c\u308b\u8a00\u8449\u3060\u3002\u7d20\u6674\u3089\u3057\u3044',
    '\u793a\u5506\u306b\u5bcc\u3080\u767a\u8a00\u3060\u3002\u6b74\u53f2\u306e\u4e2d\u306b\u540c\u3058\u7bc9\u5c71\u304c\u3042\u3063\u305f',
    '\u6b66\u8005\u3067\u3042\u308c\u5b66\u8005\u3067\u3042\u308c\u3001\u771f\u5b9f\u3092\u8a00\u3046\u52c7\u6c17\u306f\u5171\u901a\u3060',
  ]
};

function tRand(seed) {
  let s = (seed >>> 0) || 12345;
  return function() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xFFFFFFFF; };
}

function extractKeywords(text) {
  const tags  = (text.match(/#[\w\u3041-\u9FFF]+/g) || []).map(t => t.slice(1));
  const words = text.replace(/#[\w\u3041-\u9FFF]+/g,'')
    .split(/[\s\u3001\u3002\uFF01\uFF1F!?\.]+/).filter(w => w.length >= 2);
  return [...new Set([...tags,...words])].slice(0,4);
}

// \u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u306E\u307F\u3067\u306E\u8FD4\u4FE1\u751F\u6210
// - replies: \u30AD\u30E3\u30E9\u306E\u30EA\u30A2\u30AF\u30B7\u30E7\u30F3\u30B3\u30E1\u30F3\u30C8\uFF08\u77ED\u3044\u81EA\u7136\u306A\u53CD\u5FDC\uFF09
// - timelinePosts: \u30AD\u30E3\u30E9\u306E\u56FA\u6709\u306E\u72EC\u308A\u8A00
function genFromTemplates(postText, mode) {
  const seed = postText.split('').reduce((a,c,i) => (a + c.charCodeAt(0) * (i+1)) | 0, 0);
  const rand = tRand(seed + (Date.now() % 99991));
  const pool = CHAR_VOICES[mode] || CHAR_VOICES.influencer;
  const reactions = REPLY_REACTIONS[mode] || REPLY_REACTIONS.influencer;

  // \u30B7\u30E3\u30C3\u30D5\u30EB
  const idx = Array.from({length: pool.length}, (_,i) => i).sort(() => rand() - 0.5);

  // replies: \u30AD\u30E3\u30E9 + \u305D\u306E\u30E2\u30FC\u30C9\u306E\u30EA\u30A2\u30AF\u30B7\u30E7\u30F3
  const replies = idx.slice(0, Math.min(5, pool.length)).map((i, j) => {
    const {name, id, avatar} = pool[i];
    const comment = reactions[Math.floor(rand() * reactions.length)];
    return { name, id, avatar, comment, likes: Math.floor(rand()*8000)+200 };
  });

  // timelinePosts: \u30AD\u30E3\u30E9\u306E\u56FA\u6709\u306E\u58F0\uFF08\u6295\u7A3F\u3068\u7121\u95A2\u4FC2\u3067\u3082\u81EA\u7136\uFF09
  const idx2 = Array.from({length: pool.length}, (_,i) => i).sort(() => rand() - 0.5);
  const timelinePosts = idx2.slice(0, Math.min(4, pool.length)).map(i => {
    const {name, id, avatar, voices} = pool[i];
    const comment = voices[Math.floor(rand() * voices.length)];
    return { name, id, avatar, comment, likes: Math.floor(rand()*5000)+50 };
  });

  return { replies, timelinePosts };
}

function genTLFromTemplates(interests, mode) {
  const seed = interests.join('').split('').reduce((a,c,i)=>(a+c.charCodeAt(0)*(i+1))|0,0);
  const rand = tRand(seed + (Date.now() % 99991));
  const pool = CHAR_VOICES[mode] || CHAR_VOICES.influencer;
  const idx  = Array.from({length:pool.length},(_,i)=>i).sort(()=>rand()-0.5);
  const posts = idx.slice(0,6).map(i => {
    const {name,id,avatar,voices} = pool[i];
    return { name, id, avatar, comment: voices[Math.floor(rand()*voices.length)], likes: Math.floor(rand()*5000)+100 };
  });
  return { posts };
}


http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const ip   = req.headers['x-forwarded-for']?.split(',')[0].trim()
             || req.socket.remoteAddress || 'unknown';

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Headers':'Content-Type'}); res.end(); return;
  }

  // \u30D8\u30EB\u30B9\u30C1\u30A7\u30C3\u30AF
  if (path === '/api/health') {
    sendJSON(res, 200, {status:'ok', provider: CLAUDE_KEY ? 'claude' : 'gemini', hasClaudeKey:!!CLAUDE_KEY, hasGeminiKey:!!GEMINI_KEY, hasUnsplash:!!UNSPLASH_KEY, hasFirebase:!!FIREBASE_DB_URL, rpdCount, rpdLimit: RPD_HARD}); return;
  }

  // ===== POST /api/post =====
  // \u6295\u7A3F\u30C6\u30AD\u30B9\u30C8\u3092\u53D7\u3051\u53D6\u308A\u3001replies + timelinePosts \u30921\u56DE\u306EGemini\u547C\u3073\u51FA\u3057\u3067\u8FD4\u3059
  if (req.method === 'POST' && path === '/api/post') {
    if (!checkRL(ip)) {
      console.warn('[rate-limit] ip:', ip);
      sendJSON(res, 429, {error:'\u30EA\u30AF\u30A8\u30B9\u30C8\u304C\u591A\u3059\u304E\u307E\u3059\u30021\u5206\u5F8C\u306B\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002', replies:[], timelinePosts:[]});
      return;
    }
    let _postText = '', _postMode = 'influencer';
    try {
      const {text, mode='influencer', interests=[]} = await readBody(req);
      if (!text) { sendJSON(res, 400, {error:'text required', replies:[], timelinePosts:[]}); return; }
      const vm = ['influencer','mental','debate','legend'].includes(mode) ? mode : 'influencer';
      _postText = text; _postMode = vm;
      console.log(`[post] mode=${vm} text="${text.slice(0,50)}"`);

      const prompts = await buildClaudePostPrompts(text, vm, interests);
      const result = await callAI(prompts.system, prompts.user, buildPostPrompt(text, vm, interests), POST_SCHEMA);
      sendJSON(res, 200, {
        replies:       result.replies       || [],
        timelinePosts: result.timelinePosts || []
      });
    } catch(e) {
      console.warn('[post] API failed, using template engine:', e.message.slice(0,80));
      sendJSON(res, 200, genFromTemplates(_postText, _postMode));
    }
    return;
  }

  // ===== POST /api/timeline =====
  // \u8D77\u52D5\u6642\u306E\u521D\u56DE\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u751F\u6210
  if (req.method === 'POST' && path === '/api/timeline') {
    if (!checkRL('tl_' + ip)) {
      sendJSON(res, 429, {error:'\u30EA\u30AF\u30A8\u30B9\u30C8\u304C\u591A\u3059\u304E\u307E\u3059\u3002', posts:[]}); return;
    }
    let _tlInts = [], _tlMode = 'influencer';
    try {
      const {interests=[], mode='influencer'} = await readBody(req);
      _tlInts = interests; _tlMode = mode;
      console.log(`[timeline] mode=${mode} ip=${ip}`);
      const tlPrompts = buildClaudeTLPrompts(interests, mode);
      const result = await callAI(tlPrompts.system, tlPrompts.user, buildTLPrompt(interests, mode), TL_SCHEMA);
      sendJSON(res, 200, {posts: result.posts || []});
    } catch(e) {
      console.warn('[timeline] API failed, using template engine:', e.message.slice(0,80));
      sendJSON(res, 200, genTLFromTemplates(_tlInts || [], _tlMode || 'influencer'));
    }
    return;
  }


  // ===== GET /api/images =====
  if (req.method === 'GET' && path === '/api/images') {
    const query = new URL('http://x' + req.url).searchParams.get('q') || '';
    if (!query) { sendJSON(res, 400, {error:'q required', photos:[]}); return; }
    if (!UNSPLASH_KEY) {
      console.log('[unsplash] UNSPLASH_ACCESS_KEY not set');
      sendJSON(res, 200, {photos:[], reason:'no_key'});
      return;
    }
    try {
      const encoded = encodeURIComponent(query.slice(0, 50));
      console.log('[unsplash] searching:', query);
      const d = await new Promise((resolve, reject) => {
        const r2 = https.request({
          hostname: 'api.unsplash.com',
          path: `/search/photos?query=${encoded}&per_page=6&orientation=squarish`,
          method: 'GET',
          headers: {
            'Authorization': `Client-ID ${UNSPLASH_KEY}`,
            'Accept-Version': 'v1'
          }
        }, r => {
          let raw = '';
          r.on('data', c => { raw += c; });
          r.on('end', () => {
            console.log('[unsplash] status:', r.statusCode, 'body:', raw.slice(0, 100));
            if (r.statusCode >= 400) {
              reject(new Error('HTTP ' + r.statusCode + ': ' + raw.slice(0, 200)));
              return;
            }
            try { resolve(JSON.parse(raw)); }
            catch(e2) { reject(new Error('JSON parse error: ' + raw.slice(0, 100))); }
          });
        });
        r2.on('error', reject);
        r2.end();
      });
      const photos = (d.results || []).map(p => ({
        id:     p.id,
        url:    p.urls?.small  || p.urls?.regular || '',
        thumb:  p.urls?.thumb  || p.urls?.small   || '',
        alt:    p.alt_description || p.description || query,
        credit: p.user?.name   || '',
        link:   p.links?.html  || ''
      })).filter(p => p.url);
      console.log('[unsplash] found:', photos.length, 'photos');
      sendJSON(res, 200, {photos});
    } catch(e2) {
      console.warn('[unsplash error]', e2.message);
      sendJSON(res, 200, {photos:[], error: e2.message.slice(0, 100)});
    }
    return;
  }




  // ===== Firebase


  // ===== Firebase\u540c\u671f /api/sync =====
  if (path === '/api/sync') {
    if (!FIREBASE_DB_URL) { sendJSON(res, 200, {ok:false, reason:'no_firebase'}); return; }
    const userId = req.headers['x-user-id'] || 'anonymous';
    const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const fbPath = `/users/${safeId}.json`;

    if (req.method === 'GET') {
      // \u8aad\u307f\u8fbc\u307f
      try {
        const d = await new Promise((resolve, reject) => {
          const r2 = https.request(
            { hostname: new URL(FIREBASE_DB_URL).hostname,
              path: fbPath, method: 'GET' },
            r => { let raw=''; r.on('data',c=>{raw+=c;}); r.on('end',()=>{
              try { resolve(JSON.parse(raw||'null')); } catch(e){resolve(null);}
            });}
          );
          r2.on('error', reject); r2.end();
        });
        sendJSON(res, 200, {ok:true, data: d});
      } catch(e) {
        sendJSON(res, 200, {ok:false, reason: e.message.slice(0,100)});
      }
      return;
    }

    if (req.method === 'POST') {
      // \u4fdd\u5b58
      try {
        const body = await readBody(req);
        const bodyStr = JSON.stringify(body);
        await new Promise((resolve, reject) => {
          const r2 = https.request(
            { hostname: new URL(FIREBASE_DB_URL).hostname,
              path: fbPath, method: 'PUT',
              headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(bodyStr)} },
            r => { let raw=''; r.on('data',c=>{raw+=c;}); r.on('end',()=>resolve(raw)); }
          );
          r2.on('error', reject); r2.write(bodyStr); r2.end();
        });
        sendJSON(res, 200, {ok:true});
      } catch(e) {
        sendJSON(res, 200, {ok:false, reason: e.message.slice(0,100)});
      }
      return;
    }
  }

  // ===== index.html =====
  const html = Buffer.from(INDEX_HTML, 'utf8');
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Content-Length': html.length});
  res.end(html);

}).listen(PORT, () => {
  console.log(`\u2705 \u3044\u3069\u3070\u305F\u30B5\u30FC\u30D0\u30FC\u8D77\u52D5 \u30DD\u30FC\u30C8: ${PORT}`);
  console.log(`\uD83E\uDD16 Claude Haiku: ${CLAUDE_KEY ? '\u8A2D\u5B9A\u6E08\u307F\u2705' : '\u672A\u8A2D\u5B9A\u274C'} / Gemini: ${GEMINI_KEY ? '\u8A2D\u5B9A\u6E08\u307F\u2705' : '\u672A\u8A2D\u5B9A\u274C\uFF08\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\uFF09'}`);
  console.log(`\uD83D\uDEE1\uFE0F  \u30EC\u30FC\u30C8\u5236\u9650: ${RL_MAX}req/${RL_WIN/1000}s per IP`);
});
