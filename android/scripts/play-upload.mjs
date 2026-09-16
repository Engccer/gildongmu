/**
 * Google Play 내부 테스트 트랙 업로드 (Google Play Developer API v3) — **골격**.
 *
 * iOS `ios/scripts/asc-submit.mjs`와 같은 꼴: 기본은 드라이런(무엇을 할지만 출력), `--check`는 인증·앱 조회만,
 * 실제 업로드는 `--apply`. 서명 키·서비스 계정은 사람이 만든다(자격 증명을 만드는 일은 자동화하지 않는다).
 *
 * 사전 준비(위원장 1회, `docs/playstore/internal-track.md` §1):
 *   - 서비스 계정 JSON → `~/gildongmu-private/play/service-account.json`(권한 600)
 *   - Play Console에서 그 서비스 계정에 릴리스 관리자 권한
 *
 * 사용:
 *   node android/scripts/play-upload.mjs --check
 *   node android/scripts/play-upload.mjs --aab <app-release.aab> --notes-ko <파일> --notes-en <파일> [--complete] [--apply]
 *
 * ⚠ 실행은 Play 개발자 계정과 업로드 키가 생긴 뒤에만(외부 발신·비용 — 하드 스톱). 이 파일은 계정 전 골격이다.
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PACKAGE = "space.dodoplanet.gildongmu";
const SA_PATH = join(homedir(), "gildongmu-private", "play", "service-account.json");
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

function args() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return { check: a.includes("--check"), apply: a.includes("--apply"), complete: a.includes("--complete"), aab: get("--aab"), notesKo: get("--notes-ko"), notesEn: get("--notes-en") };
}

/** 서비스 계정 JWT(RS256) → OAuth 액세스 토큰. */
async function token() {
  if (!existsSync(SA_PATH)) throw new Error(`서비스 계정 JSON 없음: ${SA_PATH} (internal-track.md §1-4)`);
  const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(sa.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  if (!res.ok) throw new Error(`토큰 실패 ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function call(tok, method, url, body, contentType = "application/json") {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${tok}`, "content-type": contentType }, body });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const o = args();
  const tok = await token();
  if (o.check) {
    // 앱 조회: 편집 세션을 열었다 지우는 것이 가장 가벼운 "앱에 접근 가능한가" 확인이다.
    const edit = await call(tok, "POST", `${API}/edits`, "{}");
    await call(tok, "DELETE", `${API}/edits/${edit.id}`);
    console.log(`OK: 서비스 계정 인증·앱 ${PACKAGE} 편집 권한 확인 (edit ${edit.id} 생성 후 삭제)`);
    return;
  }
  if (!o.aab || !existsSync(o.aab)) throw new Error("--aab <app-release.aab> 필요");
  // 산출물 검사(iOS asc-submit 동형): 정식 번들에 실험판 봉인 항목이 없는지 — 번들은 `bundletool build-apks` 뒤 APK로 검사한다(추후 배선). 지금은 안내만.
  console.log("⚠ 제출 전 `node android/scripts/check-release-manifest.mjs <정식 APK>`로 봉인 매니페스트 축을 확인한다(internal-track.md §2).");
  const notes = [["ko-KR", o.notesKo], ["en-US", o.notesEn]].filter(([, p]) => p).map(([language, p]) => ({ language, text: readFileSync(p, "utf8").trim() }));
  const plan = { aab: o.aab, track: "internal", status: o.complete ? "completed" : "draft", notes: notes.map((n) => n.language) };
  console.log(`계획: ${JSON.stringify(plan)}`);
  if (!o.apply) { console.log("드라이런 — 업로드하지 않았다. 실제 반영은 --apply"); return; }
  const edit = await call(tok, "POST", `${API}/edits`, "{}");
  const bundle = await call(tok, "POST", `${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`, readFileSync(o.aab), "application/octet-stream");
  await call(tok, "PUT", `${API}/edits/${edit.id}/tracks/internal`, JSON.stringify({ track: "internal", releases: [{ versionCodes: [String(bundle.versionCode)], status: plan.status, releaseNotes: notes }] }));
  await call(tok, "POST", `${API}/edits/${edit.id}:commit`, "{}");
  console.log(`업로드 완료: versionCode ${bundle.versionCode} → internal(${plan.status})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
