// 비-ko 도보 조각 필드(A58 잔여) 실호출 게이트 — `wording=2` ∧ `includeGeometry=1` en 응답의 `parts`.
//
// fixture green ≠ 실계약 검증: en 문장은 Tmap `turnType`에서 새로 만들므로, 실경로의 코드 분포에서 조각이 방향을 품은
// 행동절(회전 12~19·방향 박은 횡단 212~217)에만 서고 본문이 방향을 다시 말하지 않는지는 실호출로만 확인된다.
//
// 보는 것:
//  ⑦a 오류 응답 0건
//  ⑦b 조각은 방향 행동절로 시작하는 문장에만 있고(회전은 거리가 있을 때), 그 밖 문장엔 없다
//  ⑦c 본문에 한글 0, 방향 낱말 0("o'clock"·"on your left/right"·"Turn")
//  ⑦d 문장은 `turn`으로 시작하고, 회전 본문은 "Walk "·횡단 본문은 "Cross the crosswalk"로 시작한다
//  ⑦e 양성 대조: 회전 조각과 횡단 조각을 각각 1건 이상 관측했다(0건 통과 방지)
//  ⑦f 같은 좌표의 판본 1 응답엔 조각이 없고 문장은 같다(미지정 응답 불변 — 첫 경로 1건)
//
// 사용법: BASE_URL=http://localhost:3013 node scripts/verify-en-walk-parts.mjs (Tmap 9건)
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANGUL = /[가-힣]/;

/** `verify-non-ko-walk-guidance.mjs` 코퍼스 중 도심 8쌍. [출발lat, 출발lng, 도착lat, 도착lng] */
const ROUTES = [
  [37.5372, 127.1265, 37.545, 127.136], [37.5665, 126.978, 37.571, 126.992],
  [37.4979, 127.0276, 37.51, 127.04], [37.551, 126.988, 37.558, 126.995],
  [35.1796, 129.0756, 35.16, 129.085], [37.556, 126.9245, 37.562, 126.933],
  [37.4563, 126.7052, 37.47, 126.715], [35.869, 128.596, 35.876, 128.605],
];
// ⚠ 코퍼스의 [37.5172, 127.0473 → 37.524, 127.056]은 뺐다: 2026-10-05 Tmap 응답 본문에 이스케이프 안 된 제어 문자가 있어
// 판본과 무관하게 502다(`JSON.parse` 실패 — 조각 이전 단계, 별도 결함).

const TURN = /^(Turn left|Turn right|Make a U-turn|Turn to your (?:8|10|2|4) o'clock), then walk /;
const CROSS = /^Cross the crosswalk (?:on your (?:left|right)|at (?:8|10|2|4) o'clock)(?:, then walk |$|, )/;
const DIRECTION_WORD = /o'clock|on your (?:left|right)|\bTurn\b|U-turn/;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function walk(route, wording) {
  const [oLat, oLng, dLat, dLng] = route;
  const url =
    `${BASE}/api/route/walk?origin=${oLat},${oLng}&dest=${dLat},${dLng}&includeGeometry=1&lang=en` +
    (wording === 2 ? "&wording=2" : "");
  // 라우트 IP 레이트리밋(60초 N회)의 429는 게이트 실패가 아니라 게이트가 스스로를 막은 것이다 — 창이 지나면 재시도한다.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status !== 429) return { status: res.status, body: await res.json().catch(() => null) };
    await new Promise((r) => setTimeout(r, 61_000));
  }
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const failures = [];
const misplaced = [];
const badBody = [];
const badShape = [];
let turnParts = 0;
let crossParts = 0;
let steps = 0;
let firstV2 = null;

for (const route of ROUTES) {
  const { status, body } = await walk(route, 2);
  if (status !== 200) {
    failures.push(`${route.join(",")} → HTTP ${status}`);
    continue;
  }
  const list = body?.result?.steps ?? [];
  if (!firstV2) firstV2 = { route, list };
  for (const s of list) {
    steps++;
    const isTurn = TURN.test(s.description);
    const isCross = CROSS.test(s.description);
    if (Boolean(s.parts) !== (isTurn || isCross)) misplaced.push(`${s.description} → parts=${JSON.stringify(s.parts)}`);
    if (!s.parts) continue;
    if (HANGUL.test(s.parts.body) || DIRECTION_WORD.test(s.parts.body)) badBody.push(s.parts.body);
    const lead = isTurn ? "Walk " : "Cross the crosswalk";
    if (!s.description.startsWith(s.parts.turn) || !s.parts.body.startsWith(lead)) badShape.push(JSON.stringify(s.parts));
    if (isTurn) turnParts++;
    else crossParts++;
  }
}

check("⑦a 오류 응답 0건", failures.length === 0, failures.slice(0, 3).join(" | "));
check("⑦b 조각은 방향 행동절 문장에만", misplaced.length === 0, misplaced.slice(0, 3).join(" | "));
check("⑦c 본문에 한글·방향 낱말 0", badBody.length === 0, badBody.slice(0, 3).join(" | "));
check("⑦d 문장은 turn으로 시작, 본문 머리 꼴", badShape.length === 0, badShape.slice(0, 3).join(" | "));
check("⑦e 회전·횡단 조각을 각각 1건 이상 관측", turnParts > 0 && crossParts > 0, `turn=${turnParts} cross=${crossParts} steps=${steps}`);

if (firstV2) {
  const v1 = await walk(firstV2.route, 1);
  const v1Steps = v1.body?.result?.steps ?? [];
  check(
    "⑦f 판본 1은 조각 없음·문장 동일",
    v1.status === 200 &&
      v1Steps.every((s) => s.parts === undefined) &&
      JSON.stringify(v1Steps.map((s) => s.description)) === JSON.stringify(firstV2.list.map((s) => s.description)),
    `status=${v1.status} steps=${v1Steps.length}`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n총 ${results.length}축 중 ${failed.length}건 실패 (steps=${steps}, turn=${turnParts}, cross=${crossParts})`);
process.exit(failed.length ? 1 : 0);
