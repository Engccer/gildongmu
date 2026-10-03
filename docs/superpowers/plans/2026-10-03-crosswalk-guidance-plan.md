# E62 횡단보도 안내 재설계 구현 계획 (2026-10-03)

spec `docs/superpowers/specs/2026-10-03-crosswalk-guidance-design.md`(설계 리뷰 반영본). 세션 `e62-crossing`.

구현 방식 판정: **inline 위주.** 리듀서 세 벌·공유 fixture·소비자 문장이 한 계약으로 묶여 같은 커밋에서 움직여야 하고(fixture를 고친 커밋에서 세 벌 게이트가 같이 초록이어야 한다), 서버 필드 이름이 소비자 인터페이스를 정한다(선행 결정이 후속 인터페이스를 바꾼다). 리뷰는 별도 컨텍스트 서브에이전트.

## 묶음

1. **서버 판본 2** — `walk-guidance.ts`(경로 단위 재작성 `rewriteWalkBriefingV2`: MOVE·CROSS 틀, 방향 원재료, 분해, `parts`·`crossingClock`·`actionResolved`), `walk-route.ts`(파이프라인 판본 인자 기본값 없음, 주석 단계의 `body` 꼬리·분해 조각 주석 생략, `attachStepActions` 표식 처리, 경유지 보정), `route-schema.ts`(`wording`·`crossingRoad`), `types.ts`, 채팅 도구·웹 `walkRouteUrl`·조회 줄 목록·CLI/MCP 카탈로그 `implicitQuery`. 테스트: 문안 확정본 예문 기대값, `parts` 조립 관계 전수, 미지정 응답 byte-identical, Tmap 원문 보존, 분해 규칙.
2. **리듀서 R1~R6** — 웹 `route-guide.ts`·`route-geometry.ts`(`crossing`) ↔ Kit `RouteGuide.swift`·`RouteGeometry.swift` ↔ `:kit` 같은 둘, 공유 fixture `route-guide-scenarios.json`과 세 러너(`stopped`·`crossing`·`late`). 기존 시나리오 기대값 변경은 각 시나리오의 의도를 보존하는 쪽으로(행동 없는 단계를 행동으로 바꾸거나 기대를 R4로 옮김). 변이 주입으로 B1 시나리오 검출력 확인(커밋 뒤).
3. **표시** — `guide-live-rows.ts` ↔ `GuideLiveRows.swift` ↔ `:kit`의 `crossingRemaining`·윗줄 `body`, fixture `guide-live-rows-scenarios.json`.
4. **소비자** — 웹 `useRouteGuide.ts`(머리말 `late`, 임박 방향, 되읽기 `body`, `stopped` 전달)·`DistanceBeacon.tsx`(남은 거리 행), iOS `GuideText`·`BeaconModel`(같은 넷 + 억제 복구)·`BeaconTrackingSheet`(행은 모델 문자열 그대로)·Kit `RouteService`(`wording=2`, 실험판 `crossingRoad=1`)·`AppConfig`, `messages/*.json` 6로케일 + xcstrings·`arg-order`·`:kit` 카탈로그·안드로이드 strings 재생성, 안드로이드 앱 최소 수정(`stopped`·`crossing` 전달).
5. **검증·문서** — 오프라인 코퍼스 재생·실보행 로그 재생(저장소 밖), 카카오 실호출, 게이트 전부, 리뷰, 문서 분배.
