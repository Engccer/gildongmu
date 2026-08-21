// "한눈에 보기"(M4) 실호출 게이트 — spec docs/superpowers/specs/2026-08-22-nearby-tab-restructure-design.md §8.
//
// fixture green ≠ 실계약 검증. 여기서 보는 것은 (1) 서울 좌표에서 불릿 5개가 전부 존재하고
// 각 상태가 계약 값 안에 있는가 (2) 서울 밖 국내에서 문화행사가 `unavailable`로 **선판정**되는가
// (3) 한국 밖은 `outOfCoverage`인가 (4) `/api/surroundings/scene` 항목이 장소 상세 재료
// (id·lat·lng)를 싣는가. 상태 값 자체("failed"가 나왔다면 그 조각 upstream 장애)를 출력한다.
//
// 사용법: BASE_URL=http://localhost:3010 node scripts/verify-nearby-overview.mjs
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1(머지 게이트).

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const KINDS = ["transit", "food", "kids", "events", "barrierFree"];
const STATES = new Set(["ok", "none", "unavailable", "failed"]);

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. 서울 주거(길동)
{
  const { status, body } = await get("/api/nearby/overview?lat=37.5385&lng=127.143");
  const d = body?.data;
  check("서울: 200 + data", status === 200 && !!d);
  const kinds = (d?.bullets ?? []).map((b) => b.kind);
  check("서울: 불릿 5종 순서 고정", JSON.stringify(kinds) === JSON.stringify(KINDS), kinds.join(","));
  const states = (d?.bullets ?? []).map((b) => `${b.kind}=${b.state}${b.kind === "transit" ? `/bus:${b.busStops?.state ?? "null"}` : ""}`);
  check("서울: 상태 값이 계약 안", (d?.bullets ?? []).every((b) => STATES.has(b.state)), states.join(" "));
  const okBullets = (d?.bullets ?? []).filter((b) => b.kind !== "transit" && b.state === "ok");
  check("서울: ok 불릿은 nearest ≤ 2 거리순", okBullets.every((b) => b.nearest.length <= 2 && b.nearest.length > 0 &&
    b.nearest.every((p, i, a) => i === 0 || a[i - 1].distanceMeters <= p.distanceMeters)));
  check("서울: 반경 1000", d?.radiusMeters === 1000);
  check("서울: 위치 문장 재료", typeof d?.place === "string" && d.place.length > 0, d?.place);
}

// 2. 서울 밖 국내(전주 한옥마을) — 문화행사 선판정
{
  const { body } = await get("/api/nearby/overview?lat=35.815&lng=127.153");
  const ev = body?.data?.bullets?.find((b) => b.kind === "events");
  check("전주: events unavailable(seoulOnly)", ev?.state === "unavailable" && ev?.reason === "seoulOnly", JSON.stringify(ev));
  const tr = body?.data?.bullets?.find((b) => b.kind === "transit");
  check("전주: 지하철역 없음(station null)", tr && tr.station === null, JSON.stringify(tr?.station));
}

// 3. 한국 밖(파리)
{
  const { status, body } = await get("/api/nearby/overview?lat=48.85&lng=2.35");
  check("파리: outOfCoverage", status === 200 && body?.outOfCoverage === true, JSON.stringify(body));
}

// 4. scene 항목 장소 상세 재료
{
  const { body } = await get("/api/surroundings/scene?lat=37.5385&lng=127.143");
  const items = (body?.data?.groups ?? []).flatMap((g) => g.items);
  check("scene: 항목 존재", items.length > 0, `${items.length}건`);
  check("scene: 전 항목 id·lat·lng·categoryRaw", items.every((i) =>
    typeof i.id === "string" && Number.isFinite(i.lat) && Number.isFinite(i.lng) && typeof i.categoryRaw === "string"));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
