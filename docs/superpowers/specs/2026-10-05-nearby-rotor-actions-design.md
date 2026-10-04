# E65 내 주변 탭 로터 액션: 설계 (2026-10-05)

설계 리뷰 판정: 적대적 설계 리뷰 생략. 새 외부 통합이 아니라 자기 서버의 additive 필드(하나는 옵트인)이고, 새 불변식·상태 머신이 없다. 판정 계층은 기존 판별선(장소 하나 = `PlaceRow` 묶음, 문장 속 장소 여럿 = 장소마다 「상세 보기」)을 그대로 쓴다.

정본: `docs/BACKLOG.md` E65(위원장 판정 표). 이 문서는 그 판정을 코드로 옮길 때 세션이 정한 설계 사항만 적는다.

## 1. 서버 응답 (additive)

### 1.1 `/api/nearby/overview?places=1` (옵트인)

`places=1`일 때만 「한눈에 보기」 항목에 상세 진입 재료를 싣는다. 미지정 응답은 종전과 byte-identical이다.

| 자리 | 옵트인 필드 | 내용 |
|---|---|---|
| `bullets[kind∈food,cafe,kids,barrierFree].nearest[]` | `place` | 채팅 카드와 같은 `Place` 투영(`nearby-place.ts`, 좌표·주소·전화 포함) |
| `bullets[kind=events].nearest[]` | `event` | 행사 목록과 같은 `CultureEvent` 원본(상세 화면의 행사 섹션 재료) |
| `bullets[kind=transit].station` | `lat`·`lng` | seed 역 좌표 |
| `bullets[kind=transit].busStops.nearest[]` | 없음 | 아래 §2 |

옵트인으로 낸 이유: `overview` 객체는 채팅 `get_nearby_overview` 도구가 Gemini 입력(`data`)으로 그대로 펼치고, CLI·npm MCP가 JSON 원문을 출력한다(도구 출력 권장 상한 1.5K자에 이미 근접, CHANGELOG 2026-08-27 실측 1,641자). 기본으로 실으면 장소마다 `Place` 한 벌이 세 소비자 모두에 붙는다. 앱 하나가 쓰는 재료라 앱만 요청한다(`/api/walk/nearby?coords=1` 선례).

하위 호환(계획 §1 코디네이터 판정 2): 스토어 2.1·2.0·1.19와 안드로이드는 `places=1`을 보내지 않으므로 받는 응답이 바뀌지 않는다. 웹 `AroundNearby`·CLI·채팅도 보내지 않는다. WebMCP는 이 라우트를 소비하지 않는다(`src/lib/webmcp` 전수 검색 0건).

### 1.2 `/api/station/subway-arrival/nearby?coords=1` 역 좌표 (옵트인)

`coords=1`일 때만 `stations[]`에 `lat`·`lng`(seed 역 좌표)를 싣는다. 역 목록의 「상세 보기」·「여기까지 길찾기」·전화가 좌표를 요구하는데 이 응답에는 좌표가 없었다. 미지정 응답은 종전과 byte-identical이다.

옵트인으로 낸 이유는 §1.1과 같은 축이다: 채팅 `get_subway_arrivals` 도구가 역 객체를 펼쳐 Gemini 입력(`data`)에 넣으므로(`src/lib/chat/router.ts`), 기본으로 실으면 좌표가 모델 입력으로 샌다. 채팅 경로는 provider를 옵션 없이 불러 종전 모양 그대로다. 하위 호환: 스토어 2.1·2.0·1.19와 안드로이드는 `coords=1`을 보내지 않는다. WebMCP는 이 라우트를 소비하지 않는다.

## 2. 종류별 판정표

「한눈에 보기」 문장 속 장소의 액션(장소마다 「○○ 상세 보기」, 등장 순으로 들리게 역순 선언):

| 종류 | 액션 | 여는 화면 | 근거 |
|---|---|---|---|
| 식당·카페·아이 놀 곳·무장애 관광지 | 상세 보기 | `PlaceDetailView(place:)` | 각 목록 화면과 같은 투영(채팅 카드와 같은 함수) |
| 문화 행사 | 상세 보기 | `PlaceDetailView(place: cultureEventToPlace) { CultureEventSection }` | 행사 목록 화면과 같은 상세(기간·요금·대상) |
| 지하철역 | 상세 보기 | 역 상세(`transitStopPlace` + 노선 힌트) | 브리핑 E45와 같은 역 진입 경로 |
| 버스 정류소 | 없음 | — | 정류소 상세 화면이 없다(죽은 액션 금지). 정류소 목록의 「여기까지 길찾기」는 제목 행이 맡는다 |

문장 대상 목록은 문장을 파싱하지 않고 **불릿 구조에서** 뽑는다(Kit `overviewDetailTargets`). 문장 조립(`buildOverviewLines`)과 같은 순서(역 → 버스, `nearest` 배열 순)를 따르고, 액션 라벨의 이름은 그 문장이 부른 이름(`bilingualName`의 `primary`)과 같다. 옵트인 필드가 없는 항목(구버전 서버 응답·투영 없는 항목)은 대상에서 빠진다.

행 액션:

| 자리 | 액션(로터에서 들리는 순서) | 구현 |
|---|---|---|
| 「주변 상황」 장소 행 | 주소 복사 → 여기까지 길찾기 → 카카오맵 → 네이버 지도 → 전화 → 물어보기(보유한 데이터만) | `PlaceRow`의 액션 묶음을 수정자(`placeRowActions`)로 꺼내 그대로 붙인다. 버튼형 「주변 확인」(안내 시트)은 붙이지 않는다(위원장 판정의 자리는 둘러보기다) |
| 지하철역 목록의 역 제목 | 상세 보기 → 여기까지 길찾기 → 전화 | 헤딩 trait 유지. 전화는 E45 창구(라벨 `stationCallLabel`, 동작 `callStationPhone`) 그대로: 액션은 늘 있고 라벨만 직통·대표번호로 갈리며, 번호가 없으면 누를 때 「역 전화번호가 없습니다.」(E45 판정 ④, 위원장 판정 2026-10-05). 좌표가 없는 응답이면 셋 다 없다 |
| 버스 정류소 목록의 정류소 제목 | 여기까지 길찾기 | 헤딩 trait 유지 |

## 3. 세션 설계 판정 (제품 판단 아님)

1. **환승역의 노선 힌트는 `lines` 중 노선 표가 아는 첫 노선이다**(없으면 첫 노선). 역 전화번호 조회는 같은 역·같은 노선 후보만 보므로(E44) 힌트가 하나 있어야 한다. 상세 화면에도 같은 힌트를 넘겨 로터의 전화와 상세의 전화 줄이 같은 번호를 말하게 한다.
2. **문자열은 기존 키만 쓴다**: 장소·행사 상세 `ios.chat.openPlace`, 역 상세 `transitGuide.openStation`, 길찾기 `directions.toHere`, 역 전화 `transitGuide.callStation`·`callStationRepresentative`, 행 묶음은 `PlaceRow` 그대로. 새 키 0.
3. **상세 이동은 화면이 `navigationDestination(item:)`으로 연다**(로터 액션은 `NavigationLink`를 누를 수 없다). 앵커 모드(`SubwayNearbyView(anchor:)`·`BusNearbyView(anchor:)`)는 같은 뷰라 함께 적용된다.
4. 「여기까지 길찾기」는 `PlaceRow`와 같은 프리필(`DirectionsPrefillStore`, 역·정류소 이름 + 좌표 + 영문/로마자 이름)이다.
5. **앵커 목록은 장소 상세의 `showsDirectionsEntry`를 따른다**: 안내 시트(`PlaceDetailSheet(showsDirectionsEntry: false)`)·길찾기 탭 스택 안의 상세에서 연 지하철·버스 앵커 목록은 「여기까지 길찾기」를 내지 않는다(프리필이 그 화면을 파괴한다, E45 spec §7). 전달은 환경값이 아니라 기본값 없는 명시 인자 `directionsEntryAllowed`(허브는 `true`를 적는다)이고, 로터가 여는 역 상세도 같은 값을 받는다. 정류소 제목은 그 자리에서 액션이 0개다.
6. **역 라벨의 이름 언어는 헤딩과 같은 판정이다**(`subwayStationEnglishLines`: 영어 UI ∧ 영문 역명 ∧ 노선 영문 전부). 노선 힌트는 Kit 순수 함수 `nearbyStationLineHint`.
7. **지하철 목록은 로터로 연 역 상세에서 돌아온 한 번만 재조회를 건너뛴다**(1회용 표식 `skipReloadOnReturn`): 복귀 때 재조회·완료 통지("역 N곳")가 복귀 커서 낭독과 겹치지 않게 한다. 탭 전환 복귀는 종전처럼 재조회한다(실시간 도착이 낡은 채 남지 않게). 상세에 오래 머문 뒤 돌아오면 목록이 그만큼 낡는 것은 당겨서 새로고침이 맡는다. 버스 목록·둘러보기의 같은 복귀 재통지는 이 회차 범위 밖의 기존 동작이다(통지 없는 재조회는 `NearbyLoadCore` 층 과제).
8. **옵트인 재료는 관대하게 디코딩한다**(Kit `OverviewPlace`의 `place`·`event`는 `try?`): 재료 하나가 깨져도 「한눈에 보기」 문장은 살고 그 장소의 액션만 빠진다.
9. 역 목록은 떠 있는 동안 역마다 전화번호를 미리 조회한다(30초 재확인, 신선 5분 — 카카오 장소 검색이 역마다 5분에 한 번, 서버 캐시 300초 뒤). 브리핑 E45와 같은 저장소·같은 수명이다. 라벨은 공용 `stationCallLabel` 하나이고, 30초 재확인 루프는 소비자마다 모양이 달라(줄당 여러 역·한 역·경유역 목록) 이번엔 묶지 않았다(네 벌: 브리핑·장소 상세·안내 시트·역 목록).

## 4. 범위 밖

안드로이드 앱 층(iOS 실기기 판정 뒤). `:kit`은 모델 디코딩만 맞추고 `overviewDetailTargets`는 미이식으로 등록부 note에 적는다. 웹 화면은 대상 밖. 「주변 가게와 시설」(이미 `PlaceRow`)·따릉이·보행 인프라·날씨는 대상 밖.

## 5. 검증

- 웹: `nearby-overview.test.ts`(옵트인 필드, 미지정 불변), 라우트 테스트 둘(`places=1`·`coords=1` 전달, 미지 값 400), `subway-nearby.test.ts`(좌표는 옵트인일 때만).
- Kit: 옵트인 필드 디코딩, `overviewDetailTargets` 순서·이름·빠짐.
- `:kit`: 새 필드가 실린 응답 디코딩이 깨지지 않는다.
- 실호출: push 뒤 프로덕션 `/api/nearby/overview`·`/api/station/subway-arrival/nearby`의 미지정·옵트인 쌍.
- 실기기(BACKLOG §2 E65 행, 대본 `docs/FIELD-TEST.md` §4-7): ①세 자리의 로터 순서(한눈에 보기 문장 등장 순, 역 제목 상세 → 길찾기 → 전화, 주변 상황 행 주소 복사 → … → 물어보기) ②헤딩 로터로 역·정류소 제목에 착지한 상태에서도 액션이 나오고 머리말 trait가 남는가 ③로터로 연 상세에서 돌아올 때 커서 복귀(시스템 복원, E45 선례)와 지하철 목록의 재통지 없음 ④「주변 상황」 행 액션이 링크 요소에서 들리는가(구조가 `PlaceRow`와 한 겹 다르다 — 들리지 않으면 `.accessibilityElement(children: .combine)`을 먼저 건다) ⑤안내 시트 안 장소 상세 → 이 장소 주변: 역 제목은 상세·전화만, 정류소 제목은 액션 없음, 액션 0개 헤딩에 "동작 사용 가능"이 남지 않는가(좌표 없는 역의 빈 빌더도 같은 축) ⑥길찾기 탭 스택 안 앵커 목록에서 로터 push·뒤로 ⑦비-ko(en) 1역·1문장의 이름 일치. 한 문장에 같은 이름 장소가 둘이면 라벨로 구분되지 않는다(실사용에서 겹침이 관측될 때만 거리 병기 검토).
