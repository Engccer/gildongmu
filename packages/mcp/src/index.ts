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

// ⚠ package.json version과 동조 필수(version-drift.test.ts가 강제). 릴리스 때 함께 올린다.
const server = new McpServer({ name: "gildongmu", version: "0.7.0" });

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
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
