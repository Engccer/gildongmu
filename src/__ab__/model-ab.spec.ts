/**
 * Gemini 모델 A/B 실호출 하네스.
 *
 * 프로덕션 채팅 경로(`/api/chat`)의 systemInstruction·도구 선언·`runAgentLoop`를 그대로 재사용해
 * 모델만 바꿔 돌린다. 프로덕션 코드에 계측 훅을 심지 않고, `ai` 클라이언트를 감싼 프록시가
 * 라운드별 지연·토큰·도구 호출을 기록한다.
 *
 * 실행: `MODELS=gemini-3.6-flash,gemini-3.7-flash REPS=3 npm run eval:ab` (`ONLY=09` 부분 실행)
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
import type { Content } from "@google/genai";
import { availableDeclarations } from "@/lib/chat/declarations";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { buildChatSystemInstruction } from "@/lib/chat/system-instruction";
import { GEMINI_MODEL } from "@/lib/gemini/client";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext } from "@/lib/chat/types";
import { checkLangInvariantArgs, scoreGrounding, type ToolOutput } from "./grounding";
import { buildReport, type Checks, type ResultFile, type RunResult } from "./report";
import { CASES, HOME, type Case } from "./cases";

// 기본 비교는 "현재 프로덕션 모델 vs 후보". 현재 모델은 상수를 참조해 교체 시
// 하네스가 낡은 이름을 들고 있지 않게 한다(후보는 그때그때 MODELS로 넘긴다).
const MODELS = (process.env.MODELS ?? `${GEMINI_MODEL},gemini-3.7-flash`).split(",");
const REPS = Number(process.env.REPS ?? "3");

interface RoundStat {
  ms: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolCalls: string[];
  toolArgs: { name: string; args: Record<string, unknown> }[];
}

/** 결과 파일 계약(`report.ts` `RunResult`) + 이 하네스가 더 기록하는 것. */
interface HarnessResult extends RunResult {
  roundStats: RoundStat[];
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
function instrument(real: GoogleGenAI, rounds: RoundStat[], toolOutputs: ToolOutput[]) {
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
        const res = await real.models.generateContent(req);
        const u = res.usageMetadata ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = res.candidates?.[0]?.content?.parts ?? [];
        rounds.push({
          ms: Date.now() - t0,
          promptTokens: u.promptTokenCount ?? 0,
          outputTokens: u.candidatesTokenCount ?? 0,
          thoughtTokens: u.thoughtsTokenCount ?? 0,
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
  const rounds: RoundStat[] = [];
  const toolOutputs: ToolOutput[] = [];
  const ctx: ExecutionContext = {
    userLocation: c.withLocation === false ? undefined : (c.location ?? HOME),
    placeAnchor: c.place ? { lat: c.place.lat, lng: c.place.lng, name: c.place.name } : undefined,
    locale: "ko",
    dataLocale: dataLocale("ko"),
  };
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
      ai: instrument(real, rounds, toolOutputs),
      model,
      systemInstruction: buildChatSystemInstruction("ko", c.place),
      tools: [{ functionDeclarations: availableDeclarations() }],
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
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 없음 — .env.local 확인");
  const real = new GoogleGenAI({ apiKey: key });

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
        const r = await runOne(real, model, c, rep);
        results.push(r);
        const g = r.checks.grounding;
        console.log(
          `${checkMark(r)} rep${rep} ${c.id} ${model} ` +
            `라운드${r.rounds} 모델${secs(r.modelMs)}s ` +
            `총${secs(r.latencyMs)}s in${r.promptTokens} out${r.outputTokens}(생각${r.thoughtTokens}) ` +
            `[${r.toolCalls.join(",") || "없음"}]` +
            (r.toolArgs.length ? ` args=${JSON.stringify(r.toolArgs.map((t) => t.args))}` : "") +
            (g && !g.pass ? ` leaked=${g.leaked.join("|")}` : ""),
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
