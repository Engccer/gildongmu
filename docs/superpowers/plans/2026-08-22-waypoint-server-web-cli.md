# N4 경유지(서버·웹·CLI) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보·자동차 경로에 경유지 1개(`via`)를 받아 `waypoint{stepIndex,coord}`를 응답에 싣고, 대중교통은 `unsupported:"waypoint"`로 정직 표시하며, 웹 폼·최근 경로·CLI/MCP가 그것을 소비한다.

**Architecture:** 스키마(`via` 선택 좌표) → provider 4종(파라미터 + 경유지 표지 투영, 표지 부재 throw) → 서비스(`via` 전달) → 라우트(커버리지·transit 마커) → 소비자(웹·CLI). 스텝 문장은 불변, 구획은 소비자가 `stepIndex`로 그린다.

**Tech Stack:** Next.js 16 라우트 핸들러, zod 4, Vitest 4, next-intl, citty CLI.

**Spec:** `docs/superpowers/specs/2026-08-22-waypoint-server-web-cli-design.md`

**구현 방식 판정:** inline. 스키마→provider→서비스→라우트→웹이 한 타입(`waypoint`)을 순차 공유하고, 실호출 결과에 따라 정규화가 뒤집힐 수 있는 탐색적 작업. 리뷰는 별도 컨텍스트(spec-compliance + code-quality 서브에이전트).

## Global Constraints

- §2 소유 파일 밖 수정 금지(iOS·`src/lib/route-guide*`·`messages` 타 네임스페이스). `messages/*.json`은 6개 로케일 동시, `directions`·`recentRoutes`·`route` 네임스페이스 안에서만.
- `via` 없는 요청의 응답은 byte-동일(옵트인 필드 키 부재).
- 커밋은 `git commit -- <파일>` pathspec, `git add -A` 금지.
- UI 라벨 이모지·em dash 금지. 통지 꼬리 문장 금지.

---

### Task 1: 스키마 — `via` 파라미터

**Files:** Modify `src/app/api/route/walk/route-schema.ts`, `src/app/api/route/car/route.ts`(querySchema), `src/app/api/route/transit/route.ts`(querySchema). Test `src/app/api/route/walk/__tests__/route-schema.test.ts`(기존 파일이 있으면 거기에 추가).

**Produces:** `WalkQuery.via?: Coord`, `parseWalkQuery(raw: {..., via: string | null})`.

- [ ] 테스트: `via: null` → `data.via === undefined`; `via: "37.5,127.1"` → `{lat,lng}`; `via: "x"` → `ok:false`.
- [ ] 구현: `via: coordSchema.nullable().transform((v) => v ?? undefined)`. car·transit 스키마에 동일 줄.
- [ ] `npm run test:run -- route-schema` 통과 후 커밋 `feat(route): via 파라미터 스키마(도보·자동차·대중교통)`.

### Task 2: 타입 + provider 4종 정규화

**Files:** Modify `src/lib/types.ts`(`RouteWaypoint` 타입, `WalkRouteBriefing.waypoint?`, `CarRouteBriefing.waypoint?`), `src/lib/providers/kakao-walk.ts`, `tmap-pedestrian.ts`, `tmap-car.ts`, `kakao-navi.ts`. Tests: 각 provider의 기존 `__tests__` 파일에 케이스 추가(fixture는 §1 실호출 응답 축약본).

**Produces:**
```ts
export interface RouteWaypoint { stepIndex: number; coord: Coord }
normalizeKakaoWalkRoute(data, opts?: { expectWaypoint?: boolean })
normalizeTmapWalkRoute(data, opts?: { includeLineGeometry?; expectWaypoint?: boolean })
normalizeTmapCarRoute(data, opts: { includeGeometry?; expectWaypoint?: boolean })
normalizeRoute(route, opts?: { expectWaypoint?: boolean })   // kakao-navi
getKakaoWalkBriefing({..., via?: Coord}) / getWalkRouteBriefing({..., via?: Coord}) / getTmapCarBriefing({..., via?: Coord}) / getCarRouteBriefing({..., via?: Coord})
```

- [ ] 테스트(각 provider): `expectWaypoint:true` + 표지 있는 fixture → `waypoint.stepIndex`·`coord` 기대값; 표지 없는 fixture + `expectWaypoint:true` → throw(`/경유지/`); `expectWaypoint` 미지정 → `waypoint` 키 부재.
  - 카카오 도보: legs 2개(leg0 스텝 2·leg1 스텝 3) → `stepIndex 2`, coord = leg0 마지막 path 끝점.
  - Tmap 보행자: PP1 Point → 그 스텝 인덱스.
  - Tmap 자동차: description 있는 B1 → 그 guide 인덱스; 말미 무설명 B1은 무시(guides 수 불변).
  - 카카오 내비: type 1000 guide가 section0 끝·section1 첫머리 중복 → guides에 **한 번만**, 그 인덱스.
- [ ] 구현: 위 투영. fetch 함수는 `via`가 있으면 카카오 도보 `via_x`/`via_y`(roundCoord 4), Tmap `passList: "lng,lat"`, 카카오 내비 `waypoints: "lng,lat"`를 붙이고 normalize에 `expectWaypoint: !!via`.
- [ ] URL 단언 테스트: fetch를 mock해 카카오 도보 URL에 `via_x=`, Tmap body에 `passList`, 카카오 내비 URL에 `waypoints=`가 있는지.
- [ ] 통과 후 커밋 `feat(route): provider 4종 경유지 파라미터·waypoint 투영(표지 부재는 throw)`.

### Task 3: 서비스·라우트

**Files:** Modify `src/lib/walk-route.ts`(`getWalkRoute`·`getWalkRouteAlternatives`·`fetchPrimaryOrFallback`에 `via?: Coord` 전달), `src/lib/car-route.ts`, `src/app/api/route/walk/route.ts`, `car/route.ts`, `transit/route.ts`. Tests: `src/app/api/__tests__/` 기존 라우트 테스트에 케이스 추가.

- [ ] 테스트: walk·car 라우트에 `via`가 국외면 `{outOfCoverage:true}`; transit에 `via`가 있으면 upstream 미호출(`getTransitRoute` mock 호출 0) + `{result:null, unsupported:"waypoint"}`; `via` 없는 요청 응답 스냅숏 불변.
- [ ] 구현: 커버리지 체크에 `via` 포함, 서비스에 `via` 전달(`annotateAudioSignals`·`withStepFree`·`rewriteWalkBriefing`은 `...briefing` 스프레드라 `waypoint` 보존 — 테스트로 확인: `getWalkRoute` mock provider가 `waypoint`를 주면 결과에 남는지).
- [ ] 커밋 `feat(route): via 전달·커버리지·transit unsupported 마커`.

### Task 4: 실호출 게이트(서버)

- [ ] `npm run dev` 띄우고 curl: walk(카카오 기본), walk `variant=shortest`, walk `includeGeometry=1`, car, car `includeGeometry=1`, transit. `waypoint` 존재·`stepIndex` 문장 확인, 기하 응답은 `buildGuideRoute`/`buildCarGuide`가 null이 아닌지 노드 스크립트로 확인. 결과를 spec §5 아래 "실호출 결과" 절로 기록.
- [ ] 재작성 파이프라인이 "경유지 후 313m 이동"·"도착지 건너편 후 …"를 어떻게 내는지 기록(깨지면 `walk-guidance`·`car-guidance`는 소유 밖이 아니므로 패턴 추가 가능 — 단 최소 수정).

### Task 5: 웹 상태 모듈(`directions-state`·`recent-searches`·`walk-route-url`)

**Files:** Modify `src/lib/directions-state.ts`, `src/lib/recent-searches.ts`, `src/lib/walk-route-url.ts`; tests 기존 `__tests__` 파일.

**Produces:** `serializeDir(from, to, via?: DirEndpoint)` → `from/to/via`; `parseDir` → `{from, to, via: DirEndpoint | null}`(3토막, via는 place만·`cur`면 null 전체); `RecentRoute.via?: RecentEndpoint`; `RecentEndpointField = "from" | "to" | "via"`; `walkRouteUrl({..., via: Coord | null})`(필수 인자, 모듈 계약).

- [ ] 테스트: 왕복 3토막, `cur`를 via에 넣으면 null, 2토막 호환; sameRoute가 via 차이를 구분; via 있는 경로 기록·삭제; `walkRouteUrl` via 있으면 `&via=lat,lng`.
- [ ] 구현·통과·커밋 `feat(web): dir 직렬화·최근 경로·도보 URL에 경유지`.

### Task 6: 웹 `DirectionsView`

**Files:** Modify `src/components/DirectionsView.tsx`, `messages/{ko,en,es,fr,it,ja}.json`(`directions.via`, `directions.searchVia`, `directions.addVia`, `directions.removeVia`, `directions.viaArrived`="경유지 {label} 도착", `directions.unsupportedWaypoint`, `recentRoutes.itemVia`). Test `src/components/__tests__/DirectionsView.test.tsx`가 있으면 케이스 추가(jsdom 레인).

- [ ] 상태 `viaField: FieldState | null`(null=필드 접힘). "경유지 추가" 버튼(도착지 필드와 조회 버튼 사이) → `viaField` 펼침 + 입력 포커스. `EndpointField` 세 번째 인스턴스(`recentEndpoints`는 `"via"` 목록, `focusAfterResolve`=submit). "경유지 삭제" 버튼 → 접고 submit 포커스.
- [ ] `runQuery`: `via` 미확정 텍스트면 `needEndpoints`; `fetchMode`에 `via: Coord | null` 필수 인자 추가, walk는 `walkRouteUrl`, car는 `&via=`, transit은 `via`면 fetch 없이 `{kind:"unsupportedWaypoint"}`. `ModeOutcome`에 그 kind 추가, 섹션 렌더에 `directions.unsupportedWaypoint` 문장, 합산 통지 계산은 done 수 기준 불변.
- [ ] 결과 렌더: walk·car 스텝 `ol`에서 `waypoint.stepIndex` 위치 앞에 `<li>{t("viaArrived",{label})}</li>`.
- [ ] 경유지 있는 조회에선 `DistanceBeacon`(안내 시작) 미렌더.
- [ ] `?dir=` 동기화·복원에 via, 최근 경로 기록에 via + `itemVia` 문장, 활성화 시 세 필드 확정.
- [ ] `npm run test:run`·`npm run lint`·`npx tsc --noEmit` 통과, 커밋 `feat(web): 길찾기 경유지 1개(버튼·조회·결과 구획·최근 경로·대중교통 미지원 표시)`.

### Task 7: CLI/MCP

**Files:** Modify `packages/cli/src/lib/endpoint-catalog-shared.ts` + `packages/mcp/src/endpoint-catalog-shared.ts`(동일 바이트), `packages/cli/src/lib/formatters.ts`, `packages/cli/CHANGELOG.md`·`packages/mcp/CHANGELOG.md`(Unreleased 항목). Tests `packages/cli/src/__tests__/formatters*.test.ts`.

- [ ] 카탈로그 3항목에 `{ key: "via", type: "string", required: false, description: "경유 좌표 '위도,경도' 1개(대중교통은 미지원 표시)" }`.
- [ ] `formatRouteWalk`·`formatRouteCar`: `waypoint`면 `stepIndex` 앞 `"경유지 도착"` 줄. `formatRouteTransit`: `body.unsupported === "waypoint"` → `["경유지는 대중교통 경로에서 지원하지 않습니다."]`.
- [ ] `cd packages/cli && npx vitest run`, `cd packages/mcp && npx vitest run` 통과, 커밋 `feat(cli,mcp): route-walk/car/transit via 파라미터·경유지 출력`.

### Task 8: 문서 분배·통합

- [ ] `CHANGELOG.md` 2026-08-22 아래 "N4 경유지(서버·웹·CLI)" 소제목, `docs/BACKLOG.md` N4 항목을 "서버·웹·CLI 완료, iOS 웨이브 3 대기 + 후속(웹 안내·딥링크 경유)"로 갱신, `PROGRESS.md` 상태 한 줄, CLAUDE.md 통합 카탈로그 도보·자동차 행에 `via` 한 줄.
- [ ] 리뷰: spec-compliance + code-quality 서브에이전트(diff·spec만 전달).
- [ ] §3 절차: rebase origin/main → `node ios/scripts/messages-to-xcstrings.mjs` → `npm run test:run` → `git push origin feat/n4-waypoint-server:main` → worktree 제거.
