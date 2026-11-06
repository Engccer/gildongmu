// 자동차 정체 구간(E80) 실호출 게이트 — spec `2026-11-07-e80-car-traffic-design.md` §7.
//
// fixture green ≠ 실계약 검증: Tmap이 `trafficInfo`를 어디에 어떤 모양으로 주는지(geometry 안 index 구간), 그 정체 좌표가
// 우리 안내 경로 위에 실제로 놓이는지는 실호출로만 안다.
//
// 보는 것(공개 지점 쌍마다):
//  ⓐ `traffic=1&includeGeometry=1`: provider tmap, `congestion`이 null이 아니다(정보 있음), 정체마다 길이 ≥ 500m·정수,
//     시작 + 길이 ≤ 총거리 + 50m, 시작·끝 좌표가 같은 응답의 안내 경로(스텝 `pathCoords`)에서 40m 안이다
//     (주행 중 판정이 그 좌표를 안내 경로에 투영한다 — 어긋나면 새 정체가 영영 "경로 밖"이 된다)
//  ⓑ 같은 쌍 `traffic` 없음: 응답에 `congestion` 키가 없고 안내 문장 목록이 ⓐ와 같다(옵트인이 경로를 바꾸지 않는다)
//  ⓒ en(NCP 키가 있을 때): `traffic=1`이면 `congestion: null`
//  양성 대조: 전체 쌍에서 정체 ≥ 1건 관측(0이면 판정 불가 — 정체 시간대에 다시 돌린다)
//  ⓓ(관측, FAIL 아님) 주행 중 재조회 흉내: 안내 경로의 30% 지점을 출발점으로 다시 찾은 경로의 정체 중, 원래 안내 경로
//     위(40m)에 놓이는 것과 아닌 것을 센다. 주행 중 판정이 그 좌표를 원래 경로에 투영하므로, "아님"이 많으면 재조회가
//     정체를 피해 다른 길을 골라 새 정체를 놓치는 빈도다(설계 리뷰 M1 — 실주행 로그 `carJams`와 함께 본다).
//
// 사용법: BASE_URL=http://localhost:3000 node scripts/verify-car-traffic.mjs
// 호출 수: 쌍 3 × Tmap 3 + en 1(NCP) = 10(언제나 실호출 — 저장 응답 재생 모드는 없다. 결과는 보고 corpus에 남긴다). 카카오 폴백은 강제할 수 없어 단위 테스트(실호출 corpus 모양)가 맡는다.
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ON_ROUTE_M = 40;
const MIN_M = 500;

/** 공개 지점 쌍(도심·간선도로). [이름, 출발lat, 출발lng, 도착lat, 도착lng] */
const PAIRS = [
  ["강남역→서울역", 37.4979, 127.0276, 37.5547, 126.9707],
  ["잠실역→김포공항", 37.5133, 127.1001, 37.5585, 126.8027],
  ["서울역→수원역", 37.5547, 126.9707, 37.2659, 127.0001],
];

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const rad = (x) => (x * Math.PI) / 180;
/** 점 p에서 선분 ab까지(m) — 로컬 평면 근사. */
function segDist(p, a, b) {
  const k = 111320;
  const c = Math.cos(rad(p.lat));
  const ax = (a.lng - p.lng) * k * c, ay = (a.lat - p.lat) * k;
  const bx = (b.lng - p.lng) * k * c, by = (b.lat - p.lat) * k;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  return Math.hypot(ax + dx * t, ay + dy * t);
}
function distToPath(p, path) {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, segDist(p, path[i], path[i + 1]));
  return best;
}

async function get(qs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/api/route/car?${qs}`);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 61_000));
      continue;
    }
    return { status: res.status, body: await res.json() };
  }
  throw new Error("429 반복");
}

let jamsSeen = 0;
for (const [name, oLat, oLng, dLat, dLng] of PAIRS) {
  const base = `origin=${oLat},${oLng}&dest=${dLat},${dLng}`;
  const a = await get(`${base}&includeGeometry=1&traffic=1`);
  if (a.status !== 200) {
    check(`${name} ⓐ 200`, false, `status ${a.status}`);
    continue;
  }
  const r = a.body;
  check(`${name} ⓐ provider tmap`, r.provider === "tmap", String(r.provider));
  check(`${name} ⓐ congestion 정보 있음`, r.congestion !== null && Array.isArray(r.congestion?.jams));
  const path = r.guides.flatMap((g) => g.pathCoords ?? []);
  for (const j of r.congestion?.jams ?? []) {
    jamsSeen++;
    const label = `${name} 정체 ${j.road ?? "(이름 없음)"} ${j.startMeters}m+${j.lengthMeters}m`;
    check(`${label} 길이·정수`, Number.isInteger(j.lengthMeters) && Number.isInteger(j.startMeters) && j.lengthMeters >= MIN_M);
    check(`${label} 총거리 안`, j.startMeters + j.lengthMeters <= r.distanceMeters + 50, `총 ${r.distanceMeters}m`);
    const ds = distToPath(j.start, path);
    const de = distToPath(j.end, path);
    check(`${label} 좌표가 안내 경로 위`, ds <= ON_ROUTE_M && de <= ON_ROUTE_M, `시작 ${ds.toFixed(1)}m 끝 ${de.toFixed(1)}m`);
  }
  if (path.length > 2) {
    const mid = path[Math.floor(path.length * 0.3)];
    const m = await get(`origin=${mid.lat},${mid.lng}&dest=${dLat},${dLng}&includeGeometry=1&traffic=1`);
    let on = 0;
    let off = 0;
    for (const j of m.body?.congestion?.jams ?? []) {
      if (distToPath(j.start, path) <= ON_ROUTE_M && distToPath(j.end, path) <= ON_ROUTE_M) on++;
      else off++;
    }
    console.log(`INFO ${name} ⓓ 30% 지점 재조회 정체: 원 경로 위 ${on}건, 밖 ${off}건 (provider ${m.body?.provider})`);
  }
  const b = await get(`${base}&includeGeometry=1`);
  check(`${name} ⓑ 미지정 응답에 congestion 키 없음`, b.status === 200 && !("congestion" in b.body));
  const textsA = r.guides.map((g) => g.guidance).join("\n");
  const textsB = (b.body.guides ?? []).map((g) => g.guidance).join("\n");
  // 두 호출 사이 교통이 바뀌면 Tmap이 다른 길을 고를 수 있다 — 다르면 FAIL이 아니라 재실행 신호로 남긴다.
  console.log(`${textsA === textsB ? "INFO 같음" : "INFO 다름(교통 변화 가능, 재실행)"} ${name} ⓑ 안내 문장 목록`);
}

const en = await get(`origin=${PAIRS[0][1]},${PAIRS[0][2]}&dest=${PAIRS[0][3]},${PAIRS[0][4]}&lang=en&traffic=1`);
if (en.body.guidanceLang === "en") {
  check("ⓒ en(NCP) traffic=1 → congestion null", en.body.congestion === null);
} else {
  console.log("SKIP ⓒ NCP 키 없음(guidanceLang ko)");
}

check("양성 대조: 정체 ≥ 1건 관측", jamsSeen > 0, `${jamsSeen}건`);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
