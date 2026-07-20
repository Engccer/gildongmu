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
