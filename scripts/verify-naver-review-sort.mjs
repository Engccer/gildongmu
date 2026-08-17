// 네이버 지역검색 리뷰순(sort=comment) 실호출 게이트
// (spec docs/superpowers/specs/2026-08-17-naver-review-sort-design.md §7).
//
// 이 저장소는 "fixture green ≠ 실계약 검증"을 원칙으로 삼는다. 리뷰순 축은 네이버가
// **실제로 sort를 먹는가**에 전부 달려 있는데, 200을 주면서 파라미터를 조용히
// 무시하는 API가 흔하다(같은 repo 빠른하차 `_type=json` 무시 선례). 그래서 판정
// 술어를 헐겁게 두지 않는다 — "두 정렬의 상위 5건 집합이 다르다"만 보면 네이버가
// 정렬을 무시하고 매번 다른 결과를 주는 경우와 구분되지 않으므로 "무효값이 SE04로
// 거절된다"를 함께 본다. 5건 캡·start 무시는 소비자 계약(페이지네이션 불가)의 근거다.
//
// 사용법: node scripts/verify-naver-review-sort.mjs [--query "여의도 맛집"]
//   키는 NAVER_LOCAL_CLIENT_ID/SECRET 환경변수 또는 .env.local에서 읽는다.
// 종료 코드: 4축 전부 PASS면 0, 하나라도 FAIL이면 1(머지 게이트).

import { readFileSync, existsSync } from "node:fs";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const ID = process.env.NAVER_LOCAL_CLIENT_ID;
const SECRET = process.env.NAVER_LOCAL_CLIENT_SECRET;
if (!ID || !SECRET) {
  console.error("NAVER_LOCAL_CLIENT_ID / NAVER_LOCAL_CLIENT_SECRET이 필요합니다.");
  process.exit(1);
}
const qi = process.argv.indexOf("--query");
const QUERY = qi >= 0 ? process.argv[qi + 1] : "여의도 맛집";

async function call(params) {
  const url = new URL("https://openapi.naver.com/v1/search/local.json");
  url.searchParams.set("query", QUERY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET },
  });
  const body = await res.json();
  return { status: res.status, body };
}
const names = (b) => (b.items ?? []).map((i) => i.title.replace(/<[^>]+>/g, ""));

const random = await call({ sort: "random", display: 5 });
const comment = await call({ sort: "comment", display: 5 });
const bogus = await call({ sort: "bogus", display: 5 });
const capped = await call({ sort: "comment", display: 10 });
const paged = await call({ sort: "comment", display: 5, start: 6 });

const rNames = names(random.body);
const cNames = names(comment.body);
const results = [
  {
    axis: "1. 두 정렬의 상위 5건 집합이 다르다",
    pass:
      rNames.length > 0 &&
      cNames.length > 0 &&
      JSON.stringify([...rNames].sort()) !== JSON.stringify([...cNames].sort()),
    detail: `random=${rNames.join(" | ")} / comment=${cNames.join(" | ")}`,
  },
  {
    axis: "2. 무효 sort는 SE04로 거절된다(조용한 무시가 아니다)",
    pass: bogus.body?.errorCode === "SE04",
    detail: `HTTP ${bogus.status} ${JSON.stringify(bogus.body)}`,
  },
  {
    axis: "3. display=10을 요청해도 5건으로 캡",
    pass: (capped.body.items ?? []).length <= 5 && (capped.body.items ?? []).length > 0,
    detail: `items=${(capped.body.items ?? []).length}`,
  },
  {
    axis: "4. start=6은 무시된다(항상 1페이지 — 페이지네이션 불가)",
    pass: cNames.length > 0 && names(paged.body)[0] === cNames[0],
    detail: `start=6 첫 항목=${names(paged.body)[0]} / start=1 첫 항목=${cNames[0]}`,
  },
];

console.log(`질의: "${QUERY}"  (${new Date().toISOString()})`);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.axis}\n      ${r.detail}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
