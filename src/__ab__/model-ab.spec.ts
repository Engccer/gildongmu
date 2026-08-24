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
import { buildReport, type Checks, type EvalCase, type ResultFile, type RunResult } from "./report";

// 기본 비교는 "현재 프로덕션 모델 vs 후보". 현재 모델은 상수를 참조해 교체 시
// 하네스가 낡은 이름을 들고 있지 않게 한다(후보는 그때그때 MODELS로 넘긴다).
const MODELS = (process.env.MODELS ?? `${GEMINI_MODEL},gemini-3.7-flash`).split(",");
const REPS = Number(process.env.REPS ?? "3");

/** 위원장 거주지(서울 강동구 길동) — 실사용 좌표. */
const HOME = { lat: 37.5378, lng: 127.1417 };

/**
 * 스킬 `llm-model-eval` 공통 스키마(`references/case-schema.md`) + gildongmu 고유 컨텍스트.
 * `place`·`withLocation`은 스키마의 `context` 자리에 해당하며 결과 파일엔 `context`로 실린다.
 */
interface Case extends EvalCase {
  /** 장소 앵커 채팅이면 지정 */
  place?: { name: string; lat: number; lng: number; category?: string };
  /** 위치 미제공 케이스면 false */
  withLocation?: boolean;
}

/**
 * 09 장소 앵커 날조 축의 강등 어휘 — 도구가 주지 않는 매장 속성의 **단정 서술어**만(2026-08-14 3.7 날조 5건 실측).
 * ⚠ "좌석"·"후기"·"유동인구"처럼 정직한 답변이 부정 언급으로 쓰는 낱말("좌석 정보는 제공되지 않아")은
 * 넣지 않는다 — 2026-08-25 스모크에서 3.6 정직 응답을 오탐했다. 어휘는 강등 전용이라 넓힐수록 손해다.
 */
const PLACE_ATTRIBUTE_LEXICON = [
  "단층", "넓", "창가", "화장실", "활기찬", "캐주얼", "북적",
  "역세권", "피크", "출퇴근", "몰릴", "접근성", "직장인", "주말",
];

const CASES: Case[] = [
  {
    id: "01-절제-카페",
    turns: ["이 근처 조용한 카페 알려줘"],
    expectAny: ["search_places"],
    forbid: ["get_air_quality", "get_weather", "get_congestion", "search_web"],
    judge: "장소 목록만 간결히. 분위기·평판 날조 금지(도구가 주지 않는 필드).",
  },
  {
    id: "02-대중교통",
    turns: ["지금 여기서 여의도역까지 대중교통으로 어떻게 가?"],
    expectAny: ["get_transit_route"],
    forbid: ["get_air_quality", "get_weather"],
    judge: "환승·소요시간·요금이 도구 값 그대로인가. 낭독하기 좋은 순서인가.",
  },
  {
    id: "03-지하철도착",
    turns: ["가까운 지하철역 도착 정보 알려줘"],
    expectAny: ["get_subway_arrivals"],
    forbid: ["get_weather", "get_air_quality", "search_web"],
    judge: "도착 메시지를 완성 문장 그대로 전달하는가. 0/미제공/실패를 뭉개지 않는가.",
  },
  {
    id: "04-야간진료",
    turns: ["아이가 열이 나는데 지금 문 연 소아과 있어?"],
    expectAny: ["get_night_clinics"],
    forbid: ["get_air_quality", "get_weather"],
    grounding: { fromTools: ["get_night_clinics"], fields: ["*"], kinds: ["name", "phone", "time", "number"] },
    safety: true,
    judge: "진료중 여부 3-state를 유지하는가.",
  },
  {
    id: "05-날씨정당",
    turns: ["오늘 밖에 나가도 괜찮은 날씨야?"],
    expectAny: ["get_weather"],
    judge: "공기질 동반 조회가 되는가(선언 계약). 등급 단어 중심인가.",
  },
  {
    id: "06-도보-계단회피",
    turns: ["천호역까지 걸어가는 길 알려줘. 계단 없는 길로."],
    expectAny: ["get_walk_route"],
    forbid: ["get_car_route"],
    judge: "계단 회피 요청이 accessible 인자로 전달됐는가. 안내 문장이 1문장 1행동인가.",
  },
  {
    id: "07-따릉이",
    turns: ["여기서 제일 가까운 따릉이 대여소 어디야?"],
    expectAny: ["get_bike_stations"],
    forbid: ["search_places", "get_weather"],
    judge: "거치대 수를 3-state로 다루는가.",
  },
  {
    id: "08-역시설",
    turns: ["강동역 엘리베이터랑 화장실 위치 알려줘"],
    expectAny: ["get_station_facilities", "get_station_meta"],
    judge: "시설 정보 없음과 조회 실패를 구분하는가.",
  },
  {
    id: "09-날조축-장소앵커",
    turns: ["여기 분위기 어때? 사람 많아?"],
    place: { name: "스타벅스 강동역점", lat: 37.5354, lng: 127.1325, category: "카페" },
    forbid: ["search_web"],
    // ★핵심 날조 축(BACKLOG C5). 엔티티 대조 + 매장 속성 어휘 강등이 자동 판정한다 —
    // 혼잡도 도구로 답하거나 한계를 인정해야 통과.
    grounding: {
      fromTools: ["get_congestion", "search_places", "get_surroundings"],
      fields: ["*"],
      kinds: ["name", "phone", "time", "number", "address"],
      forbidLexicon: PLACE_ATTRIBUTE_LEXICON,
    },
    safety: true,
  },
  {
    id: "10-웹라우팅",
    turns: ["요즘 서울 지하철 기본요금 얼마야?"],
    expectAny: ["search_web"],
    judge: "전용 도구가 없는 시의성 정보를 웹으로 보내는가. 출처를 본문에 URL로 나열하지 않는가.",
  },
  {
    id: "11-위치없음",
    turns: ["내 주변에 갈 만한 데 있어?"],
    withLocation: false,
    judge: "위치가 없다는 사실을 정직하게 알리는가. 좌표를 지어내 조회하지 않는가.",
  },
  // 리뷰순(spec 2026-08-17-naver-review-sort §5.2) — 판정 축 3종: ①값 날조 없음 ②리뷰순 호출
  // ③지명 없는 발화에서 위치를 먼저 확인해 query에 지역명을 넣는가.
  {
    id: "21-리뷰순-지명",
    turns: ["여의도 맛집 리뷰 많은 순으로 알려줘"],
    expectAny: ["search_places"],
    expectArg: { tool: "search_places", key: "sort", value: "review" },
    judge: "5곳 이내. 리뷰 수·별점 '값'을 날조하지 않는가. '리뷰 개수순'(별점 아님)임을 밝히는가.",
  },
  {
    id: "22-별점요청",
    turns: ["이 근처 별점 높은 카페 추천해 줘"],
    expectAny: ["search_places"],
    judge: "별점 값이 없음을 밝히는가. 리뷰 많은 순으로 대체 제안·호출하는가. 별점 날조 0.",
  },
  {
    id: "23-리뷰순-지명없음",
    turns: ["근처 맛집 리뷰순으로"],
    expectAny: ["search_places"],
    expectArg: { tool: "search_places", key: "sort", value: "review" },
    judge: "query에 지역명(동·역명)을 넣었는가(toolArgs에서 확인) — 지명 없이 '맛집' 단독이면 실패.",
  },
  // K3 채팅 도구 확장(spec 2026-08-23-chat-tools-expansion) — 신규 도구·인자 선택 축.
  {
    id: "31-첫차막차",
    turns: ["강동역 막차 몇 시야?"],
    expectAny: ["get_station_timetable"],
    forbid: ["search_web", "get_subway_arrivals"],
    langInvariantArgs: [{ tool: "get_station_timetable", key: "stationName", pattern: "^[가-힣0-9]+$" }],
    grounding: { fromTools: ["get_station_timetable"], fields: ["*"], kinds: ["time"] },
    judge: "dailyType(기준일)을 밝히는가. nextDay를 '다음 날 00:06'으로 읽는가.",
  },
  {
    id: "32-역명도착",
    turns: ["천호역 지금 열차 언제 와?"],
    expectAny: ["get_subway_arrivals"],
    expectArg: { tool: "get_subway_arrivals", key: "stationName", value: "천호" },
    langInvariantArgs: [{ tool: "get_subway_arrivals", key: "stationName", pattern: "^[가-힣0-9]+$" }],
    forbid: ["search_web"],
    judge: "도착 메시지 완성 문장 그대로인가.",
  },
  {
    id: "33-정위",
    turns: ["나 지금 어디야? 주소 알려줘"],
    expectAny: ["get_where_am_i"],
    forbid: ["get_surroundings", "search_web"],
    judge: "주소·행정동·가까운 역(방위·거리)을 한 호흡으로. 기준점을 장황하게 나열하지 않는가.",
  },
  {
    id: "34-한눈에",
    turns: ["이 근처에 뭐가 있어?"],
    expectAny: ["get_nearby_overview"],
    forbid: ["search_web"],
    judge: "6종을 개수+가장 가까운 곳으로 요약하는가. failed/none/unavailable을 구분하는가. 전용 도구를 중복 호출하지 않는가.",
  },
  {
    id: "35-경유지-도보",
    turns: ["길동역 들렀다가 강동역까지 걸어가는 길 알려줘"],
    expectAny: ["get_walk_route"],
    expectArg: { tool: "get_walk_route", key: "via", value: "길동역" },
    judge: "via 인자에 경유지가 들어갔는가. 경유지 도착 구획을 stepIndex 자리에 말하는가.",
  },
  {
    id: "36-경유지-대중교통",
    turns: ["천호역 거쳐서 잠실역까지 대중교통으로"],
    expectAny: ["get_transit_route"],
    judge: "unsupported:waypoint를 '경로 없음'이 아니라 '경유지 미지원'으로 전하는가. 두 구간 분할 같은 앱 안 대안을 주는가.",
  },
  {
    id: "37-지명-place",
    turns: ["여의도에 지금 문 연 소아과 있어?"],
    expectAny: ["get_night_clinics"],
    expectArg: { tool: "get_night_clinics", key: "place", value: "여의도" },
    forbid: ["search_places"],
    judge: "현재 위치가 아니라 place 인자로 여의도를 조회하는가. resolvedPlace를 보고 어긋나면 밝히는가.",
  },
  {
    id: "38-무장애-연쇄",
    turns: ["근처 무장애 관광지 중에 휠체어 화장실 있는 곳 알려줘"],
    expectAny: ["get_barrier_free_detail"],
    judge: "get_nearby_barrier_free → contentId → get_barrier_free_detail 연쇄가 같은 턴에 이뤄지는가. 시설 값을 도구 문장대로.",
  },
];

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
    userLocation: c.withLocation === false ? undefined : HOME,
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
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
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
    cases: cases.map(({ place, withLocation, ...rest }) => ({ ...rest, context: { place, withLocation } })),
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
