// 역지오코딩 영문 병기(E28) 실호출 게이트
// (spec docs/superpowers/specs/2026-08-31-place-name-bilingual-design.md §7·§9).
//
// fixture green ≠ 실계약 검증. 이 축은 ①juso 키워드 검색이 카카오 도로명 문자열을 실제로 받아
// 같은 건물의 engAddr를 1위로 돌려주는가 ②도로명이 없는 지점(공터·수면)에서 지번 로마자 폴백이
// 서는가 ③ko 요청이 종전 응답 그대로인가에 달려 있다. 라우트 자체를 부른다.
//
// 사용법: node scripts/verify-reverse-geocode-en.mjs [--base http://localhost:3100]
//   기본 base는 프로덕션. 종료 코드: 전 케이스 PASS 0, 하나라도 FAIL 1.
const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "https://gildongmu.dodoplanet.space";

const CASES = [
  // 도로명 건물 위 좌표 — juso 공식 영문 기대.
  { lat: 37.5385, lng: 127.1237, lang: "en", expect: "addressEn", why: "강동구청 부근(도로명 건물)" },
  { lat: 37.5665, lng: 126.978, lang: "en", expect: "addressEn", why: "서울시청(도로명 건물)" },
  // 한강 수면 — 도로명 없음 → NCP 최근접 도로명 또는 지번 → 어느 쪽이든 영문 후보(addressEn|addressRoman)가 있어야 한다.
  { lat: 37.5219, lng: 126.9245, lang: "en", expect: "anyEnglish", why: "한강 수면(도로명 미매핑)" },
  // ko는 종전 응답 그대로(영문 필드 없음).
  { lat: 37.5385, lng: 127.1237, lang: "ko", expect: "koOnly", why: "ko 불변" },
];

let fail = 0;
for (const c of CASES) {
  const u = new URL("/api/geocode/reverse", BASE);
  u.searchParams.set("lat", String(c.lat));
  u.searchParams.set("lng", String(c.lng));
  u.searchParams.set("lang", c.lang);
  const started = Date.now();
  let body;
  try {
    const res = await fetch(u);
    body = await res.json();
  } catch (e) {
    console.log(`FAIL ${c.why}: ${e}`);
    fail++;
    continue;
  }
  const ms = Date.now() - started;
  const hasEn = typeof body.addressEn === "string" && body.addressEn.length > 0;
  const hasRoman = typeof body.addressRoman === "string" && body.addressRoman.length > 0;
  let ok;
  if (c.expect === "addressEn") ok = hasEn && !hasRoman && !/[가-힣]/.test(body.addressEn);
  else if (c.expect === "anyEnglish") ok = (hasEn || hasRoman) && body.address;
  else ok = body.address && !hasEn && !hasRoman;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.why} (${ms}ms): ${JSON.stringify(body)}`);
}
process.exit(fail ? 1 : 0);
