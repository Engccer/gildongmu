# 백로그 6차 소화 — 병렬 세션 계획 (2026-09-26)

> **종료 상태(2026-09-27 03:50 KST)**: 세션 6개 전부 로컬 main 통합·창 종료(push 없음, 동결 준수) — 웨이브 1 odsay-corpus `2d94cb7b`·a11y-gate `709ea1b4`·small-6 `c8e0a8de`·outing `61b14ec9` / 웨이브 2 doc-audit `1844fabb`·ios-small `505448f1`. 코디네이터 커밋: 계획 판정 `520f98e2`, AGENTS.md 재생성 3회, 이 문서. worktree 0·`feat/*` 0. 실기기: iPhone 정식·실험 두 구성을 `1e1f964e`로 설치했고 최종 `505448f1`로 재설치(기기 잠금이면 자동 실행만 실패). 위원장 판정 5건(A47 착수·a11y 게이트 포함·N4 문안·E51 진입점 ② 버튼·나들이 쉼표·위치 실패 경유지 문장은 ios-small 창에서 직접). 남은 판정·후속은 `docs/BACKLOG.md` §2(E51 나들이 실보행·A47 iOS 착지·A49/A47 웹·N4 웹·D27 없음)·§3 동결 해제 순서(웹 push → 1.19 재제출 → CLI 태그)·E43 iOS 후보 ③(CRLF 차이)·B13(나들이 웹·안드로이드)·E47 2·3. doc-audit 미결: 상태 접미 헤딩 앵커 약 60개, CLAUDE.md 여유 2,300B(boarding 줄이 다음 이관 1순위). 사고: 코디네이터가 계획을 쓴 뒤 지운 playwright 캐시를 "있다"고 적었다(§0 정정), 착수 프롬프트가 세션 모델과 다른 Co-Authored-By를 지시했다(웨이브 2부터 실제 모델로).

코디네이터 세션 `gildongmu-0d [599b32]`. 기준 SHA는 이 문서를 담은 커밋(착수 프롬프트에 박는다). 절차 정본은 `parallel-sessions` 스킬(Claude 분기). 위원장 판정(2026-09-26): A47은 실기기 확인 없이 바로 고친다(헌장 §5) · 실브라우저 접근성 게이트(PORTS `[open]`)를 이번 웨이브에 넣는다. 그 밖의 설계 사항은 코디네이터가 정했고 아래에 그렇다고 적었다.

## §0. 전제(코디네이터 관측, 2026-09-26, `de22b91a`)

- ⛔ **push 동결 중**(2026-09-29 화 08:00 KST까지, `.git/hooks/pre-push`가 막는다. 근거 `PROGRESS.md` 배포 현황·글로벌 CLAUDE.md). 로컬 `main`은 `origin/main`보다 2커밋 앞(`7de5b141`·`de22b91a`). **통합 = 로컬 `main` fast-forward**, 웹 배포·iOS 심사·npm 발행 없음. 실기기 설치는 코디네이터가 통합 뒤 한 번에 한 대상씩.
- 메인 체크아웃 clean. worktree 0, 브랜치 `main`뿐. `~/gildongmu-wt/`에는 지난 세션 보고 디렉터리만 남아 있다(보존).
- 머신: 메모리 free 64%, 스왑 390MB, 부팅된 시뮬레이터 0, 다른 프로젝트 claude 세션 3개(moment 2·dodo-planet 1)가 같은 머신에서 돈다 → 게이트 락 필수. 디스크는 캐시 정리 뒤 **여유 10GB**(npm·SwiftPM·Xcode ModuleCache 삭제). iOS worktree는 DerivedData 약 2.4GB를 더 쓰므로 **iOS 세션은 한 번에 하나**(웨이브 2의 `ios-small`은 `outing` 통합·DerivedData 삭제 뒤).
- 스토어 iOS는 1.18, 1.19는 심사 취소 상태(빌드 27, 재제출은 동결 해제 뒤). 이번 웨이브의 iOS 변경은 1.19 아카이브(`2903e8e3`) 뒤 코드라 다음 릴리스에 실린다.
- `npx tsc --noEmit`·`npm run test:run` 기준선은 첫 worktree에서 한 번 돌려 `~/.claude/parallel-sessions/gildongmu/baseline-<sha12>.log`에 남긴다(동결이라 `prepare-worktrees.sh`를 못 쓰고 손으로).
- SessionStart doc-audit 신호 2건: PROGRESS `DEVELOPER_REJECTED`는 ASC 상태 문자열(코드 심볼 아님, 오탐), BACKLOG `OutingModel`은 E51 spec의 예정 심볼(이번 웨이브 `outing`이 만든다). 둘 다 웨이브 2 `doc-audit`이 마무리.
- **정정(2026-09-26 19:05, a11y-gate 보고로 확인)**: 위 "playwright 브라우저가 `~/Library/Caches/ms-playwright`에 이미 있다"는 착수 시점에 거짓이었다 — 코디네이터가 계획을 쓴 뒤 디스크 정리에서 그 캐시를 지웠다(§0 디스크 항목). 세션이 chromium-headless-shell 약 95MB를 내려받아 해결했고 영향은 없다.
- 실물 대조(코디네이터, `de22b91a`): E51 spec이 지목한 재사용 부품은 전부 있다 — Kit `SessionIdle.swift`·`GuideSessionCoordinator.swift`·`BeaconTones.swift`, 앱 `TitleMenu.swift`·`GuideTitleMenu.swift`·`GuideOverviewSheet.swift`·`BeaconModel.swift`, 웹 `session-idle.ts` + fixture `session-idle-scenarios.json`(웹·Kit·`:kit` 세 테스트가 읽는다), `scripts/build-guide-tones.py`, 소리 번들 `ios/Gildongmu/Resources/Sounds/guide-*.mp3`. A49의 즉폴 자리는 `useTransitGuide.ts`에 `void pollOnce()` 호출 12곳, 그중 `repollRef`를 세우는 곳은 2곳(`pickAboardStation`·A48 `changeBoardingAt`)이다. E47-1의 저장 응답 재사용 선례는 `verify-odsay-alternatives.mjs`(`--from-corpus`, 원본 읽기 전용·호출 0)이고 실제 corpus는 `~/gildongmu-private/probes/odsay-alternatives-2026-09-24/`에 있다. webfortd 원본은 `~/Mac-Projects/webfortd/tests/a11y/`(7파일 590줄) + `playwright.config.ts`.

## §1. 마일스톤·확정 판정·모델 배정

| 세션 | 항목 | 확정 판정(출처) | 모델·노력 | 판별 근거 |
|---|---|---|---|---|
| `outing` (웨이브 1) | E51 나들이 모드(iOS) + 동반 변경 §9 안전망 상수(웹·Kit·`:kit`) | spec `docs/superpowers/specs/2026-09-26-outing-mode-design.md` 판정 8건·상수 9종(위원장 확정) | opus · **high** | 판정 계층 신설, spec 적대적 리뷰를 세션이 판정해 반영 |
| `small-6` (웨이브 1, 문안 확정 뒤 착수) | A49 웹 국면 전이 즉폴 6곳 + A47 웹 착지 + N4 경유지 포기 문장(웹) | A49 처방 후보(BACKLOG) · A47 위원장 판정 2026-09-26 · N4 문안 위원장 확정값(아래) | opus · medium | 처방이 정해진 소규모 묶음 |
| `odsay-corpus` (웨이브 1) | E47-1 ODsay 실호출 게이트 4종의 저장 응답 재사용 | BACKLOG E47 "여지 1" + 아래 코디네이터 판정 | opus · medium | 선례(`verify-odsay-alternatives.mjs`)의 기계적 확장 |
| `a11y-gate` (웨이브 1) | 실브라우저 접근성 회귀 게이트(axe) 이식, PORTS 행 종결 | 위원장 판정 2026-09-26 + PORTS.md gildongmu 행 + 아래 | opus · medium | webfortd 원본의 이식 |
| `ios-small` (웨이브 2) | A47 iOS 착지 + N4 iOS 경유지 포기 문장 교정 + E43 iOS 확인 후보 3건 | A47 위원장 판정 · N4 문안 확정값 · BACKLOG E43 "iOS 확인 후보" | opus · medium | 처방이 정해진 소규모 묶음 |
| `doc-audit` (웨이브 2) | SessionStart 신호 2건 + 이번 웨이브 문서 분배 점검 | `doc-audit` 스킬 | opus · medium | 정형 |

서브에이전트 모델: 리뷰어·감사는 `model: opus`, **적대적 설계 리뷰(`outing`의 spec)와 데이터 무결성 최종 검토는 `model: fable`**(동시 1개, `name` 부여, 한도 통보 시 opus 재디스패치). 세션이 fable 리뷰어를 high로 돌리려면 세션이 high여야 하므로 `outing`만 high다.

**코디네이터 판정(제품 판단이 아닌 설계 사항)**:

- **E51 범위**: spec §16 순서 그대로. ~~1차는 iOS 정식 코드 경로(실험 봉인 아님, 위원장 판정).~~ ▶ **정정(2026-09-27 04:00, 위원장 재판정)**: 나들이는 다듬을 것이 많아 **실험판 봉인**이다 — 설계 시점의 "정식 코드 경로"는 위원장이 실수로 판정한 것. 후속 세션 `outing-gate`(웨이브 3, base `4798ee4c`)가 `AppConfig.experimentalOutingEnabled`로 진입점 둘을 봉인한다. 동반 변경(안전망 5분·5분, `coords=1`)은 정식 유지. §9 안전망 상수는 웹 `session-idle.ts` ↔ Kit `SessionIdle.swift` ↔ `:kit` `SessionIdle.kt` + 공유 fixture를 **한 커밋으로 먼저** 닫는다(세 미러의 테스트가 같은 fixture를 읽는다). 새 Kit 파일은 `android/kit/mirrors/guide.json`에 `pending`으로 등재(`mirror-registry.test.ts`). 웹·안드로이드 나들이 UI는 범위 밖(`PORTS.md`에 `[open]` 등록은 `outing`이 통합 보고 뒤 코디네이터가 한다). spec §11의 카카오 초과 요금 기록 충돌은 콘솔 확인이 되면 고치고, 안 되면 보고 파일에 남긴다(브라우저 자동화가 막히면 그 자리에서 멈추지 말 것). spec의 "리뷰 게이트 판정" 절 아래에 fable 리뷰 결과·반영 판정을 남긴다.
- **E51 진입점 ②**(길찾기 탭에서 도착지 없이 조회)는 `DirectionsTabView.swift`의 `needEndpoints` 거절 자리 한 곳만 만진다. ▶ **정정(2026-09-26 19:30, 위원장 판정 — spec fable 리뷰 M13 수용)**: 자동 시작이 아니라 **거절 통지("도착지를 입력하세요") 유지 + 그 자리에 "나들이 시작" 버튼 행**이다(도착지를 깜박 잊은 조회와 구분이 안 돼 실수로 세션이 켜지는 것을 막는다). spec §8.4를 그렇게 고친다. 상단 메뉴의 "나들이 시작"은 그대로. 인계 실패 프리필(§12)은 `DirectionsPrefill` 기존 경로 재사용.
- **E51 소유권 정정(2026-09-26 19:30, outing 반박 재현)**: `BeaconModel.swift` 금지는 **한 자리 예외로 푼다** — §9 무이동 300초가 도보 추정 도착의 제자리 300초와 같아져 `maybeEndIdleSession`(안전망, `handle(fix:)`에서 추정 도착보다 먼저 호출)이 도착 창 안에서 추정 도착을 선점한다(코디네이터가 코드 순서로 확인). 무이동 축을 도착 창 밖에서만 판정하는 가드 1줄 + 안드로이드 `WalkGuideModel.kt` 동형 1줄 + 소스 가드를 `outing`이 한 커밋으로 넣는다(`ios-small`은 `fallbackToBrief`만 만져 겹침 없음). `BeaconModel.swift:2236` "fix 두절 10분" 주석도 같은 커밋.
- **E51 spec 전제 정정(2026-09-26 19:30, outing 보고)**: spec §6.2의 "보행 인프라 seed는 앱 안 데이터"는 거짓이다 — 횡단보도·음향신호기는 서버 `/api/walk/nearby`가 거리·8방위만 준다(좌표 없음). 판정: **서버에 좌표 옵트인 파라미터를 additive로 열고 앱이 그것을 쓴다**(같은 세션, 같은 마일스톤). 공통 계약의 "새 서버 동작 의존 금지"는 스토어에 있는 앱(1.18)을 지키는 규칙이고, 나들이 코드는 웹 배포 뒤에야 릴리스되므로(CLAUDE.md "웹 배포가 앱보다 먼저") 해당하지 않는다. 안전 정보(횡단보도 예고)를 1차에서 빼지 않는다. 범위가 넘치면 그때 BACKLOG 잔여로 보고.
- **A49**: 즉폴 호출 자리 전수에서 즉폴 앞에 `repollRef.current = inFlightRef.current`를 세우는 것을 **한 헬퍼**(예: `requestImmediatePoll()`)로 뽑아 12곳이 같은 함수를 지나게 한다(복붙 12개 금지). 테스트는 "in-flight 폴이 있을 때 국면 전이 뒤 첫 조회가 in-flight 완료 직후에 나간다"를 여섯 진입점 중 대표 2곳 + 헬퍼 단위로.
- **A47(웹·iOS 공통 계약)**: 전이의 **출처**로 가른다 — 사용자 입력 유래 전이(버튼 누름: `confirmBoarded`·`boardAboardCandidate`·`board`·`completeOrAdvance`·`declareArrived` 등 **누른 버튼이 사라지는** 것)만 상태 문장 행(`SheetControl.status` ↔ 웹 `landingTarget` status)에 착지, 관측 유래 전이(폴 응답으로 승격)는 지금처럼 착지 없음. 웹은 `small-6`, iOS는 `ios-small`이 각자 플랫폼에서 구현하고 `transit-landing-guard.test.ts`의 허용 집합과 CLAUDE.md "boarding 국면의 선언 버튼" 줄·`docs/PATTERNS.md` 같은 절을 **자기 플랫폼 문장만** 고친다. ⚠ 착지 테스트는 누르기 전에 그 버튼으로 커서를 옮긴다(`clickFocused`, E38 함정).
- **N4 경유지 포기 문장(웹·iOS 공통, 위원장 확정값은 §1-1)**: 원인절을 뺀 문형으로 통일하고, 웹 `useRouteGuide.ts` 1898행의 `degradeMessage(failure) + viaDropped` 연결은 강등 사유가 `unavailable`일 때 **강등 문장을 대체**(두 "안내합니다" 제거), 그 밖의 사유(`retryable`·`noLocation`)에는 붙이지 않는다(현행 유지). iOS `BeaconModel.fallbackToBrief`는 `key == "guide.detailUnavailable"`일 때만 같은 대체, 다른 키에는 경유지 문장을 붙이지 않는다(a11y 감사 2026-09-24 "거짓 원인" 종결). es·fr·it의 경유지 낱말은 `addVia`와 같은 낱말로. ko 조사는 `{label}` 뒤 "은/는"이 아니라 조사 없는 문형을 우선한다(E45·N4 선례: 이름 뒤 조사 고정 금지).
- **E47-1(odsay-corpus)**: `verify-odsay-alternatives.mjs`의 corpus 규약(요청 키 → 파일, 실패 응답 미저장, `--from-corpus` 단독·호출 0)을 `scripts/lib/odsay-corpus.mjs`로 뽑아 나머지 4종(`express-lane`·`express-stops`·`lang`·`transfer-door`)이 같은 규약을 쓰게 한다. corpus 위치는 저장소 밖 `~/gildongmu-private/probes/<스크립트>-<날짜>/`(공개 저장소라 응답 dump 커밋 금지, `NOTICE.md`와 무관). **⛔ 이 세션은 ODsay 실호출을 하지 않는다**(Flex 과금·예산 0건): 검증은 기존 corpus(`odsay-alternatives-2026-09-24`)를 읽는 오프라인 경로와 단위 테스트(`scripts/**/*.test.mjs`)로만. 저장 경로가 실호출 없이는 검증되지 않는 스크립트는 "저장 훅만 넣고 첫 실호출 때 검증"을 BACKLOG E47에 남긴다. `docs/INTEGRATIONS.md` ODsay 절에 corpus 절차 한 문단, CLAUDE.md ODsay 키 행에 한 구절.
- **a11y 게이트(a11y-gate)**: webfortd 구조 그대로 이식(`tests/a11y/axe-helper.ts` critical 0 하드 게이트 + serious route별 baseline 잠금, `playwright.config.ts` chromium 단일·workers 1·`webServer`는 `npm run build && npm run start`). 라우트는 `/ko`·`/en`·`/ko/about`·`/ko/privacy`·`/ko/offline` + 상태 라우트(검색 결과 `?q=`·내 주변 허브 `?panel=nearby`·장소 상세·길찾기 결과) — **상태 라우트의 외부 API는 `page.route('**/api/**')`로 fixture 응답을 물려 실호출 0**(키·쿼터 비의존, 결정론). baseline은 첫 실행 결과를 그대로 적고 "신규 위반 fail·감소 권고"만(위반 고치기는 이 세션 범위 밖 — 발견 목록은 BACKLOG 신규 항목으로). `npm run test:a11y`는 `test:run`과 별개 레인(매 커밋 게이트에 넣지 않는다 — 빌드+크롬이라 무겁다. 도입 판정은 "PR 직전·릴리스 직전"이고 CLAUDE.md 명령어 절에 그렇게 적는다). `vitest.config.ts` include가 `src/**`·`scripts/**`뿐이라 `tests/`는 자동으로 밖이지만 `tsconfig.json`·eslint에 걸리는지 확인. 이 세션은 `npm install` 1회가 필요하다(playwright·axe devDeps, `~/Library/Caches/ms-playwright`에 브라우저가 이미 있어 재다운로드는 버전 다를 때만) — 게이트 락 안에서 한 번만. PORTS.md gildongmu 행은 `cross-port` 스킬 절차로 닫는다(소비 SHA).
- **E43 iOS 확인 후보 3건(ios-small)**: ①`Deeplink.swift`의 `=`·`+` 쿼리 인코딩이 Foundation과 같은지 Kit 테스트로 잠금 ②Foundation `CharacterSet` 실측 집합(U+200B 포함)을 Kit 테스트로 잠금(안드로이드 `SwiftSemantics`가 미러하는 대상이라 iOS 쪽 정본 테스트가 있어야 드리프트가 보인다) ③`ChatMarkdown` CRLF 분리가 웹·`:kit`과 같은지 공유 fixture로 대조. 결과가 "다르다"면 고치지 말고 보고(BACKLOG 등재는 세션이 자기 항목에).
- **웨이브 밖(사유 유지)**: E48 ②③·E45 웹 대응(B8과 같은 위원장 보류)·E33 웹 잔여·B6·B8·B9 ②·W1-R(웹 실시간 안내 실보행 미검증 선행) · E47 2·3(위원장 판정·측정 선행) · N4 자동차 경유지(판정 선행) · E15 ③·E14 ③(설계 선행) · A16 미확정 2건(실승차 로그 선행) · E30 잔여(당사자 판정 경로) · §3 도달(CLI/MCP 태그·iOS 1.19 재제출은 동결 해제 뒤).

### §1-1. 위원장 문안 확정값 (N4 경유지 포기)

TextEdit 왕복으로 확정한 뒤 여기 ko 원문 그대로 적는다. 확정 전에는 `small-6`을 띄우지 않는다(`ios-small`은 웨이브 2라 자연히 뒤).

- ✅ **확정(2026-09-26, TextEdit 왕복, 위원장이 시안 3을 직접 고침)** — ko 원문: `경유지({label})를 포함한 경로를 찾지 못했습니다. 경유지 없이 목적지({dest})로 안내합니다.` 괄호로 이름을 싸서 조사가 이름과 무관하게 고정된다(`경유지(…)를`·`목적지(…)로`). 웹 `directions.viaDropped`는 `{label}`·`{dest}` 두 인자를 받고 강등 사유 `unavailable`일 때 `degradedUnavailable`을 **대체**한다(붙이지 않는다). iOS `ios.guide.waypointDropped`도 같은 문형·두 인자, `guide.detailUnavailable` 갈래에서만 대체. 다른 로케일은 이 ko 문형의 뜻을 옮기되 이름은 괄호 안에(조사 문제가 없는 언어는 괄호를 빼도 된다). "방향과 거리로"는 뺀다(상시 표시 `degradedNote`가 그 사실을 이미 말한다).

## §2. 파일 소유권 지도

| 세션 | 소유 | 경계 인터페이스·주의 |
|---|---|---|
| `outing` | Kit 신규 `Outing*.swift`(+Tests)·`SessionIdle.swift`·`BeaconTones.swift`(톤 1종)·`GuideSessionCoordinator.swift`(Kit·앱, `.outing` 추가) · 앱 신규 `OutingModel.swift`·`OutingSheet.swift`·`OutingOverviewAdapter.swift`·`TitleMenu.swift`·`DirectionsTabView.swift`(`needEndpoints` 자리만)·`GuideOverviewSheet.swift`(어댑터 배선만)·`Resources/Sounds/guide-stroll.mp3` · `scripts/build-guide-tones.py` · 웹 `src/lib/session-idle.ts`+테스트 · `:kit` `SessionIdle.kt`+테스트 · fixture `session-idle-scenarios.json` · `android/kit/mirrors/guide.json`(자기 행) · `src/lib/__tests__/guidance-gate-drift.test.ts` · i18n `ios.outing.*`(`ios/i18n/ios-extra/*.json` 6로케일, `arg-order.json` 신규 키, xcstrings 재생성) · `docs/FIELD-TEST.md` 나들이 절 · spec 리뷰 절 · BACKLOG E51·§2 나들이 행 | `BeaconModel.swift`·`TransitGuideModel.swift`·`TransitTrackingSheet.swift` 금지. `useRouteGuide.ts`·`useTransitGuide.ts` 금지. `DirectionsTabView.swift`는 한 자리만(자진 신고) |
| `small-6` | `src/hooks/useTransitGuide.ts`·`src/components/TransitGuidePanel.tsx`·둘의 테스트·`src/lib/__tests__/transit-landing-guard.test.ts`(웹 허용 집합) · `src/hooks/useRouteGuide.ts`(1898행 viaDropped 조립만)·`useRouteGuide` 테스트 · `messages/*.json` `directions.viaDropped` 6로케일 · CLAUDE.md "boarding 국면의 선언 버튼" 줄(웹 문장)·`docs/PATTERNS.md` 같은 절(웹) · BACKLOG A49·A47(웹)·N4 문안 항목 | `DistanceBeacon.tsx`·`route-guide.ts`·`DirectionsView.tsx` 금지. 안드로이드 strings는 rebase 뒤 재생성만 |
| `odsay-corpus` | `scripts/verify-odsay-*.mjs` 5종·`scripts/lib/odsay-corpus.mjs`(신규)+`scripts/**/*.test.mjs` · `docs/INTEGRATIONS.md` ODsay 절 · CLAUDE.md ODsay 키 행 한 구절 · BACKLOG E47 | `src/lib/providers/odsay*.ts` 읽기만. ODsay 실호출 0 |
| `a11y-gate` | `tests/a11y/**`(신규)·`playwright.config.ts`(신규)·`package.json`(scripts·devDeps)·`package-lock.json`·`.gitignore`(playwright 산출물)·`tsconfig.json`/eslint 제외 설정(필요 시) · CLAUDE.md 명령어 절 한 줄 + 개발 규칙 한 줄 · `docs/PATTERNS.md` 새 절 · BACKLOG D27 · `~/Mac-Projects/PORTS.md` gildongmu 행 | `src/**` 수정 금지(위반 발견은 등재만). `npm install` 1회 허용(게이트 락 안) |
| `ios-small` (웨이브 2) | `TransitGuideModel.swift`·`TransitTrackingSheet.swift`(A47 착지)·`transit-landing-guard.test.ts`(iOS 허용 집합) · `BeaconModel.swift`(`fallbackToBrief` 조립만) · `ios/i18n/ios-extra/*.json` `ios.guide.waypointDropped` 6로케일·`arg-order.json`·xcstrings 재생성 · Kit `Deeplink.swift`·`ChatMarkdown.swift`·`SwiftSemantics` 계열 테스트(신규 테스트만, 구현 수정은 보고) · CLAUDE.md "boarding 국면의 선언 버튼" 줄(iOS 문장)·PATTERNS 같은 절(iOS) · BACKLOG A47(iOS)·N4·E43 iOS 후보 | `outing` 통합 뒤. `DirectionsTabView.swift` 금지 |
| `doc-audit` (웨이브 2) | 문서 전반 | 전 세션 통합 뒤 |

**겹침과 직렬**: `package.json`은 `a11y-gate`만. `CLAUDE.md`·`docs/PATTERNS.md`는 세션마다 **자기 줄·자기 절만**, rebase 뒤 `comm -23`·`comm -13`. xcstrings·안드로이드 strings·`arg-order.json`·`mirrors/*.json` 수치는 rebase 뒤 재생성(손 병합 금지). `transit-landing-guard.test.ts`는 웹(`small-6`)과 iOS(`ios-small`)가 다른 웨이브에서 자기 플랫폼 집합만. `CHANGELOG.md`(2026-09-26)·`docs/BACKLOG.md`·`PROGRESS.md`·`docs/FIELD-TEST.md`는 자기 항목만.

**소유권 측정 근거**: 호출부 기준(`de22b91a`). `outing`은 새 파일이 대부분이고 기존 파일 접점은 `GuideSessionCoordinator`(세션 잠금)·`TitleMenu`·`DirectionsTabView`(거절 자리)·`BeaconTones`(톤 표)·`SessionIdle` 세 벌뿐이다. `small-6`과 `outing`은 웹에서 `session-idle.ts`(outing) ↔ `useTransitGuide.ts`/`useRouteGuide.ts`(small-6)로 갈려 접점 0. `a11y-gate`는 `src/**`를 만지지 않는다.

## §3. git 격리 — 저장소 정책: push 동결(로컬 main ff)

worktree는 **로컬 `main`**에서 손으로 만든다(코디네이터가 미리 만들고 `npm install`·`.env.local` 복사까지 끝낸다):

```bash
git worktree add ~/gildongmu-wt/<이름> -b feat/<이름> main
```

통합(작업 세션):

```bash
cd ~/gildongmu-wt/<이름>
base=$(git rev-parse main) && git rebase "${base}"
comm -23 <(git show "${base}:docs/BACKLOG.md" | sort) <(sort docs/BACKLOG.md)   # 고친 공유 문서마다(CHANGELOG·BACKLOG·PROGRESS·FIELD-TEST·CLAUDE.md·PATTERNS), 중괄호 필수. 역방향 comm -13도
# 생성물 재생성 → 게이트(gate-lock.py) → ff
git -C ~/Mac-Projects/gildongmu merge --ff-only feat/<이름>
```

ff가 거부되면 다른 세션이 먼저 올린 것이니 rebase부터 다시. ⛔ **push는 어디로도 하지 않는다**(pre-push 훅이 막고, 훅을 지우지 않는다). `--force` 금지. `git add -A` 금지. `git stash` 되도록 금지(기준선은 `baseline-<sha12>.log`). 무거운 게이트는 `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- <명령>`(같은 머신에 다른 프로젝트 세션 3개가 돈다). 메인 체크아웃은 세션이 만지는 파일에 대해 clean을 유지한다(코디네이터 문서 커밋은 세션 통합 사이에만).

## §4. 웨이브

- **웨이브 1**: `outing` · `odsay-corpus` · `a11y-gate`(동시, 30초 간격) → 문안 확정(§1-1) 뒤 `small-6`.
- **웨이브 2**: `ios-small`(`outing` 통합 + DerivedData 정리 뒤) · `doc-audit`(전부 통합 뒤).
- **실기기 배포**: 세션은 하지 않는다. `outing`·`ios-small` 통합 뒤 코디네이터가 iPhone 정식·실험 두 구성을 한 번에 하나씩 설치.

## §5. 착수 프롬프트·보고 경로

프롬프트 사본: `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`. 보고: `~/gildongmu-wt/<이름>-reports/`(통합 시작·완료·막힘·판정마다 새 파일 `<단계>-<YYYYmmddHHMM>.md`, 리뷰 `review-<주제>-<시각>.md`, 기준 `base.sha`).
