/**
 * 고정 윈도우 IP 레이트 리밋 — 유료 Perplexity 호출(/api/search/web)의 비용 방어.
 *
 * 순수 코어(evaluateRateLimit)는 store·now 주입형이라 결정적 테스트가 가능하고,
 * 모듈 싱글턴 래퍼(checkSearchWebRateLimit)가 실제 요청에서 공유 store에 바인딩한다
 * (geolocation.ts·nearby-panel-store.ts와 동형 패턴).
 *
 * ⚠ 한계: Vercel 서버리스는 stateless라 이 in-memory store는 함수 인스턴스마다
 * 분리된다(Fluid Compute 인스턴스 재사용으로 부분 적중). 즉 분산 환경에서 정확한
 * 전역 제한이 아니라 "인스턴스별 폭주 차단"이다 — 봇 어뷰징 1차 방어로 충분하지만,
 * 엄밀한 전역 제한이 필요하면 Upstash Redis 같은 외부 스토어로 승격해야 한다.
 */

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * 고정 윈도우 카운터. key가 현재 윈도우에서 limit 미만이면 허용·증가, 초과면 차단.
 * 윈도우가 만료됐거나 처음 보는 key면 새 윈도우를 연다.
 */
export function evaluateRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const entry = store.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count };
}

/**
 * 호출 수 단위 예약 — `evaluateRateLimit`의 비용 판(E70 여정, spec §4.5-3). 한 요청이 외부 API를
 * 여러 번 부를 때 요청이 아니라 **호출 수**로 센다. 남은 칸이 비용보다 모자라면 아무것도 쓰지 않고
 * 거절한다(부분 예약 금지 — 예약하지 않은 호출을 만들지 않는 것이 계약이다).
 */
export function reserveCalls(
  store: Map<string, RateLimitEntry>,
  key: string,
  now: number,
  cost: number,
  limit: number,
  windowMs: number,
): boolean {
  const entry = store.get(key);
  const fresh = !entry || now - entry.windowStart >= windowMs;
  const used = fresh ? 0 : entry.count;
  if (used + cost > limit) return false;
  if (fresh) store.set(key, { count: cost, windowStart: now });
  else entry.count += cost;
  return true;
}

// IP당 60초에 30회 — 정상 사용자는 디바운스된 검색으로 닿기 어렵고, 봇 폭주는 차단.
const WINDOW_MS = 60_000;
const LIMIT = 30;
const store = new Map<string, RateLimitEntry>();

/**
 * /api/search/web 전용 레이트 리밋. 허용이면 true.
 * now는 호출부가 주입(Date.now()) — 테스트는 순수 코어를 직접 검증한다.
 */
export function checkSearchWebRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(store, ip, now, LIMIT, WINDOW_MS).allowed;
}

// TTS는 버튼 탭당 1회 호출이라 검색보다 훨씬 낮게 잡는다(무료 티어 초과분 유료 방어).
const TTS_LIMIT = 10;
const ttsStore = new Map<string, RateLimitEntry>();

/** /api/tts 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkTtsRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(ttsStore, ip, now, TTS_LIMIT, WINDOW_MS).allowed;
}

// STT는 유료 Deepgram 중계 + 웹 녹음 60초 캡이라 탭당 1회 수준 — TTS와 동일 강도.
const STT_LIMIT = 10;
const sttStore = new Map<string, RateLimitEntry>();

/** /api/speech-to-text 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkSttRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(sttStore, ip, now, STT_LIMIT, WINDOW_MS).allowed;
}

// 채팅은 요청당 비용이 가장 크고(Gemini 다회 호출+도구 경유 Perplexity) 대화 턴 간격이
// 자연히 길어, 검색(30회)보다 강한 60초 10회로 잡는다(스펙 §5).
const CHAT_LIMIT = 10;
const chatStore = new Map<string, RateLimitEntry>();

/** /api/chat 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkChatRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(chatStore, ip, now, CHAT_LIMIT, WINDOW_MS).allowed;
}

// 도보 경로(Tmap)도 일 1,000건 무료 쿼터가 있는 유료 API라 채팅과 동일하게
// 60초 10회로 잡는다(도보 W2 브리프).
const WALK_LIMIT = 10;
const walkStore = new Map<string, RateLimitEntry>();

/** /api/route/walk 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkWalkRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(walkStore, ip, now, WALK_LIMIT, WINDOW_MS).allowed;
}

// 시간표는 키워드 1 + 노선×2 호출 증폭이 있어 채팅과 동일한 60초 10회.
const TIMETABLE_LIMIT = 10;
const timetableStore = new Map<string, RateLimitEntry>();

/** /api/station/timetable 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkTimetableRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(timetableStore, ip, now, TIMETABLE_LIMIT, WINDOW_MS).allowed;
}

// 보행 인프라는 Overpass 공개 인스턴스를 경유하는 공유 자원이라 도보 경로와 동일하게
// 60초 10회로 잡는다(인스턴스 전역 카운터는 별도로 walk-infra.ts가 담당).
const WALK_INFRA_LIMIT = 10;
const walkInfraStore = new Map<string, RateLimitEntry>();

/** /api/walk/nearby 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkWalkInfraRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(walkInfraStore, ip, now, WALK_INFRA_LIMIT, WINDOW_MS).allowed;
}

// 자동차 경로(Tmap 기본)도 일 1,000건 무료 쿼터를 도보 경로와 공유하는 유료 API라
// 동일하게 60초 10회로 잡는다(2026-07-30 Tmap 승격).
const CAR_LIMIT = 10;
const carStore = new Map<string, RateLimitEntry>();

/** /api/route/car 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkCarRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(carStore, ip, now, CAR_LIMIT, WINDOW_MS).allowed;
}

// 대중교통 추적 폴링(B2 §7): 최소 폴링 15초 = 분당 4회 + 수동 조작·복귀 즉폴
// 버스트 여유. NAT 공유 IP에서 10회 관례가 과도 차단을 만들 수 있어 이 라우트만
// 20회로 상향. 1차 방어는 세션 폴링 캡(240콜)과 단일 비행이고 이건 2차다.
const TRANSIT_TRACK_LIMIT = 20;
const transitTrackStore = new Map<string, RateLimitEntry>();

/** /api/transit/track 전용 레이트 리밋(60초 20회). 허용이면 true. */
export function checkTransitTrackRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(transitTrackStore, ip, now, TRANSIT_TRACK_LIMIT, WINDOW_MS).allowed;
}

// 승차 중 열차 위치(E35): riding 미관측 폴에 한 번씩 얹히므로 세션당 분당 1~2회. 추적 라우트와 같은
// NAT 공유 근거로 60초 20회 — 429는 클라이언트에서 조용한 표식 부재가 된다. 1차 방어는 결박당 조회 상한과
// 노선 캐시(20초)이고 이건 2차다.
const TRANSIT_POSITION_LIMIT = 20;
const transitPositionStore = new Map<string, RateLimitEntry>();

/** /api/transit/position 전용 레이트 리밋(60초 20회). 허용이면 true. */
export function checkTransitPositionRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(transitPositionStore, ip, now, TRANSIT_POSITION_LIMIT, WINDOW_MS).allowed;
}

// 혼잡도는 서울 열린데이터 일 1,000회를 따릉이·문화행사와 나눠 쓰므로 동일하게
// 60초 10회. 영역 코드 단위 5분 캐시가 1차 방어이고 이건 2차다.
const CONGESTION_LIMIT = 10;
const congestionStore = new Map<string, RateLimitEntry>();

/** /api/congestion/nearby 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkCongestionRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(congestionStore, ip, now, CONGESTION_LIMIT, WINDOW_MS).allowed;
}

/** Vercel은 클라이언트 IP를 x-forwarded-for(첫 항목)·x-real-ip로 전달한다. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headers.get("x-real-ip") ?? "unknown";
}

// follow-up 칩은 답변당 1회 경량 호출(thinking low·도구 없음)이라 채팅보다 싸지만, 채팅 리밋을
// 나눠 쓰면 답변당 칩 호출 1회가 채팅 예산을 절반으로 깎는다 — 별도 store, 60초 20회.
const SUGGESTIONS_LIMIT = 20;
const suggestionsStore = new Map<string, RateLimitEntry>();

/** /api/chat/suggestions 전용 레이트 리밋(60초 20회). 허용이면 true. */
export function checkSuggestionsRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(suggestionsStore, ip, now, SUGGESTIONS_LIMIT, WINDOW_MS).allowed;
}

// 여정(E70, spec §4.5): 한 조회가 Tmap을 최대 8회 부른다. IP 버킷은 1분 안 두 번 조회(역 A만 넣고 조회한 뒤
// B를 더해 다시)를 받는 16회이고 자동차 라우트 버킷(10회)과 합치지 않는다 — 합치면 조회 직후 안내 시작의
// `/api/route/car` 상세 조회가 스스로 429에 걸린다. Tmap 일 1,000건 무료분(자동차·도보 폴백과 공유) 보호는
// 인스턴스 일 상한이 맡는다. ⚠ 머리 주석의 한계 그대로 인스턴스별이다 — 실험판을 넓히기 전에 외부 저장소로
// 승격할지 다시 판정한다(BACKLOG E70 편승).
export const JOURNEY_TMAP_IP_LIMIT = 16;
export const JOURNEY_TMAP_DAILY_CAP = 200;
const KST_OFFSET_MS = 9 * 3_600_000;

export type JourneyReserveResult = "ok" | "rateLimited" | "budgetExhausted";

/** 여정 Tmap 예산(테스트가 새 인스턴스를 만든다). 일 상한을 먼저 무기록 판정한다 — 거절된 요청이 IP 버킷을 먹지 않게. */
export function createJourneyTmapBudget() {
  const ipStore = new Map<string, RateLimitEntry>();
  let day = -1;
  let used = 0;
  const kstDay = (now: number) => Math.floor((now + KST_OFFSET_MS) / 86_400_000);
  const rollDay = (now: number) => {
    const d = kstDay(now);
    if (d !== day) {
      day = d;
      used = 0;
    }
  };
  return {
    reserve(ip: string, now: number, cost: number): JourneyReserveResult {
      rollDay(now);
      if (used + cost > JOURNEY_TMAP_DAILY_CAP) return "budgetExhausted";
      if (!reserveCalls(ipStore, ip, now, cost, JOURNEY_TMAP_IP_LIMIT, WINDOW_MS)) return "rateLimited";
      used += cost;
      return "ok";
    },
    /** 일 상한을 다 썼는가(무기록) — 비용이 드는 앞 단계(ODsay·카카오)를 부르기 전 선판정용. */
    exhausted(now: number): boolean {
      rollDay(now);
      return used >= JOURNEY_TMAP_DAILY_CAP;
    },
    /**
     * 요청 단위로 IP 칸 하나를 쓴다(일 상한은 올리지 않는다). 지금 탄 열차(aboard)는 Tmap을 0회 부르므로 `reserve`가 IP를
     * 세지 못하는데, 유료 ODsay는 그대로 1~2회 부른다 — 요청 하나를 한 칸으로 세어 상한이 사라지지 않게 한다.
     */
    chargeIp(ip: string, now: number): boolean {
      return reserveCalls(ipStore, ip, now, 1, JOURNEY_TMAP_IP_LIMIT, WINDOW_MS);
    },
    dailyCount(now: number): number {
      rollDay(now);
      return used;
    },
    ipCount(ip: string, now: number): number {
      const e = ipStore.get(ip);
      return !e || now - e.windowStart >= WINDOW_MS ? 0 : e.count;
    },
  };
}

const journeyTmapBudget = createJourneyTmapBudget();

/** /api/route/journey 전용 Tmap 호출 예약(팬아웃 전 정확한 비용 한 번). */
export function reserveJourneyTmap(ip: string, now: number, cost: number): JourneyReserveResult {
  return journeyTmapBudget.reserve(ip, now, cost);
}

/** aboard 요청의 IP 칸 하나 예약(요청 단위, 일 상한 불변). 칸이 없으면 false. */
export function chargeJourneyIp(ip: string, now: number): boolean {
  return journeyTmapBudget.chargeIp(ip, now);
}

/** 이 IP의 여정 Tmap 버킷이 이미 다 찼는가(무기록). 차 있으면 라우트가 ODsay·카카오 호출 전에 429로 거절한다. */
export function journeyIpExhausted(ip: string, now: number): boolean {
  return journeyTmapBudget.ipCount(ip, now) >= JOURNEY_TMAP_IP_LIMIT;
}

/** 여정 Tmap 일 상한 소진 여부(무기록). 소진이면 라우트가 ODsay·카카오 호출 전에 503으로 거절한다. */
export function journeyTmapExhausted(now: number): boolean {
  return journeyTmapBudget.exhausted(now);
}
