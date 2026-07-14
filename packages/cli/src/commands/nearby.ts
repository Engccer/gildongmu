import { defineCommand } from "citty";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { runEndpoint, sharedArgs } from "./shared.js";

const NEARBY: Record<string, { catalog: string; description: string }> = {
  subway: { catalog: "nearby-subway", description: "주변 지하철역 실시간 도착" },
  bus: { catalog: "nearby-bus", description: "주변 버스 정류소 실시간 도착" },
  bike: { catalog: "nearby-bike", description: "주변 따릉이 대여소(서울)" },
  clinic: { catalog: "nearby-clinic", description: "주변 소아 야간·휴일 진료" },
  kids: { catalog: "nearby-kids", description: "주변 아이 놀 곳" },
  around: { catalog: "nearby-around", description: "주변 둘러보기(편의점·카페 등)" },
  "barrier-free": { catalog: "nearby-barrier-free", description: "주변 무장애 관광지" },
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
        if (err instanceof LocationError) fail(err.message, err.exitCode);
        throw err;
      }
    },
  });
}

export const nearbyCommand = defineCommand({
  meta: { name: "nearby", description: "내 주변 정보 7종" },
  subCommands: Object.fromEntries(
    Object.entries(NEARBY).map(([verb, v]) => [verb, makeNearby(verb, v.catalog, v.description)]),
  ),
});
