# 장소 상세 영업시간 한 줄(E24) — Google Places, 실험판 전용

> 위원장 착수 확정 2026-08-30("설계 확정한 대로 구현, 단 실험판에만. 실사용으로 충분히 도움이 된다고 판단하면 정식판으로"). 조사·실호출 게이트·약관·예산의 근거는 `docs/BACKLOG.md` E24(착수 시점 판)와 GitHub 이슈 #2가 정본이고 여기엔 **구현 계약**만 둔다.
>
> **설계 리뷰 판정: 생략.** 외부 통합의 계약 가정(응답 모양·`openNow`=`periods`의 함수·SKU 판정 축·약관 3조)은 착수 전 실호출 460회와 1차 소스 원문으로 이미 검증됐고, 파급은 실험판 장소 상세 한 줄로 국소·가역이다. 구현 단계 서브에이전트 리뷰 + 실호출 게이트가 잔여 리스크를 덮는다.

## 1. 범위

- **한다**: iOS **실험판**(`EXPERIMENTAL`) 장소 상세의 기본 정보 섹션에 한 줄. 서버 라우트 `/api/places/hours`(웹 배포에 실리지만 소비자는 실험판뿐).
- **하지 않는다(재도입 금지 — E24 표기 규칙)**: 채팅 도구·CLI/MCP 카탈로그·"내 주변" 목록·정렬·필터·단정형 문장("지금 영업 중")·웹 UI(정식판 승격 판정 뒤 별도).

## 2. 서버 계약

`GET /api/places/hours?lat&lng&name&roadAddress` → `200 {"hours": PlaceHoursToday | null}`. **어떤 실패도 `null`**(무장애 `match` 라우트 동형 — 매칭 보조는 throw하지 않는다). 키 없음·한국 밖·매칭 실패·영업시간 부재·upstream 오류·**쿼터 소진(429)**·타임아웃 전부 같은 `null`이다. 소비자는 `null`이면 **줄을 만들지 않는다**(침묵).

```ts
type PlaceHoursToday = {
  /** 오늘(KST) 영업 구간. 빈 배열 = 오늘 휴무(시간표에 다른 요일은 있다). */
  ranges: { open: string; close: string; closesNextDay: boolean }[]; // "HH:MM"
  /** 24시간 영업(구글이 close 없는 period로 준다). 이때 ranges는 빈 배열. */
  allDay: boolean;
};
```

호출은 둘로 갈린다(예산 근거는 BACKLOG E24):

| 단계 | API | SKU | 캐시 |
|---|---|---|---|
| ① 카카오 장소 → `place_id` | Text Search(`textQuery`=이름, `locationBias` 원 300m, 필드 `id,displayName,location,formattedAddress`) | Pro | `unstable_cache` **365일**(place_id는 무기한 캐시 허용, MST §3). **불일치(null)도 30일 캐시** — 부재는 Google 콘텐츠가 아니고 매번 Pro 1콜을 태우는 것은 낭비다 |
| ② `place_id` → 영업시간 | Place Details(필드 `currentOpeningHours,regularOpeningHours,utcOffsetMinutes`) | Enterprise | **`no-store`**(§3.2.3(b)) |

- 매칭 술어 **B1'·B2**(`src/lib/place-hours.ts` 순수 함수): 정규화 이름 완전 일치 AND (≤50m OR 도로명 주소 키 `(도로명, 건물번호)` 일치) / 브랜드 코어 일치(지점 접미·주소에서 유도한 지역 토큰·후행 숫자 제거) AND ≤50m. 좌표만으로는 매칭하지 않는다(B3 기각).
- "오늘"은 **KST** 기준이고 `currentOpeningHours.periods`의 `date`로 고른다(공휴일 특별 시간 반영). 그 필드가 없으면 `regularOpeningHours`의 요일로. 자정을 넘는 구간은 `closesNextDay`.
- 타임아웃: 서버 fetch 각 3초, iOS 요청 4초(양 플랫폼 상한 명시, 상세 렌더는 기다리지 않는다).

## 3. 예산 게이트 — 서버 상태 없이 GCP 쿼터로

무료 월 1,000회(Details Enterprise)·5,000회(Text Search Pro)를 **GCP 소비자 쿼터 오버라이드**로 일 단위 상한에 박는다: `GetPlaceRequest` 33/일, `SearchTextRequest` 160/일. 초과는 429이고 위 계약대로 `null`=침묵이다. Vercel에 카운터를 두지 않는 이유: 함수 인스턴스 간 공유 상태가 없고, 쿼터는 결제 계정 단에서 강제되어 코드 결함으로도 뚫리지 않는다. 키는 `gildongmu-prod`의 `gildongmu-places`(Places API New만 허용).

## 4. iOS 계약

- `AppConfig.experimentalPlaceHoursEnabled`(`#if EXPERIMENTAL`). 정식판은 서비스 호출 자체가 없다(`PlaceDetailView`가 `.task`를 걸지 않는다).
- Kit `PlaceHoursService.today(lat:lng:name:roadAddress:)` 비-throw → `PlaceHoursToday?`. 앱 `PlaceHoursModel` + `PlaceHoursLine`.
- 자리: 기본 정보 섹션, 전화 링크 **앞**(불확실한 시각은 전화로 확인 가능한 자리에 있을 때만 정직하다 — 표기 규칙). 한 줄 = 한 객체, 로딩 표시·통지 없음(조용히 나타나는 보조 정보).
- 문장(`ios.placeHours.*`): `오늘 영업시간 {ranges} (Google Maps)` · `오늘 휴무 (Google Maps)` · 24시간이면 ranges 자리에 `24시간` · 자정 넘김은 `다음 날 {time}`. **"Google Maps"는 attribution 의무 표기**(지도 없이 데이터를 보일 때 로고, 공간이 제한되면 그 문자열 — 번역·대소문자 변경·줄바꿈 금지).
- 낭독: VoiceOver만이다. 이 문자열은 `TtsPlayer`·`speakGuidance`·채팅 산문 어디로도 흘러가지 않는다 — `src/lib/__tests__/place-hours-tts-drift.test.ts`가 심볼 등장 파일을 allowlist로 고정한다.

## 5. 개인정보

장소 이름·좌표·도로명 주소가 Google에 전송된다(사용자 데이터 아님 — 위치가 아니라 장소 좌표). 웹 privacy 카피에 한 문장 추가(6로케일). `PrivacyInfo.xcprivacy`·ASC 라벨은 새 데이터 유형이 없어 불변.

## 6. 검증

- 단위: 매칭 밴드(B1'·B2·기각), 오늘 구간(정기휴무·자정 넘김·24시간·2구간·현행 없음→정규 폴백), 라우트 파라미터(좌표 헬퍼).
- 실호출 게이트: `scripts/verify-place-hours.mjs` — 대조 시트 표본(워터캐슬 하남미사점 = 도로명 키 매칭 케이스 포함)으로 `hours` 비-null과 침묵 케이스를 함께 단언.
- 실기기: 위원장 실험판 실사용(정식판 승격 판정의 정본).
