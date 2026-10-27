// D35 측정용 외부 API 대역 — `next start`에 `NODE_OPTIONS=--import <이 파일>`로 싣는다.
//
// 서버 프로세스의 전역 fetch를 Next가 감싸기 **전에** 바꿔 둔다. Next의 데이터 캐시(`next.revalidate`·
// `unstable_cache`)는 이 대역 위에 얹히므로, 여기까지 내려온 호출 수가 곧 "실제 upstream 호출 수"다.
// 실호출 0: localhost 밖 요청은 전부 여기서 끝난다(카카오만 정상 응답, 나머지는 503 — 호출 수만 센다).
//
// 집계는 `UPSTREAM_COUNT_FILE`에 호스트별 JSON으로 덮어쓴다(요청마다 동기 기록 — 서버를 죽여도 남는다).

import { writeFileSync } from "node:fs";

const countFile = process.env.UPSTREAM_COUNT_FILE;
const counts = {};
const realFetch = globalThis.fetch;

const KAKAO_DOCS = {
  meta: { total_count: 1, pageable_count: 1, is_end: true },
  documents: [
    {
      id: "measure-1",
      place_name: "측정용 카페",
      category_name: "음식점 > 카페",
      category_group_code: "CE7",
      phone: "",
      address_name: "서울 종로구 세종로 1-1",
      road_address_name: "서울 종로구 사직로 161",
      x: "126.9770",
      y: "37.5796",
      place_url: "",
      distance: "",
    },
  ],
};

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return realFetch(input, init);
  counts[url.hostname] = (counts[url.hostname] ?? 0) + 1;
  if (countFile) writeFileSync(countFile, JSON.stringify(counts));
  if (url.hostname === "dapi.kakao.com") {
    return new Response(JSON.stringify(KAKAO_DOCS), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: "측정 대역(D35)" }), { status: 503, headers: { "content-type": "application/json" } });
};
