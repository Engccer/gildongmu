import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { runEndpoint, sharedArgs } from "./shared.js";

const NEARBY: Record<string, { catalog: string; description: string }> = {
  subway: { catalog: "nearby-subway", description: "주변 지하철역 실시간 도착" },
  bus: { catalog: "nearby-bus", description: "주변 버스 정류소 실시간 도착" },
  bike: { catalog: "nearby-bike", description: "주변 따릉이 대여소(서울)" },
  clinic: { catalog: "nearby-clinic", description: "주변 소아 야간·휴일 진료" },
  kids: { catalog: "nearby-kids", description: "주변 아이 놀 곳" },
  around: { catalog: "nearby-around", description: "주변 둘러보기(편의점·카페 등)" },
  "barrier-free": { catalog: "nearby-barrier-free", description: "주변 무장애 관광지" },
  walk: { catalog: "nearby-walk-infra", description: "주변 보행 인프라(음향신호기·횡단보도·점자블록)" },
};

function makeNearby(verb: string, catalog: string, description: string) {
  return defineCommand({
    meta: { name: verb, description },
    args: sharedArgs,
    async run({ args }) {
      try {
        const loc = await resolveLocation(args, { required: true });
        await runEndpoint(catalog, { lat: String(loc!.lat), lng: String(loc!.lng) }, args.output);
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
  meta: { name: "nearby", description: "내 주변 정보 8종" },
  subCommands: Object.fromEntries(
    Object.entries(NEARBY).map(([verb, v]) => [verb, makeNearby(verb, v.catalog, v.description)]),
  ),
});
