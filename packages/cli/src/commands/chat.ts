import { defineCommand } from "citty";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import { readConfig } from "../lib/config.js";
import { resolveLocation } from "../lib/resolve-location.js";
import { chatOnce, type ChatTurn, type ChatOnceResult } from "../lib/chat-client.js";
import { emit, fail, resolveOutputMode } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { sharedArgs } from "./shared.js";

/** 마크다운 경량 정리 — 헤딩·볼드·이탤릭 마커 제거 수준(의존성 추가 없음, 스펙 §7). */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

/** 답변 하단 출처 목록 — 빈 줄 뒤 "출처:" + `label, url` 줄들(url 없으면 label만). */
function formatSources(sources: ChatOnceResult["sources"]): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s) => (s.url ? `${s.label}, ${s.url}` : s.label));
  return `\n\n출처:\n${lines.join("\n")}`;
}

function printResult(result: ChatOnceResult, mode: "text" | "json"): void {
  if (mode === "json") {
    emit(result, [], mode);
    return;
  }
  emit(result, [stripMarkdown(result.text) + formatSources(result.sources)], mode);
}

/** 위치는 선택 컨텍스트 — 해석 실패(잘못된 --lat/--lng, --near 미발견)해도 채팅은 계속한다. */
async function resolveUserLocation(
  args: { lat?: string; lng?: string; near?: string },
): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const loc = await resolveLocation(args);
    return loc ? { lat: loc.lat, lng: loc.lng } : undefined;
  } catch {
    return undefined;
  }
}

/** rl.question()은 EOF(Ctrl+D) 시 정착하지 않는다 — close 이벤트와 경합해 EOF를 검출. */
async function nextLine(rl: ReadlineInterface): Promise<{ eof: true } | { eof: false; value: string }> {
  return Promise.race([
    rl.question("> ").then((value) => ({ eof: false as const, value })),
    new Promise<{ eof: true }>((resolve) => rl.once("close", () => resolve({ eof: true }))),
  ]);
}

async function runRepl(
  opts: { userLocation?: { lat: number; lng: number }; locale: string; apiUrl: string },
  mode: "text" | "json",
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const messages: ChatTurn[] = [];
  try {
    for (;;) {
      const line = await nextLine(rl);
      if (line.eof) break;
      const question = line.value.trim();
      if (!question) continue;
      if (question === "/exit") break;
      messages.push({ role: "user", text: question });
      try {
        const result = await chatOnce(messages, opts);
        messages.push({ role: "assistant", text: result.text });
        printResult(result, mode);
      } catch (err) {
        process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
      }
    }
  } finally {
    rl.close();
  }
}

export const chatCommand = defineCommand({
  meta: { name: "chat", description: "장소·이동 관련 질문에 답하는 채팅(단발/REPL)" },
  args: {
    question: { type: "positional", description: "질문(생략 시 REPL 진입)", required: false },
    near: sharedArgs.near,
    lat: sharedArgs.lat,
    lng: sharedArgs.lng,
    lang: sharedArgs.lang,
    output: sharedArgs.output,
  },
  async run({ args }) {
    const cfg = await readConfig();
    const mode = resolveOutputMode(args.output, cfg);
    const opts = {
      userLocation: await resolveUserLocation(args),
      locale: args.lang ?? "ko",
      apiUrl: cfg.apiUrl,
    };

    if (args.question) {
      try {
        const result = await chatOnce([{ role: "user", text: args.question }], opts);
        printResult(result, mode);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err), ExitCode.Error);
      }
      return;
    }

    if (!process.stdout.isTTY) {
      fail('질문을 인자로 주거나 TTY에서 실행하세요: gil chat "질문"', ExitCode.Usage);
    }
    await runRepl(opts, mode);
  },
});
