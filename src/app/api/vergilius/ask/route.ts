// POST /api/vergilius/ask — 베르길리우스 「말로 묻기」 답변(E82 spec `2026-11-14-e82-vergilius-v1-design.md` §4). NDJSON 스트림.
//
// 끝점은 공개 서버에 선다(「실험판」은 앱 쪽 봉인일 뿐이다). 순서가 계약이다:
//   IP 상한(60초 10회) → 본문 검증(zod) → 커버리지(한국 밖이면 200 `{"outOfCoverage":true}`, 모델·도구 미호출)
//   → 키 게이트(그 회사 키 없음 502) → 인스턴스 하루 상한(503) → 모델 스트림.
// 도구 실행은 채팅 라우터의 실행부를 그대로 부른다(`router.ts`는 고치지 않는다). 실행 컨텍스트는 이 끝점이 채운다:
// `userLocation` = 요청 좌표, `routeStart` 능력 켬, 장소 앵커 없음.
// ⚠ 질문 글·재료·좌표를 로그에 쓰지 않는다(V10·V34).
import { executeFunction } from "@/lib/chat/router";
import type { ExecutionContext } from "@/lib/chat/types";
import { isInKorea } from "@/lib/coverage";
import { dataLocale } from "@/lib/data-locale";
import { checkVergiliusRateLimit, clientIpFromHeaders, reserveVergiliusDaily } from "@/lib/rate-limit";
import { proposableIds } from "@/lib/vergilius/guard";
import { buildVergiliusInstruction } from "@/lib/vergilius/instruction";
import { runVergiliusLoop } from "@/lib/vergilius/loop";
import { buildVergiliusMaterial } from "@/lib/vergilius/materials";
import { toVergiliusNdjsonLine } from "@/lib/vergilius/ndjson";
import { availableVergiliusProviders, createVergiliusSession } from "@/lib/vergilius/providers";
import { PROPOSE_GUIDE_NAME, vergiliusToolSpecs } from "@/lib/vergilius/tools";
import { vergiliusAskSchema, type VergiliusStreamEvent } from "@/lib/vergilius/types";

export const maxDuration = 60; // 도구 왕복 2회 + 마지막 글 회차

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const clientIp = clientIpFromHeaders(request.headers);
  if (!checkVergiliusRateLimit(clientIp, Date.now())) return json({ error: "rate_limited" }, 429);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const parsed = vergiliusAskSchema.safeParse(raw);
  if (!parsed.success) {
    // 어느 필드가 틀렸는지만 돌려준다(값은 되비추지 않는다).
    return json({ error: "invalid_request", fields: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
  }
  const body = parsed.data;

  if (!isInKorea(body.location.lat, body.location.lng)) return json({ outOfCoverage: true }, 200);

  if (!availableVergiliusProviders().includes(body.provider)) return json({ error: "provider_unavailable" }, 502);

  if (!reserveVergiliusDaily(Date.now())) return json({ error: "daily_budget_exhausted" }, 503);

  const tools = vergiliusToolSpecs();
  const session = createVergiliusSession({
    provider: body.provider,
    instruction: buildVergiliusInstruction(body.locale),
    material: buildVergiliusMaterial(body),
    tools,
    signal: request.signal,
  });
  if (!session) return json({ error: "provider_unavailable" }, 502);

  const ctx: ExecutionContext = {
    userLocation: { lat: body.location.lat, lng: body.location.lng },
    routeStart: { manualOrigin: false },
    locale: body.locale,
    dataLocale: dataLocale(body.locale),
  };
  const allowedTools = new Set(tools.map((t) => t.name).filter((n) => n !== PROPOSE_GUIDE_NAME));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: VergiliusStreamEvent) => controller.enqueue(encoder.encode(toVergiliusNdjsonLine(e)));
      try {
        const result = await runVergiliusLoop({
          session,
          execute: executeFunction,
          ctx,
          allowedTools,
          proposableIds: proposableIds(body),
          emit: send,
        });
        if (result.proposal === null && result.text.trim() === "") {
          // 글도 제안도 없다. 침묵을 답으로 보내지 않는다(앱이 실패 문장을 읽는다, V17).
          send({ type: "error", code: "empty_answer" });
        } else {
          send({ type: "done", text: result.text, renders: result.renders, proposal: result.proposal });
        }
      } catch (e) {
        console.error("[vergilius] 답변 루프 오류:", e instanceof Error ? e.message : "unknown");
        send({ type: "error", code: "vergilius_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
