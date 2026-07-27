# Phase 0 출시 전 방어 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정식 출시 전 비용·쿼터 방어 4건(STT 라우트 리밋+크기 상한, 채팅 search_web 캐시, 경로 좌표 캐시 키 반올림, 함수 리전 icn1)과 정본 도메인(gildongmu.dodoplanet.space) 반영을 완료한다.

**Architecture:** 기존 패턴 재사용이 원칙이다. 레이트리밋은 `src/lib/rate-limit.ts`의 고정 윈도우 코어에 store 하나를 추가하는 형태, 캐시는 순수 in-memory TTL Map(`src/lib/chat`의 React/Next 비의존 계약 유지 — `unstable_cache` 금지), 좌표 반올림은 walk-infra의 타일 anchor 정신을 경로 API에 4자리(±5.5m, GPS 오차 미만)로 적용한다.

**Tech Stack:** Next.js 16 Route Handler, Vitest 4, 순수 TypeScript(src/lib).

## Global Constraints

- `src/lib/chat/`·`src/lib/gemini/`는 React/Next 비의존 유지 — `next/cache` import 금지.
- **region-scan.ts의 샘플 좌표는 반올림 금지**(파일 상단 주석에 판단 기록: 경계 판정 정확도 > 캐시, 카카오 쿼터 일 30만이라 여유). 이번 계획은 그 판단을 존중하고 건드리지 않는다.
- **kakao-navi는 `no-store`(실시간 교통)라 반올림 대상 아님.** 캐시가 없는 곳에 반올림은 정확도만 깎는다.
- **odsay.ts의 `Referer: https://gildongmu.vercel.app/`은 변경 금지** — ODsay 키가 URI 앱(gildongmuweb)에 묶여 있어 도메인 변경 시 인증이 깨진다. 도메인 교체는 ODsay 콘솔에 새 URI 등록 후 별도 작업.
- 커밋 이메일 `engccer@gmail.com`, 주석·커밋 한국어, `git add -A` 금지(의도 파일만, `git commit -- <경로>` 원자 커밋).
- 매 태스크: 테스트 먼저(RED) → 구현(GREEN) → `npm run test:run` 전량 통과 → 커밋.

---

### Task 1: STT 라우트 방어 (레이트리밋 + 크기 상한 축소)

배경: `/api/speech-to-text`는 유료 Deepgram 중계인데 30개 라우트 중 유일하게 리밋이 없고 25MB(약 100분+ 오디오)까지 허용한다. 웹 UI는 60초 녹음 캡이 있으므로 서버 상한도 그에 맞춘다. iOS는 온디바이스 STT라 이 라우트를 쓰지 않는다.

**Files:**
- Modify: `src/lib/rate-limit.ts` (TTS 블록 아래에 STT 블록 추가)
- Modify: `src/lib/stt-validate.ts:13` (`STT_MAX_SIZE` 25MB → 5MB)
- Modify: `src/app/api/speech-to-text/route.ts` (리밋 적용)
- Test: `src/lib/__tests__/rate-limit.test.ts`, `src/lib/__tests__/stt-validate.test.ts` (기존 파일 위치 확인 후 그 파일에 추가; 없으면 인접 관례 따라 생성)

**Interfaces:**
- Produces: `checkSttRateLimit(ip: string, now: number): boolean` (60초 10회, 기존 `checkTtsRateLimit`와 동형)

- [ ] **Step 1: 실패하는 테스트 작성** — rate-limit 테스트에 STT 함수 케이스, stt-validate 테스트에 5MB 초과 거부·5MB 이하 허용 케이스.

```typescript
// rate-limit.test.ts에 추가 (기존 케이스 관례를 따를 것)
import { checkSttRateLimit } from "../rate-limit";

it("STT 리밋: 60초 창에서 10회 허용, 11회째 차단", () => {
  const now = 1_000_000;
  for (let i = 0; i < 10; i++) {
    expect(checkSttRateLimit("1.2.3.4", now)).toBe(true);
  }
  expect(checkSttRateLimit("1.2.3.4", now)).toBe(false);
  // 다른 IP는 독립
  expect(checkSttRateLimit("5.6.7.8", now)).toBe(true);
});

// stt-validate.test.ts에 추가/갱신
it("5MB 초과 오디오는 too_large", () => {
  const big = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "audio/webm" });
  expect(validateSttInput(big, "ko")).toEqual({ ok: false, reason: "too_large" });
});
```

기존 stt-validate 테스트가 25MB 경계를 검증하고 있으면 그 케이스를 5MB 경계로 갱신한다(테스트 두 벌 병존 금지).

- [ ] **Step 2: 테스트 실행, 실패 확인** — `npm run test:run -- rate-limit stt-validate`. `checkSttRateLimit` 미정의·경계값 불일치로 FAIL.

- [ ] **Step 3: 구현**

`src/lib/stt-validate.ts`:

```typescript
// 서버 상한은 웹 UI 60초 녹음 캡 기준(opus 60초 ≈ 1MB 미만)의 여유분.
// 25MB(약 100분 오디오)는 유료 Deepgram 직접 호출 어뷰징 표면이었다.
export const STT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
```

에러 문구 갱신: `src/app/api/speech-to-text/route.ts:14`의 `"(최대 25MB)"` → `"(최대 5MB)"`.

`src/lib/rate-limit.ts` (TTS 블록 아래):

```typescript
// STT는 유료 Deepgram 중계 + 웹 녹음 60초 캡이라 탭당 1회 수준 — TTS와 동일 강도.
const STT_LIMIT = 10;
const sttStore = new Map<string, RateLimitEntry>();

/** /api/speech-to-text 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkSttRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(sttStore, ip, now, STT_LIMIT, WINDOW_MS).allowed;
}
```

`src/app/api/speech-to-text/route.ts` POST 최상단(formData 파싱 전):

```typescript
import { checkSttRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

// 유료 Deepgram 비용 방어 — formData 파싱(메모리 적재) 전에 차단한다.
if (!checkSttRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
  return NextResponse.json(
    { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." },
    { status: 429 },
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — `npm run test:run` 전량 PASS.

- [ ] **Step 5: 커밋** — `git commit -m "feat(stt): 라우트 레이트리밋 + 크기 상한 5MB — 유료 Deepgram 어뷰징 방어" -- src/lib/rate-limit.ts src/lib/stt-validate.ts src/app/api/speech-to-text/route.ts src/lib/__tests__/<수정한 테스트 파일들>`

---

### Task 2: 채팅 search_web 쿼리 캐시 (순수 in-memory TTL)

배경: `/api/search/web` 라우트는 `unstable_cache` 1시간 캐시가 있는데, 채팅 도구 경유 `searchWebPerplexity`(`src/lib/chat/perplexity-search.ts`)는 캐시가 없어 같은 질문 반복이 매번 유료 호출된다. `src/lib/chat`은 React/Next 비의존 계약이라 `unstable_cache`를 쓸 수 없다 — rate-limit.ts와 동형인 순수 in-memory TTL Map으로 구현한다(인스턴스별 캐시라는 한계는 rate-limit과 동일하게 수용, 주석으로 명시).

**Files:**
- Modify: `src/lib/chat/perplexity-search.ts`
- Test: `src/lib/chat/__tests__/perplexity-search.test.ts` (기존 테스트 파일 위치 확인 후 추가)

**Interfaces:**
- Produces: `searchWebPerplexity` 시그니처 불변. 내부에 `evaluateSearchCache(store, key, now, ttlMs)` 순수 헬퍼(테스트용 export).

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// 캐시 코어는 store·now 주입형이라 결정적으로 검증한다(rate-limit 테스트 동형).
import { readSearchCache, writeSearchCache, type SearchCacheEntry } from "../perplexity-search";

it("TTL 내 동일 키는 캐시 적중, TTL 경과 후 미스", () => {
  const store = new Map<string, SearchCacheEntry>();
  const value = { ok: true } as never;
  writeSearchCache(store, "k", value, 1_000);
  expect(readSearchCache(store, "k", 1_000 + 3_599_000, 3_600_000)).toBe(value);
  expect(readSearchCache(store, "k", 1_000 + 3_600_000, 3_600_000)).toBeNull();
});

it("용량 상한 도달 시 가장 오래된 항목부터 제거", () => {
  const store = new Map<string, SearchCacheEntry>();
  for (let i = 0; i < 501; i++) writeSearchCache(store, `k${i}`, {} as never, i);
  expect(store.size).toBeLessThanOrEqual(500);
  expect(store.has("k0")).toBe(false);
});
```

또한 기존 `searchWebPerplexity` 성공 경로 테스트(fetch mock)에 "동일 인자 2회 호출 시 fetch 1회" 케이스를 추가한다.

- [ ] **Step 2: 테스트 실행, 실패 확인** — export 미존재로 FAIL.

- [ ] **Step 3: 구현** — `perplexity-search.ts`에 추가:

```typescript
/**
 * 쿼리별 in-memory TTL 캐시 — /api/search/web의 unstable_cache 1시간과 등가 정책.
 * src/lib/chat은 React/Next 비의존 계약이라 next/cache를 쓸 수 없어 순수 Map으로
 * 구현한다. ⚠ 인스턴스별 캐시(rate-limit.ts와 동일 한계) — 전역 정확성보다
 * "동일 인스턴스 반복 질문 무료화"가 목적. 실패 결과는 캐시하지 않는다.
 */
export interface SearchCacheEntry {
  value: ToolResult;
  createdAt: number;
}

const CACHE_TTL_MS = 3_600_000; // 1시간(/api/search/web CACHE_TTL_SECONDS와 동조)
const CACHE_MAX_ENTRIES = 500;
const searchCache = new Map<string, SearchCacheEntry>();

export function readSearchCache(
  store: Map<string, SearchCacheEntry>,
  key: string,
  now: number,
  ttlMs: number,
): ToolResult | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (now - entry.createdAt >= ttlMs) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function writeSearchCache(
  store: Map<string, SearchCacheEntry>,
  key: string,
  value: ToolResult,
  now: number,
): void {
  if (store.size >= CACHE_MAX_ENTRIES) {
    // Map은 삽입 순서를 보존 — 가장 오래된 키부터 제거(단순 FIFO로 충분).
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, createdAt: now });
}
```

`searchWebPerplexity` 본문: 인자 파싱(query·maxResults·recencyFilter 확정) 직후에

```typescript
const cacheKey = `${query}|${maxResults}|${recencyFilter ?? ""}`;
const cached = readSearchCache(searchCache, cacheKey, Date.now(), CACHE_TTL_MS);
if (cached) return cached;
```

성공 반환 직전(빈 결과 포함, `ok: true`일 때만):

```typescript
writeSearchCache(searchCache, cacheKey, result, Date.now());
return result;
```

실패 `fail(...)` 경로는 캐시하지 않는다(일시 장애 고착 방지, /api/search/web의 throw 회피와 동일 정책).

- [ ] **Step 4: 테스트 통과 확인** — `npm run test:run` 전량 PASS.

- [ ] **Step 5: 커밋** — `git commit -m "feat(chat): search_web 쿼리 1시간 in-memory 캐시 — 유료 Perplexity 반복 호출 방어" -- src/lib/chat/perplexity-search.ts src/lib/chat/__tests__/<테스트 파일>`

---

### Task 3: 희소 쿼터 API 좌표 캐시 키 반올림 (ODsay·Tmap 4자리, 공기질 측정소 3자리)

배경: ODsay·Tmap은 각 일 1,000건 하드 쿼터에 `revalidate: 3600` 캐시가 걸려 있지만, GPS 전체 정밀도 좌표가 URL(=캐시 키)에 들어가 측위마다 키가 달라져 히트율이 사실상 0이다. 4자리 반올림(±5.5m)은 GPS 오차보다 작아 경로 품질에 무영향. 공기질 측정소 탐색은 측정소 간격이 km 단위라 3자리(±55m)로 충분하다. **kakao-navi(no-store)·region-scan(정확도 우선 판단 기록)·서울지하철 실시간(no-store)은 대상이 아니다.**

**Files:**
- Create: `src/lib/coord-round.ts`
- Modify: `src/lib/providers/odsay.ts:126-129`, `src/lib/providers/tmap-pedestrian.ts:127-130`, `src/lib/providers/air-quality.ts:193` 근처(`fetchNearestStation`)
- Test: `src/lib/__tests__/coord-round.test.ts`

**Interfaces:**
- Produces: `roundCoord(value: number, digits: number): string` — 캐시 키 안정화를 위한 좌표 문자열화. `String(lng)` 대체 전용.

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
import { roundCoord } from "../coord-round";

it("지정 자리수로 반올림한 문자열을 반환한다", () => {
  expect(roundCoord(127.12345678, 4)).toBe("127.1235");
  expect(roundCoord(37.5, 4)).toBe("37.5000"); // toFixed라 자리수 고정 — 키 안정성
  expect(roundCoord(127.0009, 3)).toBe("127.001");
});
```

- [ ] **Step 2: 테스트 실행, 실패 확인** — 모듈 미존재로 FAIL.

- [ ] **Step 3: 구현**

`src/lib/coord-round.ts`:

```typescript
/**
 * 좌표 → 고정 자리수 문자열. 외부 API URL(=Next fetch 캐시 키)에 GPS 전체
 * 정밀도를 넣으면 측위마다 키가 달라져 revalidate 캐시가 헛돈다(히트율 0).
 * 4자리 ≈ ±5.5m(GPS 오차 미만, 경로 API용), 3자리 ≈ ±55m(km 간격 측정소
 * 탐색용). walk-infra.ts 타일 anchor와 같은 정신의 경량판.
 *
 * ⚠ 적용 판단 기준: "캐시가 있고(revalidate), 반올림 오차가 결과를 못 바꾸는
 * 곳"에만. kakao-navi(no-store)·region-scan(시도 경계 판정, 반올림 금지 주석)
 * 에는 쓰지 말 것.
 */
export function roundCoord(value: number, digits: number): string {
  return value.toFixed(digits);
}
```

`odsay.ts:126-129`: `String(origin.lng)` → `roundCoord(origin.lng, 4)` (SX·SY·EX·EY 4곳).
`tmap-pedestrian.ts:127-130`: 동일하게 startX·startY·endX·endY 4곳.
`air-quality.ts` `fetchNearestStation`: `wgs84ToTm(lat, lng)` 호출 전에 `lat = Number(roundCoord(lat, 3)); lng = Number(roundCoord(lng, 3));` (TM 변환 입력을 양자화해 URL 캐시 키 안정화). 각 파일의 캐시 관련 기존 주석(예: tmap-pedestrian.ts:22)에 "좌표는 4자리 반올림으로 캐시 키 안정화" 한 줄을 덧붙인다.

- [ ] **Step 4: 테스트·기존 스냅샷 통과 확인** — `npm run test:run` 전량 PASS. odsay·tmap 기존 테스트가 URL 문자열을 고정 좌표로 단언하고 있으면 반올림 결과로 기대값을 갱신(테스트 좌표가 이미 4자리 이하면 무변경).

- [ ] **Step 5: 커밋** — `git commit -m "feat(quota): ODsay·Tmap 좌표 4자리, 공기질 측정소 3자리 반올림 — 일 1,000건 쿼터 캐시 실효화" -- src/lib/coord-round.ts src/lib/providers/odsay.ts src/lib/providers/tmap-pedestrian.ts src/lib/providers/air-quality.ts src/lib/__tests__/coord-round.test.ts <갱신 테스트>`

---

### Task 4: 함수 리전 icn1 고정

배경: vercel.json이 없어 함수가 미국 기본 리전에서 한국 공공 API를 태평양 건너 호출한다. PROGRESS.md에 "재발 지속 시 icn1 전환 검토" 기록이 이미 있다.

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: 파일 생성**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"]
}
```

- [ ] **Step 2: 로컬 검증** — `npm run build` 통과(설정 파일이 빌드에 영향 없음 확인). 배포 후 확인 방법을 PR/커밋 메시지에 명시: `vercel inspect`로 함수 리전이 icn1인지 확인.

- [ ] **Step 3: 커밋** — `git commit -m "feat(infra): 함수 리전 icn1 고정 — 한국 공공 API 왕복 지연 제거" -- vercel.json`

---

### Task 5: 정본 도메인 gildongmu.dodoplanet.space 반영

배경: 위원장 결정(2026-07-27) — 대외 정본은 `gildongmu.dodoplanet.space`, 사용량이 늘면 독립 도메인 별도 구매 검토. 두 호스트는 같은 Vercel 배포를 가리키므로 코드 동작 변화는 없고 참조 문자열·문서 정합만 맞춘다.

**Files:**
- Modify: `docs/appstore/1.0-submission-draft.md:17-18` (처리방침·지원 URL)
- Modify: `src/lib/providers/overpass.ts:11` (User-Agent)
- Modify: `packages/cli/src/lib/config.ts:11`, `packages/mcp/src/index.ts:13` (기본 API URL)
- Modify: `packages/cli/README.md`, `packages/mcp/README.md` (본문 내 vercel.app URL 존재 시)
- Modify: `PROGRESS.md` (미결 결정 2건 해소 기록)

**변경 금지:** `src/lib/providers/odsay.ts:139`의 Referer(Global Constraints 참조).

- [ ] **Step 1: 문자열 치환** — 위 파일들의 `https://gildongmu.vercel.app` → `https://gildongmu.dodoplanet.space`. 단 CLI/MCP는 `GILDONGMU_API_URL` env 오버라이드가 이미 있으므로 기본값만 교체. 치환 후 `grep -rn "gildongmu.vercel.app" src packages docs`로 잔여 확인 — odsay.ts Referer 1건만 남아야 정상.

- [ ] **Step 2: PROGRESS.md 결정 기록** — 미결 결정 섹션에 추가:

```markdown
- **정본 도메인 확정(2026-07-27, 위원장)**: 대외 정본 = gildongmu.dodoplanet.space(코드·문서 반영 완료). 사용량 증가 시 독립 도메인 구매 재검토. ⚠ odsay.ts Referer는 URI 키 묶임이라 vercel.app 유지 — 교체하려면 ODsay 콘솔에 새 도메인 URI 등록 선행.
- **CLI/MCP 제3자 쿼터 정책(2026-07-27, 위원장)**: 자체 키 없이 개방 유지. 유료 경로(Gemini 채팅·Perplexity)는 서버 IP 레이트리밋으로 방어(채팅 60초 10회 기존 + search_web 캐시 신규). CLI/MCP 기본 URL은 dodoplanet.space 서브도메인으로 교체(다음 릴리스 0.5.0에 반영).
```

- [ ] **Step 3: 게이트 확인** — `npm run test:run`(CLI 테스트가 기본 URL을 단언하면 기대값 갱신) + `npm run lint`.

- [ ] **Step 4: 커밋** — `git commit -m "docs+chore: 정본 도메인 gildongmu.dodoplanet.space 반영 — App Store 제출값·UA·CLI/MCP 기본 URL" -- docs/appstore/1.0-submission-draft.md src/lib/providers/overpass.ts packages/cli/src/lib/config.ts packages/mcp/src/index.ts packages/cli/README.md packages/mcp/README.md PROGRESS.md`

---

## 계획 밖(이 플랜에서 하지 않는 것)

- 유료 API 스펜드 알림(Google AI Studio·Perplexity·Deepgram·Vercel 콘솔): 브라우저 콘솔 작업이라 코드 플랜 밖 — 위원장 안내 목록으로 별도 전달.
- CLI/MCP 0.5.0 릴리스(보행 인프라 카탈로그 포함): Phase 3.
- Sentry 등 관측성: 출시 후 트랙.
- 레이트리밋 Upstash 승격: 인스턴스별 한계는 수용(rate-limit.ts 주석의 기존 판단 유지).
