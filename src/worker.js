// 초대석 서버: 게스트 프로필·채널·출연 제안·출연 후기를 Durable Object(SQLite) 하나에 저장
// 공개 API는 연락처를 절대 돌려주지 않음. 연락처는 출연 제안이 수락된 뒤 두 당사자의 관리 페이지에서만 보임.
import { DurableObject } from "cloudflare:workers";
import SEED from "./channels.json";

const now = () => Date.now();
const kst = (t = now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const rid = (n = 10) => {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => a[x % a.length]).join("");
};
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const arr = (v, k, n) => (Array.isArray(v) ? v : []).map((x) => clip(x, n)).filter(Boolean).slice(0, k);
const url = (v) => {
  const s = clip(v, 300);
  return /^https?:\/\/[^\s<>"]+$/i.test(s) ? s : "";
};
class Bad extends Error {}
const need = (c, msg) => { if (!c) throw new Bad(msg); };

// 연기·예능 캐스팅 제외
const BLOCK = /연기자|배우 지망|오디션|예능 출연|캐스팅/;
export const FIELDS = ["창업·경영", "책·글쓰기", "강의·교육", "커리어·직장", "마케팅·브랜딩", "IT·개발", "디자인·예술", "건강·운동", "육아·가족", "여행·지역", "투자·재테크", "취미·라이프", "사회·환경", "기타"];

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, token TEXT UNIQUE, name TEXT, headline TEXT, field TEXT, topics TEXT, bio TEXT, links TEXT, mode TEXT, region TEXT, contact TEXT, created INTEGER, updated INTEGER, hidden INTEGER DEFAULT 0, reports INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, token TEXT UNIQUE, name TEXT, url TEXT, platform TEXT, field TEXT, topics TEXT, about TEXT, subs TEXT, recruit TEXT, contact TEXT, curated INTEGER DEFAULT 0, registered INTEGER DEFAULT 0, created INTEGER, hidden INTEGER DEFAULT 0, reports INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, dir TEXT, guest TEXT, channel TEXT, msg TEXT, status TEXT, created INTEGER, answered INTEGER);
      CREATE TABLE IF NOT EXISTS shows (id TEXT PRIMARY KEY, guest TEXT, channel TEXT, chname TEXT, url TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS logs (day TEXT, kind TEXT, ref TEXT, note TEXT, at INTEGER);
    `);
    // 공개 정보로 정리한 채널 목록을 반영 (삭제 요청으로 숨긴 채널은 계속 숨김)
    for (const c of SEED) {
      this.sql.exec(
        `INSERT INTO channels (id, name, url, platform, field, topics, about, subs, recruit, curated, created) VALUES (?,?,?,?,?,?,?,?,?,1,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, platform=excluded.platform, field=excluded.field, topics=excluded.topics, about=excluded.about, subs=excluded.subs, recruit=excluded.recruit WHERE channels.registered=0`,
        c.id, c.name, c.url, c.platform, c.field, JSON.stringify(c.topics || []), c.about || "", c.subs || "", c.recruit || "", now());
      // 오래 새 영상이 없는 채널은 목록에서 숨김 (직접 가입하면 다시 보임)
      if (c.inactive) this.sql.exec("UPDATE channels SET hidden=1 WHERE id=? AND registered=0", c.id);
    }
  }
  log(kind, ref, note = "") { this.sql.exec("INSERT INTO logs VALUES (?,?,?,?,?)", kst(), kind, ref, note, now()); }
  rows(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0] || null; }

  pubGuest(g) {
    const shows = this.rows("SELECT chname, url, created FROM shows WHERE guest=? ORDER BY created DESC", g.id);
    return { id: g.id, name: g.name, headline: g.headline, field: g.field, topics: JSON.parse(g.topics || "[]"), bio: g.bio, links: JSON.parse(g.links || "[]"), mode: g.mode, region: g.region, created: g.created, shows };
  }
  pubChannel(c) {
    return { id: c.id, name: c.name, url: c.url, platform: c.platform, field: c.field, topics: JSON.parse(c.topics || "[]"), about: c.about, subs: c.subs, recruit: c.recruit, registered: !!c.registered, curated: !!c.curated };
  }

  // ---------- 공개 조회 ----------
  guests() { return this.rows("SELECT * FROM guests WHERE hidden=0 ORDER BY created DESC").map((g) => this.pubGuest(g)); }
  guest(id) { const g = this.one("SELECT * FROM guests WHERE id=? AND hidden=0", id); return g && this.pubGuest(g); }
  channels() { return this.rows("SELECT * FROM channels WHERE hidden=0 ORDER BY registered DESC, name").map((c) => this.pubChannel(c)); }
  channel(id) { const c = this.one("SELECT * FROM channels WHERE id=? AND hidden=0", id); return c && this.pubChannel(c); }
  shows() {
    return this.rows("SELECT s.chname, s.url, s.created, g.id gid, g.name gname, g.headline FROM shows s JOIN guests g ON g.id=s.guest WHERE g.hidden=0 ORDER BY s.created DESC LIMIT 30");
  }

  // ---------- 등록 ----------
  guestFields(b) {
    const g = {
      name: clip(b.name, 30), headline: clip(b.headline, 60), field: FIELDS.includes(b.field) ? b.field : "기타",
      topics: arr(b.topics, 3, 40), bio: clip(b.bio, 600), links: arr(b.links, 4, 300).filter((x) => url(x)),
      mode: ["원격", "대면", "둘 다"].includes(b.mode) ? b.mode : "둘 다", region: clip(b.region, 20), contact: clip(b.contact, 120),
    };
    need(g.name && g.headline, "이름과 한 줄 소개를 적어 주세요.");
    need(g.topics.length >= 1, "이야기할 수 있는 주제를 하나 이상 적어 주세요.");
    need(g.contact, "출연 제안을 수락했을 때 채널에 알려 줄 연락처를 적어 주세요.");
    need(!BLOCK.test([g.headline, g.bio, ...g.topics].join(" ")), "초대석은 연기·예능 캐스팅은 받지 않아요.");
    return g;
  }
  addGuest(b) {
    const g = this.guestFields(b);
    need(b.agree === true, "이용 안내와 개인정보 처리방침에 동의해 주세요.");
    const id = rid(8), token = rid(24);
    this.sql.exec("INSERT INTO guests (id, token, name, headline, field, topics, bio, links, mode, region, contact, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, token, g.name, g.headline, g.field, JSON.stringify(g.topics), g.bio, JSON.stringify(g.links), g.mode, g.region, g.contact, now(), now());
    this.log("guest", id);
    return { id, token, kind: "guest" };
  }
  channelFields(b) {
    const c = {
      name: clip(b.name, 40), url: url(b.url), platform: ["유튜브", "팟캐스트", "유튜브·팟캐스트"].includes(b.platform) ? b.platform : "유튜브",
      field: FIELDS.includes(b.field) ? b.field : "기타", topics: arr(b.topics, 5, 30), about: clip(b.about, 400), subs: clip(b.subs, 20), contact: clip(b.contact, 120),
    };
    need(c.name && c.url, "채널 이름과 주소(https://로 시작)를 적어 주세요.");
    need(c.contact, "게스트가 수락했을 때 알려 줄 연락처를 적어 주세요.");
    need(!BLOCK.test([c.about, ...c.topics].join(" ")), "초대석은 연기·예능 캐스팅은 받지 않아요.");
    return c;
  }
  addChannel(b) {
    const c = this.channelFields(b);
    need(b.agree === true, "이용 안내와 개인정보 처리방침에 동의해 주세요.");
    const token = rid(24);
    const norm = (u) => u.toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, "").replace(/[/?#].*$/, (m) => m.split(/[?#]/)[0]).replace(/\/+$/, "");
    const same = this.rows("SELECT id, url FROM channels WHERE registered=0").find((x) => norm(x.url) === norm(c.url));
    let id;
    if (same) {
      id = same.id; // 목록에 있던 채널이 직접 가입: 그 줄을 가입 채널로 바꿈
      this.sql.exec("UPDATE channels SET token=?, name=?, url=?, platform=?, field=?, topics=?, about=?, subs=?, contact=?, registered=1, hidden=0 WHERE id=?",
        token, c.name, c.url, c.platform, c.field, JSON.stringify(c.topics), c.about, c.subs, c.contact, id);
    } else {
      id = rid(8);
      this.sql.exec("INSERT INTO channels (id, token, name, url, platform, field, topics, about, subs, contact, registered, created) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)",
        id, token, c.name, c.url, c.platform, c.field, JSON.stringify(c.topics), c.about, c.subs, c.contact, now());
    }
    this.log("channel", id);
    return { id, token, kind: "channel" };
  }

  // ---------- 내 관리 페이지 ----------
  who(token) {
    need(typeof token === "string" && token.length >= 20, "관리 링크가 올바르지 않아요.");
    const g = this.one("SELECT * FROM guests WHERE token=?", token);
    if (g) return { kind: "guest", row: g };
    const c = this.one("SELECT * FROM channels WHERE token=?", token);
    if (c) return { kind: "channel", row: c };
    throw new Bad("이 관리 링크로 찾은 프로필이 없어요. 삭제됐거나 주소가 잘렸을 수 있어요.");
  }
  me(token) {
    const { kind, row } = this.who(token);
    const offers = this.rows(`SELECT o.*, g.name gname, g.headline gheadline, g.contact gcontact, c.name cname, c.url curl, c.contact ccontact
      FROM offers o JOIN guests g ON g.id=o.guest JOIN channels c ON c.id=o.channel WHERE o.${kind}=? ORDER BY o.created DESC`, row.id)
      .map((o) => ({
        id: o.id, dir: o.dir, status: o.status, msg: o.msg, created: o.created, guest: o.guest, channel: o.channel,
        gname: o.gname, gheadline: o.gheadline, cname: o.cname, curl: o.curl,
        // 수락된 제안에서만 상대 연락처를 보여 줌
        contact: o.status === "수락" ? (kind === "guest" ? o.ccontact : o.gcontact) : null,
        mine: (o.dir === "c2g") === (kind === "channel"),
      }));
    const profile = kind === "guest" ? { ...this.pubGuest(row), contact: row.contact, hidden: !!row.hidden } : { ...this.pubChannel(row), contact: row.contact, hidden: !!row.hidden };
    return { kind, profile, offers };
  }
  update(token, b) {
    const { kind, row } = this.who(token);
    if (kind === "guest") {
      const g = this.guestFields(b);
      this.sql.exec("UPDATE guests SET name=?, headline=?, field=?, topics=?, bio=?, links=?, mode=?, region=?, contact=?, updated=? WHERE id=?",
        g.name, g.headline, g.field, JSON.stringify(g.topics), g.bio, JSON.stringify(g.links), g.mode, g.region, g.contact, now(), row.id);
    } else {
      const c = this.channelFields(b);
      this.sql.exec("UPDATE channels SET name=?, url=?, platform=?, field=?, topics=?, about=?, subs=?, contact=? WHERE id=?",
        c.name, c.url, c.platform, c.field, JSON.stringify(c.topics), c.about, c.subs, c.contact, row.id);
    }
    return { ok: true };
  }
  remove(token) {
    const { kind, row } = this.who(token);
    if (kind === "guest") {
      this.sql.exec("DELETE FROM offers WHERE guest=?", row.id);
      this.sql.exec("DELETE FROM shows WHERE guest=?", row.id);
      this.sql.exec("DELETE FROM guests WHERE id=?", row.id);
    } else {
      this.sql.exec("DELETE FROM offers WHERE channel=?", row.id);
      // 공개 목록에서 온 채널이면 다시 목록에 올리지 않도록 숨김 처리만 남김
      if (row.curated) this.sql.exec("UPDATE channels SET token=NULL, contact=NULL, registered=0, hidden=1 WHERE id=?", row.id);
      else this.sql.exec("DELETE FROM channels WHERE id=?", row.id);
    }
    this.log("delete-" + kind, row.id);
    return { ok: true };
  }

  // ---------- 출연 제안 ----------
  offer(token, b) {
    const { kind, row } = this.who(token);
    const msg = clip(b.msg, 800);
    need(msg.length >= 10, "제안 내용을 10자 이상 적어 주세요.");
    need(b.nofee === true, "출연 조건은 상대와 직접 정하고 초대석은 관여하지 않는다는 확인란에 체크해 주세요.");
    let guest, channel, dir;
    if (kind === "channel") {
      const g = this.one("SELECT id FROM guests WHERE id=? AND hidden=0", clip(b.to, 20));
      need(g, "게스트를 찾지 못했어요.");
      guest = g.id; channel = row.id; dir = "c2g";
    } else {
      const c = this.one("SELECT id FROM channels WHERE id=? AND hidden=0 AND registered=1", clip(b.to, 20));
      need(c, "초대석에 가입한 채널에만 출연 신청을 보낼 수 있어요.");
      guest = row.id; channel = c.id; dir = "g2c";
    }
    const open = this.one("SELECT COUNT(*) n FROM offers WHERE guest=? AND channel=? AND status='대기'", guest, channel).n;
    need(!open, "이미 답을 기다리는 제안이 있어요.");
    const today = this.one("SELECT COUNT(*) n FROM offers WHERE " + (kind === "channel" ? "channel" : "guest") + "=? AND dir=? AND created>?", row.id, dir, now() - 86400e3).n;
    need(today < 20, "하루에 보낼 수 있는 제안은 20건까지예요.");
    const id = rid(10);
    this.sql.exec("INSERT INTO offers (id, dir, guest, channel, msg, status, created) VALUES (?,?,?,?,?,'대기',?)", id, dir, guest, channel, msg, now());
    this.log("offer", id, dir);
    return { ok: true };
  }
  answer(token, b) {
    const { kind, row } = this.who(token);
    const o = this.one("SELECT * FROM offers WHERE id=?", clip(b.id, 20));
    need(o && o[kind] === row.id, "제안을 찾지 못했어요.");
    need((o.dir === "c2g") === (kind === "guest"), "받은 제안에만 답할 수 있어요.");
    need(o.status === "대기", "이미 답한 제안이에요.");
    const st = b.accept ? "수락" : "거절";
    this.sql.exec("UPDATE offers SET status=?, answered=? WHERE id=?", st, now(), o.id);
    this.log("answer", o.id, st);
    return { ok: true };
  }

  // ---------- 출연 후기 ----------
  addShow(token, b) {
    const { kind, row } = this.who(token);
    need(kind === "guest", "출연 후기는 게스트가 남겨요.");
    const u = url(b.url);
    need(u, "출연한 영상이나 에피소드 주소(https://)를 적어 주세요.");
    let chname = clip(b.chname, 40), channel = clip(b.channel, 20);
    if (channel) { const c = this.one("SELECT name FROM channels WHERE id=?", channel); if (c) chname = c.name; else channel = ""; }
    need(chname, "출연한 채널 이름을 적어 주세요.");
    this.sql.exec("INSERT INTO shows VALUES (?,?,?,?,?,?)", rid(10), row.id, channel, chname, u, now());
    this.log("show", row.id, chname);
    return { ok: true };
  }

  // ---------- 신고·삭제 요청 ----------
  report(b) {
    const type = b.type === "channel" ? "channels" : "guests";
    const id = clip(b.id, 20);
    const r = this.one(`SELECT id, reports FROM ${type} WHERE id=?`, id);
    need(r, "대상을 찾지 못했어요.");
    this.sql.exec(`UPDATE ${type} SET reports=reports+1, hidden=CASE WHEN reports+1>=3 THEN 1 ELSE hidden END WHERE id=?`, id);
    this.log("report", id, clip(b.reason, 200));
    return { ok: true };
  }
  removeRequest(b) {
    const c = this.one("SELECT id FROM channels WHERE id=? AND registered=0", clip(b.id, 20));
    need(c, "목록에서 찾지 못했어요. 직접 가입한 채널은 관리 페이지에서 삭제할 수 있어요.");
    this.sql.exec("UPDATE channels SET hidden=1 WHERE id=?", c.id);
    this.log("remove-request", c.id, clip(b.reason, 200));
    return { ok: true };
  }

  // ---------- 숫자 ----------
  stats() {
    const n = (q, ...a) => this.one(q, ...a).n;
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = kst(now() - i * 86400e3);
      const c = (k) => n("SELECT COUNT(*) n FROM logs WHERE day=? AND kind=?", d, k);
      days.push({ d, guest: c("guest"), channel: c("channel"), offer: c("offer"), show: c("show") });
    }
    return {
      guests: n("SELECT COUNT(*) n FROM guests WHERE hidden=0"),
      channels: n("SELECT COUNT(*) n FROM channels WHERE registered=1 AND hidden=0"),
      listed: n("SELECT COUNT(*) n FROM channels WHERE hidden=0"),
      offers: n("SELECT COUNT(*) n FROM offers"),
      accepted: n("SELECT COUNT(*) n FROM offers WHERE status='수락'"),
      shows: n("SELECT COUNT(*) n FROM shows"),
      hiddenGuests: n("SELECT COUNT(*) n FROM guests WHERE hidden=1"),
      removed: this.rows("SELECT l.day, l.note, c.name FROM logs l LEFT JOIN channels c ON c.id=l.ref WHERE l.kind='remove-request' ORDER BY l.at DESC LIMIT 20"),
      reports: this.rows("SELECT day, ref, note FROM logs WHERE kind='report' ORDER BY at DESC LIMIT 20"),
      days,
    };
  }
}

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const statsPage = (s) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>초대석 숫자</title>
<style>body{margin:0 auto;background:#F6F5F1;color:#25282C;font-family:system-ui,sans-serif;padding:20px 16px;max-width:640px}h1{font-size:20px}h2{font-size:15px;margin-top:24px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.c{background:#fff;border:1px solid #E1DFD8;border-radius:8px;padding:12px}.c b{display:block;font-size:26px}.c span{font-size:12px;color:#666}.c i{font-style:normal;font-size:12px;color:#B5432F}table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}td:first-child,th:first-child{text-align:left}p{font-size:12px;color:#666;line-height:1.6}</style></head><body>
<h1>초대석 시험판 숫자</h1>
<div class="g"><div class="c"><b>${s.guests}</b><span>등록 게스트</span><br><i>8주 목표 100 · 4주 점검 40</i></div><div class="c"><b>${s.channels}</b><span>가입 채널 (목록 ${s.listed}곳 중)</span><br><i>8주 목표 20 · 4주 점검 8</i></div><div class="c"><b>${s.shows}</b><span>출연 후기</span><br><i>8주 목표 5</i></div></div>
<p>출연 제안 ${s.offers}건 중 수락 ${s.accepted}건 (4주 점검선: 제안 10건). 신고 3번으로 숨겨진 게스트 ${s.hiddenGuests}명.</p>
<h2>최근 14일</h2><table><tr><th>날짜</th><th>게스트</th><th>채널</th><th>제안</th><th>출연</th></tr>${s.days.map((r) => `<tr><td>${r.d.slice(5).replace("-", "/")}</td><td>${r.guest}</td><td>${r.channel}</td><td>${r.offer}</td><td>${r.show}</td></tr>`).join("")}</table>
<h2>채널 삭제 요청 (요청 즉시 숨김)</h2><table>${s.removed.map((r) => `<tr><td>${esc(r.day)}</td><td>${esc(r.name)}</td><td>${esc(r.note)}</td></tr>`).join("") || "<tr><td>없음</td></tr>"}</table>
<h2>신고</h2><table>${s.reports.map((r) => `<tr><td>${esc(r.day)}</td><td>${esc(r.ref)}</td><td>${esc(r.note)}</td></tr>`).join("") || "<tr><td>없음</td></tr>"}</table>
<p>한국 시간 기준. 이 화면에는 연락처 같은 개인정보를 보여 주지 않습니다.</p></body></html>`;

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) {
      if (e instanceof Bad || (e && e.message && /^[가-힣]/.test(e.message))) return json({ error: e.message }, 400);
      return json({ error: "잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요." }, 500);
    }
  },
};

async function handle(req, env) {
  const u = new URL(req.url);
  const db = env.DB.get(env.DB.idFromName("main"));
  const p = u.pathname;
  const tok = req.headers.get("x-key") || "";
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const call = async (fn) => {
    try { return json(await fn()); }
    catch (e) { const m = String(e && e.message || ""); if (/^[가-힣]/.test(m) || /[가-힣]/.test(m.slice(0, 5))) return json({ error: m }, 400); throw e; }
  };

  if (p === "/stats") return new Response(statsPage(await db.stats()), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (req.method === "GET") {
    if (p === "/api/guests") return call(() => db.guests());
    if (p === "/api/channels") return call(() => db.channels());
    if (p === "/api/shows") return call(() => db.shows());
    let m;
    if ((m = p.match(/^\/api\/guests\/([a-z0-9]+)$/))) return call(async () => (await db.guest(m[1])) || Promise.reject(new Error("게스트를 찾지 못했어요.")));
    if ((m = p.match(/^\/api\/channels\/([a-z0-9-]+)$/))) return call(async () => (await db.channel(m[1])) || Promise.reject(new Error("채널을 찾지 못했어요.")));
    if (p === "/api/me") return call(() => db.me(tok));
  }
  if (req.method === "POST") {
    const b = await body();
    if (b.website) return json({ ok: true }); // 자동 등록 봇 걸러내기
    if (p === "/api/guests") return call(() => db.addGuest(b));
    if (p === "/api/channels") return call(() => db.addChannel(b));
    if (p === "/api/me") return call(() => db.update(tok, b));
    if (p === "/api/me/delete") return call(() => db.remove(tok));
    if (p === "/api/offers") return call(() => db.offer(tok, b));
    if (p === "/api/offers/answer") return call(() => db.answer(tok, b));
    if (p === "/api/shows") return call(() => db.addShow(tok, b));
    if (p === "/api/report") return call(() => db.report(b));
    if (p === "/api/remove-request") return call(() => db.removeRequest(b));
  }
  return json({ error: "없는 주소예요." }, 404);
}
