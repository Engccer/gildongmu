// 장소 상세 영업시간(E24) 실호출 게이트
// (spec docs/superpowers/specs/2026-08-30-place-hours-google-design.md §6).
//
// fixture green ≠ 실계약 검증. 이 축은 ①구글 Text Search가 카카오 장소를 실제로 돌려주는가
// ②매칭 술어 B1'(도로명 키)가 대형 시설에서 실제로 여는가 ③영업시간 없는 장소·해외 좌표가
// 침묵(null)으로 오는가에 달려 있다. 라우트 자체를 부른다(캐시·쿼터·타임아웃 경로 포함).
//
// 사용법: node scripts/verify-place-hours.mjs [--base http://localhost:3000]
//   기본 base는 프로덕션. 종료 코드: 전 케이스 PASS 0, 하나라도 FAIL 1.
const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "https://gildongmu.dodoplanet.space";

// 기대: "hours" = 비-null이고 ranges 또는 allDay가 있다 / "silent" = null
const CASES = [
  // 대조 시트 표본(2026-08-28 카카오 실측 좌표). 영업시간 보유가 확인된 곳.
  { name: "워터캐슬 하남미사점", lat: 37.56711145026242, lng: 127.1974899021748, roadAddress: "경기 하남시 미사대로 410", expect: "hours", why: "B1' 도로명 키(구글 좌표 85m 이격)" },
  { name: "스타벅스 강동역점", lat: 37.536045232577685, lng: 127.13298720047844, roadAddress: "서울 강동구 천호대로 1089", expect: "hours", why: "B1 완전 일치" },
  // 침묵 케이스
  { name: "존재하지않는가게zzz", lat: 37.5385, lng: 127.1237, roadAddress: "", expect: "silent", why: "매칭 실패" },
  { name: "Starbucks", lat: 35.6895, lng: 139.6917, roadAddress: "", expect: "silent", why: "한국 밖(도쿄) — upstream 미호출" },
  { name: "카페", lat: 0, lng: 0, roadAddress: "", expect: "silent", why: "좌표 (0,0)" },
];

let fail = 0;
for (const c of CASES) {
  const u = new URL("/api/places/hours", BASE);
  u.searchParams.set("lat", String(c.lat));
  u.searchParams.set("lng", String(c.lng));
  u.searchParams.set("name", c.name);
  if (c.roadAddress) u.searchParams.set("roadAddress", c.roadAddress);
  const t0 = Date.now();
  const res = await fetch(u);
  const ms = Date.now() - t0;
  const body = await res.json().catch(() => null);
  const hours = body?.hours ?? null;
  const got = hours !== null ? "hours" : "silent";
  const ok = res.status === 200 && got === c.expect;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name} [${c.why}] ${res.status} ${ms}ms →`, JSON.stringify(hours));
}
console.log(fail ? `FAIL ${fail}건` : "ALL PASS");
process.exit(fail ? 1 : 0);
