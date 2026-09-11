# 2026-09-12 실승차 피드백 3건 병렬 착수 계획 (코디네이터 `gildongmu-1f [f257b5]`)

> **웨이브 1 종료 상태(2026-09-12 06:20 KST)**: sheet-landing `d6abbfe9`(E38, 커밋 2) → transit-signal `65c3eb9b`(A41, 커밋 8) 로컬 main ff 통합, 두 worktree·창 제거. 실기기 배포는 웨이브 2 뒤 한 번(두 구성). 위원장 판정 신규: E40(시작 통지 목적지, 3수단)·E41(착지·통지 중복) — 웨이브 2 `status-prose`가 E39와 함께. §6 정정 절 참조.

> 접수 세션 = 이 코디네이터. 판정은 여기서, 코드는 작업 세션에서. push는 2026-09-22 09:00 KST까지 동결이라 통합은 **로컬 `main` fast-forward**(§3). 관측 시점 `b7cd34ba`(BACKLOG A41·E38·E39 등록 커밋).

## 0. 전제 (코디네이터 판독, 로그 `~/gildongmu-private/field-logs/transit-guide-diag-2026-09-12.log` 757행~ + URLCache entry 1136~1139)

- 2026-09-11 저녁 실승차(1411 신교동→갈월동 · 241 갈월동→한국폴리텍대)는 **웨이브 1 빌드 1.15.0(23) `9e808111`**에서 났다(착지 대상 `confirmBoarded`·백그라운드 폴 정지가 지문). 지금 아이폰에는 2026-09-12 03:09 HEAD 1.16.0(24)이 두 구성 다 설치돼 있다 — 재배포 불필요, 다음 실승차는 최신 판.
- **A41 기제(확정)**: 서울버스 도착 API의 "곧 도착"(`remainingStops == 0`, `staOrd − sectOrd == 0`)은 *직전 정류소 출발*이지 *이 정류소 정차*가 아니다. 앱은 승차(`arrivedAtBoardStop`)·하차(`arrivedByMode`) 둘 다 잔여 0을 정차로 읽어 자동 승격·"하차 지점 도착"이 직전 구간 주행 시간(간선 2~3분, 마을버스 16초)만큼 이르다. 원 설계 spec `2026-08-04-transit-guidance-design.md` 국면표는 "곧 도착은 임박 신호이지 도착 확정이 아니다"라고 적었고, `2026-08-22-transit-boarding-phase-design.md` §1이 잔여 0으로 접으며 무너졌다. ⚠ 정차 신호 후보(같은 API `isArrive1`·`stationNm1` / 목록 소실=출발 / 버스위치 API)는 **아직 실호출로 확정된 것이 없다** — 미검증 표시.
- **E38 위원장 판정(2026-09-12)**: 시트에서 무엇을 누르든 커서는 상태 문장 행(`SheetControl.status`)에 앉는다. 예외 없음(하차 도착도 [다음 구간]이 아니라 상태 문장). 웹 `TransitGuidePanel`도 같은 규칙.
- **E39**: 상태 문장 문장형. A41이 같은 문장("곧 도착" 어휘)을 만지므로 **A41 통합 뒤 웨이브 2**.

## 1. 마일스톤·확정 판정·모델 배정

| 세션 | 항목 | 모델 | 근거 |
|---|---|---|---|
| `transit-signal` | [A41](../../BACKLOG.md#a41-서울버스-곧-도착을-도착으로-읽는다--승차-자동-승격하차-도착-통지가-한-정거장23분-이르다---코드-종결2026-09-12-세션-transit-signal-changelog-같은-날-실승차-판정-대기) 서울버스 정차 신호 — spec 신설 + 실호출 게이트 + 리듀서·웹 미러 | `fable` | 정차 신호를 실호출로 골라야 하고(판단이 정본), 원인 확정은 됐지만 처방은 미정 |
| `sheet-landing` | [E38](../../BACKLOG.md#e38-안내-시트-착지-대상을-상태-문장-행으로-통일---코드-종결2026-09-12-세션-sheet-landing-실승차-판정-대기) 착지 대상 `status` 통일(iOS+웹) | `opus` | 판정 완료, 기존 A35 헬퍼 위에서 대상만 바꾸는 기계적 적용 |
| `status-prose`(웨이브 2) | E41(착지·통지 중복, 위원장 문안 판정) + E40(시작 통지에 목적지, 3수단) + [E39](../../BACKLOG.md#e39-대중교통-안내-시트-상태-문장을-문장형으로---코드-종결2026-09-12-세션-status-prose-changelog-같은-날-실승차-판정-대기) 상태 문장 문장형 | `opus` | 구조 확정(A26 클라이언트 조립), 문안은 위원장 TextEdit 왕복 |

**확정 판정(재질문 금지)**: ①"곧 도착" 시점 통지는 남긴다(승차 "곧 도착합니다", 하차 "이번 정류장에서 내리세요") — 승격·`arrived(certain)`만 새 신호로 ②지하철 `arvlCd`는 A41 밖 ③E38 예외 없음 ④E39는 A41 뒤.
**세션이 스스로 정할 것**: A41의 정차 신호 선택(실호출 결과가 정본), 이벤트·신호 enum 모양, 실호출 스크립트 이름.

## 2. 파일 소유권 (겹침 지도)

술어는 "이름이 나오는가"가 아니라 "그것을 고치는가"다.

| 세션 | 소유(쓰기) | 금지 |
|---|---|---|
| `transit-signal` | Kit `TransitGuide.swift`·`TransitGuideText.swift`·`TransitGuideTests.swift`, 앱 `TransitGuideModel.swift`(이벤트→통지 배선만), 웹 `src/lib/transit-guide.ts`·`src/lib/transit-track.ts`·`src/lib/providers/seoul-bus.ts`·`src/app/api/transit/track/**`·관련 테스트·공유 fixture(`src/lib/__tests__/fixtures/transit-guide*.json`), `messages/*.json`의 **새 키만**(`transitGuide.*` 네임스페이스 안, 기존 키 문안 변경 금지 — E39 몫), `scripts/verify-seoul-bus-*.mjs`(신설), spec `docs/superpowers/specs/2026-09-12-seoul-bus-stop-arrival-signal-design.md`(신설), `docs/INTEGRATIONS.md` §서울버스 절, `docs/research/RESEARCH-2026-08-03-mode-specific-guidance.md` 머리 한 줄(결론 반전 표기), CLAUDE.md 규칙 1~2줄 | `TransitTrackingSheet.swift`, `src/components/TransitGuidePanel.tsx`(착지 = E38). 필요하면 코디네이터에 보고 |
| `sheet-landing` | `ios/Gildongmu/Directions/TransitTrackingSheet.swift`(`phaseTransitionLanding`·시트 진입 착지·`landingFallbackText`), `src/components/TransitGuidePanel.tsx`·`__tests__/TransitGuidePanel.test.tsx`, `src/lib/__tests__/transit-landing-guard.test.ts`, `docs/FIELD-TEST.md` §5-3 착지 행, `docs/PATTERNS.md` 착지 절, CLAUDE.md 착지 규칙 줄(A35 항목) | Kit·Model·provider·i18n |
| `status-prose`(웨이브 2, 단독) | `TransitGuideModel.swift`·`BeaconModel.swift` 계열 시작 통지, `src/hooks/useTransitGuide.ts`, `src/lib/transit-guide-text.ts`·`transit-text-args.ts`·fixture `transit-guide-text-cases.json`, Kit `TransitGuideText.swift`, `messages/*.json`(전 키), xcstrings·arg-order 재생성, spec `2026-09-12-transit-status-prose-design.md`(신설), FIELD-TEST §5-2·§5-3, PATTERNS 상태 문장 절, CLAUDE.md 한 줄 | Kit 리듀서 `TransitGuide.swift`(A41 판정 계층)·E37 범위(내 주변 지하철 도착 줄) |
| 공용 생성물 | `CHANGELOG.md`·`docs/BACKLOG.md`(자기 항목만)·`PROGRESS.md`(상태 한 줄)·`ios/Gildongmu/Resources/Localizable.xcstrings`(생성물: rebase 뒤 `messages-to-xcstrings.mjs`로 재생성, 손편집 금지)·`ios/i18n/arg-order.json`(새 키만 `--update-arg-order`) | |

겹침 0으로 판단했다(관측 `b7cd34ba`). 세션이 "내 소유 목록이 틀렸다"고 보고하면 코디네이터가 재현해 이 절에 정정 절을 단다.

## 3. git 격리 절차 (각 세션 공통 — origin 금지, 로컬 main ff 통합)

worktree와 `node_modules`·`.env.local`은 **코디네이터가 착수 전에 만들어 두었다**(`~/gildongmu-wt/<name>`, base = 로컬 `main`). `npm install` 금지.

```bash
cd ~/gildongmu-wt/<name>                     # 브랜치 feat/<name>, 자기 파일만, pathspec 커밋(git add -A 금지)
# 리뷰(서브에이전트 spec-compliance + code-quality, iOS a11y 변경은 a11y 감사 — general-purpose에 ~/Mac-Projects/.claude/agents/a11y-auditor.md Read 지시) 통과 뒤:
base=$(git rev-parse main); git rebase main   # fetch 없음 — origin은 동결, 정본은 로컬 main
node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs    # i18n을 건드렸을 때
comm -23 <(git show $base:CHANGELOG.md | sort) <(sort CHANGELOG.md); comm -13 <(git show $base:CHANGELOG.md | sort) <(sort CHANGELOG.md)   # BACKLOG·FIELD-TEST도 같게 — 출력은 전부 내가 의도한 줄이어야 한다
# 무거운 게이트는 락으로 순번을 잡는다(동시 xcodebuild·vitest 금지):
until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done
npm run test:run -- --maxWorkers=2 && npx tsc --noEmit && npm run lint
(cd ios/GildongmuKit && swift test)
xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' build -quiet
rmdir ~/gildongmu-wt/gate.lock              # 실패해도 반드시 푼다
git -C ~/Mac-Projects/gildongmu merge --ff-only feat/<name>   # 통합. 거부(비-ff)면 rebase부터 다시. --force·origin push 금지
```

- `git push`는 어디로도 하지 않는다. 통합 뒤 `git -C ~/Mac-Projects/gildongmu log --oneline -1`로 자기 커밋이 main HEAD인지 확인해 보고에 SHA를 적는다. worktree 제거는 코디네이터 "통합 확인" 뒤.
- 리뷰가 도는 동안 rebase·추가 커밋 금지. 리뷰는 **전부 커밋한 뒤** `git diff main...HEAD`(3점)로 읽게 하고, 리뷰 보고는 파일로 받는다(`~/gildongmu-wt/reports/<name>-review-*.md`, 머리에 HEAD SHA).
- **실기기 배포·App Store 제출·npm 발행·origin push·외부 API 활용신청은 세션이 하지 않는다.** 배포는 웨이브 통합 뒤 코디네이터.
- 보고는 **파일 + SendMessage 둘 다**: `~/gildongmu-wt/reports/<name>.md`(착수 SHA·통합 SHA·변경 파일·검증 결과·소유권 밖 파일 자진 신고·남은 판정 위치·공유 자산 반영 요청). 코디네이터 주소 `gildongmu-1f [f257b5]`. SendMessage는 통보 채널이지 질의 채널이 아니다.
- 위원장 판정이 새로 필요하면 그 세션이 `AskUserQuestion`으로 직접 묻는다. 배정 모델이 판정에 부족하면 밀고 나가지 말고 코디네이터에 보고한다.
- 작업 세션은 TTS 요약 파일을 쓰지 않는다(런처가 `TTS_SUMMARY=off`). 사용자에게 닿아야 하는 것은 코디네이터로.
- 실호출은 프로덕션 쿼터를 공유한다 — 서울버스 도착 API 실호출은 항목당 수십 회 이내, 스윕은 호출 단위 실패 격리 + 부분 저장.

## 4. 웨이브

- **웨이브 1(동시 2)**: `transit-signal`(fable) · `sheet-landing`(opus). 게이트 락으로 빌드 겹침 차단.
- **웨이브 2**: `status-prose`(opus) — ✅ transit-signal 통합(65c3eb9b) 뒤 착수. 범위 E39+E41+E40. 인계: 이벤트 `arrivingAtBoardStop`·`arrivingAtAlightStop`(키 같은 이름), `boarded(cause: .departed)` 문장은 `boardedLine` 그대로(E39가 cause 분기 판단), boarding 잔여 ≤1 폴 15초 축소는 실승차 뒤.
- **웨이브 3**: doc-audit 새 창 → 코디네이터 실기기 배포(두 구성) → §2 실승차 판정은 위원장.

최종 순서는 위원장 결정으로 남긴다(기본값은 위).

## 5. 세션별 착수 프롬프트

원문은 `launch-session.sh`가 넘긴다(사본 `~/.claude/parallel-sessions/gildongmu/<name>.prompt.txt`, 본 문서에 복제하지 않음). 머리말 고정 + §0 전제 + §1 자기 행 + §2 자기 행 + §3.

## 6. 정정 절 (코디네이터, 2026-09-12 06:20 KST, 관측 `65c3eb9b`)

- **§2 소유권 누락 3건(세션 자진 신고, 코디네이터 확인)**: ①`src/hooks/useTransitGuide.ts`는 `TransitGuideModel.swift`의 웹 짝(이벤트→통지 배선)인데 표에 없었다 — transit-signal이 새 case 2개를 더했고 sheet-landing은 미접촉(diff 대조). ②`src/components/__tests__/TransitGuidePanel.test.tsx`의 서울버스 분기 헬퍼가 옛 "잔여 0=승격" 계약이라 transit-signal이 고쳤다 — sheet-landing 소유 파일이지만 sheet-landing 통합(d6abbfe9)보다 뒤에 rebase돼 충돌 없이 얹혔다. ③계획 문서의 A41·E38 앵커는 BACKLOG 헤딩에 종결 접미가 붙으며 두 세션이 각각 고쳤다. 다음 계획부터 "Model의 웹 짝 훅"과 "상대 소유 테스트의 계약 헬퍼"를 소유 표에 명시한다.
- **§0·판정 문언 정정**: E38 판정 문언의 "다음 행동 버튼은 한 번 스와이프 아래"는 사실이 아니다 — 상태 문장과 컨트롤 사이에 경유역 목록이 있어 두 번, 펼쳐 두면 정차역 수+2번(sheet-landing 실측, 문서·주석 4곳 정정). 실승차 대본이 그 비용을 묻는다.
- **§0 A41 후보 정정**: "같은 API의 `isArrive1`·`stationNm1`로 정차를 잡는다"는 실호출로 기각됐다(2,430행 전부 0, 현재 정류소명은 잔여의 다른 표기). 채택은 "곧 도착 뒤 목록 소실 = 서고 떠났다"(승차 승격 `departed`), 하차는 추정 도착. 버스위치 API는 하차 **확정**이 필요해질 때의 유일한 후보로 남았다(spec `2026-09-12-seoul-bus-stop-arrival-signal-design.md` §0·§5).
