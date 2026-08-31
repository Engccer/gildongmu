# 카카오 분류 경로 영문화 설계 (A28) — 세그먼트 사전 + 서버 `categoryEn` 투영 + 전부-아니면-원문

병렬 세션 category-en(웨이브 3). 코디네이터 gildongmu-9a 설계 사항(계획 `2026-08-31-en-locale-korean-cleanup-parallel-plan.md` §웨이브 3)을 계약으로 굳힌다. E28(`2026-08-31-place-name-bilingual-design.md`)의 `nameRoman` 투영과 동형이며, E28 §7이 "카카오 카테고리는 로마자를 만들지 않는다 — BACKLOG 후보"로 남긴 자리를 닫는다.

**설계 리뷰 판정**: 새 외부 계약의 첫 정의(카카오 `category_name` 분류 체계가 유한 집합이라는 가정 위에 사전을 세운다)라 codex adversarial-review 대상. 기록은 §10.

## 1. 문제

위원장 웹 실사용 스크린샷(`/en?q=sinmyung middle school`, 2026-08-31): 카드가 `Sinmyeongjunghakgyo (신명중학교)` / **"교육,학문 > 학교 > 중학교, about 1.463km"** / 영문 주소. E28로 이름·주소는 영문이 됐는데 분류 줄만 한국어 원문이다. A26이 그 줄에 `lang="ko"`를 달아 발화 엔진은 맞췄지만, 한국어를 모르는 사용자에게 분류는 여전히 정보 0이다.

원인은 구조다: 카카오 `category_name`(`"교육,학문 > 학교 > 중학교"`)을 `kakao-local.ts`가 `Place.category`로 그대로 투영하고, 아이 놀 곳(`KidsPlace.category`)·둘러보기(`SurroundingPlace.categoryRaw`)·부근 장면(`SceneItem.categoryRaw`)도 같은 원문을 들며, `nearby-place.ts`가 그것을 `Place.category`로 모은다. 영문 원천이 없다(카카오는 en 응답을 제공하지 않고, E28 로마자는 분류엔 정보가 0이라 의도적으로 만들지 않았다).

## 2. 계약 (코디네이터 확정 → 불변)

1. **세그먼트 사전** `src/lib/data/kakao-category-en.json`: 카카오 경로 세그먼트(ko) → 영문 라벨. 코퍼스는 실호출 스윕으로 모으고 번역은 이 세션이 직접 쓴다(외부 번역 API 호출 0 — 비용·날조 축).
2. **서버 투영 `categoryEn`(additive)**: 순수 함수 `kakaoCategoryEn(path)`가 세그먼트 **전부** 등재일 때만 `"Education & Academia > School > Middle School"`, 하나라도 미등재면 `null`(필드 부재). 부분 번역 혼합 금지 — "Education & Academia > 학교 > Middle School"은 어느 언어 엔진으로도 읽을 수 없다.
3. **소비자**: 비-ko 로케일은 `categoryEn ?? category`. 폴백 줄엔 종전 `lang="ko"`(A26·E28)가 그대로 남는다. 분류 줄에 **한글 병기는 하지 않는다**(분류는 고유명사가 아니라 번역 — 코디네이터 판정, 위원장 병기 판정 범위 밖).
4. **판정 축은 원문이다**: 채팅 프롬프트 `isStation`(`nearby-place.ts`·Kit `PlaceProjection` 주석), 검색 칩 버킷 `categoryOf`(`category.ts` ↔ `SearchFilters.swift`), 키즈 화이트리스트 `classifyKidsPlace`, 채팅 도구 `data`의 `category`, 채팅 컨텍스트(`PlaceDetail`·iOS `ChatModel`)는 전부 `category` 원문을 계속 읽는다. `categoryEn`은 **표시 전용**이다.
5. **ko 화면·낭독은 byte-identical**. 필드 자체는 요청 로케일과 무관하게 실린다(§4) — E28 `nameRoman`과 같은 이유.

## 3. 카카오 분류 체계의 가정 (리뷰 대상)

- `category_name`은 `" > "`로 이어진 경로이고 최상위 18종은 `category_group_code`와 1:1이다(둘러보기 `CATEGORY_GROUPS`). 세그먼트는 카카오맵 분류 트리의 노드 라벨이라 **유한 집합**이다 — 단 공개된 전체 목록이 없다. 그래서 사전은 **스냅샷**이고 "커버리지 100%"를 주장하지 않는다(§8이 수치를 재고 미등재를 목록으로 남긴다).
- 세그먼트 안의 쉼표(`"교육,학문"`·`"육류,고기"`·`"관광,명소"`)는 병렬 나열이지 구분자가 아니다. 사전 키는 **쉼표 포함 세그먼트 그대로**이고 번역은 한 라벨이다. 두 개념이 동의어가 아니면 둘 다 남긴다(`Education & Academia`·`Tourism & Attractions`·`Meat` — 후자는 동의어라 하나, 설계 리뷰 #3).
- 세그먼트는 경로 위치와 무관하게 같은 뜻이다. **실측(2026-08-31 스윕, 고유 경로 1,176개·세그먼트 1,246개): 같은 세그먼트가 두 부모 아래 등장하는 경우 0건** — 카카오는 라벨을 트리에서 재사용하지 않는다. 그래서 평탄 세그먼트 사전은 관측 범위에서 경로 사전과 동치다. 스윕 스크립트가 이 수(`부모가 둘 이상인 세그먼트`)를 매번 출력하고, 0이 아니게 되면 그 세그먼트를 사전에서 뺀다(전부-아니면-원문이 그 경로를 한국어로 남긴다).
- 브랜드·프랜차이즈 세그먼트(`"스타벅스"`·`"맥도날드"`·`"CU"`)는 공식 영문 표기만 쓰고, 공식 표기를 확신하지 못하면 넣지 않는다(로마자 금지 — E28 판정과 같은 결). 지역·행정 단위·고유명사 세그먼트도 같다.
- 정규화: 비교 전 `NFC` + 양끝 공백 trim. `>` 주변 공백은 관용(`"음식점>한식"`도 같은 경로) — 네이버 `category`(`"음식점>한식"`)엔 이 함수를 태우지 않으므로(ko 병합 전용) 실제로 카카오 원문만 지난다. **빈 세그먼트가 하나라도 있으면(`"a >  > b"`·선행/후행 `>`) 조각을 버리지 않고 경로 전체를 미승인**(fail-closed, 리뷰 #13) — 조각을 버려 `"a > b"`로 승인하면 원래 승인하지 않은 경로가 번역된다. 제어 문자가 섞인 경로도 같다.
- 사전 값(영문)에 한글이 있으면 사전 결함이다(테스트가 막는다). 키에 `>`가 있으면 결함이다.

**약관 판정(NOTICE 등록 여부)**: 카카오 로컬 API 정책은 **장소 검색 결과**(문서)의 저장·재배포를 제한한다. 사전은 장소 데이터가 아니라 분류 **라벨의 번역표**(우리 저작)이고 원문 라벨은 키로만 쓴다 — `NOTICE.md` 등록 대상이 아니다. 스윕 코퍼스(경로·빈도·예시 장소명)는 장소 데이터를 포함하므로 **저장소에 넣지 않는다**(scratch 전용, 스크립트가 경로만 stdout에 낸다). 테스트 fixture는 경로 문자열 30건 안팎만 든다(장소명·좌표 없음).

## 4. 서버 투영 표 (전부 additive · 기존 필드 불변 · CLI/MCP 비파괴)

E28 §7과 같은 이유로 **로케일 무관**하게 싣는다: nearby 라우트(`/api/places/around`·`/api/places/kids`·`/api/surroundings/scene`)는 `lang`을 받지 않고, 라우트마다 축을 뚫으면 Kit 호출부(`NearbyService`, 소유권 밖)가 필수 인자를 늘려야 한다. 항목당 수십 바이트이고 표시 판정은 클라이언트 로케일이 한다. **불변식은 "ko 렌더·낭독 동등성"이다**(응답 바이트가 아니다 — 리뷰 #10으로 문구 정정): ko 소비자는 필드를 읽지 않는다. ⚠ 코디네이터 문구 "ko 요청은 byte-identical"은 이 판정으로 갈음하고 보고에 밝힌다. CLI/MCP는 두 패키지에 zod `.strict()`·`additionalProperties:false` 0건(E28 확인분 재확인 2026-08-31)이라 additive 필드에 깨지지 않는다.

**wire 계약은 "키 부재"다** — `categoryEn: null`을 싣는 라우트가 없다(리뷰 #6). provider는 `categoryEnField(path)`(있을 때만 키)로 싣고, 투영 3종은 `undefined`를 넘겨 `JSON.stringify`가 키를 떨군다. 순수 함수 `kakaoCategoryEn`의 `null`은 프로세스 안 반환값이지 wire 값이 아니다. Swift `Optional`은 부재·`null`을 같게 디코딩하므로 어느 쪽이 와도 안전하지만 테스트는 "키 부재"를 단언한다.

| 도메인 | 타입(`types.ts`) | 필드 | 투영 지점 |
|---|---|---|---|
| 장소 검색 | `Place` | `categoryEn?` | `kakao-local.ts normalizeDocument`(검색·en 병합·출입구 후보 공통). TourAPI en 라벨(`Tourist Attraction`)은 이미 영문·한글 없음이라 대상 밖, 네이버는 ko 병합 전용이라 대상 밖 |
| 아이 놀 곳 | `KidsPlace` | `categoryEn?` | `kids-places.ts normalizeKidsDoc` |
| 둘러보기 | `SurroundingPlace` | `categoryEn?`(`categoryRaw` 옆) | `surroundings.ts normalizeSurroundingDoc` |
| 부근 장면 | `SceneItem` | `categoryEn?` | `surroundings-scene.ts toItem`(`nameRoman` 옆 — **소유권 밖 파일**, 자진 신고) |

`Place` 투영 `nearby-place.ts`(`kidsPlaceToPlace`·`surroundingPlaceToPlace`·`sceneItemToPlace`) ↔ Kit `PlaceProjection.swift` 3종이 `categoryEn`을 그대로 넘긴다. 소아 진료(`kind`)·무장애(TourAPI 라벨)·문화행사(서울시 코드명)는 카카오 분류가 아니라 대상 밖(부재 = 종전 동작). Kit 모델 `Place`·`KidsPlace`·`SurroundingPlace`·`SurroundingsSceneItem`에 `public var categoryEn: String? = nil`(nameRoman 동형, 구버전 응답 부재 허용 — `SearchModels.swift`·`NearbyModels.swift`·`SurroundingsSceneModels.swift`는 소유권 밖, 자진 신고).

## 5. 순수 계층

- `src/lib/kakao-category.ts`
  - `kakaoCategoryEn(path: string): string | null` — §3 정규화 → `>` 분할 → 각 세그먼트 사전 조회 → 전부 있으면 `" > "` 결합, 아니면 `null`. 빈 경로 `null`.
  - `pickCategory(locale, { category, categoryEn }): string` — `prefersEnglish(locale) && categoryEn ? categoryEn : category`. 웹 표시 계층이 부르는 유일한 자리 ↔ Kit `pickCategory(lang:category:categoryEn:)`(`BilingualName.swift` 옆, 같은 술어 `dataLocale == "en"`). 공유 fixture `kakao-category-pick-cases.json`(웹·Kit 함께 읽는다).
- `src/lib/data/kakao-category-en.json`: 평탄 객체 `{ "<ko 세그먼트>": "<en>" }`, 키 정렬. 서버 전용 import(클라이언트 번들에 넣지 않는다 — 표시 계층은 응답 필드만 본다).

## 6. 웹 렌더 규칙

- `PlaceCard`(검색 결과·채팅 장소 카드): `const category = pickCategory(locale, place)`; 줄은 종전 `joinText(category, distance)`, `lang={hasHangul(category) ? "ko" : undefined}`(종전 판정 그대로 — 영문이면 자동으로 페이지 언어).
- `PlaceDetail` 분류 문장 `"{t("place.category")} {category}"`: 같은 `pickCategory`, 같은 `lang` 판정. 채팅 컨텍스트 `category: p.category`는 불변(§2-4).
- `AroundNearby`·`KidsPlacesNearby`: **변경 없음** — 목록은 버킷 i18n 라벨(`category.${p.category}`)·종류 라벨(`kind.${k.kind}`)만 그리고 원문 분류를 보이지 않는다. 상세 진입은 `nearby-place.ts` 투영이 `categoryEn`을 나르므로 그쪽에서 영문이 선다.
- i18n 키 추가 0(plurals 세션과의 `messages/*.json` 겹침 회피 — 원칙).

## 7. iOS 렌더 규칙

- `SearchView.swift` `PlaceRow.joined`: `place.category` → `pickCategory(lang: AppLanguage.current, …)`(E28 `bilingual()` 헬퍼와 같은 인자 — 판정은 `lang != "ko"`뿐이라 `dataLocale`과 결과가 같다). **이 줄만** 건드린다(결과 수 헤딩은 plurals 소유).
- `PlaceDetailView.swift` 분류 행: 고른 값에 한글이 남을 때만 `KoreanText`(종전 조건 그대로), 아니면 `Text`.
- `AroundNearbyView.swift` `categoryPiece`: 고른 값의 마지막 세그먼트(`Middle School`). 영문 경로도 `" > "` 결합이라 같은 분할이 선다.
- `KidsNearbyView`: **변경 없음**(원문 분류를 그리지 않는다).
- 병기 없음·`accessibilityLabel` 변경 없음(분류는 한글이 사라지거나 그대로 남거나 둘 중 하나라 한 객체 규칙에 영향이 없다).

## 8. 코퍼스·커버리지 게이트

- `scripts/build-kakao-category-en.mjs`(코퍼스 수집, 카카오 직접 호출, `.env.local`의 `KAKAO_REST_API_KEY`): 전국 대표 좌표(서울·경기·인천·부산·대구·광주·대전·울산·세종·강원·충북·충남·전북·전남·경북·경남·제주, 도심·교외 섞어 약 25점) × 카테고리 검색 18코드(반경 20km, 3페이지) + 키워드 검색(일반 명사 약 100개, 1페이지). 호출 수를 세고 `--max-calls`(기본 4,000) 상한에서 멈춘다. 카카오 로컬 무료 쿼터는 일 100,000(dodo 앱 공유)이라 1회 스윕이 4% 안팎. 출력: 고유 경로·세그먼트 빈도, **사전 미등재 세그먼트를 빈도순으로**(예시 경로 1건씩) — 이것이 번역 작업 목록이다. 코퍼스 파일은 scratch에만.
- `scripts/verify-kakao-category-en.mjs [--base] [--min 90]`(실호출 게이트, 우리 라우트 경유): 서울 2·부산·대구·광주·전주·제주 7좌표 × **4투영 경로 전부**(`/api/places` 일반 질의 8종·`/api/places/around`·`/api/places/kids`·`/api/surroundings/scene`)에서 카카오 원문이 있는 카드를 분모로(리뷰 #11: 원문 없는 카드·비카카오 provider는 분모 밖) **카드 기준**·**고유 경로 기준** `categoryEn` 비율을 **엔드포인트별·지역별**로 낸다. 미등재 세그먼트 목록 출력 → 사전 보강 루프. **합격선 카드 기준 전체 90%**(미달·요청 실패 시 exit 1). 결과 수치는 §11에 기록한다. `build-kakao-category-en.mjs --from-corpus <file>`은 저장된 코퍼스로 커버리지·미등재·부모 다양성을 호출 0으로 재계산한다(사전을 고칠 때마다 쓴다).
- **커버리지 ≠ 정확성**(리뷰 #12): 비-null 비율은 "번역이 있다"만 재고 "맞다"는 재지 못한다. 정확성은 이 세션이 쓴 번역 자체와 `kakao-category.test.ts`의 실경로 기대값 표(35경로, 코퍼스에서 뽑음 — 장소명·좌표 없음)가 든다. 표를 늘리는 것이 정확성 게이트를 넓히는 유일한 길이다.
- 사전은 스냅샷이다: 카카오가 분류를 더하면 그 경로는 한국어 원문으로 남는다(거짓 영문보다 정직한 폴백). 재스윕 주기는 정하지 않고 실사용 리포트로 갱신한다.

## 9. 테스트

- `kakao-category.test.ts`: 전부 등재 → 결합, 하나 미등재 → null, 빈/공백 → null, 빈 세그먼트·제어 문자 fail-closed, `>` 공백 변형 동치, NFC(NFD 입력) 동치, 사전 무결성(값에 한글 0·키에 `>` 0·빈 값 0·코드포인트 정렬·최상위 13종 등재), 실경로 기대값 표 35건(전부 비-null이어야 — 사전 회귀 가드).
- `kakao-category-projection.test.ts`: `kakao-local` `normalizeDocument`·`kids-places`·`surroundings`에 `categoryEn` 존재/부재(미등재 경로는 **키 자체 부재**, `JSON.stringify`에 `categoryEn` 0). `nearby-place` 3종이 값을 나르고 `category`는 원문. **판정 축 불변**(리뷰 #7): 상충하는 `categoryEn`("Restaurants…")을 주입해도 `isStation`·`categoryOf` 결과가 원문 기준과 같다. **소스 가드(2선)**: `station-match.ts`·`category.ts`·`chat/{router,system-instruction,declarations}.ts`·Kit `StationMatch.swift`·`SearchFilters.swift`·`PlaceChatPrompts.swift`·앱 `ChatModel.swift`에 `categoryEn`·`pickCategory` 문자열 0.
- `pickCategory` 공유 fixture(웹 `kakao-category-pick.test.ts` ↔ Kit `KakaoCategoryTests`): ko는 항상 원문, en은 `categoryEn` 우선·부재면 원문, ja·es 등 비-ko도 en 데이터 로케일.
- 컴포넌트(jsdom): `PlaceCard` en — 영문 분류 텍스트 + `lang` 없음 / `categoryEn` 부재 — 한국어 + `lang="ko"` / ko — 원문. `PlaceDetail` 동형 1건.
- Kit: `Place`·`KidsPlace`·`SurroundingPlace`·`SurroundingsSceneItem` 디코딩(필드 있음·없음), 투영 3종 전달.
- 게이트: `npm run test:run`·`npx tsc --noEmit`·`npm run lint`·Kit `swift test`·iOS 시뮬 빌드·a11y-auditor(분류 줄 한 객체 유지·`lang` 정합·과잉 없음)·§8 실호출 게이트. 실기기 배포는 코디네이터 잠금.
- 변이 주입 1회: "전부-아니면-원문" 가드 제거(미등재 세그먼트를 원문으로 남겨 결합) → **실측 2026-08-31: 3건 실패로 검출**(`kakao-category.test.ts` 2 · `kakao-category-projection.test.ts` 1), 복원 후 24/24.

## 10. 설계 리뷰 기록

codex adversarial-review(raw `codex exec` 설계 문서 주입·파일 읽기 금지, gpt-5.6-sol high, 2026-08-31, 38.7k 토큰) 1회 — 15건(치명 3·높음 9·중간 3, 판정 "승인 불가"). 리뷰는 신호이지 처방이 아니므로 항목마다 계층을 대조해 판정했다:

**수정(설계·코드에 반영)**
- #3 쉼표 병렬의 의미 축약 → §3 원칙 정정: 동의어가 아니면 두 개념을 다 남긴다(`관광,명소` → `Tourism & Attractions`).
- #6 `null` vs 키 부재 충돌 → §4 wire 계약을 "키 부재"로 확정, 투영 테스트가 `JSON.stringify`에 키 0을 단언.
- #7 판정 축이 영문을 읽는 회귀 → 상충 값 주입 불변 테스트 + 판정 모듈 소스 가드(§9). 타입 분리(`categoryRawKo`)는 기각 — 이 repo의 실측([[brand-types-block-forgery-not-substitution]])대로 1선은 구조(판정 함수가 `category`만 읽는 시그니처), 2선이 소스 가드이고, 타입 분리는 이름만 바꾼 같은 문자열이라 바꿔치기를 못 막는다.
- #9 CLI/MCP 엄격 스키마 → 두 패키지 `.strict()`·`additionalProperties` 0건 재확인(§4).
- #10 "ko byte-identical" 문구 → "ko 렌더·낭독 동등성"으로 정정(§4).
- #11 커버리지 표본 대표성 → 4투영 경로 전부 + 엔드포인트·지역별 분해 + 분모를 "카카오 원문 있는 카드"로 고정(§8), scene 라우트 표본 추가.
- #12 커버리지 ≠ 정확성 → §8에 분리 명시, 실경로 기대값 표를 9 → 35건으로 확대(정확성 게이트는 이 표뿐이라는 한계도 기록).
- #13 malformed 경로 fail-closed → §3·§5 빈 세그먼트·제어 문자 통째 미승인 + 테스트.

**의도된 결정으로 기각(근거 기록)**
- #1·#4 세그먼트 문맥 의존·조합 부자연 → **실측으로 반증**: 스윕 1,176경로에서 다부모 세그먼트 0건(§3). 경로 허용 목록으로 바꾸면 관측 범위에서 결과가 같고 미관측 조합만 잃는데, 그 조합은 카카오가 라벨을 재사용하지 않는 한 생기지 않는다. 대신 스윕 스크립트가 다부모 수를 매번 출력해 가정이 깨지는 순간을 잡는다. 단수·복수·수식 범위는 이 표기(`A > B > C` 경로 나열)에서 문장이 아니라 라벨 나열이라 성립하지 않는다.
- #2 분류 트리 변경 탐지 스냅샷 → 문자열이 같고 뜻만 바뀌는 변경은 한국어 화면에도 같은 정도로 보이지 않는 가상 사례이고, 문자열이 바뀌는 변경은 "미등재 → 한국어 원문"으로 이미 fail-closed다. 재스윕이 곧 스냅샷 대조다(over-engineering).
- #5 `pickCategory`가 3-state를 잃는다 → 표시 계층의 3-state는 값이 아니라 렌더 결과(영문 / 한국어+`lang="ko"` / 빈 값 미렌더)이고, `lang` 판정을 `hasHangul`로 하는 것은 A26·E28이 확정한 축이다(E28 §10 #13). 한글 없는 한국어 원문 분류는 카카오 경로가 항상 한국어 최상위로 시작하므로 존재하지 않는다.
- #8 채팅·CLI가 `category` 원문을 노출 → 채팅 산문은 모델이 사용자 언어로 쓰며 도구 `data`는 모델 입력이지 표시가 아니다. CLI/MCP `lang`은 E26 동형으로 범위 밖(`docs/BACKLOG.md`).
- #14 결합 줄의 `lang="ko"` 범위 → E28 §10 #13과 같은 판정: 가운데 `lang` span은 Chrome AX 실측에서 접근성 객체를 가르므로(분절) 대안이 없고, 이 기능으로 그 폴백 줄 자체가 카드의 3% 안팎으로 준다(§11).
- #15 원문 접근 경로 → 한국어 원문은 한국어를 모르는 사용자에게 정보가 0이고 ko 로케일이 원문을 그대로 보인다. 병기·별도 행은 이중 낭독·객체 증가(과잉).

**코드 리뷰(별도 컨텍스트, spec-compliance + 정확성 + 사전 표본 80+103항목, swift test·tsc·vitest 재실행)**: 판정 "머지 가능". 반영 — WARNING: `kids-places`·`surroundings` 투영에 미등재 경로(키 부재) 케이스 추가(provider마다 spread 회귀를 따로 잡는다); INFO: `자산관리,자산운용` → `Wealth & Asset Management`(§3 원칙 정합). 기각 — INFO `용인에버라인`을 `Yongin EverLine`으로: E27 노선명 표(`subway-line-names.ts`)가 `EverLine`이라 같은 앱 안의 노선명 표기를 하나로 유지하는 쪽을 택했다(다른 노선명도 전부 E27 표를 따른다). 리뷰어가 본 `coverage.test.ts` OSM 전수 5초 타임아웃 1건은 이 diff 무관(부하 시 flake).

**a11y 감사(별도 컨텍스트, 정적 + 웹 Chrome AX 실측(dev 서버) + iOS 시뮬 런타임 실측(`appLanguage=en` 주입))**: "접근성 양호" — 한 줄=한 객체 유지(웹 카드 버튼 accessible name 통짜 1개, iOS PlaceRow `.combine` 한 `text`), `lang` 접근 텍스트 기준 정확(categoryEn 있음 → 속성 없음 / 부재 → `lang="ko"` 실측), 판정 축 오염 0, 부분 번역 혼합 경로 0, 새 ARIA·live region·병기 0. 기록 — 시뮬 앱이 프로덕션 API를 불러 `categoryEn` 부재 폴백(`KoreanText`) 경로가 실측됐고 존재 경로는 웹 실측 + 공유 fixture로 덮였다. §7 `dataLocale` 표기는 실제 인자 `AppLanguage.current`로 정정(결과 동일).

## 11. 커버리지 실측 기록

- **코퍼스 스윕**(`build-kakao-category-en.mjs`, 2026-08-31, 카카오 직접 호출 4,000회 — 첫 시도는 3,800회째 HTTP/2 GOAWAY 소켓 오류로 결과가 유실돼 재시도·격리를 넣고 다시 돌렸다, 합계 7,800회 ≈ 일 쿼터 8%): 장소 59,535건 · 고유 경로 1,176개 · 고유 세그먼트 1,246개 · 다부모 세그먼트 0개. 사전 947항목(브랜드는 공식 영문 표기를 아는 것만, 지역 소규모 브랜드 ~300개는 의도적으로 미등재) → **장소 기준 97.7%(58,189/59,535) · 고유 경로 72.7%(855/1,176)**. 미등재 상위는 전부 브랜드 잎사귀(김영편입학원·우리끼리·옆커폰·소녀폰·테르엔…)라 그 경로는 한국어 원문으로 남는다(거짓 영문보다 정직).
- **실호출 게이트**(`verify-kakao-category-en.mjs --base http://localhost:3100`, dev 서버, 2026-08-31): 엔드포인트별 places 98.3%(826/840) · around 94.0%(329/350) · kids 97.9%(142/145) · scene 96.0%(533/555); 지역별 최저 대구 92.9%, 최고 서울 강동 98.5%; **전체 카드 96.8%(1,830/1,890) · 고유 경로 88.0%(221/251) · 요청 실패 0 → PASS(합격선 90%)**. 미번역 잔여는 브랜드 잎사귀(이지함피부과·하늘마음한의원·벌크커피·차백도·후라토식당 등).
- 프로덕션 재실행은 배포 뒤 같은 명령(base 생략)으로 한다.
