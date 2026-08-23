// 횡단보도 차로 수·도로 폭 주석(E8) 실호출 게이트 — spec
// docs/superpowers/specs/2026-08-23-crosswalk-lanes-length-design.md §7.
//
// fixture green ≠ 실계약 검증. 보는 것: (1) 동작구 경로(데이터 보유 63개 시군구 중 서울 유일)에서
// 단일 횡단보도 스텝에 ", N차로, 도로 폭 Mm"가 ≥ 1건 붙는가 (2) 길동(seed 0건)에서는 한 건도
// 붙지 않는가 (3) 붙은 스텝은 전부 "횡단보도" 포함이고 병합("횡단보도 N개") 스텝이 아닌가
// (4) 주석 형식이 계약 정규식과 일치하는가.
//
// 사용법: BASE_URL=http://localhost:3010 node scripts/verify-crosswalk-annotation.mjs
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1(머지 게이트).

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ANNOTATION = /, (\d+)차로, 도로 폭 (\d+)m$/;

async function walk(from, to) {
  const res = await fetch(
    `${BASE}/api/route/walk?origin=${from[0]},${from[1]}&dest=${to[0]},${to[1]}`,
  );
  return { status: res.status, body: await res.json() };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// 동작구 실측 쌍(2026-08-23): 흑석역→중앙대(서달로 3차로), 상도역→노량진역(만양로·노량진로)
const DONGJAK = [
  [[37.5087, 126.9634], [37.5052, 126.9570]],
  [[37.5027, 126.9478], [37.5142, 126.9423]],
];
const GILDONG = [[37.5385, 127.143], [37.5326, 127.1376]];

let annotated = [];
for (const [a, b] of DONGJAK) {
  const { status, body } = await walk(a, b);
  check(`동작구 ${a}→${b}: 200`, status === 200, String(status));
  const steps = body?.result?.steps ?? [];
  annotated.push(...steps.map((s) => s.description).filter((d) => ANNOTATION.test(d)));
}
check("동작구: 차로 수 주석 ≥ 1", annotated.length >= 1, `${annotated.length}건`);
for (const d of annotated) console.log("   ", d);
check(
  "주석 스텝은 전부 단일 횡단보도 문장",
  annotated.every((d) => d.includes("횡단보도") && !/횡단보도 \d+개|\d+개의/.test(d)),
);
check(
  "주석 값은 차로 1~15·폭 1~60m",
  annotated.every((d) => {
    const m = ANNOTATION.exec(d);
    return m && +m[1] >= 1 && +m[1] <= 15 && +m[2] >= 1 && +m[2] <= 60;
  }),
);

{
  const { status, body } = await walk(...GILDONG);
  const steps = body?.result?.steps ?? [];
  const cross = steps.filter((s) => s.description.includes("횡단보도"));
  check("길동: 200 + 횡단보도 스텝 존재(대조군 성립)", status === 200 && cross.length > 0, `${cross.length}건`);
  check("길동: 주석 0건(침묵)", !cross.some((s) => ANNOTATION.test(s.description)));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
