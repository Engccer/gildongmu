# 검색 정확도순 전환 + 명소 섹션 통합 폐지 설계

- 날짜: 2026-07-20
- 상태: 승인(위원장 2026-07-20). 구현 대상.
- 대체: `2026-07-01-landmark-attraction-search-design.md`(명소 별도 섹션 설계)를 이 스펙이 폐기·대체한다.

## 배경과 문제

장소 검색의 거리순 정렬은 "내 주변" 탭을 분기하기 전의 잔재다. 실사용 판정(위원장): 검색 탭은 **정확도순이 더 유용하다**. 거리순의 부작용을 메우려고 명소 전용 섹션(`/api/places/attractions`)을 별도로 만들었는데, 이로 인해:

1. 같은 장소가 명소 섹션과 장소 섹션에 중복 노출될 수 있다.
2. 카테고리 칩 "관광명소"와 "명소" 섹션 헤딩이 같은 개념처럼 들려 혼동된다.
3. 칩 필터가 장소 섹션에만 적용되어 "검색 결과 전체의 필터"라는 직관과 어긋난다.

## 실호출 확정 사실 (2026-07-20, 길동 좌표 x=127.145 y=37.535)

카카오 키워드 검색 `sort=accuracy`(기본값) + x·y 첨부 시 **근접성이 관련도에 블렌딩된다**:

- "맥도날드": 둔촌DT(928m)→굽은다리역DT(1.4km)→천호로데오(1.6km)→상일동→잠실 — 브랜드 다건은 근처 우선.
- "스타벅스": 길동역점(600m)부터 — 동일 패턴 재확인.
- "경복궁": 15.6km 원거리인데 경복궁 본체 1위, 경회루·근정전(부속)이 top 5 — 랜드마크는 관련도가 거리를 이긴다.

→ "정확도 우선, 다건 브랜드는 거리 반영" 요구를 자체 하이브리드 알고리듬 없이 카카오 파라미터만으로 충족한다.

## 설계

### 1. 정렬 정책 전환 — 거리순 3겹 제거

| 계층 | 현행 | 변경 |
|---|---|---|
| 카카오 요청 (`kakao-local.ts` `buildKakaoSearchUrl`) | 좌표 있으면 `sort=distance` | `sort` 미지정(정확도 기본값), **x·y는 유지**(근접 블렌딩 신호) |
| 서버 병합 (`places.ts` `searchPlacesMergedKo`) | 병합 후 Haversine 재정렬 | 재정렬 제거. 카카오 정확도순 15건 뒤에 네이버 5건(자체 정확도순) 이어붙임. `mergePlaces` 좌표 4자리 dedupe 유지 |
| 클라이언트 (`PlaceSearch.tsx`) | `sortPlacesByDistance` 재정렬 | 제거. 거리 **표기**는 유지 — 정렬 없이 `distanceMeters`만 부여하는 `annotateDistances`(`geo.ts` 신설)로 대체 |

- en(`searchPlacesMergedEn`)은 현행 유지(정렬 없음 — 카카오 정확도순 + TourAPI 이어붙임).
- 채팅 도구 `search_places`는 같은 provider 경유라 자동으로 동일 정책.
- **수용 트레이드오프**: 네이버 전용 근처 가게(예: 백년찌개집 1971)가 목록 하단에 붙는다. 네이버는 "카카오 미등록 보강" 역할이고 전체 최대 20건이라 도달 가능 — 재정렬로 정확도 축을 깨는 것보다 낫다.
- 위치 권한 거부 시: 좌표 없이 정확도순 전국(현행과 동일한 graceful degrade).

### 2. 명소 전용 경로 완전 제거

삭제 대상:

- `src/app/api/places/attractions/route.ts`
- `src/lib/providers/attractions.ts`, `src/lib/providers/kakao-attractions.ts`
- `src/lib/providers/tour-api.ts`의 명소 함수(`searchAttractionsTourApi`)만 — 장소 검색용 `searchPlacesTourApi`는 유지
- `PlaceSearch.tsx`: `attractionStatus`·`performAttractionSearch`·명소 섹션 렌더·포커스 settled의 attraction 절
- `search-sections.ts`: `orderResultSections` 4번째 인자(attraction), `combinedLiveMessage`의 `attractionCount`
- i18n: `search.attractionSection` 키(전 로케일)
- 관련 테스트(시그니처 변경 반영 포함)

명소 노출 보장(대체 메커니즘, 2겹):

1. 카카오 정확도순이 랜드마크·부속 명소를 자연 부상시킨다(실호출 확정).
2. `groupByCategory`의 `BUCKET_ORDER`가 관광명소 그룹을 장소 목록 최상단에 배치한다 — 기존 "건수 무관 최상단 병치"의 등가물.

### 3. CLI·MCP 릴리스 (breaking-soft)

- `endpoint-catalog-shared.ts` 両미러(cli·mcp)에서 `attractions-search` 항목 제거(drift 테스트 동조).
- CLI `search` 명령: 명소 병렬 호출·`attractions-search` 포매터 제거.
- 두 `packages/*/package.json` 버전 동조 bump(마이너) → `cli-v*` 태그 push → Trusted Publishing 자동 발행.
- 구버전 호환: CLI는 allSettled라 명소 섹션만 조용히 소멸(비파괴). 구버전 MCP `attractions-search` 도구만 404 — 사용자가 사실상 본인뿐이라 수용(위원장 승인).

### 4. 칩 필터·중복·명칭 혼동 — 무변경으로 해소

칩 필터 코드는 변경하지 않는다. 명소 섹션 소멸로:

- 칩이 검색 장소 결과 전체를 커버한다(주소·웹 섹션은 의도적 비대상 유지 — 주소는 카테고리 개념 없음, 웹은 장소 아님).
- "관광명소 칩 vs 명소 섹션" 명칭 혼동 소멸.
- 명소·장소 이중 노출(화면 중복의 유일 원천) 소멸. 목록 내부 중복은 기존 `mergePlaces`가 담당.

### 5. 검증 게이트

- **실호출 3종(머지 게이트)**: ① "맥도날드" — 근접 편향(근처 지점 상위) ② "경복궁" — 랜드마크 부상 + 관광명소 그룹 최상단 ③ "백년찌개집 1971" — 네이버 보강 생존 + dedupe.
- 게이트 테스트: `orderResultSections`·`combinedLiveMessage` 시그니처 변경 반영, i18n 키 일관성(`i18n-messages.test.ts`), 카탈로그 drift 테스트, `npm run lint`+`build`+`test:run`.

### 6. 문서

- CLAUDE.md 통합 카탈로그: 명소 행 제거, 장소 행에 정렬 정책(정확도순+좌표 블렌딩) 반영.
- PROGRESS.md에 전환 기록. 구 스펙에 폐기 표기는 본 문서 헤더의 "대체" 선언으로 갈음(원본 무수정).

### 7. iOS 동조 제거 (확인 완료 — 범위 포함)

iOS 앱이 명소 트랙을 미러하고 있어 같은 사이클에서 제거한다:

- `GildongmuKit/SearchService.swift`: `SearchOutcome.attractions` 트랙·ko 전용 명소 호출 제거.
- `SearchView.swift`: 명소 섹션 렌더·`attraction-` 포커스 id·`attractionIDs` dedupe 제거.
- `SearchModel.swift`: 건수 합산에서 attractions 제거.
- GildongmuKit 테스트·fixture 정리.
- iOS 사이클 규칙: 커밋 + 실기기 배포까지(기기 연결 시).

## 비목표

- 주소·웹 섹션의 필터 편입(카테고리 개념 부재·장소 아님).
- 네이버 결과의 위치 기반 재배치(자의적 휴리스틱 금지).
