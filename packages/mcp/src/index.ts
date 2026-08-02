/**
 * gildongmu-mcp — Claude Code/Cursor/Codex 등이 spawn하는 stdio MCP 서버.
 *
 * ENDPOINT_CATALOG(cli와 byte-mirror, catalog-drift.test.ts가 강제)에서 mcp:true인
 * 항목만 도구로 자동 노출한다. 도구 handler는 프로덕션 REST(GILDONGMU_API_URL)를
 * 그대로 호출·중계 — 자체 비즈니스 로직 없음(단일 정본은 REST 라우트).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ENDPOINT_CATALOG } from "./endpoint-catalog-shared.js";

const API_URL = process.env.GILDONGMU_API_URL ?? "https://gildongmu.dodoplanet.space";

/**
 * 서버 커버리지 마커 감지 — 한국 밖 좌표는 HTTP 200 + `{outOfCoverage:true}` 정상
 * 응답이다(오류 아님). cli `lib/api-client.ts`의 동형 헬퍼를 미러링한다(별도 패키지라
 * 공유 모듈 없음, endpoint-catalog-shared.ts와 같은 byte-mirror 관례).
 */
function isOutOfCoverage(body: unknown): boolean {
  return typeof body === "object" && body !== null &&
    (body as { outOfCoverage?: unknown }).outOfCoverage === true;
}

const OUT_OF_COVERAGE_NOTICE =
  "서비스 지역(대한민국) 밖 좌표입니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.";

/**
 * 서비스 지역 미제공 마커 — 한국 **안**이지만 그 도메인 데이터가 그 지역에 없다
 * (따릉이·문화행사 = 서울 전용). 0건으로 흡수하면 LLM이 "오늘은 없나 보다"로
 * 요약해 데이터 한계가 지역의 부재로 위장된다. cli 동형 헬퍼 미러.
 */
type UnavailableHereReason = "seoulOnly" | "noBusData";

const UNAVAILABLE_HERE_NOTICES: Record<UnavailableHereReason, string> = {
  seoulOnly: "서울 지역에서만 제공됩니다.",
  noBusData: "이 지역은 정류소 정보가 제공되지 않습니다.",
};

/** 모르는 사유는 null이라 일반 경로로 흘러간다(낡은 미러가 틀린 문장을 말하지 않게). */
function unavailableHereReason(body: unknown): UnavailableHereReason | null {
  if (typeof body !== "object" || body === null) return null;
  const reason = (body as { unavailableHere?: unknown }).unavailableHere;
  return reason === "seoulOnly" || reason === "noBusData" ? reason : null;
}

// ⚠ package.json version과 동조 필수(version-drift.test.ts가 강제). 릴리스 때 함께 올린다.
const server = new McpServer({ name: "gildongmu", version: "0.8.0" });

for (const spec of ENDPOINT_CATALOG.filter((e) => e.mcp)) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of spec.params) {
    let s: z.ZodTypeAny = p.type === "number" ? z.number().describe(p.description) : z.string().describe(p.description);
    if (!p.required) s = s.optional();
    shape[p.key] = s;
  }
  server.registerTool(
    spec.name.replaceAll("-", "_"),
    { description: spec.description, inputSchema: shape, annotations: { readOnlyHint: true } },
    async (args: Record<string, unknown>) => {
      const url = new URL(spec.path, API_URL);
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
      const res = await fetch(url.toString());
      const text = await res.text();
      if (!res.ok) return { content: [{ type: "text" as const, text: `오류 (HTTP ${res.status}): ${text}` }], isError: true };
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = undefined; }
      if (isOutOfCoverage(parsed)) return { content: [{ type: "text" as const, text: OUT_OF_COVERAGE_NOTICE }] };
      const unavailable = unavailableHereReason(parsed);
      if (unavailable) {
        return { content: [{ type: "text" as const, text: UNAVAILABLE_HERE_NOTICES[unavailable] }] };
      }
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
