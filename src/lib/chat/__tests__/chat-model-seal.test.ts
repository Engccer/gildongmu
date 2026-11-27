import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 채팅 답변 모델 봉인 2선(소스 가드). 1선은 구조다: 서버는 알려진 다섯 값만 다른 회사로 보내고(`parseChatModel`, 값 없음 = Gemini),
 * 웹·CLI는 Terra(`openai`) 한 값만 보내고(E92 §3), iOS는 3.0부터 정식판도 Kit 한 판정으로 값을 채운다.
 * 이 테스트는 그 구조가 소스에서 무너지지 않았는지 센다.
 * spec `docs/superpowers/specs/2026-11-23-e89-chat-model-choice-design.md` §3, `2026-11-27-e92-release-3.0-design.md` §2·§3.
 */
const ROOT = process.cwd();

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".build" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p);
const isTest = (p: string) => /__tests__|\.test\.|\.spec\./.test(p);

describe("채팅 답변 모델 봉인 (E89·E92)", () => {
  it("서버·웹 소스에서 `chatModel`을 쓰는 곳은 라우트·chat-models와 웹 채팅 훅뿐이고, 웹은 Terra(`openai`)만 보낸다(E92 §3)", () => {
    const allowed = new Set(["src/app/api/chat/route.ts", "src/lib/chat/chat-models.ts", "src/hooks/useChat.ts"]);
    const offenders = files(join(ROOT, "src"), [".ts", ".tsx"])
      .filter((p) => !isTest(p) && !allowed.has(rel(p)))
      .filter((p) => /\bchatModel\b/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
    expect(readFileSync(join(ROOT, "src/hooks/useChat.ts"), "utf8").match(/chatModel:\s*"[^"]*"/g)).toEqual(['chatModel: "openai"']);
  });

  it("CLI는 채팅 요청에 Terra(`openai`)만 보내고 MCP는 `chatModel`을 보내지 않는다(E92 §3)", () => {
    const users = files(join(ROOT, "packages"), [".ts", ".mjs", ".js"])
      .filter((p) => !isTest(p) && !p.includes("/dist/"))
      .filter((p) => /\bchatModel\b/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(users).toEqual(["packages/cli/src/lib/chat-client.ts"]);
    expect(readFileSync(join(ROOT, users[0]), "utf8").match(/chatModel:\s*"[^"]*"/g)).toEqual(['chatModel: "openai"']);
  });

  it("추천 질문 라우트는 선택 모델을 읽지 않는다(범위 밖, Gemini 그대로)", () => {
    const src = readFileSync(join(ROOT, "src/app/api/chat/suggestions/route.ts"), "utf8");
    expect(src).not.toMatch(/chatModel|chat-models/);
  });

  it("iOS 앱 타깃에서 `chatModel:` 인자를 채우는 줄은 ChatModel.swift 한 곳이고 정식판에도 컴파일된다(E92 A1)", () => {
    const app = files(join(ROOT, "ios/Gildongmu"), [".swift"]);
    const fillers = app.filter((p) => /chatModel:\s*(?!String)/.test(readFileSync(p, "utf8"))).map(rel);
    expect(fillers).toEqual(["ios/Gildongmu/Chat/ChatModel.swift"]);

    const lines = readFileSync(join(ROOT, "ios/Gildongmu/Chat/ChatModel.swift"), "utf8").split("\n");
    const fillLines = lines.flatMap((l, i) => (/chatModel:\s*(?!String)/.test(l) ? [i] : []));
    expect(fillLines).toHaveLength(1);
    // 그 줄을 감싸는 `#if` 블록이 없어야 한다(정식판에서 Terra 값이 실리지 않으면 2.8과 같이 Gemini로 간다).
    let depth = 0;
    for (const l of lines.slice(0, fillLines[0])) {
      const t = l.trim();
      if (t.startsWith("#if")) depth++;
      else if (t.startsWith("#endif")) depth--;
    }
    expect(depth, `ChatModel.swift:${fillLines[0] + 1}`).toBe(0);
    // 값은 Kit 한 판정(`ChatAnswerModel.requestValue`)이 정한다: Gemini는 nil(필드 없음), 정식판은 `openai`만.
    expect(lines.join("\n")).toMatch(/ChatAnswerModel\.requestValue\(stored: stored, choices: chatModelChoices, extended: extended\)/);
  });

  it("Kit 처음 값은 Terra(`openai`)이고 정식판 선택지는 Terra·Gemini 둘이다(E92 A2·A3)", () => {
    const kit = readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/ChatAnswerModel.swift"), "utf8");
    expect(kit).toMatch(/defaultID = "openai"/);
    expect(kit).toMatch(/releaseOrder = \["openai", "gemini"\]/);
  });
});
