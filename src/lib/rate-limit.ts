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
