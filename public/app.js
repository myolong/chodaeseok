// 초대석 화면: 주소 뒤 #/... 로 화면을 바꾸는 한 장짜리 앱 (외부 라이브러리 없음)
"use strict";

const FIELDS = ["창업·경영", "책·글쓰기", "강의·교육", "커리어·직장", "마케팅·브랜딩", "IT·개발", "디자인·예술", "건강·운동", "육아·가족", "여행·지역", "투자·재테크", "취미·라이프", "사회·환경", "기타"];
const MODES = ["원격", "대면", "둘 다"];
const $app = document.getElementById("app");

// ---------- 도구 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const myKey = () => store.get("cds.key");
const myKind = () => store.get("cds.kind");
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = (name) => `<span class="av" style="background:hsl(${hue(name)} 32% 42%)" aria-hidden="true">${esc(String(name || "?").trim().slice(0, 1))}</span>`;
const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const toast = (msg) => { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600); };
const opts = (list, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : "") + list.map((x) => `<option${x === sel ? " selected" : ""}>${esc(x)}</option>`).join("");
const chips = (arr, cls = "") => (arr || []).map((t) => `<span class="chip ${cls}">${esc(t)}</span>`).join("");

async function api(path, { method = "GET", body, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (key) headers["x-key"] = key;
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.error || "잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.");
  return d;
}
const cache = {};
async function load(path, fresh) { if (fresh || !cache[path]) cache[path] = api(path); try { return await cache[path]; } catch (e) { delete cache[path]; throw e; } }
const clearCache = () => { for (const k in cache) delete cache[k]; };

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); toast("복사했어요."); }
  catch { const r = document.createRange(); const el = btn?.parentElement?.querySelector("code"); if (el) { r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } toast("길게 눌러 복사해 주세요."); }
}

// ---------- 라우터 ----------
const routes = [
  [/^$/, home],
  [/^guests$/, guestList],
  [/^guest\/([a-z0-9]+)$/, guestPage],
  [/^channels$/, channelList],
  [/^channel\/([a-z0-9-]+)$/, channelPage],
  [/^join\/guest$/, joinGuest],
  [/^join\/channel(?:\/([a-z0-9-]+))?$/, joinChannel],
  [/^me\/([a-z0-9]{20,})$/, (k) => { store.set("cds.key", k); store.set("cds.kind", null); location.replace("#/me"); }],
  [/^me$/, mePage],
  [/^remove\/([a-z0-9-]+)$/, removePage],
  [/^claim\/([a-z0-9]{20,})$/, claimPage],
  [/^verify\/([a-z0-9]+)\/([a-z0-9]{20,})$/, verifyPage],
  [/^about$/, aboutPage],
  [/^privacy$/, privacyPage],
];
async function route() {
  const path = location.hash.replace(/^#\/?/, "").split("?")[0];
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", path.startsWith(a.dataset.nav)));
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try { await fn(...m.slice(1)); }
      catch (e) { $app.innerHTML = `<div class="empty">${esc(e.message)}<br><br><a class="btn line sm" href="#/">처음으로</a></div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  $app.innerHTML = `<div class="empty">없는 화면이에요. <a href="#/">처음으로</a></div>`;
}
addEventListener("hashchange", route);

// ---------- 카드 ----------
const guestCard = (g) => `<a class="card" href="#/guest/${g.id}">
  <div class="who">${avatar(g.name)}<div style="min-width:0"><h3>${esc(g.name)}</h3><p class="hl">${esc(g.headline)}</p></div></div>
  <div class="topics">${chips(g.topics.slice(0, 3))}</div>
  <p class="small muted">${esc(g.field)} · ${esc(g.mode)}${g.region ? " · " + esc(g.region) : ""}${g.shows.length ? ` · <b style="color:var(--teal)">출연 ${g.shows.length}회</b>` : ""}</p>
</a>`;
const chRow = (c) => `<a class="ch" href="#/channel/${c.id}">
  <h3>${esc(c.name)}</h3><span class="subs">${c.subs ? "구독자 " + esc(c.subs) : ""}</span>
  <div class="meta">${c.registered ? '<span class="chip red">초대석 가입</span>' : c.recruit ? '<span class="chip teal">출연 신청 안내 있음</span>' : ""}<span>${esc(c.platform)} · ${esc(c.field)}</span>${chips(c.topics.slice(0, 3))}</div>
</a>`;

// ---------- 첫 화면 ----------
async function home() {
  $app.innerHTML = `
  <section class="hero">
    <div>
      <p class="eyebrow">ON AIR · 베타 무료</p>
      <h1>인터뷰할 사람이 필요한 채널과<br><em>이야기할 사람</em>을 잇습니다</h1>
      <p class="lede">책을 낸 작가, 회사를 꾸린 대표, 강의하는 강사가 프로필을 올리면 인터뷰형 유튜브·팟캐스트 채널이 주제로 찾아 출연을 제안합니다.</p>
      <div class="row"><a class="btn red" href="#/join/guest">게스트로 등록하기</a><a class="btn line" href="#/join/channel">채널로 가입하기</a></div>
      <a class="maplink" href="#/channels"><span class="lamp" aria-hidden="true"></span><span>지금 출연 신청 받는 채널 <b id="h-recruit">…</b>곳 · 전체 채널 지도 <b id="h-total">…</b>곳 보기</span><span aria-hidden="true">→</span></a>
    </div>
    <div class="cuecard" aria-label="출연이 성사되는 순서">
      <div class="h"><span>CUE SHEET</span><b>● REC</b></div>
      <ol>
        <li><span class="t">00:00</span><span><b>게스트</b> 말할 수 있는 주제 3개로 프로필 등록</span></li>
        <li><span class="t">00:10</span><span><b>채널</b> "그림책 작가", "1인 창업"처럼 주제로 검색</span></li>
        <li><span class="t">00:20</span><span><b>채널</b> 초대석에서 출연 제안서 보내기</span></li>
        <li><span class="t">00:30</span><span><b>게스트</b> 수락하면 서로의 연락처가 보여요</span></li>
      </ol>
    </div>
  </section>
  <section class="sec" id="h-guests" hidden><div class="sec-h"><h2>최근 등록한 게스트</h2><a class="small" href="#/guests">모두 보기</a></div><div class="grid" id="hg"><div class="empty" style="grid-column:1/-1">불러오는 중…</div></div></section>
  <section class="sec"><div class="sec-h"><h2>게스트를 받는 인터뷰 채널</h2><a class="small" href="#/channels">채널 지도 전체 보기</a></div><div class="list" id="hc"></div>
    <p class="small muted">채널 목록은 유튜브에 공개된 채널 정보로 정리했어요. 채널 운영자라면 직접 가입하거나 목록에서 빼 달라고 요청할 수 있어요.</p></section>
  <section class="sec" id="hs" hidden><div class="sec-h"><h2>초대석으로 성사된 출연</h2></div><div class="list" id="hsl"></div></section>
  <section class="steps">
    <div class="box"><span class="k">게스트</span><h3>알릴 이야기가 있는 사람</h3><p class="small muted">작가, 대표, 강사, 연구자, 직업인. 무엇을 이야기할 수 있는지만 적으면 돼요.</p></div>
    <div class="box"><span class="k">채널</span><h3>매주 새 게스트가 필요한 채널</h3><p class="small muted">창업·책·커리어·지역 이야기를 다루는 인터뷰형 유튜브와 팟캐스트. 계속 무료예요.</p></div>
    <div class="box"><span class="k">약속</span><h3>수수료 없이 연결만</h3><p class="small muted">초대석은 연결만 하고 수수료를 받지 않아요. 출연 조건은 채널과 게스트가 직접 정해요. <a href="#/about">이용 안내</a></p></div>
  </section>`;
  const [gs, cs, ss] = await Promise.all([load("/api/guests"), load("/api/channels"), load("/api/shows").catch(() => [])]);
  // 게스트가 아직 없으면 빈 칸을 보여 주지 않고 섹션을 숨김
  if (gs.length) { document.getElementById("h-guests").hidden = false; document.getElementById("hg").innerHTML = gs.slice(0, 6).map(guestCard).join(""); }
  document.getElementById("h-recruit").textContent = cs.filter((c) => c.registered || c.recruit).length;
  document.getElementById("h-total").textContent = cs.length;
  const pick = cs.filter((c) => c.registered || c.recruit).slice(0, 6);
  document.getElementById("hc").innerHTML = (pick.length ? pick : cs.slice(0, 6)).map(chRow).join("");
  if (ss.length) {
    document.getElementById("hs").hidden = false;
    document.getElementById("hsl").innerHTML = ss.slice(0, 5).map((s) => `<a class="ch" href="${esc(s.url)}" target="_blank" rel="noopener"><h3>${esc(s.gname)} → ${esc(s.chname)}</h3><span class="subs">${fmtDate(s.created)}</span><div class="meta">${esc(s.headline)}</div></a>`).join("");
  }
}

// ---------- 게스트 ----------
async function guestList() {
  const st = JSON.parse(store.get("cds.gf") || "{}");
  $app.innerHTML = `<div class="sec-h"><h1 style="font-size:26px">게스트 찾기</h1><a class="btn red sm" href="#/join/guest">게스트로 등록</a></div>
  <div class="filters"><input type="search" id="gq" placeholder="주제·이름·소개로 찾기 (예: 그림책, 1인 창업)" value="${esc(st.q || "")}" aria-label="검색어">
  <select id="gf" aria-label="분야">${opts(FIELDS, st.f, "모든 분야")}</select><select id="gm" aria-label="출연 방식">${opts(MODES, st.m, "원격·대면 모두")}</select></div>
  <div class="grid" id="gl"><div class="empty" style="grid-column:1/-1">불러오는 중…</div></div>`;
  const all = await load("/api/guests", true);
  const draw = () => {
    const q = gq.value.trim().toLowerCase(), f = gf.value, m = gm.value;
    store.set("cds.gf", JSON.stringify({ q, f, m }));
    const list = all.filter((g) => (!f || g.field === f) && (!m || g.mode === m || g.mode === "둘 다" || m === "둘 다") && (!q || [g.name, g.headline, g.bio, g.region, ...g.topics].join(" ").toLowerCase().includes(q)));
    document.getElementById("gl").innerHTML = list.length ? list.map(guestCard).join("") : `<div class="empty" style="grid-column:1/-1">${all.length ? "조건에 맞는 게스트가 없어요." : "아직 등록한 게스트가 없어요."}</div>`;
  };
  const gq = document.getElementById("gq"), gf = document.getElementById("gf"), gm = document.getElementById("gm");
  gq.oninput = gf.onchange = gm.onchange = draw;
  draw();
}

async function guestPage(id) {
  const g = await load("/api/guests/" + id, true);
  const iAmChannel = myKey() && myKind() === "channel";
  $app.innerHTML = `<p class="small"><a href="#/guests">← 게스트 목록</a></p>
  <div class="profile">
    <div class="main">
      <div class="phead">${avatar(g.name)}<div><h1>${esc(g.name)}</h1><p class="muted">${esc(g.headline)}</p></div></div>
      <div class="box sec"><h2 style="font-size:16px">이야기할 수 있는 주제</h2><ul class="topic-list">${g.topics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
      ${g.bio ? `<div class="box sec"><h2 style="font-size:16px">소개</h2><p class="bio">${esc(g.bio)}</p></div>` : ""}
      ${g.shows.length ? `<div class="box sec"><h2 style="font-size:16px">출연 이력</h2>${g.shows.map((s) => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.chname)}</a> <span class="small muted">${fmtDate(s.created)}</span></p>`).join("")}</div>` : ""}
    </div>
    <aside class="side">
      <div class="box"><dl class="facts"><dt>분야</dt><dd>${esc(g.field)}</dd><dt>출연 방식</dt><dd>${esc(g.mode)}</dd>${g.region ? `<dt>지역</dt><dd>${esc(g.region)}</dd>` : ""}
      ${g.links.length ? `<dt>링크</dt><dd>${g.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener nofollow">${esc(l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40))}</a>`).join("<br>")}</dd>` : ""}
      <dt>등록</dt><dd>${fmtDate(g.created)}</dd></dl></div>
      <div class="box sec" id="offerbox">
        ${iAmChannel ? offerForm("이 게스트에게 출연 제안하기", "어떤 주제로, 언제쯤, 원격/대면 중 어떻게 찍고 싶은지 적어 주세요.") :
        `<h2 style="font-size:16px">이 분을 초대하고 싶다면</h2><p class="small muted">채널로 가입하면 출연 제안서를 보낼 수 있어요. 게스트가 수락하면 연락처가 공개됩니다.</p><a class="btn" href="#/join/channel">채널로 가입하기 (무료)</a>${myKey() ? '<p class="small muted">지금 이 기기에는 게스트 관리 링크가 저장돼 있어요.</p>' : ""}`}
      </div>
      <button class="linkbtn" id="rep">이 프로필 신고하기</button>
    </aside>
  </div>`;
  if (iAmChannel) bindOffer(g.id);
  document.getElementById("rep").onclick = () => report("guest", g.id);
}

const offerForm = (title, ph) => `<h2 style="font-size:16px">${title}</h2>
  <form id="of"><div class="field"><label for="om">제안 내용</label><textarea id="om" maxlength="800" placeholder="${esc(ph)}" required></textarea></div>
  <label class="check"><input type="checkbox" id="onf"><span>출연료 등 출연 조건은 상대와 직접 정하고, 초대석은 관여하지 않는다는 점을 확인했어요.</span></label>
  <p class="err" id="oe" hidden></p><button class="btn red" type="submit">보내기</button></form>`;
function bindOffer(to) {
  const f = document.getElementById("of");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector("button"), err = document.getElementById("oe");
    b.disabled = true; err.hidden = true;
    try {
      await api("/api/offers", { method: "POST", key: myKey(), body: { to, msg: document.getElementById("om").value, nofee: document.getElementById("onf").checked } });
      document.getElementById("offerbox").innerHTML = `<h2 style="font-size:16px">보냈어요</h2><p class="small muted">상대가 수락하면 <a href="#/me">내 관리</a>에서 연락처를 볼 수 있어요. 상대도 초대석에 들어와야 제안을 볼 수 있으니, 며칠 걸릴 수 있어요.</p>`;
    } catch (x) { err.textContent = x.message; err.hidden = false; b.disabled = false; }
  };
}

async function report(type, id) {
  const box = document.createElement("div");
  box.className = "box sec";
  box.innerHTML = `<form id="rf"><div class="field"><label for="rr">무엇이 문제인가요?</label><input type="text" id="rr" maxlength="200" placeholder="예: 광고만 올림, 다른 사람을 사칭함"></div><div class="row"><button class="btn sm" type="submit">신고하기</button><button class="btn line sm" type="button" id="rc">취소</button></div></form>`;
  const btn = document.getElementById("rep");
  btn.replaceWith(box);
  document.getElementById("rc").onclick = () => route();
  document.getElementById("rf").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/report", { method: "POST", body: { type, id, reason: document.getElementById("rr").value } }); box.innerHTML = `<p class="small muted">신고를 받았어요. 신고가 쌓이면 자동으로 가려집니다.</p>`; }
    catch (x) { toast(x.message); }
  };
}

// ---------- 채널 ----------
async function channelList() {
  const st = JSON.parse(store.get("cds.cf") || "{}");
  $app.innerHTML = `<div class="sec-h"><div><h1 style="font-size:26px">게스트 받는 채널 지도 <span class="muted" id="cn" style="font-weight:500"></span></h1><p class="small muted">인터뷰형 채널을 공개 정보로 모았어요. 구독자 수는 2026년 11월 26일에 확인한 숫자예요.</p></div><a class="btn sm line" href="#/join/channel">채널로 가입</a></div>
  <div class="filters"><input type="search" id="cq" placeholder="채널 이름·주제로 찾기" value="${esc(st.q || "")}" aria-label="검색어">
  <select id="cf" aria-label="분야">${opts(FIELDS, st.f, "모든 분야")}</select>
  <select id="cr" aria-label="보기"><option value="">모든 채널</option><option value="recruit"${st.r === "recruit" ? " selected" : ""}>출연 신청 안내가 있는 채널</option><option value="reg"${st.r === "reg" ? " selected" : ""}>초대석 가입 채널만</option></select></div>
  <div class="list" id="cl"><div class="empty">불러오는 중…</div></div>
  <p class="notice">초대석에 가입한 채널에만 사이트 안에서 출연 신청을 보낼 수 있어요. 가입하지 않은 채널은 각 채널이 공개한 창구로 직접 문의해 주세요. 초대석은 채널이 공개한 출연·문의 창구로만, 채널 지도에 소개했다는 안내를 한 번씩 보낼 수 있어요.</p>`;
  const all = await load("/api/channels", true);
  document.getElementById("cn").textContent = all.length + "곳";
  // 가입 채널 → 출연 신청 안내 있는 채널 → 나머지 순으로, 같은 묶음 안에서는 구독자 많은 순
  const subsN = (s) => { const m = String(s || "").match(/([\d.]+)\s*(만|천)?/); return m ? parseFloat(m[1]) * (m[2] === "만" ? 1e4 : m[2] === "천" ? 1e3 : 1) : 0; };
  const rank = (c) => (c.registered ? 2 : c.recruit ? 1 : 0);
  all.sort((a, b) => rank(b) - rank(a) || subsN(b.subs) - subsN(a.subs));
  const cq = document.getElementById("cq"), cf = document.getElementById("cf"), cr = document.getElementById("cr");
  const draw = () => {
    const q = cq.value.trim().toLowerCase(), f = cf.value, r = cr.value;
    store.set("cds.cf", JSON.stringify({ q, f, r }));
    const list = all.filter((c) => (!f || c.field === f) && (!r || (r === "reg" ? c.registered : c.registered || c.recruit)) && (!q || [c.name, c.about, ...c.topics].join(" ").toLowerCase().includes(q)));
    document.getElementById("cl").innerHTML = list.length ? list.map(chRow).join("") : `<div class="empty">조건에 맞는 채널이 없어요.</div>`;
  };
  cq.oninput = cf.onchange = cr.onchange = draw;
  draw();
}

async function channelPage(id) {
  const c = await load("/api/channels/" + id, true);
  const iAmGuest = myKey() && myKind() === "guest";
  $app.innerHTML = `<p class="small"><a href="#/channels">← 채널 지도</a></p>
  <div class="profile">
    <div class="main">
      <div class="phead">${avatar(c.name)}<div><h1>${esc(c.name)}</h1><p class="muted">${esc(c.platform)} · ${esc(c.field)}${c.subs ? " · 구독자 " + esc(c.subs) : ""}</p></div></div>
      ${c.about ? `<div class="box"><p class="bio">${esc(c.about)}</p></div>` : ""}
      <div class="row">${c.registered ? '<span class="chip red">초대석 가입 채널</span>' : '<span class="chip">공개 정보로 정리한 채널</span>'}${c.recruit && !c.registered ? `<span class="chip teal">${esc(c.recruit)}</span>` : ""}${chips(c.topics)}</div>
      <p><a class="btn line" href="${esc(c.url)}" target="_blank" rel="noopener">채널 보러 가기 ↗</a></p>
    </div>
    <aside class="side">
      <div class="box sec" id="offerbox">
      ${c.registered
        ? iAmGuest ? offerForm("이 채널에 출연 신청하기", "어떤 이야기를 할 수 있는지, 왜 이 채널과 잘 맞는지 적어 주세요.")
          : `<h2 style="font-size:16px">이 채널에 나가고 싶다면</h2><p class="small muted">게스트로 등록하면 출연 신청을 보낼 수 있어요.</p><a class="btn red" href="#/join/guest">게스트로 등록하기</a>`
        : `<h2 style="font-size:16px">아직 초대석에 가입하지 않은 채널</h2><p class="small muted">출연을 원하면 채널 소개란에 공개된 창구로 직접 문의해 주세요.</p>
           <hr style="border:0;border-top:1px solid var(--line);width:100%"><p class="small"><b>이 채널 운영자이신가요?</b></p>
           <a class="btn sm" href="#/join/channel/${c.id}">가입하고 게스트 받기</a><a class="small muted" href="#/remove/${c.id}">목록에서 빼 주세요</a>
           <p class="small muted">가입과 목록 빼기는 채널 운영자 확인을 거친 뒤 반영돼요.</p>`}
      </div>
      ${c.registered ? '<button class="linkbtn" id="rep">이 채널 신고하기</button>' : ""}
    </aside>
  </div>`;
  if (c.registered && iAmGuest) bindOffer(c.id);
  if (c.registered) document.getElementById("rep").onclick = () => report("channel", c.id);
}

async function removePage(id) {
  const c = await load("/api/channels/" + id, true);
  $app.innerHTML = `<div class="doc"><h1>목록에서 빼기 요청</h1><p><b>${esc(c.name)}</b> 채널을 초대석 채널 지도에서 뺍니다. 다른 사람이 대신 지우지 못하도록, 채널 운영자임을 간단히 확인한 뒤 바로 목록에서 빼고 다시 올리지 않아요.</p>
  <form id="rmf"><div class="field"><label for="rmr">이유 (선택)</label><input type="text" id="rmr" maxlength="200"></div><div class="row"><button class="btn" type="submit">다음: 운영자 확인</button><a class="btn line" href="#/channel/${c.id}">취소</a></div></form></div>`;
  document.getElementById("rmf").onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api("/api/remove-request", { method: "POST", body: { id: c.id, reason: document.getElementById("rmr").value } }); location.hash = "#/claim/" + r.token; }
    catch (x) { toast(x.message); }
  };
}

// ---------- 채널 운영자 확인 ----------
// 가입·목록 빼기 요청은 운영자 확인(소개란 코드 또는 공개 메일 인증 링크)을 마쳐야 반영됨
async function claimPage(token) {
  const d = await api("/api/me", { key: token });
  if (d.kind !== "claim") { location.replace("#/me/" + token); return; }
  claimView(token, d.claim, false);
}
function claimView(token, c, isMine) {
  const join = c.kind === "join", yt = /youtube\.com|youtu\.be/i.test(c.url);
  const link = `${location.origin}/#/${isMine ? "me" : "claim"}/${token}`;
  const mailState = c.status === "mail" ? `<p class="notice">채널 소개란에 공개된 <b>${esc(c.vmail)}</b> 주소로 운영자가 인증 링크를 보내 드려요(보통 하루 안). 메일의 링크를 누르면 ${join ? "가입이 끝나고 그 화면에서 관리 링크를 드려요" : "바로 목록에서 빠져요"}.</p>`
    : c.status === "mail-manual" ? `<p class="notice">채널 소개란에서 메일 주소를 자동으로 찾지 못했어요. 운영자가 채널에 공개된 연락처를 직접 확인해 연락드릴게요. 더 빠르게 하려면 위의 소개란 코드 확인을 이용해 주세요.</p>` : "";
  $app.innerHTML = `<div class="doc" style="max-width:720px"><p class="eyebrow">${join ? "채널 가입" : "목록에서 빼기"} · 운영자 확인</p>
  <h1>${esc(c.name)} 채널 운영자이신지 확인할게요</h1>
  <p class="muted">다른 사람이 남의 채널로 가입하거나 목록에서 지우지 못하도록, 채널을 실제로 운영하는 분인지 확인한 뒤에 ${join ? "가입이 완료돼요. 확인 전에는 채널 지도에 바뀌는 것이 없고, 출연 제안도 보낼 수 없어요" : "목록에서 빼요"}.</p>
  <div class="keybox"><code>${esc(link)}</code><button class="btn sm" id="clcopy">이 화면 주소 복사</button></div>
  <p class="small muted">확인을 나중에 마치려면 이 주소를 저장해 두세요.</p>
  ${yt ? `<div class="box sec"><h2 style="font-size:16px">방법 1. 채널 소개란에 코드 넣기 (바로 확인)</h2>
    <ol class="small"><li>유튜브 스튜디오 → 맞춤설정 → 기본 정보 → <b>설명</b>에 아래 코드를 아무 곳에나 넣고 게시해 주세요.</li><li>몇 분 뒤 아래 <b>확인하기</b>를 눌러 주세요. 확인이 끝나면 코드는 지워도 돼요.</li></ol>
    <div class="keybox"><code id="clcode">${esc(c.code)}</code><button class="btn sm" id="ccopy">코드 복사</button></div>
    <p class="err" id="cle" hidden></p><div class="row"><button class="btn red" id="clcheck">확인하기</button></div></div>` : ""}
  <div class="box sec"><h2 style="font-size:16px">방법 ${yt ? 2 : 1}. 채널에 공개된 메일로 인증 링크 받기</h2>
    <p class="small muted">채널 소개란에 공개해 둔 출연·문의 메일 주소로만 인증 링크를 보내요. 다른 주소로는 보내지 않아요.</p>
    ${mailState || `<div class="row"><button class="btn line" id="clmail">공개 메일로 인증 링크 받기</button></div>`}</div>
  <button class="linkbtn" id="clcancel">요청 취소하기</button></div>`;
  document.getElementById("clcopy").onclick = (e) => copy(link, e.target);
  const done = (r) => {
    clearCache();
    if (r.kind === "join") { store.set("cds.key", r.token); store.set("cds.kind", "channel"); store.set("cds.new", "1"); location.hash = "#/me"; location.reload(); }
    else { if (isMine) { store.set("cds.key", null); store.set("cds.kind", null); } $app.innerHTML = `<div class="empty">확인했어요. <b>${esc(r.name)}</b> 채널을 목록에서 뺐어요. 불편을 드려 죄송합니다.<br><br><a class="btn line sm" href="#/channels">채널 지도로</a></div>`; }
  };
  if (yt) {
    document.getElementById("ccopy").onclick = (e) => copy(c.code, e.target);
    document.getElementById("clcheck").onclick = async (e) => {
      const b = e.target, err = document.getElementById("cle"); b.disabled = true; err.hidden = true; b.textContent = "확인하는 중…";
      try { done(await api("/api/claim/check", { method: "POST", key: token, body: {} })); }
      catch (x) { err.textContent = x.message; err.hidden = false; b.disabled = false; b.textContent = "확인하기"; }
    };
  }
  const mb = document.getElementById("clmail");
  if (mb) mb.onclick = async () => {
    mb.disabled = true;
    try { await api("/api/claim/mail", { method: "POST", key: token, body: {} }); const d = await api("/api/me", { key: token }); claimView(token, d.claim, isMine); }
    catch (x) { toast(x.message); mb.disabled = false; }
  };
  document.getElementById("clcancel").onclick = async () => {
    if (!confirm("요청을 취소할까요?")) return;
    try { await api("/api/claim/cancel", { method: "POST", key: token, body: {} }); if (isMine) { store.set("cds.key", null); store.set("cds.kind", null); } location.hash = "#/channels"; }
    catch (x) { toast(x.message); }
  };
}
async function verifyPage(id, secret) {
  $app.innerHTML = `<div class="empty">확인하는 중…</div>`;
  const r = await api(`/api/verify?c=${encodeURIComponent(id)}&s=${encodeURIComponent(secret)}`);
  clearCache();
  if (r.kind === "join") {
    store.set("cds.key", r.token); store.set("cds.kind", "channel"); store.set("cds.new", "1");
    location.replace("#/me");
  } else {
    $app.innerHTML = `<div class="empty">확인했어요. <b>${esc(r.name)}</b> 채널을 목록에서 뺐어요. 불편을 드려 죄송합니다.<br><br><a class="btn line sm" href="#/channels">채널 지도로</a></div>`;
  }
}

// ---------- 등록 양식 ----------
const guestFormHTML = (g = {}) => `
  <div class="two"><div class="field"><label for="f-name">이름 또는 활동명</label><input type="text" id="f-name" maxlength="30" value="${esc(g.name)}" required></div>
  <div class="field"><label for="f-headline">한 줄 소개</label><input type="text" id="f-headline" maxlength="60" placeholder="예: 그림책 작가, 『○○○』 저자" value="${esc(g.headline)}" required></div></div>
  <div class="field"><span class="lbl">이야기할 수 있는 주제 (최대 3개)</span><span class="hint">채널이 이 문장으로 검색해요. "~에 대해 이야기할 수 있어요"처럼 구체적으로.</span>
  <div class="stack">${[0, 1, 2].map((i) => `<input type="text" id="f-t${i}" maxlength="40" aria-label="주제 ${i + 1}" placeholder="${["예: 마흔에 시작한 그림책", "예: 1인 출판 첫해 매출", "예: 아이와 함께 작업하기"][i]}" value="${esc((g.topics || [])[i])}">`).join("")}</div></div>
  <div class="two"><div class="field"><label for="f-field">분야</label><select id="f-field">${opts(FIELDS, g.field)}</select></div>
  <div class="field"><label for="f-region">활동 지역 (선택)</label><input type="text" id="f-region" maxlength="20" placeholder="예: 서울, 부산, 전국" value="${esc(g.region)}"></div></div>
  <div class="field"><span class="lbl">출연 방식</span><div class="seg">${MODES.map((m) => `<label><input type="radio" name="f-mode" value="${m}"${(g.mode || "둘 다") === m ? " checked" : ""}><span>${m}</span></label>`).join("")}</div></div>
  <div class="field"><label for="f-bio">자기소개 (선택)</label><textarea id="f-bio" maxlength="600" placeholder="어떤 일을 해 왔고, 인터뷰에서 어떤 이야기를 나누고 싶은지">${esc(g.bio)}</textarea></div>
  <div class="field"><label for="f-links">링크 (선택, 한 줄에 하나)</label><textarea id="f-links" style="min-height:70px" placeholder="책 소개, 블로그, 지난 출연 영상 주소">${esc((g.links || []).join("\n"))}</textarea></div>
  <div class="field"><label for="f-contact">수락했을 때 채널에 알려 줄 연락처</label><input type="text" id="f-contact" maxlength="120" placeholder="이메일 또는 카카오톡 오픈채팅 주소" value="${esc(g.contact)}" required><span class="hint">공개되지 않아요. 내가 수락한 채널에만 보여요.</span></div>`;
const readGuest = () => ({
  name: v("f-name"), headline: v("f-headline"), topics: [0, 1, 2].map((i) => v("f-t" + i)).filter(Boolean), field: v("f-field"), region: v("f-region"),
  mode: (document.querySelector('input[name="f-mode"]:checked') || {}).value, bio: v("f-bio"), links: v("f-links").split(/\s*\n\s*/).filter(Boolean), contact: v("f-contact"),
});
const channelFormHTML = (c = {}) => `
  <div class="two"><div class="field"><label for="f-name">채널 이름</label><input type="text" id="f-name" maxlength="40" value="${esc(c.name)}" required></div>
  <div class="field"><label for="f-url">채널 주소</label><input type="url" id="f-url" maxlength="300" placeholder="https://www.youtube.com/@..." value="${esc(c.url)}" required></div></div>
  <div class="two"><div class="field"><label for="f-platform">어디서 방송하나요</label><select id="f-platform">${opts(["유튜브", "팟캐스트", "유튜브·팟캐스트"], c.platform)}</select></div>
  <div class="field"><label for="f-field">주로 다루는 분야</label><select id="f-field">${opts(FIELDS, c.field)}</select></div></div>
  <div class="two"><div class="field"><label for="f-topics">찾는 게스트 주제 (쉼표로 구분)</label><input type="text" id="f-topics" maxlength="160" placeholder="예: 창업 실패담, 로컬 가게, 신간 작가" value="${esc((c.topics || []).join(", "))}"></div>
  <div class="field"><label for="f-subs">구독자 수 (선택)</label><input type="text" id="f-subs" maxlength="20" placeholder="예: 1.2만" value="${esc(c.subs)}"></div></div>
  <div class="field"><label for="f-about">채널 소개와 촬영 방식 (선택)</label><textarea id="f-about" maxlength="400" placeholder="어떤 인터뷰를 찍는지, 원격/대면, 촬영 시간 등">${esc(c.about)}</textarea></div>
  <div class="field"><label for="f-contact">게스트가 수락했을 때 알려 줄 연락처</label><input type="text" id="f-contact" maxlength="120" placeholder="이메일 또는 카카오톡 오픈채팅 주소" value="${esc(c.contact)}" required><span class="hint">공개되지 않아요. 수락한 게스트에게만 보여요.</span></div>`;
const readChannel = () => ({ name: v("f-name"), url: v("f-url"), platform: v("f-platform"), field: v("f-field"), topics: v("f-topics").split(/[,，]/).map((s) => s.trim()).filter(Boolean), subs: v("f-subs"), about: v("f-about"), contact: v("f-contact") });
const v = (id) => (document.getElementById(id)?.value || "").trim();

const agreeHTML = `<label class="check"><input type="checkbox" id="f-agree"><span><a href="#/about" target="_blank">이용 안내</a>와 <a href="#/privacy" target="_blank">개인정보 처리방침</a>을 읽었고 동의합니다. 연기·예능 캐스팅은 받지 않고, 출연 조건은 당사자끼리 정한다는 점을 확인했어요.</span></label>
  <input class="hp" type="text" id="f-website" tabindex="-1" autocomplete="off" aria-hidden="true">`;

function joinGuest() {
  if (myKey() && myKind() === "guest") { location.replace("#/me"); return; }
  $app.innerHTML = `<div class="doc" style="max-width:720px"><p class="eyebrow">게스트 등록 · 무료</p><h1>어떤 이야기를 할 수 있나요?</h1>
  <p class="muted">5분이면 끝나요. 등록하면 바로 게스트 목록에 올라가고, 채널이 주제로 찾아 출연을 제안합니다.</p></div>
  <form id="jf" class="box">${guestFormHTML()}${agreeHTML}<p class="err" id="je" hidden></p><button class="btn red" type="submit">등록하기</button></form>`;
  bindJoin("/api/guests", readGuest);
}
async function joinChannel(fromId) {
  if (myKey() && (myKind() === "channel" || myKind() === "claim")) { location.replace("#/me"); return; }
  let pre = {};
  if (fromId) { try { pre = await load("/api/channels/" + fromId); } catch {} }
  $app.innerHTML = `<div class="doc" style="max-width:720px"><p class="eyebrow">채널 가입 · 계속 무료</p><h1>어떤 게스트를 찾고 있나요?</h1>
  <p class="muted">가입하면 게스트에게 출연 제안을 보내고, 게스트의 출연 신청을 받을 수 있어요. 남의 채널로 가입하는 일을 막기 위해, 양식을 낸 뒤 채널 운영자 확인(채널 소개란에 코드 넣기 또는 채널에 공개된 메일로 인증)을 거쳐요.${fromId ? " 채널 지도에 있던 정보를 미리 채워 두었어요." : ""}</p></div>
  <form id="jf" class="box">${channelFormHTML(pre)}${agreeHTML}<p class="err" id="je" hidden></p><button class="btn red" type="submit">가입하기</button></form>`;
  bindJoin("/api/channels", readChannel);
}
function bindJoin(path, read) {
  const f = document.getElementById("jf");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button[type="submit"]'), err = document.getElementById("je");
    b.disabled = true; err.hidden = true;
    try {
      const r = await api(path, { method: "POST", body: { ...read(), agree: document.getElementById("f-agree").checked, website: v("f-website") } });
      if (!r.token) throw new Error("등록하지 못했어요. 다시 시도해 주세요.");
      store.set("cds.key", r.token); store.set("cds.kind", r.kind); store.set("cds.new", "1");
      clearCache();
      location.hash = "#/me";
    } catch (x) { err.textContent = x.message; err.hidden = false; b.disabled = false; err.scrollIntoView({ block: "center" }); }
  };
}

// ---------- 내 관리 ----------
async function mePage() {
  const key = myKey();
  if (!key) {
    $app.innerHTML = `<div class="doc"><h1>내 관리</h1><p>등록할 때 받은 <b>관리 링크</b>로 들어오면 받은 제안을 보고 프로필을 고칠 수 있어요. 이 기기에서 등록했다면 자동으로 열려요.</p>
    <form id="kf"><div class="field"><label for="kk">관리 링크 붙여넣기</label><input type="text" id="kk" placeholder="https://…/#/me/…"></div><button class="btn" type="submit">열기</button></form>
    <p class="small muted">아직 등록하지 않았다면 <a href="#/join/guest">게스트 등록</a> 또는 <a href="#/join/channel">채널 가입</a>부터 해 주세요.</p></div>`;
    document.getElementById("kf").onsubmit = (e) => { e.preventDefault(); const m = v("kk").match(/([a-z0-9]{20,})\s*$/); if (m) location.hash = "#/me/" + m[1]; else toast("관리 링크를 다시 확인해 주세요."); };
    return;
  }
  let d;
  try { d = await api("/api/me", { key }); }
  catch (x) { store.set("cds.key", null); store.set("cds.kind", null); throw x; }
  store.set("cds.kind", d.kind);
  if (d.kind === "claim") { claimView(key, d.claim, true); return; }
  const p = d.profile, isG = d.kind === "guest";
  const link = `${location.origin}/#/me/${key}`;
  const fresh = store.get("cds.new"); store.set("cds.new", null);
  const inbox = d.offers.filter((o) => !o.mine), sent = d.offers.filter((o) => o.mine);
  const waiting = inbox.filter((o) => o.status === "대기").length;
  $app.innerHTML = `
  ${fresh ? `<div class="box" style="border-color:var(--onair)"><h2 style="font-size:18px">등록했어요!</h2><p class="small muted" style="margin-top:4px">아래 관리 링크를 꼭 저장해 두세요. 다른 기기에서 들어오거나 프로필을 고칠 때 필요해요. 이메일로 따로 보내 드리지 않아요.</p></div>` : ""}
  <div class="sec-h"><div><p class="eyebrow">${isG ? "게스트" : "채널"} 관리</p><h1 style="font-size:26px">${esc(p.name)}</h1></div><a class="btn line sm" href="#/${isG ? "guest" : "channel"}/${p.id}">공개 화면 보기</a></div>
  <div class="keybox"><code id="klink">${esc(link)}</code><button class="btn sm" id="kcopy">관리 링크 복사</button></div>
  <div class="tabs" role="tablist"><button class="on" data-t="in">받은 ${isG ? "제안" : "신청"}${waiting ? ` (${waiting})` : ""}</button><button data-t="out">보낸 ${isG ? "신청" : "제안"}</button><button data-t="edit">프로필 고치기</button>${isG ? '<button data-t="show">출연 후기</button>' : ""}</div>
  <div id="tab"></div>`;
  document.getElementById("kcopy").onclick = (e) => copy(link, e.target);
  const tabs = {
    in: () => offersHTML(inbox, isG, true),
    out: () => offersHTML(sent, isG, false) + `<p class="small muted">${isG ? '<a href="#/channels">채널 지도</a>에서 "초대석 가입" 채널에 출연 신청을 보낼 수 있어요.' : '<a href="#/guests">게스트 찾기</a>에서 프로필을 열어 출연 제안을 보낼 수 있어요.'}</p>`,
    edit: () => `<form id="ef" class="box">${isG ? guestFormHTML(p) : channelFormHTML(p)}<p class="err" id="ee" hidden></p><div class="row"><button class="btn" type="submit">저장</button></div></form>
      <div class="box sec"><h2 style="font-size:16px">삭제하기</h2><p class="small muted">프로필과 주고받은 제안이 모두 지워지고 되돌릴 수 없어요.</p><div class="row" id="delrow"><button class="btn line sm" id="del1">삭제하기</button></div></div>
      <button class="linkbtn" id="logout">이 기기에서 관리 링크 지우기</button>`,
    show: () => `<form id="sf" class="box"><p class="small muted">초대석으로 연결된 출연이 공개되면 알려 주세요. 프로필에 출연 이력으로 표시돼요.</p>
      <div class="two"><div class="field"><label for="s-ch">출연한 채널</label><select id="s-ch">${opts(d.offers.filter((o) => o.status === "수락").map((o) => o.cname))}<option value="">직접 입력</option></select></div>
      <div class="field"><label for="s-name">채널 이름 (직접 입력할 때)</label><input type="text" id="s-name" maxlength="40"></div></div>
      <div class="field"><label for="s-url">영상·에피소드 주소</label><input type="url" id="s-url" placeholder="https://"></div><p class="err" id="se" hidden></p><button class="btn" type="submit">출연 후기 남기기</button></form>
      ${p.shows && p.shows.length ? `<div class="list">${p.shows.map((s) => `<a class="ch" href="${esc(s.url)}" target="_blank" rel="noopener"><h3>${esc(s.chname)}</h3><span class="subs">${fmtDate(s.created)}</span></a>`).join("")}</div>` : ""}`,
  };
  const show = (t) => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    document.getElementById("tab").innerHTML = tabs[t]();
    bindTab(t, d, key, isG);
  };
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => show(b.dataset.t)));
  show("in");
}

function offersHTML(list, isG, incoming) {
  if (!list.length) return `<div class="empty">${incoming ? (isG ? "아직 받은 출연 제안이 없어요. 주제를 구체적으로 적을수록 채널이 찾기 쉬워요." : "아직 받은 출연 신청이 없어요.") : "아직 보낸 것이 없어요."}</div>`;
  return `<div class="list">${list.map((o) => {
    const other = isG ? `<a href="#/channel/${o.channel}"><b>${esc(o.cname)}</b></a>` : `<a href="#/guest/${o.guest}"><b>${esc(o.gname)}</b></a> <span class="small muted">${esc(o.gheadline)}</span>`;
    const st = o.status === "수락" ? '<span class="chip teal">수락</span>' : o.status === "거절" ? '<span class="chip">거절</span>' : '<span class="chip red">답 기다리는 중</span>';
    return `<div class="offer"><div class="row">${other}${st}<span class="small muted">${fmtDate(o.created)}</span></div><p class="msg">${esc(o.msg)}</p>
      ${o.contact ? `<p class="small">연락처: <span class="contact">${esc(o.contact)}</span></p><p class="small muted">이제 직접 연락해 일정을 잡아 주세요. 출연이 공개되면 출연 후기를 남겨 주세요.</p>` : ""}
      ${incoming && o.status === "대기" ? `<div class="row"><button class="btn red sm" data-ans="${o.id}" data-acc="1">수락하고 연락처 공개</button><button class="btn line sm" data-ans="${o.id}">거절</button></div>` : ""}</div>`;
  }).join("")}</div>`;
}

function bindTab(t, d, key, isG) {
  document.querySelectorAll("[data-ans]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api("/api/offers/answer", { method: "POST", key, body: { id: b.dataset.ans, accept: !!b.dataset.acc } }); toast(b.dataset.acc ? "수락했어요. 서로의 연락처가 보여요." : "거절했어요."); mePage(); }
    catch (x) { toast(x.message); b.disabled = false; }
  }));
  if (t === "edit") {
    document.getElementById("ef").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("ee");
      err.hidden = true;
      try { await api("/api/me", { method: "POST", key, body: isG ? readGuest() : readChannel() }); clearCache(); toast("저장했어요."); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
    };
    document.getElementById("del1").onclick = () => {
      document.getElementById("delrow").innerHTML = `<span class="small">정말 지울까요?</span><button class="btn red sm" id="del2">네, 삭제합니다</button><button class="btn line sm" id="del0">취소</button>`;
      document.getElementById("del0").onclick = () => mePage();
      document.getElementById("del2").onclick = async () => {
        try { await api("/api/me/delete", { method: "POST", key }); store.set("cds.key", null); store.set("cds.kind", null); clearCache(); $app.innerHTML = `<div class="empty">삭제했어요. 그동안 고마웠어요.<br><br><a class="btn line sm" href="#/">처음으로</a></div>`; }
        catch (x) { toast(x.message); }
      };
    };
    document.getElementById("logout").onclick = () => { store.set("cds.key", null); store.set("cds.kind", null); toast("이 기기에서 지웠어요. 관리 링크로 다시 들어올 수 있어요."); location.hash = "#/"; };
  }
  if (t === "show") {
    document.getElementById("sf").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("se"), sel = v("s-ch");
      const o = d.offers.find((x) => x.status === "수락" && x.cname === sel);
      try { await api("/api/shows", { method: "POST", key, body: { channel: o ? o.channel : "", chname: sel || v("s-name"), url: v("s-url") } }); clearCache(); toast("출연 후기를 남겼어요."); mePage(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
    };
  }
}

// ---------- 안내 글 ----------
function aboutPage() {
  $app.innerHTML = `<article class="doc">
  <p class="eyebrow">이용 안내 · 2026년 11월 베타</p><h1>초대석 이용 안내</h1>
  <p>초대석은 인터뷰할 사람을 찾는 유튜브·팟캐스트 채널과, 자기 이야기를 하고 싶은 사람을 이어 주는 게시판입니다. 베타 기간에는 모든 기능이 무료입니다.</p>
  <h2>초대석이 하는 일</h2>
  <ul><li>게스트 프로필과 채널 정보를 보여 줍니다.</li><li>출연 제안·신청을 상대에게 전달하고, 수락하면 서로의 연락처를 보여 줍니다.</li><li>일정 조율, 촬영, 편집, 공개 여부는 채널과 게스트가 직접 정합니다. 초대석은 출연을 보장하지 않습니다.</li></ul>
  <h2>출연 조건과 비용</h2>
  <p>초대석은 연결만 하고 수수료를 받지 않습니다. 출연료 등 출연 조건은 채널과 게스트가 직접 정하며, 초대석은 관여하거나 책임지지 않습니다.</p>
  <p>돈을 받고 제품·서비스를 알리는 출연(유료 광고)이라면 영상에 &#39;유료 광고 포함&#39;을 표시해야 합니다.</p>
  <h2>연결하지 않는 것</h2>
  <ul><li><b>연기·예능 출연자 캐스팅.</b> 배우, 모델, 예능 출연자를 모집하는 용도로 쓸 수 없습니다.</li>  <li>광고·홍보만을 위한 프로필, 다른 사람을 사칭한 프로필.</li></ul>
  <h2>채널 지도에 대해</h2>
  <p>채널 지도는 유튜브에 공개된 채널 이름, 주소, 소개, 구독자 수로 정리했습니다. 채널 운영자의 연락처를 따로 모으지 않습니다. 초대석은 채널이 소개란에 공개한 출연·문의 창구로만, 채널 지도에 소개했다는 안내를 한 번씩 보낼 수 있습니다. 운영자가 원하면 채널 화면의 "목록에서 빼 주세요"로 뺄 수 있고, 다른 사람이 대신 지우지 못하도록 채널 운영자 확인(소개란 코드 또는 공개 메일 인증)을 거칩니다. 채널 가입도 같은 확인을 마친 뒤 반영됩니다.</p>
  <h2>게스트가 지켜 주실 것</h2>
  <ul><li>출연 조건은 채널과 직접, 미리 분명하게 정합니다. 대가를 받고 제품·서비스를 알리는 출연이라면 영상에 &#39;유료 광고 포함&#39; 표시가 되도록 채널과 상의합니다.</li><li>사실과 다른 경력이나 이력을 적지 않습니다.</li></ul>
  <h2>신고와 숨김</h2>
  <p>각 프로필의 "신고하기"로 알려 주세요. 신고가 3번 쌓이면 자동으로 가려지고, 운영자가 확인합니다.</p>
  <h2>문의</h2>
  <p>운영자 이메일: <b>chodaeseok.kr@gmail.com</b></p>
  <h2>관리 링크</h2>
  <p>초대석은 비밀번호 대신 등록할 때 주는 관리 링크로 본인을 확인합니다. 링크를 가진 사람은 누구나 프로필을 고칠 수 있으니 다른 사람에게 보내지 마세요. 잃어버리면 다시 찾아 드릴 수 없습니다.</p>
  <h2>앞으로</h2>
  <p>베타가 끝난 뒤 게스트용 유료 기능(목록 위쪽 노출 등)이 생길 수 있습니다. 유료 기능을 시작하기 전에 미리 알리고, 동의 없이 요금을 받지 않습니다. 채널은 계속 무료입니다.</p>
  </article>`;
}
function privacyPage() {
  $app.innerHTML = `<article class="doc">
  <p class="eyebrow">개인정보 처리방침 · 2026년 11월 26일 시행 (베타 초안)</p><h1>개인정보 처리방침</h1>
  <h2>모으는 정보와 쓰는 곳</h2>
  <table><tr><th>누구</th><th>모으는 정보</th><th>쓰는 곳</th></tr>
  <tr><td>게스트</td><td>이름(활동명), 한 줄 소개, 주제, 분야, 지역, 자기소개, 링크, 연락처</td><td>프로필 공개(연락처 제외), 출연 제안 전달, 수락한 채널에 연락처 전달</td></tr>
  <tr><td>채널</td><td>채널 이름·주소·소개, 연락처</td><td>채널 정보 공개(연락처 제외), 수락한 게스트에게 연락처 전달</td></tr>
  <tr><td>채널 확인 요청</td><td>요청한 채널, 확인용 코드, 채널 소개란에 공개된 메일 주소(메일 인증을 고른 경우)</td><td>채널 운영자 확인, 인증 링크 발송</td></tr>
  <tr><td>공통</td><td>주고받은 제안 내용, 신고 내용</td><td>제안 전달, 부정 이용 확인</td></tr></table>
  <p>연락처는 공개 화면에 나오지 않고, 본인이 수락한 제안의 상대에게만 보입니다. IP 주소나 기기 정보를 따로 저장하지 않습니다.</p>
  <h2>보관 기간</h2>
  <p>본인이 관리 화면에서 삭제할 때까지 보관하며, 삭제하면 프로필과 주고받은 제안이 바로 지워집니다. 베타를 끝내고 서비스를 닫으면 모든 정보를 지웁니다.</p>
  <h2>제3자 제공과 맡기는 곳</h2>
  <p>수락한 상대에게 연락처를 보여 주는 것 외에는 다른 곳에 제공하지 않습니다. 정보는 Cloudflare(미국)의 서버에 저장됩니다.</p>
  <h2>공개된 채널 정보</h2>
  <p>채널 지도의 정보는 유튜브에 공개된 채널 정보입니다. 채널 운영자의 개인 연락처는 모으지 않습니다. 목록에서 빼기를 요청하면 채널 운영자 확인을 거쳐 숨깁니다. 확인용으로 받은 공개 메일 주소는 확인이 끝나면 더 쓰지 않습니다.</p>
  <h2>권리</h2>
  <p>내 관리 화면에서 언제든 정보를 보고, 고치고, 지울 수 있습니다. 관리 링크를 잃어버려 지울 수 없다면 운영자 이메일 <b>chodaeseok.kr@gmail.com</b> 으로 알려 주세요.</p>
  <p class="small muted">베타 기간 초안입니다. 유료 기능을 시작하기 전에 전문가 검토를 거쳐 다시 고칩니다.</p>
  </article>`;
}

route();
