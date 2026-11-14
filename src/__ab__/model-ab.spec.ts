/**
 * Gemini 모델 A/B 실호출 하네스.
 *
 * 프로덕션 채팅 경로(`/api/chat`)의 systemInstruction·도구 선언·`runAgentLoop`를 그대로 재사용해
 * 모델만 바꿔 돌린다. 프로덕션 코드에 계측 훅을 심지 않고, `ai` 클라이언트를 감싼 프록시가
 * 라운드별 지연·토큰·도구 호출을 기록한다.
 *
 * 실행: `MODELS=<현행>,<후보> REPS=3 npm run eval:ab` (`ONLY=09` 부분 실행, 첫 항목이 regression 기준)
 * 모델 표기에 `@<생각 수준>`을 붙이면 그 수준으로 돈다(`gemini-4-hydrogen@low`). 없으면 프로덕션 경로 그대로(생각 설정 없음).
 * `claude-`로 시작하는 모델은 Claude 러너(`claude-runner.ts`)로 돈다: `claude-opus-5-5@low`, `claude-sonnet-5-5@low+between_tools`.
 * 같은 systemInstruction·도구 선언·도구 실행기·루프 상한·채점기를 쓴다. 키는 `ANTHROPIC_API_KEY`(.env.local).
 * 결과: `.ab-out/<타임스탬프>.json`(원시, 스킬 `llm-model-eval` 결과 파일 계약) + `.md` 리포트.
 * 판정에 쓴 파일은 `docs/evals/`로 옮겨 커밋한다.
 *
 * 채점은 결정론이다(`grounding.ts`): expect·forbid·arg 외에 **날조 축**(도구 출력 대비 답변 엔티티
 * 대조 + 강등 전용 어휘)·언어 불변 인자·safety pass^k. 도구 출력은 프로덕션 루프에 훅을 심지 않고
 * 다음 라운드 요청의 `functionResponse` 파트에서 읽는다. 사람이 읽는 `judge`는 자동화 안 된 잔여만.
 *
 * ⚠ 유료 API 실호출이다. 기본 게이트 레인(`npm run test:run`)에 포함하지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { it } from "vitest";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import type { Content } from "@google/genai";
import { availableDeclarations } from "@/lib/chat/declarations";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { buildChatSystemInstruction } from "@/lib/chat/system-instruction";
import { GEMINI_MODEL } from "@/lib/gemini/client";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext } from "@/lib/chat/types";
import { checkLangInvariantArgs, scoreGrounding, type ToolOutput } from "./grounding";
import { buildReport, parseModelSpec, type Checks, type ResultFile, type RunResult } from "./report";
import { CASES, GILDONG, type Case } from "./cases";
import {
  isClaudeModel,
  parseClaudeSpec,
  runClaudeAgentLoop,
  toAnthropicTools,
  type ClaudeClientLike,
  type ClaudeLoopTrace,
  type ClaudeRoundStat,
} from "./claude-runner";

// 비교는 "현재 프로덕션 모델 vs 후보"이고 후보는 실행마다 MODELS로 넘긴다. 기본 후보를 두지 않는다 — 기각된
// 모델 이름(3.7·3.8)이 기본값에 남으면 MODELS를 빠뜨린 실행이 이미 판정한 비교에 다시 돈을 쓴다.
if (!process.env.MODELS) throw new Error(`MODELS=${GEMINI_MODEL},<후보> 를 지정한다(첫 항목 = 현행).`);
const MODELS = process.env.MODELS.split(",");
const REPS = Number(process.env.REPS ?? "3");

interface RoundStat {
  ms: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  /** 기록만 한다(채점·실패 판정에 쓰지 않는다 — Claude 러너의 refusal·max_tokens 실패와의 비대칭을 리포트에서 읽기 위해). */
  finishReason: string | null;
  toolCalls: string[];
  toolArgs: { name: string; args: Record<string, unknown> }[];
}

/** 결과 파일 계약(`report.ts` `RunResult`) + 이 하네스가 더 기록하는 것. */
interface HarnessResult extends RunResult {
  roundStats: RoundStat[] | ClaudeRoundStat[];
  /** 도구 반환 원문 — 채점기를 고친 뒤 실호출 없이 재채점할 수 있게 남긴다(C5 재실행에서 이것이 없어 재채점을 못 했다). */
  toolOutputs: ToolOutput[];
  modelMs: number;
  renders: string[];
  sources: number;
}

/**
 * 밀리초를 초 표기로. ⚠ 나누기와 자릿수 절단을 **한 줄에 붙여 쓰지 말 것** —
 * `format-drift` 가드가 그 관용구를 "소수 km 직접 조립"으로 잡는다(거리 표기
 * 사본 금지 규칙). 여기선 거리가 아니라 시간이지만 가드를 약화시키지 않는다.
 */
function secs(ms: number, digits = 1): string {
  const s = ms / 1000;
  return s.toFixed(digits);
}

/**
 * generateContent를 감싸 지연·토큰·도구 호출을 기록하는 프록시. 도구 **출력**은 루프가
 * 다음 라운드 요청의 `contents`에 `functionResponse`로 되돌려 주므로 거기서 읽는다(프로덕션
 * 루프 무수정). history는 append-only라 (content, part) 위치로 중복을 거른다.
 */
function instrument(real: GoogleGenAI, rounds: RoundStat[], toolOutputs: ToolOutput[], thinkingLevel: string | null) {
  const seen = new Set<string>();
  return {
    models: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateContent: async (req: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req.contents as any[]).forEach((c, i) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c.parts ?? []).forEach((p: any, j: number) => {
            if (!p.functionResponse || seen.has(`${i}:${j}`)) return;
            seen.add(`${i}:${j}`);
            toolOutputs.push({ name: p.functionResponse.name, response: p.functionResponse.response });
          }),
        );
        const t0 = Date.now();
        // 생각 수준 접미사가 있으면 그 값만 얹는다(프로덕션 루프는 생각 설정을 보내지 않는다).
        const res = await real.models.generateContent(
          thinkingLevel ? { ...req, config: { ...req.config, thinkingConfig: { thinkingLevel } } } : req,
        );
        const u = res.usageMetadata ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = res.candidates?.[0]?.content?.parts ?? [];
        rounds.push({
          ms: Date.now() - t0,
          promptTokens: u.promptTokenCount ?? 0,
          outputTokens: u.candidatesTokenCount ?? 0,
          thoughtTokens: u.thoughtsTokenCount ?? 0,
          finishReason: res.candidates?.[0]?.finishReason ?? null,
          toolCalls: parts.filter((p) => p.functionCall).map((p) => p.functionCall.name),
          toolArgs: parts
            .filter((p) => p.functionCall)
            .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {} })),
        });
        return res;
      },
    },
  } as unknown as GoogleGenAI;
}

/** 세션 공통 실행 맥락 — 두 러너가 같은 값을 쓰게 한 곳에서 만든다. */
function ctxOf(c: Case): ExecutionContext {
  return {
    userLocation: c.withLocation === false ? undefined : (c.location ?? GILDONG),
    placeAnchor: c.place ? { lat: c.place.lat, lng: c.place.lng, name: c.place.name } : undefined,
    locale: "ko",
    dataLocale: dataLocale("ko"),
  };
}

function checksOf(c: Case, toolCalls: string[], toolArgs: RoundStat["toolArgs"], toolOutputs: ToolOutput[], text: string): Checks {
  const checks: Checks = {};
  if (c.expectAny) checks.expect = c.expectAny.some((t) => toolCalls.includes(t));
  if (c.forbid) checks.forbid = !c.forbid.some((t) => toolCalls.includes(t));
  if (c.expectArg) checks.arg = toolArgs.some((t) => t.name === c.expectArg!.tool && t.args[c.expectArg!.key] === c.expectArg!.value);
  if (c.langInvariantArgs) {
    const v = checkLangInvariantArgs(c.langInvariantArgs, toolArgs);
    if (v !== null) checks.langInvariant = v;
  }
  // 장소 앵커 이름·사용자 발화는 도구 밖에서 이미 주어진 문자열이라 leak이 아니다.
  if (c.grounding) checks.grounding = scoreGrounding(c.grounding, toolOutputs, text, [c.place?.name ?? "", ...c.turns]);
  return checks;
}

async function runOne(real: GoogleGenAI, model: string, c: Case, rep: number): Promise<HarnessResult> {
  const spec = parseModelSpec(model);
  const rounds: RoundStat[] = [];
  const toolOutputs: ToolOutput[] = [];
  const ctx = ctxOf(c);
  const history: Content[] = c.turns.map((t) => ({ role: "user", parts: [{ text: t }] }));
  const t0 = Date.now();
  const base = () => ({
    model,
    rep,
    caseId: c.id,
    roundStats: rounds,
    rounds: rounds.length,
    modelMs: rounds.reduce((s, r) => s + r.ms, 0),
    latencyMs: Date.now() - t0,
    toolCalls: rounds.flatMap((r) => r.toolCalls),
    toolArgs: rounds.flatMap((r) => r.toolArgs),
    toolOutputs,
    // gildongmu 하네스는 스텁이 없다 — 모든 도구가 실호출이라 "빈 응답을 받은 스텁 없는 도구"는 정의상 0.
    unstubbed: [] as string[],
    promptTokens: rounds.reduce((s, r) => s + r.promptTokens, 0),
    outputTokens: rounds.reduce((s, r) => s + r.outputTokens, 0),
    thoughtTokens: rounds.reduce((s, r) => s + r.thoughtTokens, 0),
  });
  try {
    const result = await runAgentLoop({
      ai: instrument(real, rounds, toolOutputs, spec.thinkingLevel),
      model: spec.model,
      systemInstruction: buildChatSystemInstruction("ko", c.place, { journey: false }),
      tools: [{ functionDeclarations: availableDeclarations(new Set()) }],
      history,
      ctx,
    });
    const b = base();
    return {
      ...b,
      ok: true,
      checks: checksOf(c, b.toolCalls, b.toolArgs, toolOutputs, result.text),
      text: result.text,
      renders: result.renders.map((r) => r.type),
      sources: result.sources.length,
    };
  } catch (e) {
    return { ...base(), ok: false, error: String(e), checks: {}, text: "", renders: [], sources: 0 };
  }
}

/** Claude 세션 1회. 결과 모양은 Gemini `runOne`과 같고, 캐시 토큰·첫 글자 시각을 더 적는다. */
async function runClaudeOne(client: ClaudeClientLike, model: string, c: Case, rep: number): Promise<HarnessResult> {
  const trace: ClaudeLoopTrace = { rounds: [], toolOutputs: [] };
  const rounds = trace.rounds;
  const t0 = Date.now();
  const sum = (f: (r: ClaudeRoundStat) => number) => rounds.reduce((s, r) => s + f(r), 0);
  const base = () => ({
    model,
    rep,
    caseId: c.id,
    roundStats: rounds,
    rounds: rounds.length,
    modelMs: sum((r) => r.ms),
    latencyMs: Date.now() - t0,
    toolCalls: rounds.flatMap((r) => r.toolCalls),
    toolArgs: rounds.flatMap((r) => r.toolArgs),
    toolOutputs: trace.toolOutputs,
    unstubbed: [] as string[],
    promptTokens: sum((r) => r.promptTokens),
    outputTokens: sum((r) => r.outputTokens),
    thoughtTokens: sum((r) => r.thoughtTokens),
    cacheReadTokens: sum((r) => r.cacheReadTokens),
    cacheWriteTokens: sum((r) => r.cacheWriteTokens),
  });
  try {
    const result = await runClaudeAgentLoop(
      {
        client,
        spec: parseClaudeSpec(model),
        systemInstruction: buildChatSystemInstruction("ko", c.place, { journey: false }),
        tools: toAnthropicTools(availableDeclarations(new Set())),
        turns: c.turns,
        ctx: ctxOf(c),
      },
      trace,
    );
    const b = base();
    return {
      ...b,
      ok: true,
      ...(result.ttftMs !== undefined ? { ttftMs: result.ttftMs } : {}),
      checks: checksOf(c, b.toolCalls, b.toolArgs, trace.toolOutputs, result.text),
      text: result.text,
      renders: result.renders.map((r) => r.type),
      sources: result.sources,
    };
  } catch (e) {
    return { ...base(), ok: false, error: String(e), checks: {}, text: "", renders: [], sources: 0 };
  }
}

function checkMark(r: HarnessResult): string {
  if (!r.ok) return "×";
  const c = r.checks;
  const failed = [c.expect, c.forbid, c.arg, c.langInvariant, c.grounding?.pass].some((v) => v === false);
  return failed ? "△" : "○";
}

function gitSha(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

it("모델 A/B 실호출", async () => {
  // 키는 그 회사 모델이 MODELS에 있을 때만 요구한다.
  const needGemini = MODELS.some((m) => !isClaudeModel(m));
  const needClaude = MODELS.some(isClaudeModel);
  if (needGemini && !process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 없음 — .env.local 확인");
  if (needClaude && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 없음 — .env.local 확인");
  // 표기 오타는 돈을 쓰기 전에 잡는다.
  MODELS.filter(isClaudeModel).forEach(parseClaudeSpec);
  const real = needGemini ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }) : (null as unknown as GoogleGenAI);
  // 재시도는 끈다: Gemini 클라이언트(retryOptions 없음)도 재시도하지 않으므로, 일시 오류는 두 회사 모두 그 세션의 실패로 남고
  // 재시도 대기가 지연에 숨지 않는다. 리포트에서 API 오류와 품질 실패를 갈라 읽는다.
  const claude = needClaude ? (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 }) as ClaudeClientLike) : null;

  const only = process.env.ONLY;
  const cases = only
    ? CASES.filter((c) => only.split(",").some((frag) => c.id.includes(frag.trim())))
    : CASES;
  const measuredAt = new Date().toISOString();
  const results: HarnessResult[] = [];
  // 모델을 케이스 안에서 번갈아 부른다(interleaved) — 몰아 재면 시간대 부하가 모델 차이로 읽힌다.
  for (let rep = 1; rep <= REPS; rep++) {
    for (const c of cases) {
      for (const model of MODELS) {
        const r = isClaudeModel(model) ? await runClaudeOne(claude!, model, c, rep) : await runOne(real, model, c, rep);
        results.push(r);
        const g = r.checks.grounding;
        console.log(
          `${checkMark(r)} rep${rep} ${c.id} ${model} ` +
            `라운드${r.rounds} 모델${secs(r.modelMs)}s ` +
            `총${secs(r.latencyMs)}s${r.ttftMs !== undefined ? ` 첫글자${secs(r.ttftMs)}s` : ""} in${r.promptTokens}` +
            `${r.cacheReadTokens !== undefined ? `(캐시읽기${r.cacheReadTokens} 쓰기${r.cacheWriteTokens})` : ""} out${r.outputTokens}(생각${r.thoughtTokens}) ` +
            `[${r.toolCalls.join(",") || "없음"}]` +
            (r.toolArgs.length ? ` args=${JSON.stringify(r.toolArgs.map((t) => t.args))}` : "") +
            (g && !g.pass ? ` leaked=${g.leaked.join("|")}` : "") +
            (r.error ? ` error=${r.error.slice(0, 200)}` : ""),
        );
      }
    }
  }

  const file: ResultFile = {
    run: { models: MODELS, repeats: REPS, only, measuredAt, interleaved: true, gitSha: gitSha() },
    cases: cases.map(({ place, withLocation, location, ...rest }) => ({ ...rest, context: { place, withLocation, location } })),
    results,
  };
  const dir = path.resolve(process.cwd(), ".ab-out");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = measuredAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(file, null, 2));
  const report = buildReport(file);
  fs.writeFileSync(path.join(dir, `${stamp}.md`), report + "\n");
  console.log(`\n원시 결과: ${jsonPath}\n\n${report}`);
}, 3_600_000);
