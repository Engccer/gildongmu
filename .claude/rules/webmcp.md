---
paths:
  - "src/lib/webmcp/**"
  - "src/lib/place-lines/**"
  - "src/lib/route-step-items.ts"
  - "src/hooks/useWebMcpTools.ts"
  - "src/hooks/useAxisBridge.ts"
  - "src/components/PlaceSearch.tsx"
  - "src/components/PlaceDetail.tsx"
  - "src/components/DirectionsView.tsx"
  - "src/components/NearbyHub.tsx"
  - "src/components/BarrierFreeInfo.tsx"
  - "src/components/SeoulMetroFacilities.tsx"
  - "src/components/SeoulSubwayArrival.tsx"
  - "src/components/StationFacilities.tsx"
  - "src/components/StationMeta.tsx"
  - "src/components/StationTimetable.tsx"
  - "src/app/*/privacy/**"
---

# WebMCP 도구층 규칙

Claude Code는 위 `paths`에 맞는 파일을 읽을 때 이 파일을 자동으로 싣는다. 설계 단계(파일을 열기 전)이거나 다른 에이전트라면 이 영역 작업 전에 직접 읽는다. 항목 끝의 `→ INTEGRATIONS`·`→ PATTERNS`는 `docs/INTEGRATIONS.md`·`docs/PATTERNS.md`의 같은 제목 절이다. 어디서나 통하는 원칙은 루트 `CLAUDE.md`에 있다.

## WebMCP 도구층 (앱 루트가 브라우저 에이전트에게 상시 선언하는 도구 7개)

설계 정본은 spec `docs/superpowers/specs/2026-08-29-webmcp-wave2-design.md`(W2, 공통 계약은 W1 `2026-08-27-webmcp-tool-layer-design.md` §3.0·§4·§6), 상세는 PATTERNS §WebMCP 도구층.

- **도구 목록 정본은 코드다**(`src/lib/webmcp/manifest.ts` 7개, 루트 `PlaceSearch`가 상시 등록, 미가용은 실행 시 `notConfigured`). 화면별 등록·`open_*`·`focus_item` 재도입 금지(`webmcp-removal.test.ts`), 화면 이동은 `ensure-view.ts`. → PATTERNS
- **화면은 브릿지를 뷰 레지스트리에 게시하고 도구는 실행 시점에 읽는다**(`view-registry.ts`): 이동 뒤 대기는 뷰 이름이 아니라 정체성(`placeId`·`publishedAfter`)에 결박. → PATTERNS
- **도구층은 한 번에 하나만 실행한다**(`tool-lock.ts` `withOp`, 상한 30초, 늦은 완료는 `isLive()`로 무시). ⚠ 이미 끊긴 호스트 signal로는 잠금을 잡지 않는다. → PATTERNS
- **사용자 조작이 언제나 도구를 이긴다**: 새 세대가 앞 세대 대기자를 `superseded`로 끝내고, 모달이 열려 있으면 `modalOpen`으로 거절하되 닫지 않는다. → PATTERNS
- **손잡이는 불투명 `ref`**(`place-refs.ts`): 해석은 정착 시 동결한 스냅샷(`HomeBridge.snapshotFor`)에서만, 불일치는 `staleResult`·순번 밖은 `notFound`. → PATTERNS
- **장소 정보 축은 화면 소유 명령이다**(`place-axes.ts`+`useAxisSource`): 마운트 축 초기 `loading` 세대는 1, 정착 통지는 자식이 커밋 뒤. → PATTERNS
- **검색은 트랜잭션이다**(`PlaceSearch`): 정착은 커밋 뒤 effect가 판정, `busy`는 `statusRef`가 아니라 동기 갱신되는 분기 표로. → PATTERNS
- **도구층이 능동적으로 옮기는 포커스는 0이고 한 호출에 착지는 최종 화면의 기존 착지 하나뿐이다**(중간 착지 억제 `suppressFocusRef`·`isUnwinding()`). → PATTERNS
- **출력은 `finish(value, SHAPE)`만 지난다**(`output.ts` allowlist + `assertNoCoordinates`, 1,500자 상한은 항목 단위 생략). → PATTERNS
- **사람 문장은 화면과 같은 함수에서 나온다**(`place-lines/*`·`route-step-items.ts`·`transitRouteLabel`): 공유 헬퍼는 컴포넌트 모듈이 아니라 lib에 둔다. → PATTERNS
- **도구의 길찾기 조회는 화면 정본 `runQuery(request)`를 부르고 세대 결박 대기자로 기다린다**: 안내 세션이 살아 있으면 `sessionActive`로 거절하고 세션을 끊지 않는다. → PATTERNS
- **privacy `agent` 절은 웹 전용이다**(3자 일치 대상 아님). 도구 출력에 새 데이터 유형을 실으면 그 문장(6로케일)을 함께 고친다. → PATTERNS
