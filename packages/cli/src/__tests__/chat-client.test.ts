import { describe, it, expect, afterEach, vi } from "vitest";
import { chatOnce } from "../lib/chat-client.js";

/**
 * chat-client.ts 테스트 — NDJSON 스트림 소비(스펙 §7, 서버 계약은 src/lib/chat/types.ts).
 * fetch를 stub하고 실제 ReadableStream으로 청크를 흘려보내 파싱을 검증한다.
 */

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function stubFetchWithBody(body: string | string[], ok = true, status = 200): void {
  const chunks = Array.isArray(body) ? body : [body];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, body: streamFromChunks(chunks) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatOnce", () => {
  it("done 이벤트의 text·sources를 반환한다(status 이벤트는 무시)", async () => {
    stubFetchWithBody(
      '{"type":"status","categories":["장소"]}\n' +
        '{"type":"done","text":"답변입니다","renders":[],"sources":[{"label":"source.kakao"}]}\n',
    );

    const result = await chatOnce([{ role: "user", text: "질문" }], {
      locale: "ko",
      apiUrl: "https://x.test",
    });

    expect(result).toEqual({ text: "답변입니다", sources: [{ label: "source.kakao" }] });
  });

  it("error 이벤트는 throw한다", async () => {
    stubFetchWithBody('{"type":"error","code":"upstream_failed"}\n');

    await expect(
      chatOnce([{ role: "user", text: "질문" }], { locale: "ko", apiUrl: "https://x.test" }),
    ).rejects.toThrow(/upstream_failed/);
  });

  it("한 줄이 청크 경계에서 분할되어도 파싱한다", async () => {
    const line = '{"type":"done","text":"청크분할","renders":[],"sources":[]}\n';
    const mid = Math.floor(line.length / 2);

    stubFetchWithBody([line.slice(0, mid), line.slice(mid)]);

    const result = await chatOnce([{ role: "user", text: "질문" }], {
      locale: "ko",
      apiUrl: "https://x.test",
    });

    expect(result).toEqual({ text: "청크분할", sources: [] });
  });

  it("HTTP 오류 응답은 throw한다", async () => {
    stubFetchWithBody("", false, 500);

    await expect(
      chatOnce([{ role: "user", text: "질문" }], { locale: "ko", apiUrl: "https://x.test" }),
    ).rejects.toThrow(/500/);
  });
});
