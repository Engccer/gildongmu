import { defineCommand } from "citty";
import { apiRequest, ApiError } from "../lib/api-client.js";
import { readConfig } from "../lib/config.js";
import { FORMATTERS } from "../lib/formatters.js";
import { emit, fail, resolveOutputMode } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { catalogPath, runEndpoint, sharedArgs } from "./shared.js";

/**
 * `station info`의 4병렬 섹션 정의 — 카탈로그 이름·envelope 키·표시 제목·json 합성 키를
 * 한 곳에 묶는다. envelope 확정값(카탈로그 정본): meta는 `{ meta }`, timetable은 `{ timetable }`,
 * 나머지 둘은 `{ facilities }`.
 */
const INFO_SECTIONS = [
  { catalog: "station-meta", envelopeKey: "meta", title: "역 정보", jsonKey: "meta" },
  { catalog: "station-timetable", envelopeKey: "timetable", title: "첫차·막차", jsonKey: "timetable" },
  { catalog: "station-facilities", envelopeKey: "facilities", title: "철도역 교통약자 시설", jsonKey: "facilities" },
  {
    catalog: "station-metro-facilities",
    envelopeKey: "facilities",
    title: "서울 지하철 교통약자 시설",
    jsonKey: "metroFacilities",
  },
] as const;

/**
 * 역명 메타 + 첫차·막차 + 코레일 시설 + 서울지하철 시설 4종을 병렬 조회한다(allSettled, 부분 실패 보존).
 * fulfilled+값 존재만 렌더, rejected는 "<섹션> 조회 실패" 한 줄, null/빈은 생략(3-state 불변식).
 */
const infoCommand = defineCommand({
  meta: { name: "info", description: "역 정보 + 첫차·막차 + 교통약자 시설(코레일·서울지하철) 조회" },
  args: {
    station: { type: "positional", description: "역명", required: true },
    output: sharedArgs.output,
  },
  async run({ args }) {
    const cfg = await readConfig();
    const mode = resolveOutputMode(args.output, cfg);
    const query = { station: args.station };

    const settled = await Promise.allSettled(
      INFO_SECTIONS.map((s) => apiRequest<Record<string, unknown>>(catalogPath(s.catalog), { query })),
    );

    if (settled.every((r) => r.status === "rejected")) {
      const first = settled[0] as PromiseRejectedResult;
      const err = first.reason;
      fail(
        err instanceof ApiError ? err.message : "역 정보 조회에 실패했습니다.",
        err instanceof ApiError ? err.exitCode : ExitCode.Error,
      );
    }

    const lines: string[] = [];
    const jsonData: Record<string, unknown> = {};

    settled.forEach((result, i) => {
      const section = INFO_SECTIONS[i];
      if (result.status === "rejected") {
        jsonData[section.jsonKey] = null;
        lines.push(`${section.title} 조회 실패`);
        return;
      }
      const value = result.value[section.envelopeKey];
      jsonData[section.jsonKey] = value ?? null;
      if (value === null || value === undefined) return; // null/빈은 생략
      lines.push(section.title);
      lines.push(...FORMATTERS[section.catalog](result.value as never));
    });

    // 3-state: 네 섹션이 모두 fulfilled인데 값이 전부 null(존재하지 않는 역명)이면
    // 무음 종료가 아니라 미발견을 명시한다. 조회 자체는 성공(0건)이므로 exit 0 유지.
    if (lines.length === 0) lines.push(`역 정보를 찾을 수 없습니다: ${args.station}`);

    emit(jsonData, lines, mode);
  },
});

/** 역명 기반 지하철 실시간 도착 — 단순 카탈로그 위임. */
const arrivalsCommand = defineCommand({
  meta: { name: "arrivals", description: "역 실시간 도착(지하철)" },
  args: {
    station: { type: "positional", description: "역명", required: true },
    output: sharedArgs.output,
  },
  async run({ args }) {
    await runEndpoint("subway-arrival", { station: args.station }, args.output);
  },
});

/** 역 첫차·막차 시간표 — 단순 카탈로그 위임. */
const timetableCommand = defineCommand({
  meta: { name: "timetable", description: "역 첫차·막차 시간표" },
  args: {
    station: { type: "positional", description: "역명", required: true },
    output: sharedArgs.output,
  },
  async run({ args }) {
    await runEndpoint("station-timetable", { station: args.station }, args.output);
  },
});

export const stationCommand = defineCommand({
  meta: { name: "station", description: "역 정보·시설·실시간 도착" },
  subCommands: { info: infoCommand, timetable: timetableCommand, arrivals: arrivalsCommand },
});
