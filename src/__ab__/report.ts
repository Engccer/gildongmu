/**
 * A/B 결과 JSON → 사람이 읽는 리포트(순수 함수). 형식 정본은 스킬 `llm-model-eval`
 * `references/report-format.md`의 6항이며 **순서가 규칙이다** — 뒤집힌 케이스가 집계 위에 온다.
 *
 * ⚠ 요금은 날짜의 함수다. 프로모 단가($0.75/$3.75 per 1M)가 2026-12-31에 끝나고 정가
 * ($1.50/$7.50)로 복귀하므로 단가를 상수로 박지 않고 `run.measuredAt`으로 고른다.
 * thinking 토큰은 출력 단가로 과금된다(`candidatesTokenCount`와 분리돼 오므로 더해야 한다).
 */
// @ts-expect-error `eval:ab:report`는 노드 타입 스트리핑으로 이 파일을 읽는다 — 상대 import에 .ts 확장자가 필수이고 tsc는 그것을 금지한다(런타임이 정본, `report-cli.mts`와 같은 사정).
import { passK, type EntityKind } from "./grounding.ts";

export interface EvalCase {
  id: string;
  turns: string[];
  context?: Record<string, unknown>;
  locale?: string;
  cluster?: string;
  expectAny?: string[];
  forbid?: string[];
  expectArg?: { tool: string; key: string; value: unknown };
  langInvariantArgs?: { tool: string; key: string; pattern: string }[];
  grounding?: { fromTools: string[]; fields: string[]; kinds: readonly EntityKind[]; forbidLexicon?: string[] };
  safety?: boolean;
  diagnostic?: boolean;
  judge?: string;
}

export interface Checks {
  expect?: boolean;
  forbid?: boolean;
  arg?: boolean;
  langInvariant?: boolean;
  grounding?: { pass: boolean; leaked: string[] };
}

export interface RunResult {
  model: string;
  caseId: string;
  rep: number;
  ok: boolean;
  error?: string;
  /** ⚠ 총지연. 사용자 체감(TTFT)이 아님 */
  latencyMs: number;
  ttftMs?: number;
  rounds: number;
  toolCalls: string[];
  toolArgs: { name: string; args: Record<string, unknown> }[];
  unstubbed: string[];
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  /** `promptTokens` 가운데 캐시에서 읽은 몫(Claude). 없으면 캐시 할인을 빼고 센다. */
  cacheReadTokens?: number;
  /** `promptTokens` 가운데 캐시에 쓴 몫(Claude, 5분 캐시 = 입력 단가의 1.25배). */
  cacheWriteTokens?: number;
  checks: Checks;
  text: string;
}

export interface ResultFile {
  run: { models: string[]; repeats: number; only?: string; measuredAt: string; interleaved: boolean; gitSha: string };
  cases: EvalCase[];
  results: RunResult[];
}

const PROMO_END = "2026-12-31T23:59:59.999Z";

/**
 * 모델별 단가표(USD per 1M 토큰). 두 모델이 같은 값인 것은 실측 사실이지 가정이 아니다 — 새 모델은 여기 등록한다.
 * `promo`가 없는 모델은 기간 할인이 없다(날짜와 무관하게 `list`).
 * 2026-11-14 공식 요금표 확인: 3.6-flash는 2026-12-31까지 $0.75/$3.75, 그 뒤 $1.50/$7.50. 4-hydrogen은 할인 없이 $1.50/$7.50.
 */
/** Claude 단가는 2026-11-14 claude-api 스킬 모델 표 확인: Opus 5.5 $4/$20(캐시 읽기 $0.20), Sonnet 5.5 $2/$10(캐시 읽기 $0.10). 5분 캐시 쓰기는 입력의 1.25배. */
const PRICE_TABLE: Record<string, { promo?: [number, number]; list: [number, number]; cacheRead?: number; cacheWriteMultiplier?: number }> = {
  "gemini-3.6-flash": { promo: [0.75, 3.75], list: [1.5, 7.5] },
  "gemini-3.7-flash": { promo: [0.75, 3.75], list: [1.5, 7.5] },
  "gemini-4-hydrogen": { list: [1.5, 7.5] },
  "claude-opus-5-5": { list: [4, 20], cacheRead: 0.2, cacheWriteMultiplier: 1.25 },
  "claude-sonnet-5-5": { list: [2, 10], cacheRead: 0.1, cacheWriteMultiplier: 1.25 },
};
const FALLBACK_MODEL = "gemini-3.6-flash";

/**
 * 실행기의 모델 표기 `<모델 id>@<생각 수준>`(예: `gemini-4-hydrogen@low`)을 가른다. 접미사가 없으면 생각 설정을
 * 넣지 않는다(그 모델의 기본값). 결과 파일의 `model`에는 접미사까지 그대로 남아 같은 모델의 두 설정이 따로 집계된다.
 */
export function parseModelSpec(spec: string): { model: string; thinkingLevel: string | null } {
  // Claude 표기(`claude-…@low+between_tools`)의 `+` 꼬리는 단가 조회에 쓰지 않는다 — 해석은 `claude-runner.ts` `parseClaudeSpec`이 정본.
  if (spec.startsWith("claude-")) spec = spec.split("+")[0];
  const at = spec.indexOf("@");
  if (at < 0) return { model: spec, thinkingLevel: null };
  return { model: spec.slice(0, at), thinkingLevel: spec.slice(at + 1).toUpperCase() };
}

export interface Prices {
  inPerToken: number;
  outPerToken: number;
  /** 캐시 단가가 없는 모델은 입력 단가 그대로(할인을 빼고 센 상한). */
  cacheReadPerToken: number;
  cacheWritePerToken: number;
  label: string;
}

export function pricesAt(measuredAt: string, modelSpec = FALLBACK_MODEL): Prices {
  const { model } = parseModelSpec(modelSpec);
  const known = PRICE_TABLE[model];
  const row = known ?? PRICE_TABLE[FALLBACK_MODEL];
  const unknown = known ? "" : ` ⚠ ${model} 단가 미등록 — ${FALLBACK_MODEL} 기준 가정`;
  const promo = row.promo !== undefined && new Date(measuredAt).getTime() <= new Date(PROMO_END).getTime();
  const [inUsd, outUsd] = promo ? row.promo! : row.list;
  const cacheNote = row.cacheRead !== undefined ? `, 캐시 읽기 $${row.cacheRead}·쓰기 ×${row.cacheWriteMultiplier}` : "";
  const label = promo
    ? `프로모 $${inUsd}/$${outUsd} per 1M, 2026-12-31까지${unknown}`
    : `정가 $${inUsd}/$${outUsd} per 1M${row.promo ? " (프로모 종료 후)" : " (기간 할인 없음)"}${cacheNote}${unknown}`;
  return {
    inPerToken: inUsd / 1e6,
    outPerToken: outUsd / 1e6,
    cacheReadPerToken: (row.cacheRead ?? inUsd) / 1e6,
    cacheWritePerToken: (inUsd * (row.cacheWriteMultiplier ?? 1)) / 1e6,
    label,
  };
}

/** 세션 1회 비용. `promptTokens`는 캐시 몫을 포함한 입력 총량이고, 생각 토큰은 출력 단가다. */
export function sessionCost(r: RunResult, p: Prices): number {
  const read = r.cacheReadTokens ?? 0;
  const write = r.cacheWriteTokens ?? 0;
  return (
    (r.promptTokens - read - write) * p.inPerToken +
    read * p.cacheReadPerToken +
    write * p.cacheWritePerToken +
    (r.outputTokens + r.thoughtTokens) * p.outPerToken
  );
}

const AXES = ["expect", "forbid", "arg", "langInvariant", "grounding"] as const;
type Axis = (typeof AXES)[number];

function axisPass(c: Checks, a: Axis): boolean | undefined {
  if (a === "grounding") return c.grounding?.pass;
  return c[a];
}

/** 한 실행의 판정 — 실행 실패는 실패, 기록된 모든 축이 통과여야 통과. */
export function caseVerdict(r: RunResult): boolean {
  if (!r.ok) return false;
  return AXES.every((a) => axisPass(r.checks, a) !== false);
}

function failedAxes(rs: RunResult[]): Axis[] {
  const s = new Set<Axis>();
  for (const r of rs) for (const a of AXES) if (axisPass(r.checks, a) === false) s.add(a);
  return [...s];
}

function leakedOf(rs: RunResult[]): string[] {
  return [...new Set(rs.flatMap((r) => r.checks.grounding?.leaked ?? []))];
}

function usd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function secs(ms: number): string {
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

export function buildReport(file: ResultFile): string {
  const { run, cases, results } = file;
  const models = run.models;
  const byCaseModel = (caseId: string, model: string) => results.filter((r) => r.caseId === caseId && r.model === model);
  const passCount = (rs: RunResult[]) => rs.filter(caseVerdict).length;
  // 케이스 판정: 그 모델의 반복 전부 통과(엄격). safety가 아니어도 뒤집힘 판정엔 같은 기준을 쓴다 —
  // 느슨하게 하면 "가끔 실패"가 양쪽 통과로 뭉개진다.
  // 결과가 0건인 (케이스, 모델)은 실패가 아니라 미실행(null) — 뒤집힘·regression 표본에서 뺀다.
  const verdict = (caseId: string, model: string): boolean | null => {
    const rs = byCaseModel(caseId, model);
    return passK(rs.map(caseVerdict));
  };
  const caseIds = [...new Set(results.map((r) => r.caseId))].sort();
  const caseOf = (id: string) => cases.find((c) => c.id === id);
  const lines: string[] = [];

  lines.push(`# 모델 A/B 리포트 (${models.join(" vs ")})`);
  lines.push(`측정 ${run.measuredAt} · gitSha ${run.gitSha} · 반복 ${run.repeats}${run.only ? ` · ONLY=${run.only}` : ""} · interleaved ${run.interleaved}`);
  lines.push("");

  // ① 뒤집힌 케이스 — 집계보다 위
  lines.push("## 뒤집힌 케이스");
  const flipped = caseIds.filter((id) => {
    const vs = models.map((m) => verdict(id, m));
    return !vs.includes(null) && vs.some(Boolean) && !vs.every(Boolean);
  });
  if (flipped.length === 0) lines.push("뒤집힌 케이스 없음");
  else {
    lines.push(`| 케이스 | 축 | ${models.join(" | ")} | 비고 |`);
    lines.push(`|---|---|${models.map(() => "---").join("|")}|---|`);
    for (const id of flipped) {
      const all = results.filter((r) => r.caseId === id);
      const axes = failedAxes(all).join(",") || "ok:false";
      const cols = models.map((m) => `${passCount(byCaseModel(id, m))}/${byCaseModel(id, m).length}`);
      const leaked = leakedOf(all);
      lines.push(`| ${id} | ${axes} | ${cols.join(" | ")} | ${leaked.length ? `leaked: ${leaked.join(", ")}` : ""} |`);
    }
  }
  lines.push("");

  // ② safety pass^k
  const k = run.repeats;
  lines.push(`## safety pass^${k}`);
  const safetyIds = caseIds.filter((id) => caseOf(id)?.safety);
  if (safetyIds.length === 0) lines.push("- safety 케이스 없음");
  for (const m of models) {
    if (safetyIds.length === 0) break;
    const fails = safetyIds.filter((id) => verdict(id, m) !== true);
    lines.push(`- pass^${k} ${m}: ${safetyIds.length - fails.length}/${safetyIds.length}${fails.length ? ` (미달: ${fails.join(", ")})` : ""}`);
  }
  lines.push("");

  // ③ regression / capability — 기준은 models[0](현행)
  const base = models[0];
  lines.push("## regression / capability");
  // 같은 cluster의 로케일 변형은 하나의 표본(클러스터 통과 = 변형 전부 통과).
  // 자동 축이 하나도 없는 케이스(judge 전용)는 통과/실패를 말할 수 없어 표본에서 뺀다.
  const decidable = (id: string) => results.some((r) => r.caseId === id && AXES.some((a) => axisPass(r.checks, a) !== undefined));
  const unitOf = (id: string) => caseOf(id)?.cluster ?? id;
  const units = [...new Set(caseIds.filter(decidable).map(unitOf))];
  const unitVerdict = (u: string, m: string): boolean | null => {
    const vs = caseIds.filter((id) => unitOf(id) === u).map((id) => verdict(id, m));
    return vs.includes(null) ? null : vs.every(Boolean);
  };
  for (const m of models.slice(1)) {
    const ran = units.filter((u) => unitVerdict(u, base) !== null && unitVerdict(u, m) !== null);
    const basePass = ran.filter((u) => unitVerdict(u, base));
    const kept = basePass.filter((u) => unitVerdict(u, m));
    const gained = ran.filter((u) => unitVerdict(u, base) === false && unitVerdict(u, m));
    lines.push(`- regression ${m}: ${kept.length}/${basePass.length} 유지${basePass.length !== kept.length ? ` (깨짐: ${basePass.filter((u) => !kept.includes(u)).join(", ")})` : ""}`);
    lines.push(`- capability ${m}: ${gained.length}건 새로 통과${gained.length ? ` (${gained.join(", ")})` : ""}`);
  }
  lines.push("");

  // ④ 비용
  lines.push(`## 비용 (측정 ${run.measuredAt.slice(0, 10)} 기준 단가 — 요금은 날짜의 함수)`);
  const isDiag = (r: RunResult) => !!caseOf(r.caseId)?.diagnostic;
  for (const m of models) {
    const price = pricesAt(run.measuredAt, m);
    const rs = results.filter((r) => r.model === m);
    const core = rs.filter((r) => !isDiag(r));
    const cost = (xs: RunResult[]) => xs.reduce((a, r) => a + sessionCost(r, price), 0);
    const sum = (xs: RunResult[], f: (r: RunResult) => number) => xs.reduce((a, r) => a + f(r), 0);
    const cached = core.some((r) => r.cacheReadTokens !== undefined)
      ? ` (캐시 읽기 ${sum(core, (r) => r.cacheReadTokens ?? 0)} · 쓰기 ${sum(core, (r) => r.cacheWriteTokens ?? 0)})`
      : "";
    lines.push(
      `- ${m} [${price.label}]: ${usd(cost(core))} (diagnostic 제외 ${core.length}건 · in ${sum(core, (r) => r.promptTokens)}${cached} / out ${sum(core, (r) => r.outputTokens)} / thinking ${sum(core, (r) => r.thoughtTokens)}) · 포함 합계 ${usd(cost(rs))}`,
    );
  }
  lines.push("");

  // ⑤ 지연
  lines.push("## 총지연");
  for (const m of models) {
    const rs = results.filter((r) => r.model === m && !isDiag(r));
    const avg = rs.length ? rs.reduce((a, r) => a + r.latencyMs, 0) / rs.length : 0;
    const ttft = rs.filter((r) => r.ttftMs !== undefined);
    const ttftAvg = ttft.length ? ` · TTFT 평균 ${secs(ttft.reduce((a, r) => a + r.ttftMs!, 0) / ttft.length)}` : "";
    lines.push(`- ${m}: 총지연 평균 ${secs(avg)} (${rs.length}건)${ttftAvg}`);
  }
  lines.push("각주: 판정 근거 아님. 다른 날 2회 재현 전엔 서빙 변동으로 본다. 사용자 체감은 TTFT.");
  lines.push("");

  // ⑥ unstubbed
  const unstubbed = results.filter((r) => r.unstubbed.length > 0);
  const tools = [...new Set(unstubbed.flatMap((r) => r.unstubbed))];
  lines.push(`## unstubbed 세션: ${unstubbed.length}건${tools.length ? ` (${tools.join(", ")})` : ""}`);
  lines.push("이 세션의 응답 길이·비용·날조는 \"빈 응답을 받은 모델의 반응\"이라 다른 케이스와 섞어 읽지 않는다.");
  lines.push("");

  // 잔여 수동 judge
  const manual = cases.filter((c) => c.judge);
  lines.push(`## 잔여 수동 judge: ${manual.length}건`);
  for (const c of manual) lines.push(`- ${c.id}: ${c.judge}`);
  lines.push("");
  // 마지막 두 줄은 사람이 채운다(스킬 report-format.md) — 빈 틀을 두어 잊지 않게 한다.
  lines.push("판정: (모델 유지/전환). 근거: (뒤집힌 케이스·pass^k 수치).");
  lines.push("재평가: (조건 — systemInstruction 보강 후 재시도 / 현행 모델 은퇴 공지 / 차기 모델 출시).");

  return lines.join("\n");
}
