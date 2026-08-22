# 2026-08-22 실사용 피드백 통합 계획 — 병렬 세션 작업 분할

> 출처: 위원장 실사용 피드백(2026-08-22, 카카오톡) 4건 + `docs/BACKLOG.md` 통합. 판정은 2026-08-23 세션에서 위원장이 내렸고 여기 **결과만** 적는다. 이 문서는 병렬 터미널 세션들의 **착수 브리프**이고, 각 마일스톤의 설계 정본은 그 세션이 쓰는 spec이다(여기 설계를 복제하지 않는다). 절차 정본은 `parallel-sessions` 스킬, 직전 선례는 `2026-08-22-feedback-260821-parallel-plan.md`.

> ✅ **2026-08-23 웨이브 1·2 종료**: K3 `051c869` → K1 `43c0a72` → K2 `b417f3f`(배포 기록 `2ce46b8`) → E15-1 `6eaced3`. 실기기 정식·실험 두 구성 `6eaced3`. 남은 것은 위원장 실기기 판정 — `docs/BACKLOG.md` K1(탭 순서 실험판·띠바·억제)·K3(실사용 3항)·B1(자동차 실주행, `docs/FIELD-TEST.md` §6)·E15-1(실승차, §5-4). 웨이브 3(doc-audit)은 별도 세션.

## 0. 전제 (조사·로그 판독 결과)

- **자동차 실주행 로그(2026-08-22 자택 → 송추가마골) 회수 완료**: 실험판에서 돌았다(`guide-diag.old.log`, 16:52 KST 시작, fix 2,424건, 최고 26.9m/s). 원본은 `~/gildongmu-private/field-logs/2026-08-23/`(repo 밖, 색인은 `docs/superpowers/specs/logs/README.md`에 K2 세션이 추가). ⚠ 로그에 수단 표식이 없어 속도로만 도보·자동차를 가른다 — K2가 세션 첫 줄 `session kind=` 표식을 넣는다.
- **띠바가 탭 바를 덮는 원인은 구조**: `GildongmuApp.swift`의 `.safeAreaInset(edge:.bottom)`이 **TabView 자체**에 걸려 있어 inset 콘텐츠가 탭 바 자리에 그려진다(사진 실측: 탭 바가 시각적으로도 사라진다, VoiceOver는 탭 바를 인식 못 하고 띠바가 화면 첫 객체). `accessibilitySortPriority`·`zIndex`는 소스에 없다.
- **탭 순서 변경은 안전**: `AppTab`이 이름 기반 rawValue이고 인덱스 참조·저장값이 없다(`selectedTab`은 `@State`, 기본 `.chat`).
- **자동차 안내의 격차 절반은 결함이 아니라 옛 방침("실주행은 딥링크 위임")의 의도적 배제**였다 — 위원장이 그 방침을 뒤집었다(§1 K2).
- **채팅 도구는 20개**(`src/lib/chat/declarations.ts`), 미연결 라우트 중 순수 추가 가능한 것이 다수. 도구 수 상한 근거는 코드·문서에 없으나 선언이 매 요청 프롬프트에 실리므로 증설 판정은 `npm run test:ab`가 정본.

## 1. 마일스톤과 확정 판정

| ID | 이름 | 피드백 | 확정 판정(위원장 2026-08-23) · 설계 결정(코디네이터) | 규모 |
|---|---|---|---|---|
| **K1** | 안내 시트 접기·띠바 위치·탭 순서 | 1, 4 | **(위원장)** 최소화 버튼은 한 행을 차지하지 않고 **시트 최상단 우측 작은 아이콘**(YouTube 플레이어 전체화면 접기 아이콘 레퍼런스), 라벨 **"안내 시트 접기"**(`guide.minimize` 문구 교체, 6로케일). 띠바는 **탭 바 바로 위**에 놓여 VoiceOver 순서가 화면 콘텐츠 → 띠바 → 탭 바가 되게, 띠바 문구 **"안내 시트 펼치기"**(`guide.band.return`). 탭 순서 **검색 - 길찾기 - 내 주변 - 채팅**. **(설계)** 버튼은 `toolbar(.topBarTrailing)` 아이콘 버튼 + 접근성 라벨(시각 텍스트 없는 아이콘이라 `accessibilityLabel` 정당), 도보·대중교통 두 시트 동일. 띠바는 iOS 26 `tabViewBottomAccessory`를 `#available`로 쓰고 18~25는 각 `Tab` 콘텐츠 쪽 `safeAreaInset`으로 폴백 — 두 경로 모두 실기기(또는 시뮬 26/18)에서 탭 바가 보이고 VO 순서가 맞는지 확인이 게이트. 기본 선택 탭은 **검색**(첫 탭 = 기본. 채팅 유지가 낫다고 보면 세션이 spec에 근거를 적고 위원장에게 묻는다). **+ 잔일 N1 후속**: 검색·채팅 탭 받아쓰기 중 안내 톤·통지 억제(`outputSuppressed`를 `SpeechService` 시작·종료에 연결, 두 모델 공통). | 중간 |
| **K2** | 자동차 실시간 안내 완성 | 2 | **(위원장)** ①"실주행은 딥링크 위임" 방침 **폐기**, 자동차도 도보처럼 자체 안내로 완성(딥링크 버튼은 보조로 존치). ②청취자 **둘 다, 설정으로 전환**: *동승자 모드*(기본, 내가 이어폰으로 듣는다 — VO 통지·햅틱 유효, 도보 문형 계승) / *운전자 모드*(운전하는 가족이 스피커로 듣는다 — 짧은 명령형, 낭독 빈도 낮게, 햅틱 무의미, **VO 통지가 아니라 `TtsPlayer` 음성 채널**로 발화). ③임박 신호는 거리가 아니라 **시간 축 5초 전**(잠정, 실주행으로 조정; 운전자 모드 8초). ④종료: 목적지 부근 정차 시 **도착 종 + 종료 화면 + "여기서 도보 안내 시작" 인계 버튼**(대중교통 하차 인계 틀, 걸음 요약 없음). **(설계)** 행동별 임박 톤 5종(`imminentTone`)·햅틱 재사용, 행동 분류는 문자열 마커가 아니라 Tmap `turnType` 입력(낭독 재조합 금지 조항과 무충돌), 하단 2행(`guideLiveRows`) car 확장, 이탈 시 자동 대안 제안 car 확장(`maybeFetchProposal` walk 가드 해제 검토), 주기 통지 단문화는 임박 층 도입과 동시에. 방위 축·도착 추정 자동 종료·최종 접근 6b는 **이번 범위 밖**(배제 근거가 별도 실측을 요구). 로그 `session kind=` 표식. **+ 잔일 N4 잔여**: 안내 중 경유지 삭제(K2가 `BeaconTrackingSheet`·`BeaconModel`을 소유하므로 여기서). ⚠ 설계 리뷰 대상(새 판정 층·안전 축: 헌장 설계 리뷰 조건 ①④). ⚠ 실주행 판정(B1)은 실험판에서, 봉인(`experimentalGuidanceEnabled`)은 유지. | 큼 |
| **K3** | 채팅 function-calling 도구 확장 | 3 | **(위원장)** 7종 추가, 버스 노선 경유 정류소만 제외: ①역 첫차·막차(`/api/station/timetable`) ②역명으로 실시간 도착(`/api/station/subway-arrival` 역명 경로) ③현재 위치 정위(`/api/where-am-i`) ④한눈에 보기(`/api/nearby/overview`) ⑤길찾기 3도구에 `via` 인자(대중교통은 `unsupported:"waypoint"` 정직 전달) ⑥앵커 고정 8도구에 `place` 인자(지명으로 묻기) ⑦무장애 편의시설 상세(`barrier-free/detail`, 16번 도구의 `contentId` 연쇄). **(설계)** 신규 도구는 **산문 정본, 렌더 카드 없음**(iOS `PlaceProjection` 작업 회피 — 기존 카드 타입 재사용만 허용), 각 도구 키 게이트 동형, 날조 금지 systemInstruction 불변. 머지 게이트: 실호출 + `npm run test:ab`로 도구 선택·토큰 변화 실측(증설 전후 비교표를 spec에). 레이트리밋 공유 쿼터(data.go.kr·서울 열린데이터) 주의. | 중간 |
| **E15-1** | 대중교통 "진행 상황 조망" 능력 | 백로그 E15 첫 타자 | **(위원장)** 이번 묶음에 포함. **(설계)** 백로그 E15 권고 그대로 — 시트 통합 금지, **능력 프로토콜**을 조망 하나에서 발견(셸 공유, 행 생성기만 교체: leg + 정차역, "지금 여기"는 현재역). A16 L2의 "설명만 해 둔 침묵"과 같은 화면에서 해소, 대안 전환 버튼은 그 안에. ⚠ **설계 리뷰 필수**(능력 프로토콜 = 판정 계층 신설). 산출물 검증은 실험판. | 큼 |

**폐기(위원장 2026-08-23)**: **E17** 길찾기 화면 지도 앱 실주행 위임 버튼 — 장소 상세의 딥링크로 충분. `docs/BACKLOG.md` §9로 이동(코디네이터가 이 커밋에서 처리).

**기존 백로그와의 관계**: K1은 N1 실기기 관찰 ②③(띠바)을 흡수하고 N1 후속(받아쓰기 억제)을 닫는다. K2는 G3(자동차 봉인)의 선행 조건 B1 실주행 판정 대상을 넓힌다 — 코드가 끝나도 봉인은 실주행 뒤에 푼다. E15의 "자동차 몫은 이식이 아니라 판정" 서술은 K2로 대체된다(코디네이터가 BACKLOG E15에 한 줄 정정). K3은 §2 관찰 항목 "채팅 심야 지하철 4-state"의 공백(첫차·막차 도구 부재)을 닫는다.

## 2. 파일 소유권 (겹침 지도)

| 마일스톤 | 소유 파일(주요) |
|---|---|
| K1 | `ios/Gildongmu/GildongmuApp.swift`(탭 순서·띠바 부착·기본 탭), `Directions/BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`의 **최소화 버튼·toolbar만**, `Gildongmu/SpeechService.swift`(억제 연결), `Directions/GuideSessionCoordinator.swift`(`GuideSession` 억제 브리지), `messages/*.json` `guide.minimize`·`guide.band.*`·`ios.tab.*` |
| K2 | Kit `RouteGuide.swift`·`CarRouteGuide.swift`·`WalkAction.swift`·`GuideLiveRows.swift`·`GuideToneLayer.swift`·`BeaconTones.swift`, 웹 미러 `src/lib/route-guide.ts`·`car-route-guide.ts`·`walk-action.ts`·`guide-live-rows.ts`·`guide-tone-layer.ts` + 공유 fixture, `Directions/BeaconModel.swift`·`BeaconTonePlayer.swift`·`GuideText.swift`·`GuideDiag.swift`·`BeaconTrackingSheet.swift`(**행 구성·경유지 삭제** — toolbar는 K1), `Gildongmu/SettingsView.swift`(청취자 모드), `Chat/TtsPlayer.swift`(운전자 채널 재사용), 서버 `src/lib/car-guidance.ts`·`providers/tmap-car.ts`(turnType 투영), `messages/*.json` `guide.*`(K1 키 2개 제외)·`ios.guide.*`·`ios.settings.*` 신규 키 |
| K3 | `src/lib/chat/**`(declarations·router·agent-loop·system-instruction), `src/__ab__/**`, 관련 테스트, `packages/cli`·`mcp` **무변경**(채팅 도구는 서버 내부). 필요 시 `src/lib/where-am-i*`·`nearby-overview*`의 **호출 인터페이스만**(구현 변경 금지) |
| E15-1 | `Directions/TransitGuideModel.swift`·`TransitTrackingSheet.swift`(**본문·조망 — toolbar는 K1**), Kit `TransitGuide.swift`·신규 능력 프로토콜 파일, 웹 `src/lib/transit-guide*`·`TransitGuidePanel`, `messages/*.json` `transitGuide.*` |

**겹침**: K1∩K2 = `BeaconTrackingSheet` / K1∩E15-1 = `TransitTrackingSheet` / K1∩K2 = `GildongmuApp`(K2가 종료 화면 presentation을 만질 경우) → **K1 먼저**(작다). K2∩E15-1 = 없음(수단이 다름, `BeaconTonePlayer` 인터페이스는 불변 유지). K3 독립.

**공유 생성물·공용 파일 규약**: `messages/*.json`은 자기 네임스페이스만(6로케일 동시) / `Localizable.xcstrings` 2벌은 손 머지 금지, rebase 뒤 `node ios/scripts/messages-to-xcstrings.mjs` + `check-xcstrings-keys.mjs` / `project.pbxproj` 새 파일은 충돌 1순위, ID 재사용 금지(`xcodebuild -list` 검증) / `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md` 자기 항목 줄만 / `guidance-gate-drift.test.ts` 진입점 수(6)는 K2가 종료 화면 인계 버튼으로 진입점을 더하면 spec 표와 함께 갱신.

## 3. Git 격리 절차 (세션 공통)

repo는 main-direct다. 병렬은 **worktree + 브랜치**로 격리하고 main 통합은 fast-forward만 한다.

```bash
git -C ~/Mac-Projects/gildongmu worktree add ~/gildongmu-wt/<name> -b feat/<name> main
cd ~/gildongmu-wt/<name>
# 작업: 자기 브랜치에만, pathspec 커밋 (git add -A 금지)
git commit -- <파일들>
# 통합 (리뷰 통과 후)
git fetch origin && git rebase origin/main
node ios/scripts/messages-to-xcstrings.mjs && npm run test:run
git push origin feat/<name>:main            # ff만. 거부되면 다시 rebase
git -C ~/Mac-Projects/gildongmu worktree remove ~/gildongmu-wt/<name>
```

- `--force` 금지(하드 스톱). 실기기 배포는 **한 번에 한 세션**, 배포 직전 코디네이터에 알리고 해제 뒤에만 다음 세션. 정식·실험 두 구성 설치가 기본(K2·E15-1 산출물은 실험판에서만 열린다).
- 메인 worktree는 코디네이터가 `git pull --ff-only`만. TTS 요약 파일 경합은 알려진 잡음.
- 소유권 밖 파일을 건드렸으면 통합 보고에 자진 신고.

## 4. 웨이브 (제안 — 최종 순서는 위원장 결정)

| 웨이브 | 동시 세션 | 근거 |
|---|---|---|
| **1** | **K1** · **K3** · **K2**(spec·설계 리뷰·Kit/웹 순수 함수·서버 turnType — iOS 시트·앱 파일은 K1 통합 뒤) · **E15-1**(spec·설계 리뷰까지 — 코드는 K1 통합 뒤) | K1이 작아 먼저 끝나고, 나머지 셋은 K1과 겹치지 않는 층부터 시작할 수 있다 |
| **2** | K2 iOS · E15-1 구현 (K1 통합 뒤, 같은 세션이 이어간다) | `BeaconTrackingSheet`·`TransitTrackingSheet` 독점이 풀린다 |
| **3** | doc-audit 세션 | 네 세션이 각자 분배한 문서의 겹침·낡음 점검, 1.12 릴리스 노트 초안 |

## 5. 세션 착수 프롬프트 (복사용)

각 프롬프트 머리말은 고정: `[병렬 세션 배정: 이 세션의 역할 이름은 **<이름>** 다. 첫 응답 첫 줄에 "세션 <이름>" 라고 밝혀라.]` 본문 공통: 이 문서 경로 + "§2 소유 파일 밖 금지" + §3 worktree 명령 + 과제 요지 + 배포 규칙 + "통합·배포 시작·완료마다 코디네이터(ListAgents의 gildongmu 코디네이터 세션)에 SendMessage로 보고".

- **k1-sheet**: §1 K1 전부. 순서: 탭 순서(5분) → 띠바 위치(26 accessory + 18 폴백, 실기기로 탭 바 가시·VO 순서 확인) → 버튼 toolbar 이식·문구 2개 교체 → 받아쓰기 억제 연결. 시뮬 26·18 둘 다 `xcodebuildmcp`로 스냅샷. 끝나면 실기기 두 구성 배포.
- **k2-car**: §1 K2. spec(`2026-08-23-car-guidance-completion-design.md`) → codex adversarial-review(판정 층 신설) → Kit/웹 미러 순수 함수 + fixture → 서버 turnType 투영 → **K1 통합 확인 후** iOS(BeaconModel·시트·설정·TtsPlayer 채널) → 경유지 삭제 → 로그 표식 → 실험판 배포 → BACKLOG B1 실주행 판정 축 갱신 + `docs/FIELD-TEST.md` 대본.
- **k3-chat**: §1 K3. 도구 7종을 작은 커밋 단위로, 각각 실호출 게이트. 마지막에 `npm run test:ab` 증설 전후 비교를 spec에. 웹 배포는 push로 자동.
- **e15-transit**: §1 E15-1. spec → codex adversarial-review(능력 프로토콜) → **K1 통합 확인 후** 구현 → 실험판 배포(K2와 배포 순서 조율).
