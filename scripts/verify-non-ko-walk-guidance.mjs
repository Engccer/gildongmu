// 비-ko 도보 상세 안내(E16 축3) 실호출 게이트 — spec
// docs/superpowers/specs/2026-08-23-non-ko-walk-guidance-design.md §5.
//
// fixture green ≠ 실계약 검증. 이 축은 특히 그렇다: 문장이 구조화 필드에서 나오므로
// Tmap이 코드를 주는지, 우리 표가 그 코드를 전부 덮는지, juso가 로마자를 주는지가
// 전부 **실호출로만** 확인된다. 설계 근거였던 수치(30경로 435스텝, 가드 오탐 0)의
// 회귀 가드이기도 하다 — 가드가 오탐하면 en 안내가 통째로 죽는다.
//
// 보는 것:
//  ① 전 스텝 description에 한글 0 (영어 음성이 읽지 못하는 조각이 남지 않았는가)
//  ② 로마자 도로명(" along X")이 최소 1건 (juso 축이 실제로 붙는가)
//  ③ includeGeometry=1에서 pathCoords와 action이 온다 (실시간 안내 성립 조건)
//  ④ 코퍼스 규모가 설계 근거에 미치는가(스텝 400 이상)
//  ⑤ 502가 0건 (미지 turnType·가드 오탐이 없다 — 하나라도 있으면 그 경로는 죽는다)
//  ⑥ ko 조회는 종전대로 한국어다 (회귀 가드)
//
// ⚠ 이 라우트에는 IP 레이트리밋(60초 N회)이 있다. 30경로를 몰아 치면 429가 나는데 그것은
// 게이트 실패가 아니라 게이트가 스스로를 막은 것이다 — 429는 재시도하고, 재시도도 429면
// 그때만 실패로 센다(가드를 끄지 않는다. 프로덕션 방어를 시험용으로 무력화하면 그 방어가
// 실제로 동작하는지 영영 확인하지 못한다).
//
// 사용법: BASE_URL=http://localhost:3010 node scripts/verify-non-ko-walk-guidance.mjs
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1(머지 게이트). 30경로 페이싱 때문에 수 분 걸린다.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANGUL = /[가-힣]/;

/** spec §2.2 코퍼스 — 전국 30쌍(도심·역세권·주거·관광·지방). [출발lat, 출발lng, 도착lat, 도착lng] */
const ROUTES = [
  [37.5372, 127.1265, 37.545, 127.136], [37.5665, 126.978, 37.571, 126.992],
  [35.1796, 129.0756, 35.16, 129.085], [33.4996, 126.5219, 33.49, 126.53],
  [37.4979, 127.0276, 37.51, 127.04], [37.4563, 126.7052, 37.47, 126.715],
  [37.551, 126.988, 37.558, 126.995], [37.5547, 126.9707, 37.56, 126.976],
  [35.115, 129.03, 35.122, 129.035], [35.869, 128.596, 35.876, 128.605],
  [37.448, 126.701, 37.456, 126.71], [35.16, 126.852, 35.168, 126.86],
  [37.755, 128.876, 37.762, 128.885], [37.265, 127.029, 37.273, 127.038],
  [36.3504, 127.3845, 36.358, 127.393], [35.5384, 129.3114, 35.545, 129.32],
  [37.556, 126.9245, 37.562, 126.933], [37.5172, 127.0473, 37.524, 127.056],
  [37.482, 126.889, 37.489, 126.898], [37.51, 127.144, 37.517, 127.153],
  [35.228, 128.1076, 35.235, 128.116], [34.76, 127.489, 34.767, 127.497],
  [35.967, 126.79, 35.974, 126.798], [36.568, 128.73, 36.575, 128.738],
  [37.881, 127.73, 37.888, 127.738], [34.91, 127.656, 34.917, 127.664],
  [37.479, 126.95, 37.486, 126.959], [35.162, 129.165, 35.169, 129.174],
  [37.748, 126.632, 37.755, 126.64], [37.276, 127.21, 37.283, 127.219],
];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function walk(route, lang) {
  const [oLat, oLng, dLat, dLng] = route;
  const url =
    `${BASE}/api/route/walk?origin=${oLat},${oLng}&dest=${dLat},${dLng}` +
    `&includeGeometry=1${lang === "ko" ? "" : `&lang=${lang}`}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status !== 429) return { status: res.status, body: await res.json().catch(() => null) };
    await sleep(61_000); // 레이트리밋 창(60초)이 지나기를 기다린다
  }
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => null) };
}

let steps = 0;
let withRoad = 0;
let withAction = 0;
const hangulSteps = [];
const missingGeometry = [];
const failures = [];

for (const route of ROUTES) {
  const { status, body } = await walk(route, "en");
  if (status !== 200) {
    failures.push(`${route.join(",")} → HTTP ${status} ${JSON.stringify(body).slice(0, 120)}`);
    continue;
  }
  const result = body?.result;
  if (!result) continue; // 경로 없음은 실패가 아니다(커버리지 현실)
  for (const s of result.steps ?? []) {
    steps++;
    if (HANGUL.test(s.description)) hangulSteps.push(s.description);
    if (/ along /.test(s.description)) withRoad++;
    if (s.action) withAction++;
    if (!Array.isArray(s.pathCoords) || s.pathCoords.length === 0) {
      missingGeometry.push(s.description);
    }
  }
}

check("⑤ 502·오류 응답 0건(미지 turnType·가드 오탐 없음)", failures.length === 0, failures.slice(0, 3).join(" | "));
check("④ 코퍼스 스텝 400 이상", steps >= 400, `steps=${steps}`);
check("① 전 스텝 한글 0", hangulSteps.length === 0, hangulSteps.slice(0, 3).join(" | "));
check("② 로마자 도로명 1건 이상", withRoad >= 1, `withRoad=${withRoad}`);
check("③ 기하(pathCoords) 전 스텝 보유", missingGeometry.length === 0, missingGeometry.slice(0, 3).join(" | "));
check("③ 행동(action) 1건 이상", withAction >= 1, `withAction=${withAction}`);

// ⑥ ko 회귀 — 같은 좌표로 ko를 부르면 한국어가 나와야 한다.
const koSample = await walk(ROUTES[0], "ko");
const koSteps = koSample.body?.result?.steps ?? [];
check(
  "⑥ ko 조회는 종전대로 한국어",
  koSample.status === 200 && koSteps.length > 0 && koSteps.some((s) => HANGUL.test(s.description)),
  `status=${koSample.status} steps=${koSteps.length}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n총 ${results.length}축 중 ${failed.length}건 실패 (steps=${steps}, road=${withRoad}, action=${withAction})`);
process.exit(failed.length ? 1 : 0);
