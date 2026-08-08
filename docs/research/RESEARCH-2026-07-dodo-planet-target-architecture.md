# dodo-planet 타깃 아키텍처 조사 (이식 수용측 지도)

작성: 2026-07-03 (dodo-planet Round 148 기준) | 성격: **이식 수용측 코드베이스 지도**. ⚠ 이 문서가 작성될 당시의 전제("dodo 통합이 최종 목표")는 2026-08-03 위원장 정정으로 폐기됐다 — 지금은 두 독립 프로젝트이고 이식은 **양방향**이며 원장은 `~/Mac-Projects/PORTS.md`다. **아래 코드베이스 조사 내용 자체는 여전히 유효하다**(이식 방향이 바뀌었을 뿐 이식은 계속된다) — 이식 계획 스펙(`~/Mac-Projects/dodo-planet/docs/plans/2026-06-13-korea-local-provider-integration.md`)이 "무엇을 보내는가"를 다룬다면, 이 문서는 **받는 쪽(dodo-planet) 코드베이스가 지금 어떻게 생겼는가**를 파일:라인 근거로 고정한다. gildongmu 자산을 추가 졸업시킬 때 매번 재탐색하지 않기 위한 지도.

> 유의: 라인 번호는 Round 148(2026-07-02) 시점 실측. dodo가 진행되면 어긋날 수 있으므로 수치보다 파일 경로·구조를 정본으로 삼을 것.

## 1. Gemini 함수 계층 (49개)

- **함수 선언(진짜 소스)**: `src/lib/gemini/declarations.ts` — `createToolDeclarations(context)` 팩토리가 `allFunctions[]`(라인 34~1308)를 구성. 두 필터: `BUILDER_ONLY_FUNCTIONS`(finalize_travel_profile, 라인 22), `TRIP_DEPENDENT_FUNCTIONS`(23개, 라인 8~17). 정적 export `toolDeclarations`(라인 1326).
- **카탈로그 메타**: `src/lib/cli/function-catalog.ts` — `FUNCTION_CATALOG[]` 49개 `FunctionMeta`(name/category/verb/requiresTrip/isWrite/isDestructive/isBuilderOnly). CLI 명령 트리 + MCP annotation 매핑용.
- **"카탈로그 3-mirror"의 정확한 의미** (byte-for-byte 미러):
  1. `src/lib/cli/function-catalog.ts` — Next.js 원본(source of truth)
  2. `packages/cli/src/lib/function-catalog-shared.ts` — CLI 패키지 미러
  3. `packages/mcp/src/function-catalog-shared.ts` — MCP 패키지 미러
  - 미러 이유: tsup이 path-alias 없이 각 패키지를 독립 빌드하므로 복사본 유지. drift 방지: `packages/cli/__tests__/catalog-mirror-drift.test.ts`·`packages/mcp/__tests__/catalog-mirror-drift.test.ts`가 `expect(mirror).toBe(source)` byte 일치 검증.
  - 별개로 `src/__tests__/lib/cli-function-catalog.test.ts`가 declarations ↔ catalog 정합 검증: 개수 49 하드코딩(라인 32), trip-independent 26(라인 40), requiresTrip↔`TRIP_DEPENDENT_FUNCTIONS` 일치(라인 48~63), isBuilderOnly=[finalize](라인 88). **함수를 추가하면 이 하드코딩 수치들을 함께 갱신해야 한다.**

## 2. 채팅 라우트 3종과 dispatch

- **텍스트 채팅**: `src/app/api/chat/route.ts`. 함수 선언 주입 `createToolDeclarations(...)`(라인 303~309, hasTrip·cities·countryName·mode 전달), dispatch `executeFunction(...)`(라인 161).
- **음성**: `src/app/api/voice/session/route.ts`(Gemini Live ephemeral 세션 + 시스템 프롬프트, 라인 96·133). 음성은 별도 화이트리스트 `src/lib/voice/function-subset.ts`의 `VOICE_FUNCTION_NAMES` 29개(+builder 시 finalize). 실행 엔드포인트는 `src/app/api/cli/execute/route.ts` 공유로 추정.
- **CLI/MCP**: `src/app/api/cli/chat/route.ts`(대화), `src/app/api/cli/execute/route.ts`(함수 실행), `src/app/api/cli/declarations`(portable declaration HTTP 배포, `src/lib/cli/declarations-portable.ts`의 `getPortableDeclarations`가 @google/genai 타입 의존 제거).
- **dispatch 지점**: `src/lib/gemini/router.ts` `executeFunction()` — 단일 switch(라인 43~521). 각 case가 도메인 모듈(travel-info/flight-search/hotel-search/expenses/bookings/route-briefing 등)로 위임.
- **시스템 프롬프트**: `src/data/system-prompt.ts` `composeSystemPrompt(opts)` — baseContext/travelerId/mode/locale/**countryCode**. **koreaGuidance 이미 구현됨**: `countryCode?.toUpperCase()==="KR"`이면 general 모드에 `p("koreaGuidance", locale)` 부착(라인 206~209). 문구 정본은 `src/data/prompt-messages.ts:1214`(5개 언어) — "구글맵 자동차 길찾기 불가 → get_car_route_briefing, 대중교통은 get_directions(transit), 한국 장소는 카카오 자동, rating/isOpen 지어내지 마라". baseContext는 `src/data/tripContext.ts` `generateTripContextAsync(...)`(chat route 라인 348~349).
- 3-라우트(채팅·음성·CLI) 동등성은 `composeSystemPrompt`·카탈로그 단일 진입점으로 보장되는 구조(M7 web-cli invariant 패턴) — 이식 시 어느 한 라우트에만 배선하는 실수가 대표 리스크.

## 3. 한국 컨텍스트 감지 (라우팅의 심장)

- **핵심**: `src/lib/providers/index.ts:21~27` `isKoreaContext(ctx)`. **좌표 우선 원칙** — `ctx.coords` 있으면 `isInKorea(lat,lng)`(한반도 bbox, `deeplink.ts`)가 결정하고, 좌표 없을 때만 `countryCode==="KR"` 보조. 근거 주석: 한국 여행이어도 해외에서 GPS "주변" 검색이면 구글이 맞다.
- **countryCode 출처**: trip 모델 `country` 필드. chat route가 `tripConfig?.country`를 composeSystemPrompt(라인 415)와 `ExecutionContext`(라인 427) 양쪽에 주입. `ExecutionContext.countryCode`는 `src/lib/gemini/types.ts:23`.
- **여행 미선택(trip-less) 채팅**: 가능(`tripId` nullable, chat route 라인 95). trip 없으면 `hasTrip:false` → trip-dependent 23개 함수 제외, **countryCode도 undefined** → koreaGuidance 미부착, provider 라우팅의 한국 판정은 **사용자 GPS 좌표(isInKorea)가 유일한 신호**.
- ⚠ **이식 spec에서 다뤄야 할 공백**: "한국 여행 미선택 + 한국 관련 채팅"을 한국 API로 라우팅하려면 GPS 외 신호(질의 언어·지명 감지·명시적 사용자 설정 등)로 trip-less 한국 판정을 보강하는 결정이 필요하다. 현재 구조엔 그 신호가 없다.

## 4. Provider 계층 (이식 자산이 안착하는 곳)

- **구조** `src/lib/providers/`(13파일): `index.ts`(라우팅 진입점) / `env.ts`(키 헬퍼) / `types.ts`(`PlaceProvider = "google"|"kakao"|"naver"|"tour-api"|"mock"`, 라인 40) / `deeplink.ts`(isInKorea)·`deeplink-kakao.ts` / `kakao-local.ts`·`kakao-address.ts`·`kakao-navi.ts` / `tour-api.ts`(**휴면 — 라우팅 미연결, 파일+테스트만 이식됨. gildongmu 최신 라벨 맵으로 재동기 필요**) / `google.ts` / `mock.ts` / `format.ts`.
- **`selectPlacesProvider(ctx)`**: `index.ts:43`. `ProviderRoutingContext { coords?, countryCode?, locale }` → `"kakao"|"tour-api"|"google"`. 규칙: `PLACES_PROVIDER` env 강제 우선 → `isKoreaContext && hasKakaoKey()` → kakao → 아니면 google. **tour-api 자동 라우팅 v2(한국 && locale≠ko && TOUR_API_KEY → tour-api)는 주석의 계획으로만 존재, 미구현.**
- **사용처 2곳**: `src/lib/gemini/travel-info.ts:249`(search_nearby_places — kakao 분기 라인 255~298, 카카오 실패 시 구글 재시도 안 함 = "가짜 실데이터 금지"의 도메인 규칙), `src/app/api/places/autocomplete/route.ts:61`.
- **route-briefing**: `src/lib/gemini/route-briefing.ts` `getCarRouteBriefingGemini()` — selectPlacesProvider를 거치지 않고 카카오 모듈 직접 호출. get_car_route_briefing은 한국 전용 함수. gildongmu C1의 NCP lang 디스패치(en→NCP·ko→카카오)는 아직 dodo에 없다.
- **API 라우트**: `/api/route/car`(카카오 자동차 경로 프록시, isInKorea refine, 키 없으면 503), `/api/geocode/kakao`. 둘 다 `requireAuth()` — **dodo는 서버 키 프록시에 인증 필수**(gildongmu는 공개 데모라 무인증이었음, 이식 시 반드시 붙일 것).

## 5. env 키 관리

- **중앙 env.ts 없음** — P5 로드맵에 `src/lib/env.ts`(zod 중앙 검증) 신설이 미완 과제로 명시. 현재는 분산 lazy 읽기.
- 한국 키 헬퍼: `src/lib/providers/env.ts` — `getKakaoKey()`/`hasKakaoKey()`(`KAKAO_REST_API_KEY`), `hasTourApiKey()`(`TOUR_API_KEY`, 값 미등록). **호출 시점 lazy 읽기가 dodo 관례**(테스트가 process.env를 테스트별로 갈아끼우는 관행과 호환 — gildongmu의 module-scope zod parse를 그대로 가져가면 안 됨).
- `NCP_*` 키는 dodo에 **아직 없음** — §5b에서 `ncp-directions.ts` 합류 시 `.env.local` + Vercel 3환경 등록 필요(Round 148 `TRAVELPAYOUTS_API_TOKEN` 등록 패턴 참조).

## 6. 진행 상태 (Round 148, 2026-07-02)

- 완성도 9.9/10, AI 함수 49개. 카카오 provider(장소 검색 라우팅 + 자동차 경로 브리핑)는 **완결**, TourAPI·NCP는 **휴면**.
- PROGRESS.md 기준 "가장 가까운 다음 작업" = **한국 로컬 §5b 다국어 데이터 활성화**: ① `ncp-directions.ts`(lang=en) ② `tour-api.ts` 재동기 + `TOUR_API_KEY` + 라우팅 v2 ③ `get_car_route_briefing` locale 라우팅 ④ `get_place_overview`(TourAPI 영문) ⑤ 영문 현위치 체인. gildongmu 측 대응물: C1 ncp-directions **완료**, `getEnglishAddress()` 체인·tour-api 함수 확장은 Phase 0b 잔여.
- 주의: P0 최상단은 Amadeus self-service 폐쇄(2026-07-17) 대응 — 한국 이식과 리소스 경합 가능.

## 7. 테스트·검증 체계 (이식 산출물이 통과해야 할 게이트)

- **게이트 테스트**: `npm run test:run`(Vitest, ~1,886건). Gemini 함수 테스트는 `src/__tests__/lib/gemini/` 도메인별(`travel-info-kakao.test.ts`·`route-briefing.test.ts` 등). 기능·버그픽스는 같은 커밋에 테스트 동반이 repo 규칙.
- **카탈로그 정합**: `cli-function-catalog.test.ts` + 2개 mirror-drift 테스트(§1).
- **eval 레인**: `vitest.eval.config.ts` + `scripts/evals/function-calling.eval.ts`(`npm run eval:fc`, LLM 호출).
- **실호출 머지 게이트**: `scripts/verify-*.mjs` 패턴(예: verify-travelpayouts 4/4 PASS) — "코드 리뷰 ≠ 데이터 현실" 원칙. gildongmu 자산 이식 시에도 provider별 실호출 검증 스크립트를 같은 패턴으로 동반할 것.

## 8. 체크리스트 — 이식 1건당 만질 파일

### A. 새 Gemini 함수 1개 추가
1. `src/lib/gemini/declarations.ts` — `allFunctions[]`에 선언 추가(+trip 필요 시 `TRIP_DEPENDENT_FUNCTIONS`, builder 전용 시 `BUILDER_ONLY_FUNCTIONS`)
2. `src/lib/gemini/<domain>.ts` — 핸들러 구현(신규 도메인이면 새 파일)
3. `src/lib/gemini/router.ts` — import + switch `case`
4. `src/lib/cli/function-catalog.ts` — `FunctionMeta` 추가
5. `packages/cli/src/lib/function-catalog-shared.ts` — byte-for-byte 동일 갱신
6. `packages/mcp/src/function-catalog-shared.ts` — byte-for-byte 동일 갱신
7. `src/lib/voice/function-subset.ts` — 음성 허용 시 `VOICE_FUNCTION_NAMES` 추가
8. `src/__tests__/lib/cli-function-catalog.test.ts` — 하드코딩 개수 갱신(49→50 등)
9. `src/__tests__/lib/gemini/<domain>.test.ts` — 테스트 동반(같은 커밋)
10. (선택) `src/data/tripContext.ts` `generateAppIntroSection` 툴 목록(라인 272~298) — 프롬프트 노출 시

### B. 새 외부 provider(한국 전용) 추가
1. `src/lib/providers/<new>.ts` — 클라이언트(fetch + 정규화). `tour-api.ts`/`kakao-local.ts`가 템플릿
2. `src/lib/providers/env.ts` — `has<X>Key()`/`get<X>Key()` lazy 헬퍼
3. `src/lib/providers/types.ts` — 장소 provider면 `PlaceProvider` union 확장
4. `src/lib/providers/index.ts` — `selectPlacesProvider` 규칙 확장(경로 등 다른 종류면 새 selector)
5. 소비처 배선: `src/lib/gemini/travel-info.ts`(장소) 또는 `route-briefing.ts` 계열 분기
6. env 등록: `.env.local` + Vercel 3환경
7. `scripts/verify-<provider>.mjs` — 실호출 머지 게이트
8. provider·함수 테스트

## 9. 이식 spec에 반영할 3축 요약

koreaGuidance·카카오 라우팅·selectPlacesProvider·env 헬퍼·tour-api 휴면 파일이 이미 깔려 있으므로, gildongmu 자산 추가 졸업은 사실상:

1. **함수 배선**: declarations + router + 카탈로그 3-mirror(+음성 subset) 일괄 갱신 (§8-A)
2. **라우팅 규칙 확장**: `selectPlacesProvider` v2(tour-api)·경로 selector(NCP) 등 (§8-B)
3. **trip-less 한국 판정 보강 결정**: GPS 외 신호를 도입할지 — 현재 구조의 유일한 설계 공백 (§3)
