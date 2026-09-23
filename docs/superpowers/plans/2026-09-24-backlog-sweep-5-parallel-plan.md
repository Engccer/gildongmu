# 백로그 5차 소화 — 병렬 세션 계획 (2026-09-24)

코디네이터 세션 `gildongmu-9c [504187]`. 기준 SHA는 이 문서를 담은 커밋(착수 프롬프트에 박는다). 절차 정본은 `parallel-sessions` 스킬(Claude 분기). 위원장 판정(2026-09-24): 웨이브 구성 그대로 진행, E50 ODsay 실호출 예산 **최대 40건**.

## §0. 전제(코디네이터 관측, 2026-09-24 02:30 KST, `9ec4d95d`)

- 메인 체크아웃 clean, origin/main과 일치. 스토어 iOS 1.19 `WAITING_FOR_REVIEW`(빌드 27, 아카이브 `2903e8e3`) — 이번 웨이브의 iOS 변경은 심사판에 없고 다음 릴리스에 실린다.
- 2026-09-19~21 세션이 남긴 worktree 7개(`ios-b11-direction`·`ios-briefing-empty-names`·`ios-endpoint-state`·`ios-location-ui`·`ios-backlog-integration`·`ios-briefing-corpus`·`android-address-sync`)와 브랜치 17개는 전부 main에 동등 커밋이 있어(`git cherry` 전량 `-`) 제거했다. 남은 worktree 0, 브랜치 `main`뿐.
- **`npx tsc --noEmit`는 `9ec4d95d`에서 오류 0이다.** BACKLOG §7 "검증 기준선 복구"의 "tsc 오류 8건" 서술은 낡았다(2026-09-23 `a4c86c37`에서 복구됨) — 이 커밋에서 BACKLOG를 고친다. `TransitGuidePanel.test.tsx` 간헐 실패는 그대로 열려 있다(small-5).
- 머신: 메모리 free 72%, 스왑 466MB 사용, 부팅된 시뮬레이터 0, 다른 claude 세션 0.
- 기준선 게이트 기록은 `prepare-worktrees.sh --baseline`이 `~/.claude/parallel-sessions/gildongmu/baseline-<sha>.log`에 남긴다.
- doc-audit 신호(BACKLOG B12의 `src/lib/utils.ts`·`speechSynthesis`·`useTtsPlayback`)는 dodo-planet 경로·심볼을 가리킨 것이라 결함이 아니다 — 이 커밋에서 `dodo-planet/` 접두를 붙여 오탐을 없앤다.

## §1. 마일스톤·확정 판정·모델 배정

| 세션 | 항목 | 확정 판정(출처) | 모델·노력 | 판별 근거 |
|---|---|---|---|---|
| `e50` | E50 대중교통 대안 경로 재구성 | 위원장 판정 3건(BACKLOG E50, 2026-09-24) + 아래 코디네이터 설계 | opus · **high** | spec을 새로 쓰고 축 조합 문구·재조회 UI를 고른다 |
| `n4-via` | N4 경유지 진행 표시(웹·iOS) + 웹 안내 훅의 경유지 수용 | 위원장 판정 3건(BACKLOG N4 🆕 2026-09-24) + 아래 | opus · **high** | 리듀서 이벤트·문장·거리 상수를 설계한다 |
| `b12` | B12 웹 채팅 복사·듣기 | BACKLOG B12 웹 설계(접수 세션 강한 디폴트) + 아래 | opus · medium | 설계가 확정돼 있고 이식 성격 |
| `small-5` | A48 + `TransitGuidePanel.test.tsx` 간헐 실패 + §7 편승 1·3 | 아래 | opus · medium | 처방이 정해진 소규모 묶음 |
| `n4-web-wire` (웨이브 2) | 웹 길찾기 화면에서 경유지 조회의 안내 시작 버튼 개방 | N4 판정 ③ | opus · medium | 배선 10여 줄, 훅은 n4-via가 준비 |
| `doc-audit` (웨이브 2) | §7 편승 2·4 + SessionStart 신호 + 이번 웨이브 문서 분배 점검 | `doc-audit` 스킬 | opus · medium | 정형 |

서브에이전트 모델: 리뷰어·감사는 `model: opus`, **적대적 설계 리뷰(e50·n4-via의 spec)와 데이터 무결성 최종 검토는 `model: fable`**(동시 1개, `name` 부여, 한도 통보 시 opus 재디스패치). 세션이 fable 리뷰어를 high로 돌리려면 세션이 high여야 하므로 e50·n4-via만 high다.

**코디네이터 판정(제품 판단이 아닌 설계 사항 — 세션은 이 위에서 spec을 쓴다)**:

- **E50 호환 계약(가장 중요)**: 스토어 iOS 1.18·1.19는 `highlight: [String]?`·`displayIndex: Int?`로 관대하게 디코딩하지만, Kit `alternativeNameKey`가 모르는 축은 `alternativeHeading`(`displayIndex ?? 1`)으로 떨어진다. **웹 배포(push)가 앱보다 먼저**이므로 ①`highlight`는 기존 값(`fastest`·`fewestTransfers`)에 새 값(`busOnly`·`subwayOnly`·`leastWalk`)을 **additive**로 더하고 ②서버는 **`displayIndex`를 계속 채운다**(옛 앱이 "대안 경로 N"으로 구분하게, 순번은 표시 순서) — 새 클라이언트(웹·Kit·`:kit`·CLI)는 `highlight`가 비어 있지 않으면 `displayIndex`를 무시하고, 비어 있는 대안은 이제 **응답에 실리지 않는다**(판정 1: 채움 폐기). 스키마 필드 삭제 금지. 축 키 이름은 위 셋으로 고정한다(웹 `types.ts` `TransitHighlight` ↔ Kit ↔ `:kit` ↔ CLI `formatters.ts` 304행 union).
- **E50 축 조합 문구**: 한 경로가 축을 여럿 가질 수 있다. 조합마다 문장 키를 늘리지 말고(5축 조합 폭발) **spec에서 조립 규칙을 정한다** — 한 접근성 객체·쉼표 구분·가운뎃점 금지·"이름이 곧 정보"(E42 선례: 사유 문장 금지). 기존 `alternativeFastestFewestTransfers` 조합 키는 그 규칙의 특수 사례로 흡수하거나 유지하되 6로케일·xcstrings·안드로이드 strings 3벌 동조. 문구 시안은 렌더된 문장으로 보고 파일에 쓰고 코디네이터가 위원장과 TextEdit으로 확정한다(확정 전엔 시안 문자열로 구현을 진행하고 마지막 커밋에서 치환).
- **E50 수단 축 판정원**: ODsay 응답의 `pathType`(1 지하철·2 버스·3 혼합)이 정본이고, 실호출 게이트에서 leg 구성(비도보 leg가 전부 버스/전부 지하철)과 교차 대조해 어긋나면 spec §0에 적는다. 재조회는 `/api/route/transit`에 **옵트인 파라미터**(`pathType=1|2`, zod, 누락=현행) 하나로 열고 캐시 키는 URL이라 자동 분리. 버튼은 **웹·iOS** — 전체 응답에 그 수단 축 경로가 없을 때만 나타나고, 누르면 1회 조회, 결과는 3-state(찾음=목록에 축 이름으로 삽입 / 없음=문장 / 실패=502 문장). 안드로이드는 `:kit` 이름 미러 + strings까지, 버튼은 BACKLOG E43 등가성 후속으로 등록(이번 범위 밖). CLI·MCP·WebMCP는 새 축 이름 소비만(재조회 파라미터 노출 없음).
- **E50 tie-break**: 표시 개수가 줄어 동률 선택이 최종이 된다(PORTS.md `pickBest` 행). dodo 규칙(최소 환승 동률이면 그중 빠른 것)을 기본으로 spec에서 각 축의 2차 키를 정하고 그 PORTS 행을 닫는다(`~/Mac-Projects/PORTS.md`는 이번 웨이브 e50 소유).
- **E50 실호출 예산 40건**(위원장 확정): 게이트 표본 OD 10쌍 전체 조회 + 수단별 재조회 ≤20 + 머지 전 확인 ≤10. `verify-odsay-*.mjs`의 `--from-corpus`처럼 저장 응답 재사용을 우선하고 호출마다 카운터를 보고 파일에 남긴다. 초과가 필요하면 멈추고 코디네이터에 보고.
- **N4 리듀서**: 경유지 접근 이벤트 1종(`waypointApproaching`, 웹 `route-guide.ts` ↔ Kit `RouteGuide.swift` ↔ `:kit` `RouteGuide.kt` **3벌 미러 + 공유 fixture `route-guide-scenarios.json` 시나리오 추가** — 안드로이드 `:kit`은 등록부가 잠그므로 순수 계층 미러는 필수, 안드로이드 앱 UI 배선은 BACKLOG E43 등가성 후속으로 등록). 접근 예고 거리는 도보 최종 접근과 같은 상수에서 시작해 잠정(A6 계열, BACKLOG §2 도보 표에 행). 남은 거리 행은 "다음 목표" 기준 한 줄(판정 ①), `steps[waypointStepIndex].startD` 분기, 도착 추정은 최종 목적지에만.
- **N4 문장**: 판정 ②의 두 문장("경유지 {label}까지 {distance}" / "경유지 {label} 도착. 이제 목적지 {dest}로 안내합니다")은 위원장 판정문에 있으므로 확정값으로 쓴다. 시트 남은 거리 행 라벨("경유지 {label}까지 {distance}, 약 {min}분" / "목적지 {dest}까지 …")도 같다. 낱말을 바꿔야 하면 TextEdit 왕복. 6로케일·xcstrings 재생성·`ios/i18n/arg-order.json`(신규 키만 `--update-arg-order`).
- **N4 웹 훅**: `useRouteGuide`는 지금 `via: null`을 박아 조회한다. n4-via가 훅에 경유지 입력(옵션)을 열고 `DistanceBeacon`의 표시를 경로의 `waypoint`에서 유도하되 **`DistanceBeacon`·훅의 props 서명은 기존 호출부가 그대로 컴파일되게 유지**한다(`DirectionsView.tsx`는 e50 소유라 이번 세션이 만지지 않는다). 길찾기 화면의 `walkGuideStartable`에서 `!hasVia`를 풀고 경유지를 훅에 넘기는 배선은 웨이브 2 `n4-web-wire`가 한다 — 인계 사항은 n4-via 보고 파일에 "훅 입력 이름·타입"으로 남긴다. 자동차(`carGuideStartable`)의 경유지 개방은 이번 범위 밖(BACKLOG N4에 남긴다).
- **B12**: `src/lib/markdown-plain-text.ts` 신설(dodo `src/lib/utils.ts` `markdownToPlainText` 이식) + 공유 fixture `src/lib/__tests__/fixtures/markdown-plain-text-cases.json`을 Kit `MarkdownPlainTextTests.swift`가 함께 읽게 바꾼다(Kit 구현은 건드리지 않고, 드리프트가 나오면 고치지 말고 보고). 웹 듣기 훅 `src/hooks/useTtsPlayback.ts`는 `speechSynthesis` 우선·`/api/tts` 폴백(로케일 보이스 없을 때만, `getVoices` 지연 로드 처리), 앱 전체 동시 1개, 언마운트·받아쓰기 시작 시 정지. 복사 완료 통지는 채팅 화면이 소유한 polite 창구 하나로(A40 — `ChatInterface`의 진행 통지 채널을 재사용, 새 live region 금지). 버튼 라벨 키는 `chat.*` 네임스페이스에 6로케일(iOS 키 아님 — xcstrings 변환 대상인지 `messages-to-xcstrings.mjs` 규칙으로 확인). 버튼 순서는 산문 → 카드 → 출처 → [복사][듣기].
- **small-5**: A48은 `pickAboardStation`과 같은 `repollRef` 세우기 + 테스트. `TransitGuidePanel.test.tsx`의 `boardingUpstreamFailed` 단언은 통지 커밋을 `waitFor`로 기다리게. §7-1 `usage-probes.mjs` ODsay 주석을 Flex 기준으로. §7-3 `format-drift.test.ts`를 안드로이드 `:kit` `Format.kt`·`LocationNarrative.kt`까지 스캔하고 CLAUDE.md·INTEGRATIONS의 "3벌 미러"를 4벌로(자기 줄만).
- **웨이브 밖(사유 유지)**: E33 웹 잔여·B6·B8·B9 ②·W1-R(웹 실시간 안내 실보행 미검증) · A47(실기기 확인 선행) · E48 ②③·E47 2·3(판정 선행) · E45 웹 브리핑 대응(웹에 로터 등가물 없음, B8과 같은 판정) · E15 ③·E14 ③(설계 선행).

## §2. 파일 소유권 지도

| 세션 | 소유 | 경계 인터페이스·주의 |
|---|---|---|
| `e50` | `src/lib/providers/odsay-select.ts`·`odsay.ts`(pathType 투영·`SearchPathType` 옵션)·`src/app/api/route/transit/**`·`src/lib/types.ts`의 `TransitHighlight`·`src/lib/transit-alternative-name.ts` + Kit `TransitAlternativeName.swift` + `:kit` `TransitAlternativeName.kt`(+테스트·공유 fixture)·**`src/components/DirectionsView.tsx` 전체**·`src/components/TransitRouteBriefing.tsx`·iOS `Directions/DirectionsTabView.swift`·`RouteBriefing.swift`·Kit `Models/RouteModels.swift`·안드로이드 `directions/DirectionsStrings.kt`·`TransitLegText.kt`·CLI `packages/cli/src/lib/formatters.ts`(transit 자리)·MCP 미러·`src/lib/webmcp/tools/plan-directions.ts`·i18n `directions.alternative*`·`route.transit.alternative*` 3벌·`scripts/verify-odsay-alternatives.mjs`(신규)·`~/Mac-Projects/PORTS.md` pickBest 행 | **웹 배포가 앱보다 먼저** — 응답은 additive, `displayIndex` 계속 채움(§1). `DirectionsView.tsx`는 이 세션만 만진다(n4-via 금지) |
| `n4-via` | `src/lib/route-guide.ts` + Kit `RouteGuide.swift` + `:kit` `RouteGuide.kt` + `src/lib/__tests__/fixtures/route-guide-scenarios.json`(+각 테스트)·`src/hooks/useRouteGuide.ts`·`src/components/DistanceBeacon.tsx`·iOS `Directions/BeaconModel.swift`·`BeaconTrackingSheet.swift`·i18n `directions.via*`·`beacon.*` 경유지 키(6로케일·xcstrings·`ios/i18n/arg-order.json`·안드로이드 strings)·`android/kit/mirrors/*.json` RouteGuide 행 | `DirectionsView.tsx` **금지**(e50 소유). `DistanceBeacon`·`useRouteGuide` 외부 서명은 하위 호환. 훅의 경유지 입력 이름을 보고 파일에 인계 |
| `b12` | `src/components/chat/**`(+테스트)·`src/lib/markdown-plain-text.ts`(신규)·`src/lib/__tests__/fixtures/markdown-plain-text-cases.json`(신규)·`src/hooks/useTtsPlayback.ts`(신규)·Kit `Tests/.../MarkdownPlainTextTests.swift`(fixture 소비로 전환)·i18n `chat.*` 새 키 6로케일 | `src/app/api/tts/route.ts`·`src/lib/tts/**`·Kit `MarkdownPlainText.swift`는 읽기만. 답변 산문 live region 복제 금지·카드 done 1회 마운트 유지 |
| `small-5` | `src/hooks/useTransitGuide.ts`·`src/components/__tests__/TransitGuidePanel.test.tsx`·`scripts/lib/usage-probes.mjs`·`src/lib/__tests__/format-drift.test.ts`·CLAUDE.md 거리 표기 줄·`docs/INTEGRATIONS.md` 거리 표기 절 | `TransitGuidePanel.tsx` 자체는 A48에 필요할 때만 |
| `n4-web-wire` (웨이브 2) | `src/components/DirectionsView.tsx`의 `walkGuideStartable`·`useRouteGuide` 호출부 + 테스트 | e50·n4-via 통합 뒤 |
| `doc-audit` (웨이브 2) | 문서 전반 | 전 세션 통합 뒤 |

**겹침과 직렬**: `DirectionsView.tsx`(e50 ↔ N4 웹 배선) → 배선을 웨이브 2로 분리. `android/kit/mirrors/core.json`은 e50·n4-via가 **자기 행만** 고치고 rebase 뒤 `mirror-registry.test.ts`로 확인. `messages/*.json`은 자기 키만. `ios/i18n/arg-order.json`·xcstrings·안드로이드 `strings.xml`은 **rebase 뒤 재생성**(손 병합 금지). `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`docs/FIELD-TEST.md`는 자기 항목만, rebase 뒤 `comm -23`·`comm -13` 대조.

**소유권 측정 근거**: `rg -l`로 호출부를 뽑은 뒤 각 파일을 열어 주석·타입 import를 걸렀다(2026-09-24 `9ec4d95d`). e50의 `DirectionsView.tsx` 소유는 transit 블록(`transitEntries`·`transitRouteLabel`·1600행대 렌더)이 실제 호출부이기 때문이고, n4의 그 파일 접점은 `walkGuideStartable` 한 줄뿐이라 웨이브 2로 뺐다.

## §3. git 격리 — 저장소 정책: main 직접 push

`prepare-worktrees.sh`가 만든 `~/gildongmu-wt/<이름>`(브랜치 `feat/<이름>`, `origin/main` base)에서 작업한다. 통합:

```bash
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}"
comm -23 <(git show "${base}:docs/BACKLOG.md" | sort) <(sort docs/BACKLOG.md)   # 고친 공유 문서마다, 중괄호 필수. 역방향 comm -13도
# 생성물 재생성 → 게이트(gate-lock.py) → push
git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

main push는 Vercel 프로덕션 자동 배포다(이 repo는 리뷰 게이트 통과 후 자동 push 허용). `--force` 금지. `git add -A` 금지. `git stash` 되도록 금지(기준선은 `baseline-<sha>.log`로 가린다). 무거운 게이트는 `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- <명령>`.

## §4. 웨이브

- **웨이브 1**: `e50` · `n4-via` · `b12` · `small-5` (동시, 30초 간격 착수)
- **웨이브 2**: `n4-web-wire`(e50·n4-via 둘 다 통합 뒤) · `doc-audit`(전부 통합 뒤)
- **실기기 배포**: 세션은 하지 않는다. iOS 두 구성·한소네 설치는 통합 뒤 코디네이터가 한 번에 한 대상씩.

## §5. 착수 프롬프트·보고 경로

프롬프트 사본: `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`. 보고: `~/gildongmu-wt/<이름>-reports/`(통합 시작·완료·막힘마다 새 파일 `<단계>-<YYYYmmddHHMM>.md`, 리뷰 `review-<주제>-<시각>.md`, 기준 `base.sha`).
