# 2026-08-31 비-ko 로케일 한국어 잔존 정리 — 병렬 세션 계획

코디네이터: gildongmu-9a(접수·판정 세션). 조사 원본은 이 세션의 3갈래 전수 조사(웹 i18n·iOS·데이터 원천, 실호출 포함)이며 아래 항목은 코디네이터가 표본 재검증했다(`"건너"` 판정·`RouteService.car` lang 기본값·seed `nameEn` 1,098/1,098·car 라우트 en 조건).

## §1 마일스톤·판정

| ID | 내용 | 웨이브 | 판정 |
|---|---|---|---|
| A26 | 비-ko 결함 묶음 6항(아래 §5 프롬프트가 정본) | 1 (즉시) | 불필요 |
| E27 | 대중교통 영문화(ODsay `lang=1`·노선명 영문 표·도착 문장 영어 생성) | 2 | ✅ 2026-08-31 확정(아래) |
| E28 | 장소명 영문 병기(로마자 서버 투영·한 줄 괄호 병기·접근명 단일화) | 2 | ✅ 2026-08-31 확정(아래) |

**위원장 판정(2026-08-31, 순차 문답 4건):**
1. **대중교통 경로는 ODsay `lang=1` 영문 채택.** 역명·노선명·버스 번호는 그대로, 버스 정류소명은 우리가 구분자·약어만 정규화(`. `→`, `, `Stn.`→`Station`, `ㆍ`→쉼표). 한글은 `*Kor` 병기 필드로 시각 표시.
2. **지하철 실시간 도착 문장은 en에서 코드 기반 영어 단문 생성**(`arvlCd` + `arvlMsg2` 분·초·잔여역 정규식 + 종착 `bstatnNm`→seed `nameEn`). 해석 실패는 한국어 원문 폴백(`lang="ko"`). ko 화면은 완성 문장 정본 불변.
3. **영문 원천 없는 장소명(가게·병원·정류소 등)은 한글 + 로마자 병기, 스크린 리더는 로마자 한 줄만.** 서울시 외국어 표기 사전(OA-2475)은 실측상 도로명·시청 조직명 사전이라 **채택하지 않는다**(가게·병원·역명 매칭 0/15·0/15·1/15).
4. **병기 모양은 한 줄 괄호** `Gangnam Station (강남역)`(코디네이터 추천은 두 줄이었으나 위원장 결정). 접근성 정합: **접근 가능한 이름은 괄호 앞 영문·로마자만**(웹은 괄호부 `<span lang="ko" aria-hidden>`, iOS는 `.accessibilityLabel`에 영문만) — 한 줄 한 객체 유지, 이중 낭독 없음.

**코디네이터가 정한 설계 사항(판정 아님):**
- 로마자 변환은 **서버 한 곳**(`src/lib/romanize.ts`)에서 하고 응답에 additive 필드로 싣는다 — Swift 이식·iOS 내장 `.toLatin`(자모 치환뿐, 사용 불가 실측)을 피하고 웹·iOS·CLI가 같은 값을 본다. 영문 원천이 있는 이름(역명 `nameEn`·juso `engAddr`·TourAPI·ODsay 영문)에는 로마자를 쓰지 않는다.
- ODsay 조인 키(운행시간·빠른하차·실시간 추적·`subwayLineCore`의 `(급행)` 토큰)는 **전부 `*Kor` 필드**로 — 영문 `name`은 급행 표지를 잃는다(실측 `Line 9`).
- 노선명 영문 표는 `subway-line-names.ts` ↔ Kit 미러 + 공유 fixture, seed `lineName` 고유값 전수 포함 drift 테스트.
- 실시간 대중교통 안내의 en 게이트(`!prefersEnglish`)는 **E27 범위 밖**(실험판 봉인이 별도로 있어 정식 사용자 도달 없음) — E27 종결 시 BACKLOG 판정 대기로 남긴다. CLI/MCP `route transit`의 `lang`은 E26 동형으로 범위 밖.
- iOS VoiceOver 한국어 구간 언어 태깅은 E28이 헬퍼(`Text(verbatim:).environment(\.locale, ko)` 후보 ①)를 폴백 자리에 적용하되 **실기기 판정 항목**(SwiftUI `accessibilitySpeechLanguage` 미동작 보고 있음).

- 코디네이터가 정한 설계 사항(판정 아님): car ko 폴백은 N4의 의도된 결정이라 뒤집지 않고 **응답 언어 마커**로 정직화한다. `"건너"` 수정은 ko 동작 불변이 계약이다.
- W1(WebMCP, 2026-09-04 마감)과의 우선순위: 위원장이 본 건 착수를 직접 지시(2026-08-31). 파일 소유가 겹치지 않아 병행 무해(webmcp·PlaceSearch·DirectionsView는 A26 소유 밖).

## §2 파일 소유권 지도

**en-fix(웨이브 1) 소유:**
- iOS: `ios/GildongmuKit/Sources/GildongmuKit/GuideLiveRows.swift`, `RouteService.swift`, `ios/Gildongmu/Directions/BeaconModel.swift`(car `lang` 배선 한정), `ios/Gildongmu/Nearby/BusNearbyView.swift`, `ios/Gildongmu/BarrierFreeInfoSection.swift`, 両 `Localizable.xcstrings`(신규 키 추가만)
- 웹: `src/components/CarRouteBriefing.tsx`, `TransitRouteBriefing.tsx`, `src/lib/providers/tour-barrier-free.ts`, `seoul-elevator.ts`, `seoul-metro-facilities.ts`, `tago-subway.ts`, `src/lib/place-lines/*`, `src/app/api/route/car/route.ts`(언어 마커), `messages/*.json`(신규 키), lang="ko" 마크업 대상 컴포넌트(`PlaceCard`·`PlaceDetail`·`AroundNearby`·`LocationBar`·`LocalConditions`·`TransitGuidePanel`·station 계열)
- 공용 생성물 규약: `CHANGELOG.md`·`docs/BACKLOG.md`는 **자기 항목만**, rebase 후 `comm -23` 소실 대조. AGENTS.md류 생성물은 rebase 뒤 재생성.
- 코디네이터 소유: `docs/superpowers/plans/`(이 문서), E27·E28 판정 분배.

**transit-en(E27, 웨이브 2) 소유:**
- 웹: `src/lib/providers/odsay.ts`·`odsay-select.ts`·`seoul-subway-arrival.ts`, `src/app/api/route/transit/route.ts`, `src/lib/transit-guide.ts`·`transit-track.ts`·`bus.ts`(ODsay 조인부만), `src/lib/place-lines/station-arrivals.ts`·`station-timetable.ts`·`station-meta.ts`, 신규 `src/lib/subway-line-names.ts`·`subway-arrival-en.ts`(+fixture), `src/components/TransitRouteBriefing.tsx`·`TransitGuidePanel.tsx`·`SubwayArrivalsNearby.tsx`·`SubwayArrivalList.tsx`·`StationMeta.tsx`·`StationTimetable.tsx`, `src/hooks/useTransitGuide.ts`
- iOS: Kit `TransitGuide.swift`·`RouteService.swift`(transit `lang`)·신규 `SubwayLineName.swift`·`SubwayArrivalText.swift`, 앱 `RouteBriefing.swift`·`Directions/TransitGuideModel.swift`·`TransitTrackingSheet.swift`·`Nearby/SubwayNearbyView.swift`·`StationSections.swift`
- `src/lib/types.ts`는 **transit·arrival 타입 절만** additive.

**place-names(E28, 웨이브 2) 소유:**
- 웹: 신규 `src/lib/romanize.ts`(+테스트)·`src/lib/bilingual-name.ts`, `src/lib/providers/places.ts`(투영 주석), nearby 서비스·라우트의 이름 투영(`kids-places`·`surroundings`·`clinics`·`seoul-bike`·`culture-events`·`tour-barrier-free`·`congestion`·`air-quality`·`bus.ts`의 정류소명 투영·`overview`), `src/components/PlaceCard.tsx`·`PlaceDetail.tsx`·`AroundNearby.tsx`·`NightClinicsNearby.tsx`·`BusArrivals.tsx`·`BikeStations.tsx`·`CultureEventsNearby.tsx`·`BarrierFreeNearby.tsx`·`LocationBar.tsx`·`LocalConditions.tsx`·`SurroundingsScene.tsx`·`AddressResultList.tsx`
- iOS: Kit `PlaceProjection.swift`·신규 `BilingualName.swift`·언어 태깅 헬퍼, 앱 `PlaceRow`·`PlaceDetailView.swift`·`Nearby/*`(SubwayNearbyView·StationSections 제외)·`BarrierFreeInfoSection.swift`
- `src/lib/types.ts`는 **장소·nearby 타입 절만** additive.

**겹침 규약(웨이브 2):** `src/lib/types.ts`·`messages/*.json`·両 `Localizable.xcstrings`·`ios/i18n/ios-extra/*.json`은 두 세션이 각자 절·네임스페이스만 additive로 더하고 rebase 후 생성물 재생성. `BusArrivals.tsx`·`bus.ts`는 E28이 정류소명 투영, E27은 ODsay 조인부만 — 같은 함수를 고치지 않는다. `SubwayNearbyView`·`StationSections`는 E27 단독. 먼저 push한 쪽이 기준이고 나중 세션이 rebase한다.

## §3 git 격리

```bash
git worktree add ~/gildongmu-wt/<name> -b feat/<name> main
# .env.local 복사, npm install(심링크 금지). 작업은 자기 브랜치, pathspec 커밋(git add -A 금지)
# 통합: git fetch && git rebase origin/main → 생성물 재생성 → 게이트(test:run·tsc --noEmit·lint) → git push origin feat/<name>:main (ff만, force 금지)
git worktree remove ~/gildongmu-wt/<name>
```

실기기·프로덕션 배포는 한 번에 한 세션. iOS 실기기 배포는 웨이브 1에서는 하지 않는다(코디네이터 보고만).

## §4 웨이브

- **웨이브 1**: en-fix 단독(즉시).
- **웨이브 2**: E27·E28 — 위원장 판정 확정 후 코디네이터가 착수 프롬프트를 이 문서에 추가하고 세션을 띄운다.

## §5 세션별 착수 프롬프트

### en-fix (웨이브 1)

프롬프트 전문은 착수 시점 파일로 전달했고 요지는 다음과 같다(전문과 상충 시 전문 우선):

1. **[안전] iOS `GuideLiveRows.swift` `isCrossingStep`**: `description.contains("건너")` 요구로 en 도보 안내(서버 `walk-guidance-en.ts` 영어 문장)에서 횡단 유닛이 절대 판정되지 않는다. 파일 상단 주석의 "건너" 요구 근거를 먼저 이해하고 언어 무관 판정으로 수정. ko 동작 불변. 웹 상당 코드 유무 확인.
2. **iOS `RouteService.car` `lang` 필수 인자화** + `BeaconModel` car 조회·ETA 재조회 배선(walk와 같은 규율, [[no-default-for-safety-parameters]]).
3. **웹 car 라우트 언어 마커**: en 요청의 ko 폴백(NCP 키 부재·`via`)을 응답 필드로 정직화, 소비자는 ko면 `lang="ko"` 표기. ko 폴백 자체는 불변(N4 의도 결정). additive 스키마(CLI/MCP 비파괴).
4. **웹 경로 카드 오류 낭독**: `CarRouteBriefing`·`TransitRouteBriefing`이 서버 한국어 error 문자열을 live region에 그대로 낭독 → `useVoiceRecorder`의 "HTTP status로 코드 결정" 선례로 `t()` 문장 교체(6로케일).
5. **서버 합성 한국어 i18n화**(전부 additive, 기존 필드 유지): 무장애 라벨 27종은 응답 `key`→클라 `t()` 매핑(미지 key는 서버 label 폴백+`lang="ko"`), 엘리베이터 위치 합성 문장은 구조화 필드 추가+클라 조립, `seoul-metro-facilities` "휠체어 접근 가능"·`${line}호선`, `tago-subway` `${t}선` 동형, iOS `BusNearbyView` "N정류장 전" 하드코딩 → 로컬라이즈 키. ⚠ 노선명 자체의 영문화("2호선"→"Line 2")는 E27 소관 — 여기서는 우리가 덧붙인 접미·조립문만.
6. **웹 `lang="ko"` 마크업 보강**: PlaceCard(이름·분류)·PlaceDetail(분류)·AroundNearby(헤딩·overview 삽입·항목)·LocationBar 주소·LocalConditions(영역명·측정소명)·station 계열 노선명·TransitGuidePanel. 헌장 "한 줄=한 객체" 준수 — 이미 별도 블록·줄인 곳만 속성 부여, 새 분절 생성 금지(분절이 필요해 보이면 건너뛰고 보고).

리뷰는 별도 컨텍스트(요구사항+diff만), a11y-auditor 포함. 리뷰 통과 후 ff push(자동 배포). 통합·완료는 SendMessage로 코디네이터(gildongmu-9a)에 보고, 소유권 밖 파일 자진 신고.

### transit-en (웨이브 2, E27)

착수 프롬프트 파일로 전달(요지): ①`/api/route/transit`에 `lang`(웹 `dataLocale`, iOS `RouteService.transit` **필수 인자**) → en이면 ODsay `lang=1`, 조인은 `*Kor` ②표시용 영문 정규화 헬퍼 ③`subway-line-names.ts` ↔ Kit 미러 + seed 전수 drift 테스트, 노선명이 보이는 모든 자리(실시간·시간표·역 메타·경로) 적용 ④`subway-arrival-en.ts` ↔ Kit 미러: `arvlCd`·`arvlMsg2` 정규식·`bstatnNm`→`nameEn`, 실패는 ko 폴백+`lang="ko"`, fixture 공유 ⑤실호출 게이트 스크립트(`scripts/verify-odsay-lang.mjs`: `lang=1` 응답 영문 결측 0·`*Kor` 존재·급행 `nameKor` 보존) ⑥en 게이트·CLI lang은 범위 밖(BACKLOG 기록).

### place-names (웨이브 2, E28)

착수 프롬프트 파일로 전달(요지): ①`romanize.ts`(국어원 로마자, `@romanize/korean` 평가 후 채택 또는 자체 규칙 — 실측 표 5어 기대값 테스트, 알려진 오류 문서화) ②서버 투영 `nameRoman`(영문 원천 없는 이름에만, additive) ③`bilingualName(en|roman, ko)` 한 줄 괄호 조립 + 웹 렌더(괄호부 `<span lang="ko" aria-hidden>`) + iOS `.accessibilityLabel` 영문만 ④적용 면: 장소 카드·상세·둘러보기·한눈에 보기·소아진료·따릉이·문화행사·무장애·버스 정류소(내 주변)·혼잡도 영역명·측정소명·현재 위치 주소(juso 영문 없을 때) ⑤iOS 한국어 구간 언어 태깅 헬퍼(실기기 판정 항목으로 등재) ⑥a11y-auditor 필수.

## 종료 상태

(웨이브 종료 시 추기)
