/**
 * 베르길리우스 「말로 묻기」(E82 spec `2026-11-14-e82-vergilius-v1-design.md` §4) — 서버 ↔ iOS 공유 계약. React/Next 비의존.
 *
 * 요청의 재료는 전부 앱이 계산한 것이다(V18). 서버는 그 재료를 글로 조립해 모델에 주고(`materials.ts`), 모델이 만들 수 있는 것은
 * 문장뿐이다 — 이름·좌우·거리·구획은 재료에서만 온다.
 */
import { z } from "zod";
import { routing } from "@/i18n/routing";
import type { RouteStartRenderPayload } from "@/lib/chat/types";

/** 질문 글의 상한(spec §4). */
export const VERGILIUS_QUESTION_MAX = 500;
/** 주변 가게 상한(V18: 가까운 순 최대 30곳). */
export const VERGILIUS_PLACES_MAX = 30;
/** 최근 기록 상한(V18: 20건). */
export const VERGILIUS_LOG_MAX = 20;

export const VERGILIUS_PROVIDERS = ["openai", "google"] as const;
export type VergiliusProvider = (typeof VERGILIUS_PROVIDERS)[number];

/** 줄을 가르는 문자인가: C0 제어 문자, DEL, NEL(0x85), 줄·문단 구분자(0x2028·0x2029). 소스에 날 문자를 두지 않으려고 코드 포인트로 본다. */
function hasLineBreakingChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x85 || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** 한 줄 글 조각: 줄바꿈·제어 문자를 받지 않는다(재료 표의 한 줄이 쪼개지면 모델이 다른 가게로 읽는다). */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !hasLineBreakingChar(s), { message: "한 줄 글이어야 합니다" });

// 본문(JSON)의 좌표는 수 타입 그대로 받는다 — 쿼리 문자열의 `Number("")===0` 함정(`coord-param.ts`)은 여기 없다.
// 누락·null·문자열은 z.number()가 400으로 가른다.
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

const placeSchema = z.object({
  id: line(64).min(1),
  name: line(100).min(1),
  category: line(60),
  /** 구획(V18): 앞·옆·지나옴·모름. */
  zone: z.enum(["ahead", "beside", "behind", "unknown"]),
  side: z.enum(["left", "right", "unknown"]),
  /** 지금 위치에서의 거리(m). */
  distance: z.number().min(0).max(5000),
  lat,
  lng,
});

const logSchema = z.object({
  /** 기록 종류(V10): 가게·횡단보도·갈림길·도로명·답. */
  kind: z.enum(["place", "crosswalk", "junction", "road", "answer"]),
  text: line(300).min(1),
  agoSeconds: z.number().min(0).max(86_400),
  placeId: line(64).min(1).optional(),
});

export const vergiliusAskSchema = z.object({
  question: z.string().trim().min(1).max(VERGILIUS_QUESTION_MAX),
  // 누락=ko, 미지 값은 400(채팅 라우트와 같은 규칙 — 조용히 ko로 접지 않는다).
  locale: z.enum(routing.locales).default("ko"),
  provider: z.enum(VERGILIUS_PROVIDERS),
  location: z.object({ lat, lng }),
  headingKnown: z.boolean(),
  places: z.array(placeSchema).max(VERGILIUS_PLACES_MAX),
  junctionAhead: z.object({ meters: z.number().min(0).max(5000), branches: z.number().int().min(2).max(8) }).nullable(),
  nextCrosswalkMeters: z.number().min(0).max(5000).nullable(),
  roadName: line(60).nullable(),
  log: z.array(logSchema).max(VERGILIUS_LOG_MAX),
});

export type VergiliusAskRequest = z.infer<typeof vergiliusAskSchema>;
export type VergiliusPlace = VergiliusAskRequest["places"][number];
export type VergiliusLogEntry = VergiliusAskRequest["log"][number];

/**
 * NDJSON 스트리밍 이벤트(1줄 1이벤트).
 *
 * - `text`: 글 조각. `final`이 참인 조각만 읽는다 — 그 회차에 아직 도구 호출이 없다는 표시다(V16).
 * - `reset`: 지금까지 받은 `final` 글을 버린다. 한 회차에서 글 **뒤에** 도구 호출이 따라온 드문 경우에만 온다
 *   (회차가 끝나기 전에는 도구 호출이 낄지 알 수 없어서, 문장이 완결되는 대로 읽게 하려면 먼저 흘려보내야 한다).
 * - `done`: 끝. `text`는 마지막 회차의 글 전체이고, 통과한 제안이 있으면 빈 문자열이다(V22: 앱이 틀 문장을 읽는다).
 * - `error`: 실패. 그 뒤에 `done`은 오지 않는다.
 */
export type VergiliusStreamEvent =
  | { type: "text"; delta: string; final: boolean }
  | { type: "reset" }
  | { type: "done"; text: string; renders: RouteStartRenderPayload[]; proposal: { placeId: string } | null }
  | { type: "error"; code: string };

/** 모델의 도구 호출 하나(두 회사 공통 모양). `id`는 OpenAI의 호출 id이고 Gemini는 없을 수 있다(이름과 순서로 짝을 맞춘다). */
export interface VergiliusToolCall {
  id: string | null;
  name: string;
  args: Record<string, unknown>;
}

export interface VergiliusToolOutcome {
  call: VergiliusToolCall;
  response: Record<string, unknown>;
}

export interface VergiliusRoundResult {
  /** 이 회차의 글 전체(생각 부분 제외). */
  text: string;
  calls: VergiliusToolCall[];
}

export interface VergiliusRoundOptions {
  /** 거짓이면 이 회차에는 도구를 부를 수 없다(왕복 상한을 다 쓴 뒤의 마지막 회차). */
  tools: boolean;
  onText: (delta: string) => void;
  /** 이 회차에서 도구 호출이 처음 보인 순간. */
  onCall: () => void;
}

/** 한 질문의 모델 대화(회사별 어댑터). 대화 이력은 어댑터가 자기 회사 형식으로 쥔다. */
export interface VergiliusModelSession {
  round(opts: VergiliusRoundOptions): Promise<VergiliusRoundResult>;
  /** 직전 회차의 도구 결과를 이력에 넣는다. 순서는 그 회차의 호출 순서와 같아야 한다. */
  pushToolResults(outcomes: VergiliusToolOutcome[]): void;
}
