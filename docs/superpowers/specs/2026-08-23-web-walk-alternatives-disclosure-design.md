# 웹 길찾기 도보 경로 대안(추천·최단) 2행 disclosure (B9 ①) 설계

2026-08-23 확정. 백로그 B9 ①. 정본 상위 spec은 `2026-08-12-walk-route-alternatives-design.md` §4·§7(서버 계약·iOS 화면). 이 문서는 그 spec의 웹 조회 화면 판이고, 서버 계약은 바꾸지 않는다.

## 0. 전제·범위

- 서버 `alternatives=1`(`{ result, shortest }`, 최단 실패만 `shortest: null` 흡수, Tmap 키 부재면 필드 부재)은 완성·실호출 검증 완료(상위 spec §8). iOS `DirectionsTabView` 도보 섹션은 2행 disclosure로 쓰고 있다.
- 웹 `DirectionsView`는 `alternatives=1`을 요청하지 않는다(2026-08-23 실측 0건). 이번 범위는 **조회 화면 UI만**이다.
- **범위 밖**: `useRouteGuide` variant 축·전환(B9 ②, 웹 실시간 안내 실보행 미검증). 따라서 웹은 최단 경로의 실시간 안내를 시작하지 못하고, 최단 행에는 안내 시작 버튼이 없다.
- **N4 잔여 "nmap 경유지 인자"는 취소**(코디네이터 판정 2026-08-23): 웹 nmap 길찾기 빌더는 2026-07-30(`2947cde`)에 참조 0으로 제거됐고, 남은 빌더는 iOS Kit `Deeplink.swift`뿐이며 호출처(장소 상세)는 경유지를 모른다. 길찾기 화면의 딥링크는 E17로 폐기됐으므로 두 개념이 만나는 자리가 없다. 코드 변경 없이 BACKLOG N4 줄만 종결 표기한다.

## 1. 요청

- `fetchMode("walk")`는 `walkRouteUrl(...)` 출력에 `&alternatives=1`을 덧붙인다. `walkRouteUrl`의 인자 집합(전부 required)은 그대로 둔다 — 그 모듈의 계약은 안내 조회와 공유되는 **안전 인자**(accessible·via)이고, `alternatives`는 브리핑 화면만 쓰는 옵트인이라 그 계약에 올리지 않는다(실시간 안내 `useRouteGuide`가 `includeGeometry=1`과 함께 붙이면 서버 400이다).
- `includeGeometry`는 조회 화면에서 항상 false라 금지 조합(상위 spec §3.1 표)에 걸리지 않는다.
- 응답 디코딩: `{ result, shortest? }`. `result` null이면 현행대로 `empty`(최단만 있는 응답은 성립하지 않는다 — 기본 실패는 502). `shortest`는 `WalkRouteBriefing | null`로 **같은 응답의 쌍**으로 `ModeOutcome`에 싣는다(`{ kind: "done"; mode: "walk"; result; shortest }`, 필드 생략 불가 — 스냅샷 교체 계약을 타입이 강제한다). 필드 부재·null·실패 흡수는 전부 `null`로 같다(행동이 같다: 최단 행을 그리지 않는다).

## 2. 화면

도보 섹션(`mode === "walk"`)의 결과 블록:

- **`shortest`가 null이면 현행과 동일**(단일 경로: 30분 초과만 disclosure, 이하는 평문). "추천"이라는 이름은 대안과 대비될 때만 정보다 — 대안이 없는 화면에 라벨을 붙이면 잉여다(미니멀리즘). iOS는 단일일 때도 "추천 경로"를 붙이지만 이 비대칭은 의도다.
- **`shortest`가 있으면 2행 disclosure**(대중교통 대안·iOS 동형, W3C APG disclosure를 쌓은 accordion):
  - 행 1 버튼 라벨: `joinText("추천 경로", "총 {distance}, 약 {minutes}분", stepFreeNotice)`. 기본 펼침은 종전 문턱 판정(`shouldCollapseWalk`)을 그대로 따른다(30분 이하 펼침).
  - 행 2 버튼 라벨: `joinText("최단 경로", "총 {distance}, 약 {minutes}분", shortest.stepFreeNotice)`. 기본 접힘.
  - 각 버튼 `aria-expanded`, 펼침 본문은 `<div>`(버튼이 발견 경로 — 헌장 §3). 접힘·펼침 통지 없음.
  - **한 줄 = 한 객체**: 라벨은 `joinText` 단일 텍스트, 구분자 쉼표.
  - **`stepFreeNotice` 라벨 병기**: 접힘 상태에선 라벨이 유일한 전달 채널이라 안전 문장을 접힘 뒤에 가두지 않는다(iOS a11y 감사 판정 승계). 단일 경로 disclosure(현행 장거리)에도 같은 이유로 병기한다 — 현행은 notice가 접힌 본문의 스텝 0에만 있었다.
- **펼침 본문은 요약·notice 중복 금지**: `WalkRouteResult`에 `includeSummary`·`omitNoticeStep`를 둔다(iOS `WalkRouteRows(includeSummary:false, omitNoticeStep:true)` 미러). `omitNoticeStep`은 `steps[0].description === stepFreeNotice`일 때 그 스텝을 떼고 `waypoint.stepIndex`를 한 칸 되돌린다(서버 `withStepFree`가 밀어 둔 것의 역연산 — 경유지 구획 문장 자리가 어긋나면 "경유지 도착"이 엉뚱한 스텝 뒤에 붙는다). 문턱 이하 단일 경로(평문, 라벨 없음)는 요약·notice 스텝을 그대로 둔다(중복 대상이 없다).
- **계단 회피 토글·안내 시작 버튼의 자리는 불변**(섹션 상단, 접힘 밖). 안내 시작 버튼은 추천 경로를 안내한다. 최단 행에는 버튼이 없다(B9 ②). 라벨 "도보 안내 시작"이 어느 경로인지 말하지 않는 모호함은 B9 ② 착수 시 행 안으로 옮기며 해소한다(BACKLOG B9 ②에 기록).
- **스냅샷 교체**: 새 조회는 `results` 자체를 교체하므로 추천·최단은 같은 응답 쌍만 그려진다. 최단 행 펼침 상태(`walkShortestExpanded`)는 `walkExpanded`와 같은 자리에서 리셋한다.
- 계단 회피 토글 재조회(`toggleStepFree`)도 `fetchMode`를 지나므로 両행이 함께 갱신된다(최단×계단 회피의 `stepFreeNotice` 전용 문장이 최단 행 라벨에 실린다).

## 3. i18n

`directions.walkRecommended` "추천 경로" · `directions.walkShortest` "최단 경로"(iOS `ios.directions.*` 번역 그대로, 6로케일). 도보는 V1 ko 전용이지만 키 일관성 테스트가 6로케일을 요구한다.

## 4. 검증

- **게이트 테스트**(jsdom 레인, `DirectionsWalkAlternatives.test.tsx`): ①도보 요청 URL에 `alternatives=1`이 있고 `includeGeometry`가 없다 ②`shortest` 있음 → "추천 경로, …"·"최단 경로, …" 버튼 2개, 최단 `aria-expanded=false`, 추천은 문턱 판정 ③`shortest: null`·필드 부재 → 최단 버튼 없음, 현행 단일 경로 화면 ④`stepFreeNotice`가 両행 라벨에 병기 ⑤최단 행 펼침 시 최단 경로의 본문이 나온다 ⑥새 조회 뒤 최단 행 펼침 상태 리셋. 기존 `DirectionsWalkCollapse` 스위트(shortest 없는 fixture)는 무변경 통과가 곧 "현행 byte 동일" 가드.
- `WalkRouteResult` 단위(기존 `StepList.test.tsx` 레인): `omitNoticeStep`이 notice 스텝을 떼고 경유지 인덱스를 되돌린다 / notice가 아닌 스텝 0은 떼지 않는다.
- **실호출 게이트**: 배포 전 prod `/api/route/walk?…&alternatives=1` 1회로 응답에 `shortest`가 실리는지 확인(서버 계약은 08-12에 검증됐고, 이번 변경은 요청 파라미터 한 개라 이 한 번이 "URL 문자열이 맞다"의 유일한 증거다).
- `a11y-auditor` 점검.

## 5. 설계 리뷰 게이트 판정

**생략.** 검증된 서버 계약·기존 disclosure 패턴(대중교통·iOS 도보)의 재조합이고 국소·가역이다(글로벌 규칙 조건 ①~④ 비해당). 구현 단계 서브에이전트 리뷰(spec-compliance + code-quality)가 잔여 리스크를 본다.
