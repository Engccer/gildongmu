import { defineCommand } from "citty";
import { apiRequest, ApiError } from "../lib/api-client.js";
import { readConfig } from "../lib/config.js";
import { resolveLocation } from "../lib/resolve-location.js";
import { FORMATTERS } from "../lib/formatters.js";
import { emit, fail, resolveOutputMode } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { sharedArgs } from "./shared.js";

/**
 * 웹 UI 검색창의 결정론 병렬 동형(스펙 §4): 장소+주소는 매 검색 병렬.
 * 전 섹션 0건일 때만 웹 검색(Perplexity)으로 폴백한다. 섹션 순서: 건수 내림차순.
 */
export const searchCommand = defineCommand({
  meta: { name: "search", description: "장소·주소 통합 검색 (0건이면 웹 검색 폴백)" },
  args: { query: { type: "positional", description: "검색어", required: true }, ...sharedArgs },
  async run({ args }) {
    const cfg = await readConfig();
    const mode = resolveOutputMode(args.output, cfg);
    const lang = args.lang === "en" ? "en" : "ko";

    let loc: { lat: number; lng: number } | null = null;
    try {
      loc = await resolveLocation(args); // 위치는 선택 — resolveLocation이 throw하면 null 처리
    } catch {
      loc = null;
    }
    const locQ = loc ? { lat: String(loc.lat), lng: String(loc.lng) } : {};

    const settled = await Promise.allSettled([
      apiRequest<{ places: unknown[] }>("/api/places", { query: { query: args.query, lang, ...locQ } }),
      apiRequest<{ addresses: unknown[] }>("/api/address/search", { query: { query: args.query } }),
    ]);
    const places = settled[0].status === "fulfilled" ? settled[0].value.places : [];
    const addresses = settled[1].status === "fulfilled" ? settled[1].value.addresses : [];

    // 장소·주소가 둘 다 실패했을 때만 명령 자체를 실패 처리한다.
    const allFailed = settled.every((s) => s.status === "rejected");
    if (allFailed) {
      const first = settled[0] as PromiseRejectedResult;
      const err = first.reason;
      fail(
        err instanceof ApiError ? err.message : "검색에 실패했습니다.",
        err instanceof ApiError ? err.exitCode : ExitCode.Error,
      );
    }

    const lines: string[] = [];
    const sections = [
      { title: "장소", count: places.length, lines: FORMATTERS["places-search"]({ places } as never) },
      { title: "주소", count: addresses.length, lines: FORMATTERS["address-search"]({ addresses } as never) },
    ].sort((a, b) => b.count - a.count);
    for (const s of sections.filter((s) => s.count > 0)) lines.push(`${s.title} ${s.count}건`, ...s.lines, "");

    // 전 섹션 0건 → 웹 검색 폴백(웹 UI 동형). ⚠ 응답 envelope은 `{ web: [...] }`다
    // (카탈로그 envelope: "web" 대조 확정 — `{ results }` 아님).
    let web: unknown[] | undefined;
    if (!places.length && !addresses.length) {
      try {
        const webRes = await apiRequest<{ web: unknown[] }>("/api/search/web", { query: { query: args.query } });
        web = webRes.web ?? [];
        if (web.length) {
          lines.push("장소·주소 결과가 없어 웹 검색 결과를 보여드립니다.", "");
          lines.push(...FORMATTERS["web-search"](webRes as never));
        } else {
          lines.push("검색 결과가 없습니다.");
        }
      } catch {
        lines.push("검색 결과가 없습니다.");
      }
    }

    // 연속·꼬리 빈 줄 정리(text 출력의 시각적 잡음 제거, json 모드엔 영향 없음).
    const cleaned = lines.filter((l, i, a) => !(l === "" && a[i - 1] === ""));
    while (cleaned.length && cleaned[cleaned.length - 1] === "") cleaned.pop();

    // json 모드: web 폴백이 실행됐으면 그 결과도 3-state 정합상 포함한다.
    const data = web !== undefined ? { places, addresses, web } : { places, addresses };
    emit(data, cleaned, mode);
  },
});
