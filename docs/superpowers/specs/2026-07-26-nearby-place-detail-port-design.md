# 내 주변 → 장소 상세 UI 이식 (iOS) — 설계

> 2026-07-26. 위원장 요청: "근처 소아과 검색 결과 장소들의 상세 페이지도 검색 탭과 동일하게 주소·길찾기·전화 등이 나타나게, 로터 커스텀 액션까지." 방향 합의 후 자율 진행 지시.

## 1. 목적

내 주변 4종(소아 진료·아이 놀 곳·둘러보기·무장애 관광지)의 항목에서 검색 탭과 동일한 장소 상세(`PlaceDetailView`)로 진입한다. 상세가 제공하는 주소(종류별 복사)·전화·길찾기 프리필·네이버/카카오 딥링크·자동차/대중교통 브리핑·장소 채팅·무장애 편의시설 자동 섹션, 그리고 행의 VoiceOver 로터 커스텀 액션(물어보기·전화·길찾기·네이버·카카오·주소 복사)을 4종 화면이 전부 얻는다.

## 2. 범위

- **iOS만.** 웹 내 주변 패널은 인라인 정보로 완결(주소·전화 tel 링크 포함)이고 상세 전환은 History API 뷰라 상호작용 모델이 다르다 — 웹 이식은 별도 판단.
- **대상 4종**: `ClinicNearbyView`·`KidsNearbyView`·`AroundNearbyView`·`BarrierFreeNearbyView`.
- **비대상**: 지하철·버스·따릉이(역·정류소는 도메인 실시간 정본 + 역 상세 자동 섹션이 이미 존재), 현재 위치 정위(자체 화면), 날씨·공기질(장소 아님).

## 3. 설계

### 3-1. 행 컴포넌트 통일 — `PlaceRow` 확장

`PlaceRow`에 `secondaryOverride: String?`(기본 nil)을 추가한다. nil이면 기존 조합(카테고리·주소·거리) 유지 — 기존 호출처(검색 탭·채팅 카드) 무변경. 도메인 화면은 자기 보조 텍스트(진료 상태·실내외·방위 등)를 주입한다. 행 = 1접근성 객체(`children: .combine`)와 로터 액션 역순 선언은 그대로 상속된다.

### 3-2. 진입 — 직접 destination NavigationLink

4종 화면의 항목을 `NavigationLink { PlaceDetailView(...) } label: { PlaceRow(place: 합성Place, secondaryOverride:, onAskAbout:) }`로 통일한다. 검색 탭의 값 기반(`value:` + `navigationDestination`)과 달리 목적지를 직접 싣는다 — 소아 진료는 `NightClinic` 원본을 도메인 섹션에 넘겨야 해서 `Place` 값만으로는 부족하고, 항목 수가 적어(≤10) 값 등록의 이점이 없다.

### 3-3. 합성 함수 — `barrierFreePlaceToPlace` 신규

기존 3종(`nightClinicToPlace`·`kidsPlaceToPlace`·`surroundingPlaceToPlace`)은 재사용. 무장애 관광지용을 Kit `PlaceProjection.swift`에 신규 추가한다. TourAPI `addr1`은 도로명 주소(fixture 실측: "서울특별시 중구 세종대로 110 (태평로1가)") → `roadAddress` 슬롯, 지번은 빈 문자열(없는 값을 지어내지 않는다). `id`는 `contentId`, `phone`·`link`는 nil.

### 3-4. 소아 진료 도메인 섹션 — `PlaceDetailView` 슬롯

`PlaceDetailView`를 `@ViewBuilder domainSection`(기본 `EmptyView`) 제네릭 슬롯으로 확장하고 **List 최상단**에 렌더한다(진료 여부가 이 화면에 온 이유이므로 정보 서열 1위). 기존 호출처는 편의 init으로 무변경.

소아 진료가 전달하는 섹션 내용(전부 조건부·평문 단일 텍스트):
- 진료 상태 3-state 문장(기존 `clinicStatusText` — open이면 종료 시각까지)
- 찾아오는 길(`directions`, 있을 때만, 원문 그대로)
- 달빛어린이병원 지정 문장(`designated == true`일 때만 — 위원장 판정 2026-07-26 "지정 여부는 상세의 조건부 섹션으로")

상태 문장 헬퍼는 뷰 내부 private에서 파일 수준 internal로 승격해 행 보조 텍스트와 도메인 섹션이 공유한다.

### 3-5. 목록 슬림화 (검색 탭 동형)

- **소아 진료**: 항목별 Section·heading(기관명)과 주소·찾아오는 길·전화 행을 제거하고 평면 1행 리스트로 전환. 행 보조 = 종별·진료 상태·거리. 주소·전화·찾아오는 길은 상세로 이동. heading 제거 근거는 M2·M3 결정 동형 — 평면 1행=1객체 리스트에서 항목 점프는 행 자체로 충족되어 heading이 잉여. **실기기 VO 확인 게이트 항목.**
- **무장애 관광지**: `DisclosureGroup`(편의시설 펼침)과 항목 heading 제거 — 편의시설의 발견 경로가 상세의 `BarrierFreeInfoSection` 자동 섹션으로 대체된다(진입은 match 라우트: 같은 소스 좌표라 50m∩이름 매칭 안정. contentId 직결은 미도입 — 실측 미스가 나오면 후속). 항목별 상세 lazy 로드 모델(`detailStates`)은 죽은 코드가 되어 함께 제거.
- **아이 놀 곳·둘러보기**: 단일 텍스트 행을 PlaceRow(이름 + 보조)로 전환. 보조 텍스트 정보량은 현행 유지(kind·실내외·거리·주소 / 카테고리·방위·거리).
- 거리 표기는 PlaceRow 관례(`place.distance` "약 {distance}")로 통일.

### 3-6. 채팅 진입 정리

로터 "물어보기"는 PlaceRow `onAskAbout`으로 유지(행에서 바로 채팅 sheet), 상세의 채팅 버튼도 그대로 — 검색 탭과 동일한 이중 경로. 기존 `contextMenu`는 제거한다(NavigationLink 길게 누르기와 경합 + 검색 탭 비보유 — 시각 사용자의 채팅 진입은 상세 버튼). 부수 효과: Clinic·Around의 하드코딩 한국어 라벨("…에 관해 물어보기")이 `ios.place.askAbout` 키 재사용으로 자연 해소된다. 무장애 관광지는 합성 함수가 생기면서 채팅 진입(로터+상세)을 처음 획득한다.

## 4. 접근성 계약

- 행 = 1접근성 객체(이름+보조 combine), 로터 액션은 역순 선언(스와이프 메뉴 노출 순서 보장), 보유 데이터만 액션 노출(빈 전화·빈 도로명 = 죽은 액션 금지).
- 진료 상태 3-state 문장은 행 보조 텍스트에 흡수되어 목록에서 유지(뭉개지 않음).
- heading·DisclosureGroup 제거는 발견 경로 대체(행 자체·상세 진입)가 성립하므로 과잉 제거이지 완결성 훼손이 아님 — 단 실기기 VO로 확정한다.
- 도메인 섹션은 평문 단일 텍스트 행(definition list·라벨 볼드 분절 금지).

## 5. i18n

신규 키 `clinicDetail.designated`(달빛어린이병원 지정 문장) 5로케일 + xcstrings 재생성·키 린터. 제거되는 UI 문자열의 죽은 키 정리(있다면).

## 6. 게이트

1. Kit: `barrierFreePlaceToPlace` 단위 테스트 추가, 전체 테스트 통과.
2. xcodebuild 빌드 + 시뮬 `snapshot-ui`로 4종 화면 라벨·행 구조 실측.
3. code-reviewer + a11y-auditor 리뷰.
4. 커밋·push 후 실기기 배포, **위원장 실기기 VO 확인**(행 낭독·로터 액션·상세 진입·heading 제거 체감).
