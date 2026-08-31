import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { geocodeQuery } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { langArgs, runEndpoint, sharedArgs } from "./shared.js";

const COORD_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

async function toCoordString(input: string): Promise<string> {
  if (COORD_RE.test(input)) return input;
  const g = await geocodeQuery(input);
  return `${g.lat},${g.lng}`;
}

const ROUTE_CATALOG_NAME: Record<"car" | "transit" | "walk", string> = {
  car: "route-car",
  transit: "route-transit",
  walk: "route-walk",
};

const ROUTE_DESCRIPTION: Record<"car" | "transit" | "walk", string> = {
  car: "자동차 경로 턴바이턴 브리핑",
  transit: "대중교통 경로(추천+대안)",
  walk: "도보 경로 텍스트 브리핑",
};

/** walk 전용 — 계단 회피 경로. 값 검증은 라우트가 한다(아래 forwarding 주석). */
const walkArgs = {
  accessible: {
    type: "string" as const,
    description: "true|false, 계단 회피 경로(walk 전용)",
  },
};

/** 경유지 1개(N4). transit에도 받는다 — 서버가 `unsupported: "waypoint"`로 정직하게 답한다(CLI가 먼저 막으면 그 문장이 사라진다). */
const viaArgs = {
  via: {
    type: "string" as const,
    description: "경유지 1개(장소명·주소 또는 '위도,경도'). 도보·자동차만 경유하고 대중교통은 미지원 안내",
  },
};

function makeRoute(verb: "car" | "transit" | "walk") {
  return defineCommand({
    meta: { name: verb, description: ROUTE_DESCRIPTION[verb] },
    args: {
      origin: { type: "positional", description: "출발지(장소명·주소 또는 '위도,경도')", required: true },
      dest: { type: "positional", description: "도착지(장소명·주소 또는 '위도,경도')", required: true },
      ...sharedArgs,
      ...langArgs,
      ...viaArgs,
      ...(verb === "walk" ? walkArgs : {}),
    },
    async run({ args }) {
      // citty는 선언하지 않은 플래그도 args에 실어 준다 — car·transit에서 --accessible을
      // 조용히 무시하면 "계단 회피를 요청했는데 기본 경로를 받는" 침묵 강등이 된다.
      const accessible = (args as { accessible?: unknown }).accessible;
      if (verb !== "walk" && accessible !== undefined) {
        fail(`--accessible은 route walk에서만 지원합니다(${verb} 미지원).`, ExitCode.Usage);
      }
      let origin: string, dest: string, via: string | undefined;
      try {
        [origin, dest, via] = await Promise.all([
          toCoordString(args.origin),
          toCoordString(args.dest),
          args.via === undefined ? undefined : toCoordString(String(args.via)),
        ]);
      } catch (err) {
        // ApiError(네트워크 7·서버 오류 1 등)는 고유 exit 코드 보존, 지오코딩 0건(일반 Error)만 Usage(2).
        if (err instanceof ApiError) fail(err.message, err.exitCode);
        fail(err instanceof Error ? err.message : String(err), ExitCode.Usage);
      }
      const extra: Record<string, string> = {};
      // 값은 그대로 전달한다 — "true"/"false" 외는 라우트가 400으로 거절해야 하고,
      // CLI가 정규화하면 오타("yes")가 조용히 기본 모드(계단 포함)로 강등된다.
      if (verb === "walk" && accessible !== undefined) extra.accessible = String(accessible);
      if (via !== undefined) extra.via = via;
      await runEndpoint(ROUTE_CATALOG_NAME[verb], { origin, dest, ...extra }, args.output, args.lang);
    },
  });
}

export const routeCommand = defineCommand({
  meta: { name: "route", description: "경로 브리핑" },
  subCommands: { car: makeRoute("car"), transit: makeRoute("transit"), walk: makeRoute("walk") },
});
