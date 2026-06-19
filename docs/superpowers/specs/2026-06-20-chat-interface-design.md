# 채팅 인터페이스 설계 (dodo-planet 호환)

> 작성 2026-06-20. 길동무에 자연어 채팅 모드를 추가해, 지금까지 연결한 모든 외부 서비스(장소·주소·길찾기·지하철·버스·따릉이·공기질·소아진료·역 편의시설·내 주변 둘러보기·아이 놀 곳)를 대화로 사용한다. dodo-planet의 검증된 Gemini function-calling 아키텍처를 이식해 **추후 dodo-planet 통합을 구조적으로 보장**한다. 초기 화면은 기존 미니멀 철학을 유지하고, 채팅은 검색과 토글로 전환한다.

## 1. 목표와 측정 가능한 성과

**목표**: 검색창에 키워드를 넣고 결과를 훑는 기존 흐름에 더해, "길동 주변에 지금 문 연 약국 알려줘", "강남역 다음 열차 언제 와", "여기 공기질 어때" 같은 **자연어 한 문장**으로 동일한 외부 서비스를 호출하고, 결과를 기존 리치 컴포넌트로 받아 본다.

**측정 가능한 성과**(빌드 전 명명):
- 한 채팅 문장으로 14개 도구(§6) 중 올바른 도구가 선택되고, 결과가 해당 리치 컴포넌트로 렌더된다(도구별 실호출 스모크).
- 검색 모드 ⇄ 채팅 모드를 버튼 1회 또는 `Ctrl+Shift+C/S`로 전환하고, `Shift+Esc`로 현재 모드 편집창에 진입한다.
- 키 미보유(`GEMINI_API_KEY` 없음) 시 채팅 토글이 미노출되고 순수 검색 동작이 회귀 0으로 보존된다.
- 스크린 리더만으로 채팅 전송 → 산문 안내 통지 → 카드 탐색이 완결된다.

**비목표(범위 밖)**: 풀 음성 대화(Gemini Live), 멀티턴 장기 메모리/세션 영속, 채팅 히스토리 패널, 채팅에서의 데이터 쓰기(예약·저장). V1은 **읽기 전용 조회 도구**만 노출한다.

## 2. 사용자 시나리오

1. **시각장애인(ko)**: 홈에서 `Ctrl+Shift+C`로 채팅 진입 → 받아쓰기 또는 타이핑으로 "내 주변 지하철 도착 정보" → assistant가 "근처 3개 역의 도착 정보예요" 산문을 polite로 통지 + `SubwayArrivalList` 카드 렌더 → 카드 탐색.
2. **외국인(en/es/fr/it)**: 채팅 UI 텍스트는 자국어, 장소·역명 데이터는 영문(`dataLocale`). "Where can I find a pharmacy near here?" → `get_night_clinics`/`search_places` 결과 영문 카드.
3. **PC 사용자**: 검색하다 `Ctrl+Shift+C`로 채팅, `Ctrl+Shift+S`로 검색 복귀, `Shift+Esc`로 입력창 포커스 — 마우스 없이 모드·입력 전환.

## 3. 아키텍처

핵심 원칙: **채팅 엔진은 기존 provider 진입점을 호출하는 얇은 디스패치 레이어다. 외부 API 로직을 복제하지 않는다.**

```
ChatInput ──POST /api/chat──▶ Gemini (function-calling, declarations 주입)
   ▲                              │ functionCall(name, args)
   │ 메시지 스트림                  ▼
useChat ◀── { text, render? } ── src/lib/chat/router.ts
                                   executeFunction(name, args, ctx)
                                   │  (새 도메인 로직 0)
                                   ▼
              기존 providers: searchPlaces · findAirQualityNear · fetchSubwayArrivals ...
                                   │
                                   ▼
                  { summary: string, render?: RenderPayload }
                       │                    │
                       ▼                    ▼
               Gemini가 산문 생성      클라가 리치 컴포넌트 렌더
```

**데이터 흐름**:
1. 클라가 사용자 텍스트 + `ExecutionContext`(현재위치·locale)를 `/api/chat`에 POST.
2. 서버가 Gemini에 메시지 + `declarations`(게이트 통과 도구만)를 보낸다.
3. Gemini가 `functionCall`을 반환 → 서버 `executeFunction`이 해당 provider를 호출.
4. provider 결과를 `{ summary, render? }`로 매핑. `summary`(텍스트)를 Gemini에 되돌려 **안내 산문**을 받고, `render`(structured)는 응답에 함께 실어 클라로 전달.
5. 클라가 메시지 버블을 그린다: assistant 산문 + (있으면) `RenderPayload`를 기존 컴포넌트로 렌더.

**dodo 대비 유일한 확장**: dodo의 `executeFunction`은 `string`만 반환한다. 길동무는 리치 카드를 위해 `{ summary, render? }`로 확장한다. `summary`만 쓰면 dodo 동작과 동일하므로 **상위 호환**이며, 이 확장은 추후 dodo에 역수입 가능하다.

## 4. 파일 구조 (dodo와 동일 네이밍·위치 = 호환의 본체)

| 경로 | 역할 | React 의존 | dodo 대응 |
|------|------|-----------|-----------|
| `src/lib/chat/router.ts` | `executeFunction(name, args, ctx)` 디스패치 | ✗ | `gemini/router.ts` |
| `src/lib/chat/declarations.ts` | Gemini function declarations + 게이트 필터 | ✗ | `gemini/declarations.ts` |
| `src/lib/chat/types.ts` | `ExecutionContext`·`RenderPayload`·메시지 타입 | ✗ | `gemini/types.ts` |
| `src/lib/chat/render.ts` | provider 결과 → `RenderPayload` 매핑 헬퍼 | ✗ | (신규 확장) |
| `src/lib/chat/keyboard-shortcuts.ts` | dodo에서 이식 + 모드토글 액션 추가 | ✗ | `chat/keyboard-shortcuts.ts` |
| `src/lib/gemini/client.ts` | Gemini 클라이언트(모델·키) | ✗ | `gemini/client.ts` |
| `src/app/api/chat/route.ts` | 채팅 엔드포인트(서버 function 실행) | — | `app/api/chat/route.ts` |
| `src/hooks/useChat.ts` | 메시지 상태·sendMessage·error·로딩 | ✓ | `hooks/useChat.ts` |
| `src/components/chat/ChatInterface.tsx` | 채팅 화면 컨테이너 | ✓ | 동일 |
| `src/components/chat/ChatInput.tsx` | 입력창 + 마이크(기존 VoiceRecordButton) | ✓ | 동일 |
| `src/components/chat/MessageBubble.tsx` | 메시지 1건 렌더(산문 + RenderPayload 디스패치) | ✓ | `MessageBubble.tsx` |
| `src/components/ModeToggle.tsx` | 검색⇄채팅 토글 버튼 | ✓ | (신규) |

`src/lib/chat`·`src/lib/gemini`는 **React/Next 비의존 유지**(CLAUDE.md 이식성 원칙). UI 컴포넌트만 React 의존.

## 5. 채팅 엔진 계약

### 5.1 `ExecutionContext`
```ts
interface ExecutionContext {
  userLocation?: { lat: number; lng: number }; // 공유 geolocation 스토어에서
  locale: SupportedLocale;       // ko|en|es|fr|it (UI 언어)
  dataLocale: "ko" | "en";       // 외부 데이터 언어 (dataLocale()로 파생)
}
```
외부 데이터 분기는 **절대 `locale` 원시값을 직접 쓰지 않고** `dataLocale`/`prefersEnglish`를 거친다(기존 규칙 계승).

### 5.2 function 실행 반환
```ts
type ToolResult = {
  summary: string;          // Gemini가 산문화할 자연어 결과 요약 (도구 결과의 핵심 사실)
  render?: RenderPayload;   // 클라가 리치 컴포넌트로 그릴 structured 데이터
};
type RenderPayload =
  | { type: "places"; places: Place[] }
  | { type: "addresses"; results: JusoAddress[] }
  | { type: "car-route"; route: CarRoute }
  | { type: "transit-route"; route: TransitRoute | null }
  | { type: "subway-arrivals"; stations: NearbyStationArrival[] }
  | { type: "bus-arrivals"; stops: BusStop[] }
  | { type: "bike-stations"; stations: BikeStation[] }
  | { type: "air-quality"; air: AirQuality | null }
  | { type: "night-clinics"; clinics: NightClinic[] }
  | { type: "station-facilities"; korail?: StationFacilities; metro?: SeoulMetroFacilities }
  | { type: "station-meta"; meta: StationMeta | null }
  | { type: "surroundings"; places: SurroundingPlace[] }
  | { type: "kids-places"; places: KidsPlace[] };
```
`RenderPayload`는 기존 provider 반환 타입을 그대로 재사용한다(신규 DTO 최소화). `MessageBubble`이 `type`으로 기존 컴포넌트에 디스패치한다.

### 5.3 에러 처리 — 기존 3-state 계승
- provider가 throw(upstream 장애) → 도구 결과 `summary`에 "조회 실패"를 담아 Gemini가 사과 산문 생성, `render` 없음. "정보 없음"과 "조회 실패"를 뭉개지 않는다.
- provider가 빈 결과/null(graceful) → `summary`에 "결과 없음", `render`는 빈/`null` 페이로드(컴포넌트가 빈 상태 처리).
- Gemini API 자체 실패 → `/api/chat` 502, `useChat`이 코드→로케일 번역 에러를 assertive 통지.

## 6. 도구 카탈로그 (V1 = 전체)

각 도구 = **기존 provider 진입점 호출 + `{summary, render}` 매핑**. declaration은 게이트 통과 시에만 Gemini에 노출.

| function | provider 진입점 | route 참조 | 게이트 |
|----------|----------------|-----------|--------|
| `search_places` | `searchPlaces` / `searchPlacesMergedEn`(en) | `places` | `hasKakaoKey` |
| `search_address` | `searchJusoAddresses` | `address/search` | `hasJusoKey` |
| `get_car_route` | `getCarRouteBriefing` / `getCarRouteBriefingEn`(en) | `route/car` | `hasKakaoKey`(en은 `hasNcpMapsKeys`) |
| `get_transit_route` | `getTransitRoute` | `route/transit` | `hasOdsayKey` |
| `get_subway_arrivals` | `fetchNearbySubwayArrivals` / `fetchSubwayArrivals` | `station/subway-arrival[/nearby]` | `hasSeoulSubwayRealtimeKey` |
| `get_bus_arrivals` | `fetchNearbyBusStops` | `bus/nearby` | `hasDataGoKrKey` |
| `get_bus_route` | `fetchBusRouteStops` | `bus/route` | `hasDataGoKrKey` |
| `get_bike_stations` | `fetchNearbyBikeStations` | `bike/nearby` | `hasSeoulOpenDataKey` |
| `get_air_quality` | `findAirQualityNear` | `air-quality/nearby` | `hasDataGoKrKey` |
| `get_night_clinics` | `findNightClinicsNear` | `clinic/nearby` | `hasDataGoKrKey` |
| `get_station_facilities` | `fetchStationFacilities`(코레일) + `fetchSeoulMetroFacilities`(서울) | `station/facilities`·`station/metro-facilities` | `hasDataGoKrKey` |
| `get_station_meta` | `findStationMeta`/`findStationsByName`/`findStationsNear` | `station/meta` | 없음(정적 seed) |
| `get_surroundings` | `findSurroundingsNear` | `places/around` | `hasKakaoKey` |
| `get_kids_places` | `findKidsPlacesNear` | `places/kids` | `hasKakaoKey` |

**좌표가 필요한 도구**(주변/근접류)는 `ExecutionContext.userLocation`을 우선 사용. 없으면 declaration에 "현재 위치 필요" 안내를 두어 Gemini가 사용자에게 위치 요청 또는 지명 인자를 받게 한다. `get_subway_arrivals`는 역명 기반이므로 좌표→`findStationsNear`로 근접역 식별(기존 `subway-nearby` 경로 재사용).

## 7. UI/UX (미니멀 유지)

- **모드 토글**(`ModeToggle.tsx`): 헤더 영역에 버튼 **1개**. 라벨은 텍스트("채팅으로"/"검색으로"), **이모지 금지**, lucide 아이콘 + 텍스트 허용. `aria-pressed` 또는 두 모드를 명시하는 접근 가능한 이름.
- **초기 디폴트 = 검색 모드**(기존 철학 보존). 채팅은 의도적 전환으로만 진입.
- **모드 상태**: `?mode=chat` URL 동기화(검색의 `?q=`와 공존) + `localStorage`로 마지막 모드 기억(다음 방문 복원). 단 **공유 링크가 채팅을 강제하지 않도록** 첫 진입 디폴트는 검색, `localStorage`는 같은 브라우저 재방문에만 적용.
- **채팅 화면**(`ChatInterface`): 위 메시지 리스트 + 아래 입력창. 메시지 = 사용자 텍스트(우/구분) / assistant(산문 + 선택적 카드). 빈 상태엔 예시 프롬프트 칩 몇 개(선택, 미니멀).
- **렌더 디스패치**: `MessageBubble`이 `render.type`으로 기존 컴포넌트 호출. 컴포넌트는 채팅 맥락에 맞게 **불변 재사용**(props만 주입). 채팅 버블이 카드를 덮는 `aria-label` 추가 금지(First Rule of ARIA).

## 8. 키보드 단축키 (`keyboard-shortcuts.ts` 확장)

dodo의 `matchChatShortcut`을 이식하고 **모드 토글 액션 2종 추가**:

| 키 | 액션 | 비고 |
|----|------|------|
| `Ctrl+Shift+C` | `chat-mode` | 채팅 모드 전환 (신규) |
| `Ctrl+Shift+S` | `search-mode` | 검색 모드 전환 (신규) |
| `Shift+Esc` | `focus-input` | 현재 모드 편집창 포커스(검색창/채팅 입력창) — dodo와 동일 |
| `Ctrl+Shift+D` | `dictation` | 받아쓰기 토글(채팅 모드, dodo와 동일) |

- 판정은 **`event.code`**(물리 키 위치, IME·레이아웃 무관), macOS도 `metaKey` 아닌 **`ctrlKey`**(dodo 규약 계승). 순수 함수 `matchChatShortcut`로 분리해 테스트 고정.
- 단축키 안내는 `aria-keyshortcuts` 대신 **`aria-label`에 합쳐**(`appendShortcutHint`) — dodo의 VoiceOver "Shortcuts available" 접두사 함정 교훈을 그대로 계승. `+`는 공백 치환.
- 전역 리스너는 입력 충돌이 없다(모두 `Ctrl+Shift` 또는 `Shift+Esc`). `Shift+Esc`만 `preventDefault`로 브라우저 기본 동작 차단.

## 9. 접근성

- **새 assistant 메시지**: 단일 polite live region으로 **산문(summary 기반)** 통지. 카드 내용은 카드 자체 시맨틱이 담당(이중 낭독 금지).
- **모드 전환**: 전환 직후 새 화면의 첫 의미 요소(채팅이면 입력창 또는 메시지 영역 헤딩)로 포커스 이동 — 맥락 상실 방지.
- **로딩**: assistant 응답 대기 중 `aria-busy`. 장시간 대기 시 polite "답변 생성 중".
- **에러**: 코드→로케일 번역, assistant 메시지로 표현(한국어 하드코딩 금지).
- **리치 카드**: 기존 컴포넌트의 검증된 접근성을 불변 재사용. 채팅 스트림에 카드가 누적될 때 각 메시지를 적절한 구획(예: 메시지 그룹)으로 두되 과잉 landmark/region 금지.
- 모든 컨트롤 키보드 도달 + `:focus-visible`, 터치 타깃 44×44 이상.
- a11y 변경 후 `a11y-auditor` 서브에이전트 점검(워크스페이스 규칙).

## 10. 음성

- `ChatInput`에 기존 `VoiceRecordButton` + `useVoiceRecorder`(Deepgram nova-3, `language` 명시) **재사용**. 받아쓰기 텍스트를 채팅 입력에 채우고(또는 즉시 전송), 효과음(`useRecordingSound`) 그대로.
- STT 결함 교훈 계승: `detect_language` 미사용, `dataLocale`이 아니라 **실제 로케일**을 STT에 전달(es/fr/it 직접 인식, 기존 `SttLocale` 규칙).

## 11. i18n

- UI 텍스트(모드 토글·채팅 라벨·빈 상태·에러·단축키 힌트) 5개 언어 `messages/*.json` 추가. `i18n-messages.test.ts`가 ko 기준 키 집합·ICU·t.rich 태그 동일성 머지 게이트.
- function `declarations`의 자연어 설명은 Gemini가 도구를 정확히 고르도록 작성(영어 기준 + 필요 시 한국어 예시). **시스템 프롬프트는 응답 언어를 `locale`로 지정**해 Gemini가 사용자 언어로 산문 생성.
- 외부 데이터 영문/한글 분기는 `dataLocale`로 일원화.

## 12. 환경변수 · 게이트 · 비용

- **`GEMINI_API_KEY` 신규**(서버 전용, 클라 노출 금지). dodo와 동일 모델 계열 사용(최신 안정 Gemini). 비용은 사용량 기반 — 채팅 사용 시에만 호출.
- **`hasGeminiKey()` 게이트**(`env.ts`에 추가) → `canShowChat`. 키 없으면 **모드 토글·채팅 import·단축키 미등록**, 순수 검색 동작 회귀 0.
- 프로덕션 배포 시 Vercel env에 `GEMINI_API_KEY` 등록 + 재배포(기존 키 주입 규칙).
- 쿼터 보호: `/api/chat`은 캐시 불가(대화). 남용 방지는 V1 범위 밖(후속, 필요 시 rate limit).

## 13. 테스트 전략

**게이트 테스트(결정적, 매 커밋)**:
- `matchChatShortcut`: 4개 액션 매핑 + 비매칭 null + modifier 경계(fixture).
- `executeFunction` 디스패치: 각 function name → 올바른 provider 호출(provider mock) + `{summary, render}` 매핑.
- `declarations` 게이트 필터: 키 유무에 따라 노출 도구 집합이 달라짐.
- `render.ts` 매핑: provider 결과 → `RenderPayload` 투영(fixture).
- 모드 전환 순수 로직(URL/localStorage 동기화) 결정적 테스트.
- `i18n-messages.test.ts` 통과(신규 키 포함).

**주기 eval(머지 게이트 밖, ship 전/야간)**:
- Gemini 실호출: 대표 한국어/영어 프롬프트 N개 → 올바른 function 선택률(임계값). LLM 호출이라 비결정적 → 별 레인.

**실호출 스모크(머지 게이트)**: dev 서버에서 도구별 대표 문장 1개씩 → 해당 카드 렌더 확인(외부 API 통합은 실호출이 진실, fixture green ≠ 실계약).

## 14. dodo-planet 호환 체크리스트

- `src/lib/chat`·`src/lib/gemini` 네이밍·위치를 dodo와 일치, React 비의존 유지.
- `ExecutionContext`·`executeFunction` 시그니처를 dodo와 정합(길동무는 `{summary, render}` 상위 호환 확장).
- `keyboard-shortcuts.ts`는 dodo 모듈에 모드토글 액션만 추가 — 통합 시 머지 용이.
- 통합 경로: 길동무의 한국 로컬 도구(declarations + router case + render 매핑)를 dodo router에 **그대로 합치거나**, 채팅 컴포넌트를 공유. provider는 길동무 `src/lib/providers`를 dodo로 이식(이미 React 비의존).

## 15. 범위 밖 · 후속 마일스톤

- 풀 음성 대화(Gemini Live `VoiceChatOverlay`) — 별도 마일스톤.
- 채팅 히스토리 영속·세션 패널(`useChatHistory`) — V1은 세션 내 메모리만.
- 채팅에서의 쓰기 작업(예약·즐겨찾기 저장) — 읽기 전용 V1 이후.
- rate limit / 남용 방지 — 사용량 관찰 후.
- ODsay `get_transit_route`는 프로덕션 IP 화이트리스트 미해결이라 **프로덕션에선 게이트로 자동 비노출**(개발만). 별도 마일스톤에서 해결.

## 16. 미해결 결정(구현 중 확정)

- Gemini 응답을 **스트리밍** 할지 턴 단위로 한 번에 받을지 — function-calling 2-pass 구조상 V1은 턴 단위가 단순(스트리밍은 후속). 접근성상으로도 완성 산문 1회 통지가 깔끔.
- 빈 상태 예시 프롬프트 칩 포함 여부 — 미니멀 우선, 구현 시 위원장 확인.
- 모드 토글의 정확한 헤더 배치 — 기존 `Header`/`PlaceSearch` 레이아웃 확인 후 결정.
