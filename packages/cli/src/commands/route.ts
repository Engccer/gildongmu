import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { geocodeQuery } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { runEndpoint, sharedArgs } from "./shared.js";

const COORD_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

async function toCoordString(input: string): Promise<string> {
  if (COORD_RE.test(input)) return input;
  const g = await geocodeQuery(input);
  return `${g.lat},${g.lng}`;
}

function makeRoute(verb: "car" | "transit") {
  return defineCommand({
    meta: { name: verb, description: verb === "car" ? "자동차 경로 턴바이턴 브리핑" : "대중교통 경로(추천+대안)" },
    args: {
      origin: { type: "positional", description: "출발지(장소명·주소 또는 '위도,경도')", required: true },
      dest: { type: "positional", description: "도착지(장소명·주소 또는 '위도,경도')", required: true },
      ...sharedArgs,
    },
    async run({ args }) {
      let origin: string, dest: string;
      try {
        [origin, dest] = await Promise.all([toCoordString(args.origin), toCoordString(args.dest)]);
      } catch (err) {
        // ApiError(네트워크 7·서버 오류 1 등)는 고유 exit 코드 보존, 지오코딩 0건(일반 Error)만 Usage(2).
        if (err instanceof ApiError) fail(err.message, err.exitCode);
        fail(err instanceof Error ? err.message : String(err), ExitCode.Usage);
      }
      const extra = verb === "car" && args.lang === "en" ? { lang: "en" } : {};
      await runEndpoint(verb === "car" ? "route-car" : "route-transit", { origin, dest, ...extra }, args.output);
    },
  });
}

export const routeCommand = defineCommand({
  meta: { name: "route", description: "경로 브리핑" },
  subCommands: { car: makeRoute("car"), transit: makeRoute("transit") },
});
