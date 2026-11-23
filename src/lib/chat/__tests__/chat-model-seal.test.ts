import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * E89 정식판 봉인 2선(소스 가드). 1선은 구조다: 서버는 알려진 다섯 값만 다른 회사로 보내고(`parseChatModel`), 웹·CLI는 필드를 만들지 않고,
 * iOS는 실험판 컴파일 조건 안에서만 값을 채운다. 이 테스트는 그 구조가 소스에서 무너지지 않았는지 센다.
 * spec `docs/superpowers/specs/2026-11-23-e89-chat-model-choice-design.md` §3.
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

describe("채팅 답변 모델 봉인 (E89)", () => {
  it("서버·웹 소스에서 `chatModel`을 쓰는 곳은 라우트와 chat-models뿐이다", () => {
    const allowed = new Set(["src/app/api/chat/route.ts", "src/lib/chat/chat-models.ts"]);
    const offenders = files(join(ROOT, "src"), [".ts", ".tsx"])
      .filter((p) => !isTest(p) && !allowed.has(rel(p)))
      .filter((p) => /\bchatModel\b/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("CLI·MCP 패키지는 `chatModel`을 보내지 않는다", () => {
    const offenders = files(join(ROOT, "packages"), [".ts", ".mjs", ".js"])
      .filter((p) => !isTest(p) && !p.includes("/dist/"))
      .filter((p) => /\bchatModel\b/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("추천 질문 라우트는 선택 모델을 읽지 않는다(범위 밖, Gemini 그대로)", () => {
    const src = readFileSync(join(ROOT, "src/app/api/chat/suggestions/route.ts"), "utf8");
    expect(src).not.toMatch(/chatModel|chat-models/);
  });

  it("iOS 앱 타깃에서 `chatModel:` 인자를 채우는 줄은 ChatModel.swift에만 있고 실험판 컴파일 조건 안이다", () => {
    const app = files(join(ROOT, "ios/Gildongmu"), [".swift"]);
    const fillers = app.filter((p) => /chatModel:\s*(?!String)/.test(readFileSync(p, "utf8"))).map(rel);
    expect(fillers).toEqual(["ios/Gildongmu/Chat/ChatModel.swift"]);

    const lines = readFileSync(join(ROOT, "ios/Gildongmu/Chat/ChatModel.swift"), "utf8").split("\n");
    const fillLines = lines.flatMap((l, i) => (/chatModel:\s*(?!String)/.test(l) ? [i] : []));
    expect(fillLines.length).toBeGreaterThan(0);
    for (const i of fillLines) {
      // 그 줄을 감싸는 가장 가까운 #if 블록이 DEBUG || EXPERIMENTAL이어야 한다(#else 갈래가 아니어야 한다).
      let depth = 0;
      let guard: string | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const t = lines[j].trim();
        if (t.startsWith("#endif")) depth++;
        else if (t.startsWith("#else") && depth === 0) {
          guard = "else";
          break;
        } else if (t.startsWith("#if")) {
          if (depth === 0) {
            guard = t;
            break;
          }
          depth--;
        }
      }
      expect(guard, `ChatModel.swift:${i + 1}`).toMatch(/^#if (DEBUG \|\| EXPERIMENTAL|EXPERIMENTAL)$/);
    }
  });
});
