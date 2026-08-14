/**
 * Gemini 모델 A/B 실호출 하네스.
 *
 * 프로덕션 채팅 경로(`/api/chat`)의 systemInstruction·도구 선언·`runAgentLoop`를 그대로 재사용해
 * 모델만 바꿔 돌린다. 프로덕션 코드에 계측 훅을 심지 않고, `ai` 클라이언트를 감싼 프록시가
 * 라운드별 지연·토큰·도구 호출을 기록한다.
 *
 * 실행: `MODELS=gemini-3.6-flash,gemini-3.7-flash REPS=2 npx vitest run --config vitest.ab.config.ts`
 * 결과: `.ab-out/<타임스탬프>.json`(원시) + 콘솔 요약표.
 *
 * ⚠ 유료 API 실호출이다. 기본 게이트 레인(`npm run test:run`)에 포함하지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { GoogleGenAI } from "@google/genai";
import type { Content } from "@google/genai";
import { availableDeclarations } from "@/lib/chat/declarations";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { buildChatSystemInstruction } from "@/lib/chat/system-instruction";
import { GEMINI_MODEL } from "@/lib/gemini/client";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext } from "@/lib/chat/types";

// 기본 비교는 "현재 프로덕션 모델 vs 후보". 현재 모델은 상수를 참조해 교체 시
// 하네스가 낡은 이름을 들고 있지 않게 한다(후보는 그때그때 MODELS로 넘긴다).
const MODELS = (process.env.MODELS ?? `${GEMINI_MODEL},gemini-3.7-flash`).split(",");
const REPS = Number(process.env.REPS ?? "2");

/** 위원장 거주지(서울 강동구 길동) — 실사용 좌표. */
const HOME = { lat: 37.5378, lng: 127.1417 };

interface Case {
  id: string;
  /** 사용자 발화(멀티턴이면 순서대로) */
  turns: string[];
  /** 장소 앵커 채팅이면 지정 */
  place?: { name: string; lat: number; lng: number; category?: string };
  /** 위치 미제공 케이스면 false */
  withLocation?: boolean;
  /** 이 축을 만족하려면 반드시 호출해야 하는 도구(하나라도 있으면 통과) */
  expectAny?: string[];
  /** 호출하면 과잉인 도구 */
  forbid?: string[];
  /** 사람이 읽어야 할 판정 축 */
  judge: string;
}

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
    judge: "진료중 여부 3-state를 유지하는가. 전화번호·거리를 도구 값대로 주는가.",
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
    judge: "★핵심: 도구가 주지 않은 분위기·인테리어·평판을 지어내는가. 혼잡도 도구로 답하거나 한계를 인정해야 통과.",
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
];

interface RoundStat {
  ms: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolCalls: string[];
}

interface RunResult {
  model: string;
  rep: number;
  caseId: string;
  ok: boolean;
  error?: string;
  rounds: RoundStat[];
  modelMs: number;
  totalMs: number;
  toolCalls: string[];
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  expectPass: boolean | null;
  forbidPass: boolean | null;
  text: string;
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

/** generateContent를 감싸 지연·토큰·도구 호출을 기록하는 프록시. */
function instrument(real: GoogleGenAI, rounds: RoundStat[]) {
  return {
    models: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateContent: async (req: any) => {
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
        });
        return res;
      },
    },
  } as unknown as GoogleGenAI;
}

async function runOne(real: GoogleGenAI, model: string, c: Case, rep: number): Promise<RunResult> {
  const rounds: RoundStat[] = [];
  const ctx: ExecutionContext = {
    userLocation: c.withLocation === false ? undefined : HOME,
    placeAnchor: c.place ? { lat: c.place.lat, lng: c.place.lng, name: c.place.name } : undefined,
    locale: "ko",
    dataLocale: dataLocale("ko"),
  };
  const history: Content[] = c.turns.map((t) => ({ role: "user", parts: [{ text: t }] }));
  const t0 = Date.now();
  try {
    const result = await runAgentLoop({
      ai: instrument(real, rounds),
      model,
      systemInstruction: buildChatSystemInstruction("ko", c.place),
      tools: [{ functionDeclarations: availableDeclarations() }],
      history,
      ctx,
    });
    const toolCalls = rounds.flatMap((r) => r.toolCalls);
    return {
      model,
      rep,
      caseId: c.id,
      ok: true,
      rounds,
      modelMs: rounds.reduce((s, r) => s + r.ms, 0),
      totalMs: Date.now() - t0,
      toolCalls,
      promptTokens: rounds.reduce((s, r) => s + r.promptTokens, 0),
      outputTokens: rounds.reduce((s, r) => s + r.outputTokens, 0),
      thoughtTokens: rounds.reduce((s, r) => s + r.thoughtTokens, 0),
      expectPass: c.expectAny ? c.expectAny.some((t) => toolCalls.includes(t)) : null,
      forbidPass: c.forbid ? !c.forbid.some((t) => toolCalls.includes(t)) : null,
      text: result.text,
      renders: result.renders.map((r) => r.type),
      sources: result.sources.length,
    };
  } catch (e) {
    return {
      model,
      rep,
      caseId: c.id,
      ok: false,
      error: String(e),
      rounds,
      modelMs: rounds.reduce((s, r) => s + r.ms, 0),
      totalMs: Date.now() - t0,
      toolCalls: rounds.flatMap((r) => r.toolCalls),
      promptTokens: 0,
      outputTokens: 0,
      thoughtTokens: 0,
      expectPass: null,
      forbidPass: null,
      text: "",
      renders: [],
      sources: 0,
    };
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
  const results: RunResult[] = [];
  for (let rep = 1; rep <= REPS; rep++) {
    for (const c of cases) {
      for (const model of MODELS) {
        const r = await runOne(real, model, c, rep);
        results.push(r);
        const mark = r.ok ? (r.expectPass === false || r.forbidPass === false ? "△" : "○") : "×";
        console.log(
          `${mark} rep${rep} ${c.id} ${model} ` +
            `라운드${r.rounds.length} 모델${secs(r.modelMs)}s ` +
            `총${secs(r.totalMs)}s in${r.promptTokens} out${r.outputTokens}(생각${r.thoughtTokens}) ` +
            `[${r.toolCalls.join(",") || "없음"}]`,
        );
      }
    }
  }

  const dir = path.resolve(process.cwd(), ".ab-out");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ models: MODELS, reps: REPS, results }, null, 2));
  console.log(`\n원시 결과: ${file}`);

  // 모델별 집계
  for (const model of MODELS) {
    const rs = results.filter((r) => r.model === model);
    const ok = rs.filter((r) => r.ok);
    const sum = (f: (r: RunResult) => number) => rs.reduce((s, r) => s + f(r), 0);
    const expected = rs.filter((r) => r.expectPass !== null);
    const forbidden = rs.filter((r) => r.forbidPass !== null);
    console.log(
      `\n[${model}] 성공 ${ok.length}/${rs.length} | ` +
        `필수도구 ${expected.filter((r) => r.expectPass).length}/${expected.length} | ` +
        `과잉없음 ${forbidden.filter((r) => r.forbidPass).length}/${forbidden.length} | ` +
        `평균 라운드 ${(sum((r) => r.rounds.length) / rs.length).toFixed(2)} | ` +
        `평균 모델지연 ${secs(sum((r) => r.modelMs) / rs.length, 2)}s | ` +
        `총 in ${sum((r) => r.promptTokens)} out ${sum((r) => r.outputTokens)} 생각 ${sum((r) => r.thoughtTokens)} | ` +
        `평균 답변 ${Math.round(sum((r) => r.text.length) / rs.length)}자`,
    );
  }
}, 3_600_000);
