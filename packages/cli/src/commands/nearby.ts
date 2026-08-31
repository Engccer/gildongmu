import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { catalogSupportsLang, langArgs, runEndpoint, sharedArgs } from "./shared.js";

const NEARBY: Record<string, { catalog: string; description: string }> = {
  overview: { catalog: "nearby-overview", description: "한눈에 보기(1km 안 대중교통·식당·카페·아이 놀 곳·문화 행사·무장애 관광지)" },
  subway: { catalog: "nearby-subway", description: "주변 지하철역 실시간 도착" },
  bus: { catalog: "nearby-bus", description: "주변 버스 정류소 실시간 도착" },
  bike: { catalog: "nearby-bike", description: "주변 따릉이 대여소(서울)" },
  clinic: { catalog: "nearby-clinic", description: "주변 소아 야간·휴일 진료" },
  kids: { catalog: "nearby-kids", description: "주변 아이 놀 곳" },
  around: { catalog: "nearby-around", description: "주변 둘러보기(편의점·카페 등)" },
  events: { catalog: "nearby-events", description: "주변 오늘 진행 중인 문화행사(서울)" },
  "barrier-free": { catalog: "nearby-barrier-free", description: "주변 무장애 관광지" },
  walk: { catalog: "nearby-walk-infra", description: "주변 보행 인프라(음향신호기·횡단보도·점자블록)" },
  congestion: { catalog: "nearby-congestion", description: "지금 있는 곳의 실시간 인구 혼잡도(서울 핫스팟)" },
};

/** 자동완성(completion.ts)이 쓰는 verb 목록 — 여기서 파생시켜 하드코딩 드리프트를 막는다. */
export const NEARBY_VERBS = Object.keys(NEARBY);

function makeNearby(verb: string, catalog: string, description: string) {
  // lang을 받는 도메인은 지하철 도착뿐이다 — 카탈로그 술어로 갈라 `--help`가
  // 따릉이·혼잡도에 쓸 수 없는 `--lang`을 광고하지 않게 한다.
  const supportsLang = catalogSupportsLang(catalog);
  return defineCommand({
    meta: { name: verb, description },
    args: supportsLang ? { ...sharedArgs, ...langArgs } : sharedArgs,
    async run({ args }) {
      // citty는 선언하지 않은 플래그도 args에 싣는다 — 선언 여부와 무관하게 읽되,
      // 전달 판정은 runEndpoint의 카탈로그 술어가 한다(미지원 도메인에선 무전달).
      const lang = (args as { lang?: unknown }).lang;
      try {
        const loc = await resolveLocation(args, { required: true });
        await runEndpoint(
          catalog,
          { lat: String(loc!.lat), lng: String(loc!.lng) },
          args.output,
          lang === undefined ? undefined : String(lang),
        );
      } catch (err) {
        // ApiError(네트워크 7·서버 오류 1 등)는 고유 exit 코드 보존, 지오코딩 0건(일반 Error)만 Usage(2).
        if (err instanceof LocationError) fail(err.message, err.exitCode);
        if (err instanceof ApiError) fail(err.message, err.exitCode);
        fail(err instanceof Error ? err.message : String(err), ExitCode.Usage);
      }
    },
  });
}

export const nearbyCommand = defineCommand({
  meta: { name: "nearby", description: "내 주변 정보 10종" },
  subCommands: Object.fromEntries(
    Object.entries(NEARBY).map(([verb, v]) => [verb, makeNearby(verb, v.catalog, v.description)]),
  ),
});
