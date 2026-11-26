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
const normUrl = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, "").split(/[?#]/)[0].replace(/\/(featured|videos|about|streams|shorts)?\/*$/, "").replace(/\/+$/, "");
const maskMail = (m) => {
  if (!m) return "";
  const [a, d] = m.split("@");
  return (a.length <= 2 ? a[0] + "*" : a.slice(0, 2) + "*".repeat(Math.min(6, a.length - 2))) + "@" + d;
};
// 채널 공개 페이지에서 소개란에 적힌 메일 주소 찾기
const findMail = (html) => {
  const desc = [...String(html).matchAll(/<meta (?:property="og:description"|name="description") content="([^"]*)"/g)].map((m) => m[1]).join(" ");
  const src = desc || String(html).slice(0, 200000);
  const m = src.replace(/\s*(\[at\]|\(at\)| at )\s*/gi, "@").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m && !/youtube|google|example/i.test(m[0]) ? m[0].toLowerCase() : "";
};
async function fetchPage(u) {
  try {
    const target = /youtube\.com\/@/i.test(u) ? u.split(/[?#]/)[0].replace(/\/+$/, "") + "?hl=ko" : u;
    const r = await fetch(target, { headers: { "accept-language": "ko-KR,ko;q=0.9", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" }, redirect: "follow" });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}
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
      CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, token TEXT UNIQUE, kind TEXT, target TEXT, data TEXT, code TEXT, secret TEXT, vmail TEXT, status TEXT, created INTEGER, done INTEGER);
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
  // 채널 가입은 바로 반영하지 않고 '확인 요청(claim)'으로 받음.
  // 채널 운영자임을 확인(소개란 코드 또는 공개 메일 인증 링크)한 뒤에만 가입 채널이 됨. 남의 채널 사칭 방지.
  addChannel(b) {
    const c = this.channelFields(b);
    need(b.agree === true, "이용 안내와 개인정보 처리방침에 동의해 주세요.");
    const key = normUrl(c.url);
    const taken = this.rows("SELECT id, url FROM channels WHERE registered=1").find((x) => normUrl(x.url) === key);
    need(!taken, "이미 초대석에 가입된 채널이에요. 운영자라면 처음 가입할 때 받은 관리 링크로 들어가 주세요.");
    const same = this.rows("SELECT id, url FROM channels WHERE registered=0").find((x) => normUrl(x.url) === key);
    return this.newClaim("join", same ? same.id : "", c);
  }
  newClaim(kind, target, data) {
    const id = rid(10), token = rid(24);
    const code = "CDS-" + rid(6).toUpperCase();
    this.sql.exec("INSERT INTO claims (id, token, kind, target, data, code, secret, vmail, status, created) VALUES (?,?,?,?,?,?,?,'', 'pending', ?)",
      id, token, kind, target, JSON.stringify(data), code, rid(24), now());
    this.log("claim-" + kind, id);
    return { id, token, kind: "claim" };
  }
  claimInfo(cl) {
    const d = JSON.parse(cl.data || "{}");
    const t = cl.target ? this.one("SELECT name, url, platform FROM channels WHERE id=?", cl.target) : null;
    const name = d.name || (t && t.name) || "", url = d.url || (t && t.url) || "", platform = d.platform || (t && t.platform) || "유튜브";
    return { kind: cl.kind, status: cl.status, code: cl.code, name, url, platform, vmail: maskMail(cl.vmail), created: cl.created };
  }
  // 소개란 코드 확인: 채널 공개 페이지에 코드가 보이면 운영자로 봄
  async checkCode(token) {
    const { kind, row } = this.who(token);
    need(kind === "claim", "확인할 요청이 없어요.");
    const info = this.claimInfo(row);
    need(/youtube\.com|youtu\.be/i.test(info.url), "소개란 코드 확인은 유튜브 채널만 할 수 있어요. 팟캐스트는 공개 메일 인증을 이용해 주세요.");
    const html = await fetchPage(info.url);
    need(html, "채널 페이지를 열지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    need(html.includes(row.code), `채널 소개란에서 ${row.code} 코드를 찾지 못했어요. 저장한 지 몇 분 지나야 보일 수 있어요.`);
    return this.approve(row, "code");
  }
  // 공개 메일 인증: 채널 소개란에 공개된 메일 주소를 찾아 두면 운영자가 그 주소로 인증 링크를 보냄
  async requestMail(token) {
    const { kind, row } = this.who(token);
    need(kind === "claim", "확인할 요청이 없어요.");
    const info = this.claimInfo(row);
    const html = await fetchPage(info.url);
    const mail = html ? findMail(html) : "";
    this.sql.exec("UPDATE claims SET vmail=?, status=? WHERE id=?", mail, mail ? "mail" : "mail-manual", row.id);
    this.log("claim-mail", row.id, mail ? "found" : "none");
    return { ok: true, vmail: maskMail(mail) };
  }
  // 메일로 받은 인증 링크: 링크를 연 사람에게 새 관리 링크를 줌(요청한 사람이 메일 주인이 아니면 관리 권한을 못 가짐)
  verifyMail(id, secret) {
    const cl = this.one("SELECT * FROM claims WHERE id=?", clip(id, 20));
    need(cl && cl.secret === secret && typeof secret === "string" && secret.length >= 20, "인증 링크가 올바르지 않아요.");
    need(cl.status !== "done", "이미 확인을 마친 요청이에요.");
    need(cl.status !== "rejected", "취소된 요청이에요.");
    if (cl.kind === "join") this.sql.exec("UPDATE claims SET token=? WHERE id=?", rid(24), cl.id);
    return this.approve(this.one("SELECT * FROM claims WHERE id=?", cl.id), "mail");
  }
  approve(cl, how) {
    const info = this.claimInfo(cl);
    if (cl.kind === "remove") {
      this.sql.exec("UPDATE channels SET hidden=1 WHERE id=? AND registered=0", cl.target);
      this.sql.exec("UPDATE claims SET status='done', done=?, vmail='', data='{}' WHERE id=?", now(), cl.id);
      this.log("remove-request", cl.target, how);
      return { ok: true, kind: "remove", name: info.name };
    }
    const c = JSON.parse(cl.data);
    const taken = this.rows("SELECT id, url FROM channels WHERE registered=1").find((x) => normUrl(x.url) === normUrl(c.url));
    need(!taken, "그 사이에 이 채널이 먼저 가입을 마쳤어요.");
    let id = cl.target;
    const t = id ? this.one("SELECT id, registered FROM channels WHERE id=?", id) : null;
    if (t && !t.registered) {
      this.sql.exec("UPDATE channels SET token=?, name=?, url=?, platform=?, field=?, topics=?, about=?, subs=?, contact=?, registered=1, hidden=0 WHERE id=?",
        cl.token, c.name, c.url, c.platform, c.field, JSON.stringify(c.topics), c.about, c.subs, c.contact, id);
    } else {
      id = rid(8);
      this.sql.exec("INSERT INTO channels (id, token, name, url, platform, field, topics, about, subs, contact, registered, created) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)",
        id, cl.token, c.name, c.url, c.platform, c.field, JSON.stringify(c.topics), c.about, c.subs, c.contact, now());
    }
    this.sql.exec("UPDATE claims SET status='done', done=?, vmail='', data='{}' WHERE id=?", now(), cl.id);
    this.log("channel", id, how);
    return { ok: true, kind: "join", id, token: cl.token, name: c.name };
  }
  cancelClaim(token) {
    const { kind, row } = this.who(token);
    need(kind === "claim", "취소할 요청이 없어요.");
    this.sql.exec("DELETE FROM claims WHERE id=?", row.id);
    return { ok: true };
  }

  // ---------- 운영자 화면 ----------
  adminList() {
    return this.rows("SELECT * FROM claims WHERE status IN ('pending','mail','mail-manual') ORDER BY created DESC LIMIT 100")
      .map((cl) => ({ id: cl.id, secret: cl.secret, vmailFull: cl.vmail, reason: JSON.parse(cl.data || "{}").reason || "", ...this.claimInfo(cl) }));
  }
  adminDecide(id, ok) {
    const cl = this.one("SELECT * FROM claims WHERE id=?", clip(id, 20));
    need(cl && cl.status !== "done", "요청을 찾지 못했어요.");
    if (!ok) { this.sql.exec("UPDATE claims SET status='rejected', done=?, vmail='', data='{}' WHERE id=?", now(), cl.id); return { ok: true }; }
    return this.approve(cl, "admin");
  }
  async adminProbe(u, text) {
    const html = await fetchPage(u);
    return { ok: !!html, length: html.length, found: !!text && html.includes(text), mail: maskMail(findMail(html)) };
  }

  // ---------- 내 관리 페이지 ----------
  who(token) {
    need(typeof token === "string" && token.length >= 20, "관리 링크가 올바르지 않아요.");
    const g = this.one("SELECT * FROM guests WHERE token=?", token);
    if (g) return { kind: "guest", row: g };
    const c = this.one("SELECT * FROM channels WHERE token=?", token);
    if (c) return { kind: "channel", row: c };
    const cl = this.one("SELECT * FROM claims WHERE token=? AND status IN ('pending','mail','mail-manual')", token);
    if (cl) return { kind: "claim", row: cl };
    const old = this.one("SELECT kind, status FROM claims WHERE token=?", token);
    if (old && old.status === "done" && old.kind === "remove") throw new Bad("목록에서 빼기를 마친 요청이에요.");
    if (old && old.status === "rejected") throw new Bad("취소된 요청이에요.");
    throw new Bad("이 관리 링크로 찾은 프로필이 없어요. 메일 인증 링크로 확인을 마쳤다면, 그 링크를 연 화면에서 새 관리 링크를 받았어요.");
  }
  // 채널 확인 전에는 관리 기능을 쓸 수 없음
  owner(token) {
    const w = this.who(token);
    need(w.kind !== "claim", "채널 운영자 확인을 마친 뒤에 쓸 수 있어요.");
    return w;
  }
  me(token) {
    const { kind, row } = this.who(token);
    if (kind === "claim") return { kind, claim: this.claimInfo(row) };
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
    const { kind, row } = this.owner(token);
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
    const { kind, row } = this.owner(token);
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
    const { kind, row } = this.owner(token);
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
    const { kind, row } = this.owner(token);
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
    const { kind, row } = this.owner(token);
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
    const c = this.one("SELECT id FROM channels WHERE id=? AND registered=0 AND hidden=0", clip(b.id, 20));
    need(c, "목록에서 찾지 못했어요. 직접 가입한 채널은 관리 페이지에서 삭제할 수 있어요.");
    // 남이 대신 지우지 못하도록, 운영자 확인(소개란 코드 또는 공개 메일)을 거친 뒤 숨김
    return this.newClaim("remove", c.id, { reason: clip(b.reason, 200) });
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
      claimsJoin: n("SELECT COUNT(*) n FROM claims WHERE kind='join' AND status IN ('pending','mail','mail-manual')"),
      claimsRemove: n("SELECT COUNT(*) n FROM claims WHERE kind='remove' AND status IN ('pending','mail','mail-manual')"),
      reports: this.rows("SELECT day, ref, note FROM logs WHERE kind='report' ORDER BY at DESC LIMIT 20"),
      days,
    };
  }
}

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const statsPage = (s) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>초대석 숫자</title>
<style>body{margin:0 auto;background:#F6F5F1;color:#25282C;font-family:system-ui,sans-serif;padding:20px 16px;max-width:640px}h1{font-size:20px}h2{font-size:15px;margin-top:24px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.c{background:#fff;border:1px solid #E1DFD8;border-radius:8px;padding:12px}.c b{display:block;font-size:26px}.c span{font-size:12px;color:#666}.c i{font-style:normal;font-size:12px;color:#B5432F}table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}td:first-child,th:first-child{text-align:left}p{font-size:12px;color:#666;line-height:1.6}</style></head><body>
<h1>초대석 베타 숫자</h1>
<div class="g"><div class="c"><b>${s.guests}</b><span>등록 게스트</span><br><i>8주 목표 100 · 4주 점검 40</i></div><div class="c"><b>${s.channels}</b><span>가입 채널 (목록 ${s.listed}곳 중)</span><br><i>8주 목표 20 · 4주 점검 8</i></div><div class="c"><b>${s.shows}</b><span>출연 후기</span><br><i>8주 목표 5</i></div></div>
<p>출연 제안 ${s.offers}건 중 수락 ${s.accepted}건 (4주 점검선: 제안 10건). 신고 3번으로 숨겨진 게스트 ${s.hiddenGuests}명.</p>
<h2>최근 14일</h2><table><tr><th>날짜</th><th>게스트</th><th>채널</th><th>제안</th><th>출연</th></tr>${s.days.map((r) => `<tr><td>${r.d.slice(5).replace("-", "/")}</td><td>${r.guest}</td><td>${r.channel}</td><td>${r.offer}</td><td>${r.show}</td></tr>`).join("")}</table>
<p>운영자 확인을 기다리는 요청: 채널 가입 ${s.claimsJoin}건 · 목록 빼기 ${s.claimsRemove}건</p>
<h2>목록에서 뺀 채널 (운영자 확인 후)</h2><table>${s.removed.map((r) => `<tr><td>${esc(r.day)}</td><td>${esc(r.name)}</td><td>${esc(r.note)}</td></tr>`).join("") || "<tr><td>없음</td></tr>"}</table>
<h2>신고</h2><table>${s.reports.map((r) => `<tr><td>${esc(r.day)}</td><td>${esc(r.ref)}</td><td>${esc(r.note)}</td></tr>`).join("") || "<tr><td>없음</td></tr>"}</table>
<p>한국 시간 기준. 이 화면에는 연락처 같은 개인정보를 보여 주지 않습니다.</p></body></html>`;

// 운영자 화면: 채널 확인 요청을 보고, 공개 메일로 보낼 인증 링크를 복사하거나 직접 승인·거절
const adminPage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>초대석 운영자</title>
<style>body{margin:0 auto;background:#F6F5F1;color:#25282C;font-family:system-ui,sans-serif;padding:20px 16px;max-width:760px;font-size:14px}h1{font-size:20px}.c{background:#fff;border:1px solid #E1DFD8;border-radius:8px;padding:12px;margin:10px 0}.m{color:#666;font-size:12px}textarea{width:100%;height:150px;font-size:12px}button{margin:4px 4px 0 0;padding:6px 10px}input{padding:6px;width:60%}</style></head><body>
<h1>초대석 운영자 · 채널 확인 요청</h1>
<p><input type="password" id="k" placeholder="운영자 키"> <button id="go">불러오기</button></p>
<div id="out" class="m">운영자 키를 넣고 불러오기를 눌러 주세요.</div>
<h2 style="font-size:15px">채널 페이지 확인 시험</h2>
<p><input id="pu" placeholder="https://www.youtube.com/@..."> <input id="pt" placeholder="찾을 글자(선택)" style="width:30%"> <button id="pb">확인</button> <span id="pr" class="m"></span></p>
<script>
const $=(i)=>document.getElementById(i);$("k").value=sessionStorage.getItem("ak")||"";
const esc=(s)=>String(s??"").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
async function api(b){sessionStorage.setItem("ak",$("k").value);const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json","x-admin":$("k").value},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
const mailText=(c)=>(c.kind==="remove"?"제목: [초대석] 채널 지도에서 빼기 요청 확인\\n\\n안녕하세요, 초대석입니다.\\n'"+c.name+"' 채널을 초대석 채널 지도에서 빼 달라는 요청이 들어와, 채널 소개란에 공개된 이 주소로 확인 메일을 드립니다.\\n운영자께서 요청하신 것이 맞다면 아래 링크를 눌러 주세요. 누르면 바로 목록에서 빠집니다.\\n":"제목: [초대석] 채널 가입 확인 링크\\n\\n안녕하세요, 초대석입니다.\\n'"+c.name+"' 채널로 초대석 가입 요청이 들어와, 채널 소개란에 공개된 이 주소로 확인 메일을 드립니다.\\n직접 요청하신 것이 맞다면 아래 링크를 눌러 가입을 마쳐 주세요. 링크를 누른 화면에서 채널 관리 링크를 드립니다.\\n")+"\\n"+c.link+"\\n\\n요청하신 적이 없다면 이 메일을 무시해 주세요. 아무 일도 일어나지 않습니다.\\n초대석 드림";
async function load(){try{const l=await api({action:"list"});$("out").innerHTML=l.length?l.map((c)=>'<div class="c"><b>'+(c.kind==="remove"?"목록 빼기":"채널 가입")+'</b> · '+esc(c.name)+' <a href="'+esc(c.url)+'" target="_blank">채널</a><div class="m">'+new Date(c.created).toLocaleString("ko-KR")+' · 상태 '+esc(c.status)+(c.vmailFull?' · 공개 메일 <b>'+esc(c.vmailFull)+'</b>':c.status==="mail-manual"?' · 공개 메일을 자동으로 못 찾음(채널 소개란 직접 확인)':'')+(c.reason?' · 이유: '+esc(c.reason):'')+'</div>'+(c.status!=="pending"?'<textarea readonly>'+esc(mailText(c))+'</textarea>':'')+'<button data-a="approve" data-i="'+c.id+'">직접 승인</button><button data-a="reject" data-i="'+c.id+'">거절</button></div>').join(""):"확인을 기다리는 요청이 없어요.";}catch(e){$("out").textContent=e.message;}}
$("go").onclick=load;
$("out").onclick=async(e)=>{const b=e.target.closest("button");if(!b)return;if(!confirm(b.textContent+" 할까요?"))return;try{await api({action:b.dataset.a,id:b.dataset.i});load();}catch(x){alert(x.message);}};
$("pb").onclick=async()=>{try{const r=await api({action:"probe",url:$("pu").value,text:$("pt").value});$("pr").textContent=(r.ok?"열림 ("+r.length+"자)":"못 열음")+(r.found?" · 글자 찾음":" · 글자 없음")+(r.mail?" · 메일 "+r.mail:"");}catch(x){$("pr").textContent=x.message;}};
</script></body></html>`;

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
  if (p === "/admin") return new Response(adminPage, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (p === "/api/admin" && req.method === "POST") {
    // 운영자 화면: Cloudflare에 비밀값 ADMIN_KEY가 있어야 열림
    const key = env.ADMIN_KEY || "";
    if (!key || key.length < 16) return json({ error: "운영자 키(ADMIN_KEY)가 아직 설정되지 않았어요." }, 403);
    if ((req.headers.get("x-admin") || "") !== key) return json({ error: "운영자 키가 맞지 않아요." }, 403);
    const b = await body();
    if (b.action === "list") return call(async () => (await db.adminList()).map((c) => ({ ...c, link: `${u.origin}/#/verify/${c.id}/${c.secret}`, secret: undefined })));
    if (b.action === "approve") return call(() => db.adminDecide(b.id, true));
    if (b.action === "reject") return call(() => db.adminDecide(b.id, false));
    if (b.action === "probe") return call(() => db.adminProbe(clip(b.url, 300), clip(b.text, 100)));
    return json({ error: "없는 기능이에요." }, 400);
  }
  if (req.method === "GET") {
    if (p === "/api/guests") return call(() => db.guests());
    if (p === "/api/channels") return call(() => db.channels());
    if (p === "/api/shows") return call(() => db.shows());
    let m;
    if ((m = p.match(/^\/api\/guests\/([a-z0-9]+)$/))) return call(async () => (await db.guest(m[1])) || Promise.reject(new Error("게스트를 찾지 못했어요.")));
    if ((m = p.match(/^\/api\/channels\/([a-z0-9-]+)$/))) return call(async () => (await db.channel(m[1])) || Promise.reject(new Error("채널을 찾지 못했어요.")));
    if (p === "/api/me") return call(() => db.me(tok));
    if (p === "/api/verify") return call(() => db.verifyMail(u.searchParams.get("c"), u.searchParams.get("s")));
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
    if (p === "/api/claim/check") return call(() => db.checkCode(tok));
    if (p === "/api/claim/mail") return call(() => db.requestMail(tok));
    if (p === "/api/claim/cancel") return call(() => db.cancelClaim(tok));
  }
  return json({ error: "없는 주소예요." }, 404);
}
