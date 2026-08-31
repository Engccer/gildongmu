import { defineCommand } from "citty";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { runEndpoint, sharedArgs } from "./shared.js";

/** 버스 노선 경유 정류소 — `--source tago`는 `--city-code`가 필수(라우트 400 전에 클라이언트에서 잡는다). */
const routeCommand = defineCommand({
  meta: { name: "route", description: "버스 노선 경유 정류소" },
  args: {
    source: { type: "string", description: "tago|seoul", required: true },
    routeId: { type: "string", description: "노선 ID(nearby bus 결과의 routeId)", required: true },
    cityCode: { type: "string", description: "tago일 때 필수(nearby bus 결과의 cityCode)" },
    output: sharedArgs.output,
  },
  async run({ args }) {
    if (args.source === "tago" && !args.cityCode) {
      fail("--source tago는 --city-code가 필요합니다 (nearby bus 결과의 cityCode 참고).", ExitCode.Usage);
    }
    await runEndpoint(
      "bus-route-stops",
      { source: args.source, routeId: args.routeId, cityCode: args.cityCode },
      args.output,
      undefined,
    );
  },
});

export const busCommand = defineCommand({
  meta: { name: "bus", description: "버스 노선" },
  subCommands: { route: routeCommand },
});
