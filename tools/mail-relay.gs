/**
 * 초대석 메일 중계 (Google Apps Script 웹 앱)
 * 초대석 구글 계정(chodaeseok.kr@gmail.com)에서 실행되어, 사이트가 요청한 메일을 이 계정의 지메일로 보냄.
 *
 * 설정
 * 1) 프로젝트 설정 > 스크립트 속성 > MAIL_SECRET 에 긴 무작위 값을 넣는다(Cloudflare의 MAIL_SECRET과 같은 값).
 * 2) 배포 > 새 배포 > 유형: 웹 앱, 실행 계정: 나, 액세스 권한: 모든 사용자 > 배포 > 권한 허용.
 * 3) 나온 웹 앱 URL을 Cloudflare 비밀값 MAIL_URL 에 넣는다.
 *
 * 비밀값이 맞는 요청만 처리하고, 한 번에 받는 사람은 1명으로 제한한다.
 */
function doPost(e) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    var secret = PropertiesService.getScriptProperties().getProperty("MAIL_SECRET");
    var b = JSON.parse(e.postData.contents || "{}");
    if (!secret || secret.length < 16 || b.secret !== secret) return out({ ok: false, error: "secret" });
    var to = String(b.to || "").trim();
    if (b.notify) to = Session.getEffectiveUser().getEmail(); // 운영자 알림은 이 계정 자신에게
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return out({ ok: false, error: "to" });
    var subject = String(b.subject || "").slice(0, 200);
    var body = String(b.body || "").slice(0, 5000);
    if (!subject || !body) return out({ ok: false, error: "empty" });
    if (MailApp.getRemainingDailyQuota() < 1) return out({ ok: false, error: "quota" });
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: "초대석" });
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}

// 편집기에서 한 번 실행해 메일 발송 권한을 허용할 때 쓰는 함수(자기 자신에게 시험 메일)
function testSend() {
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: "[초대석] 메일 중계 시험", body: "이 메일이 보이면 메일 중계 설정이 끝난 거예요.", name: "초대석" });
}
