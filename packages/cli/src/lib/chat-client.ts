/**
 * 채팅 NDJSON 클라이언트 — `/api/chat` POST 후 스트림 라인 파싱(스펙 §7).
 *
 * 서버 계약(정본 웹 src/lib/chat/types.ts `ChatStreamEvent`)을 로컬 타입으로 재선언한다
 * (씬 클라이언트 독립성 — packages/cli는 웹 타입을 import하지 않는다). 출처 필드는
 * `SourceAttribution`과 동형: `label`(필수) + `url`(선택) — `title` 아님, src/lib/chat/sources.ts
 * 실제 생성값으로 대조 확인.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatSource {
  label: string;
  url?: string;
}

export interface ChatOnceOptions {
  userLocation?: { lat: number; lng: number };
  locale: string;
  apiUrl: string;
}

export interface ChatOnceResult {
  text: string;
  sources: ChatSource[];
}

interface ChatStreamEvent {
  type: "status" | "done" | "error";
  text?: string;
  sources?: ChatSource[];
  code?: string;
}

export async function chatOnce(messages: ChatTurn[], opts: ChatOnceOptions): Promise<ChatOnceResult> {
  const res = await fetch(new URL("/api/chat", opts.apiUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, userLocation: opts.userLocation, locale: opts.locale }),
  });
  if (!res.ok || !res.body) throw new Error(`채팅 요청 실패 (HTTP ${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: ChatOnceResult | null = null;

  for (;;) {
    const { value, done: eof } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ChatStreamEvent;
      if (event.type === "done") done = { text: event.text ?? "", sources: event.sources ?? [] };
      if (event.type === "error") throw new Error(`채팅 오류: ${event.code}`);
    }
    if (eof) break;
  }
  if (!done) throw new Error("채팅 응답이 완료되지 않았습니다.");
  return done;
}
