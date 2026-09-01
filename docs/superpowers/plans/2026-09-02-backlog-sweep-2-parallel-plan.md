# 2026-09-02 백로그 2차 전수 소화 계획 — 병렬 세션 작업 분할

> 출처: `docs/BACKLOG.md` 전수 판독(2026-09-02, HEAD `f4270ec`). 위원장 지시 "백로그에서 코딩으로 처리할 수 있는 건 모두 처리, 마일스톤 여러 개면 코디네이터 + 병렬 세션". 판정 6건은 같은 세션에서 위원장이 직접 내렸다(§1 표의 "판정" 열). 절차 정본은 `parallel-sessions` 스킬, 직전 선례는 `2026-08-23-backlog-sweep-parallel-plan.md`·`2026-09-01-en-locale-residual-parallel-plan.md`.

## 0. 전제 (코디네이터 판독 결과, 관측 시점 `f4270ec`)

- **iOS 1.14는 WAITING_FOR_REVIEW**(ASC `--check` 2026-09-02, 빌드 22). 이 묶음의 iOS 변경은 1.14 아카이브 `11fe5f9` 뒤라 **스토어판엔 없다** — 판정은 직접 설치한 빌드로만. 1.15 제출 여부는 전 웨이브 뒤 위원장 판정.
- **CLI/MCP는 0.9.0 이후 미발행 변경이 있다**(E26 `lang`, `457e9c5`). small-batch(E29)가 포매터 계약을 또 바꾸므로 **발행은 그 통합 뒤 한 번**(cli-v0.10.0). 발행은 외부 배포라 **코디네이터가 위원장에게 묻고** 한다 — 세션이 태그를 push하지 않는다.
- 실기기 iPhone 13 Pro `available (paired)`(관측 시점 기준 — 배포 직전 재확인은 배포 세션 몫).
- **처리하지 않는 것(근거)**: §2 전부·§3 G3(실보행·실승차 판정) / §8 W1 G4 제출물·거리 추적 간섭 시나리오(위원장) / B6·B9 ②·N4 웹 경유지(웹 실시간 안내 실보행 미검증 축) / B7(CLI 실사용 뒤) / B8(위원장 보류) / E22(리뷰순 판정 선행) / E18(보류) / M2(도보 판정 선행) / E6·E1·E2·E3(조건 미성립) / D11(의도적 동결) / E20(외부 사건) / A1(동결) / E24(관측) / E14 ③(A16 L2의 조망 설명 행이 이미 "무엇을 기다리는지"를 말한다 — 별도 항목 아님) / E19 ①·④(문맥이 다르므로 현행 유지, 코디네이터 판정)·②(문장 판정 미결 — 열어 둔다) / PORTS.md 실브라우저 a11y 게이트(W2 마감 2026-09-04 뒤 착수 조건).

## 1. 마일스톤과 확정 판정

| 세션 | 항목(백로그) | 판정·설계 결정 | 규모 | 웨이브 |
|---|---|---|---|---|
| **transit-data** | A16 L1 데이터층 · E25 출구 번호 서버 투영 · E25 최단시간 조사 · A22 | **위원장 판정 2026-09-02: A16 L1 만든다.** ①급행 정차역 집합은 ODsay **런타임** 조회(노선 전 구간 1회) + `unstable_cache` 장기 캐시(공개 저장소라 seed 커밋 금지 — 재배포 문제). `/api/route/transit` 지하철 leg에 additive `expressStops?: string[]`(그 노선의 급행 정차역 이름 전체 집합, ODsay `passStopList` 원문 이름)를 싣는다 — **급행 운행이 있는 노선에만**, 조회 실패·미지 노선은 필드 부재(거짓 집합보다 부재). 웹 `types.ts` `TransitLeg` + Kit 대중교통 모델(`RouteModels.swift`) 디코딩(옵셔널). 실호출 게이트 `scripts/verify-odsay-express-stops.mjs`(9호선 급행 13역 집합이 나오는가, 완행 전용 노선엔 부재인가). ②**E25 출구 번호**: ODsay subPath `startExitNo`/`endExitNo`를 `TransitLeg`에 additive `exit?: {board?: string, alight?: string}`로 투영(실호출 확정 필드명으로, 부재는 필드 부재). ③**E25 조사**: 출발·도착 10쌍을 ODsay 길찾기 vs `subwayPath`(`Sopt=1`)로 실호출해 "더 나은 지하철 경로가 후보에 없는 빈도"를 `docs/research/RESEARCH-2026-09-02-odsay-subway-shortest.md`에 기록(설계 판정은 그 뒤, 이번엔 코드 없음). ④**A22**: `node scripts/verify-odsay-transfer-door.mjs` 주간 1회 실행·기록 + 사당발 2호선 leg `unknown`의 시간표 조인 미스 원인 규명·수정(순환선 wayCode·역명 정규화 — `name-mapping-miss-masquerades-as-uncovered` 계열). ⚠ ODsay 일 1,000회를 프로덕션과 공유 — 실호출은 세션 합계 100회 이내로 예산을 잡고 429면 재시도 말고 BACKLOG에 미실측으로. **설계 리뷰**: A16 L1 데이터 계약(ODsay 전 구간 조회 가정·집합 정확성 = 안전 축 ④)에 codex `adversarial-review` 1회 — spec `docs/superpowers/specs/2026-09-02-express-stops-data-design.md` | 중 | 1 |
| **transit-guide** | E15 ② 추세 톤 · A16 미확정 ①② 계측 · A16 L1 판정 계층 · E25 출구 번호 낭독 | **위원장 판정 2026-09-02: E15 ② 이번에 만든다.** ①**추세 톤**: 대중교통 승차 국면에 남은 정거장 수를 축으로 한 추세 톤 계층 신설 — `toneLayerStep`의 계층 구조(배타적 순서·이벤트 소유)를 공유하되 축은 정거장 수. Kit `TransitGuide.swift` 순수 판정 ↔ 웹 `transit-guide.ts` 미러 + 공유 fixture, 배선은 `TransitGuideModel`·`BeaconTonePlayer`. 실험판 봉인 안. **설계 리뷰 필수**(새 판정 계층·상태 머신). ②**계측**(A16 미확정 ①②): riding 국면 폴에 `logRidingPoll`(empty/매칭 실패/매칭 성공 + 잔여 수) 추가, 화면 잠금 중 타이머 간격 실측용 폴 시각 로그 — `TransitGuideDiag`. ③**A16 L1 판정 계층**(transit-data 통합 뒤): `terminatesBeforeAlight`(웹 ↔ Kit)에 급행 결정적 미도달 분기 — 잠금 후보가 급행이고 `expressStops`가 있고 하차역이 그 집합에 없으면 **활성화 차단 + 결정적 문장**("이 급행은 {하차역}에 서지 않습니다", i18n 6로케일 + en descriptor). 판정 불가(집합 부재)는 차단하지 않고 종전 `expressCheck` 유지. 완행 leg × 급행 잠금 후보 목록에서 그 열차를 고르지 못하게 한다. ④**E25 낭독**: 하차 통지·하차역 행에 `exit.alight`가 있으면 "{N}번 출구 방면" 병기(문장은 i18n, ko·en). 맞는지는 실승차(§2 E5·B2에 행 추가). ⚠ ③④는 transit-data가 main에 통합된 뒤에만 착수 — 판정은 `git fetch origin && git show origin/main:src/lib/types.ts | grep -c expressStops`(0이면 대기). 그 전에 ①②를 끝내 통합한다. 계약 위반 금지: `guidance-gate-drift.test.ts` 호출 수 불변(새 진입점 없음) | 큼 | 1(①② 즉시, ③④ transit-data 뒤) |
| **en-ios** | E27 잔여(iOS `facilityName`) · E28 후속 4건 · iOS 수동 위치 `labelRoman` | **위원장 판정 2026-09-02: iOS 수동 위치 병기 같이 한다.** ①**E27 잔여**: 백로그 후보 ⓐ — 서버 `SeoulMetroFacilityParts.lineEn` additive(라우트 `/api/station/metro-facilities`에 `langParam()` 도입, en일 때 `subwayLineNameEn` 표로), iOS `StationSections.facilityName`이 `parts.lineEn`을 소비(부재는 종전 조립). 웹은 이미 표를 탄다 — 무변화 확인만. ②**진료 종별 영문화**: `NightClinic.kind` "의원"/"병원" → i18n 키 `clinic.kind.clinic`·`clinic.kind.hospital`(6로케일, 웹 `NightClinicsNearby` + iOS `ClinicNearbyView`), 값이 2종 밖이면 원문 + `lang="ko"`. ③**둘러보기 도로명 `roadRoman`**: `SceneItem.road`에 `romanAddressOf` 계열 additive `roadRoman`, 웹 `SurroundingsScene`·iOS 장면 문장이 비-ko에서 소비. ④**길찾기 화면 장소명 병기**: 웹 `DirectionsView` 출발·도착 검색 결과 + iOS `DirectionsEndpointSearchView` 결과 행 + `DirectionsTabView` 현재 주소에 `bilingualName`/`bilingualLine` 적용(`Place.nameRoman`·`reverseGeocode(lang:)` 기존 값 소비만). ⑤**iOS 수동 위치 라틴 표기**: `DirectionsEndpoint.place`에 `labelRoman: String?`(지정 시점 저장 — 장소 `nameRoman`, 주소 juso `engAddr`), `ManualLocation`·`ManualLocationStore`·`LocationBarView`가 웹 `useManualLocationBilingual` 동형으로 1순위 낭독. enum 확장이 호출부 8파일에 닿으므로 **이 태스크는 세션 마지막**에, rebase 직후 한다(`TransitTrackingSheet`·`BeaconTrackingSheet`·`GuideSessionCoordinator`·`GildongmuApp`은 호출부 인자 한 줄만 — 자진 신고). 설계 리뷰 생략: 검증된 계약(E27·E28)의 소비 확장, 국소·가역 | 중~큼 | 1 |
| **ios-quality** | E16 잔여 2건 · §8 ko 인자 순서 게이트 · E19 ③ | **위원장 판정 2026-09-02: 인자 순서 게이트 넣는다.** ①Kit `RouteService.walk(lang:)`를 `String`에서 enum(`DataLocale`류, `WalkRouteVariant` 대칭)으로. ②Kit `walkStepAction`·`GuideActionSource.text` 분기 삭제(호출자 0 — 소스 주석 확인) — `GuideActionSource` 자체가 사라지면 `GuideTuning.actionSource`를 상수 제거로 졸업(car·walk 둘 다 `step`). ⚠ 웹 `src/lib/walk-action.ts`는 서버 정본이라 삭제 금지. ③**인자 순서 manifest**: `ios/i18n/arg-order.json`(키 → ko 플레이스홀더 등장 순서)을 `messages-to-xcstrings.mjs`가 생성·대조 — 기존 키의 순서가 바뀌면 exit 1(명시적 갱신 절차 `--update-arg-order`), 신규 키는 등록. 게이트 테스트 `scripts/__tests__/` 또는 `src/lib/__tests__/xcstrings-arg-order.test.ts`. 변이 주입으로 "ko 어순만 바꾸면 실패하는가" 확인. ④**E19 ③**: iOS 0건 문구가 웹보다 한정어를 잃는 3곳(소아 "야간·휴일" / 키즈 괄호 예시 / 무장애 "등록된")을 `ios/i18n/ios-extra/*.json` 6로케일에서 웹 문장과 맞춘다(iOS만, 웹 무변화). 설계 리뷰 생략: 정리·가드 신설, 사용자 가시 변화는 ④뿐 | 소~중 | 1 |
| **small-batch** | E29 · `lang` 검증 통일 · C5 빈 응답 케이스 + systemInstruction 보강 · D27 | **위원장 판정 2026-09-02: 하네스 실호출 돌린다(수십 원).** ①**E29**: `FORMATTERS[name](body, ctx)`로 요청 `lang`을 내리는 계약 변경(전 포매터 시그니처, `runEndpoint`가 넘김) → `route car`가 `--lang en` + `guidanceLang:"ko"`일 때 text 모드에 "한국어 안내(영문 미제공)" 한 줄 표기. `formatter-coverage`·drift 테스트 갱신. ②**검증 통일**: `/api/route/car`의 `lang`을 `langParam()`(미지 값 400)으로, `/api/chat`의 `locale`을 지원 6로케일 enum(미지 값 400)으로 — E27 원칙. CLI `--help`·README의 "오타는 400" 문구를 두 라우트에도 참으로 만든다. ③**C5**: `src/__ab__/cases.ts`에 **빈 도구 응답** 케이스(nearby 0건·`unknown`) 추가(`safety: true`), `system-instruction.ts`에 빈 응답 날조 금지 최소판(삭제+긍정 트리거 우선, [[prompt-edits-minimalism-first]]) → `npm run eval:ab` 실호출로 3.6 회귀 0 확인, 리포트 `docs/evals/`. ④**D27**: `NUMBER_RE`에 `도`·`유로`·`€` 흡수(`grounding.test.ts` 오탐 0). CLI 발행은 하지 않는다(코디네이터) | 소~중 | 1 |
| **doc-audit** | 문서 전수 정합 | 전 웨이브 뒤 새 창. 종결 식별자 이동, `PORTS.md` 등록(급행 정차역·추세 톤·인자 순서 게이트는 dodo 이식 후보), CLI 0.10.0·iOS 1.15 판정 위치 기록 | — | 2 |

## 2. 파일 소유권 (겹침 지도)

| 세션 | 소유 파일(주요) |
|---|---|
| transit-data | `src/lib/providers/odsay.ts`·`odsay-select.ts`·`odsay-envelope.ts`·`subway-service-hours.ts`·`bus-service-hours.ts`, `src/lib/express-stops.ts`(신규), `src/app/api/route/transit/route.ts`, `src/lib/types.ts`(**`TransitLeg` 절만**), Kit `RouteModels.swift`(**대중교통 모델 디코딩만**), `scripts/verify-odsay-*.mjs`, `docs/research/RESEARCH-2026-09-02-odsay-subway-shortest.md`, `docs/INTEGRATIONS.md` §대중교통, spec `2026-09-02-express-stops-data-design.md` |
| transit-guide | `src/lib/transit-guide.ts`·`transit-guide-text.ts`·`transit-text-args.ts`·`transit-display.ts`, Kit `TransitGuide.swift`·`TransitGuideText.swift`·`TransitDisplay.swift`·`BeaconTones.swift`(**대중교통 톤 추가만**), 공유 fixture `transit-guide-*.json`, iOS `Directions/TransitGuideModel.swift`·`TransitGuideDiag.swift`·`TransitTrackingSheet.swift`·`TransitGuideTextRenderer.swift`·`BeaconTonePlayer.swift`(**톤 재생 진입만**), `messages/*.json` `transitGuide.*`·`ios.transitGuide.*`, spec `2026-09-02-transit-trend-tone-and-express-gate-design.md` |
| en-ios | `src/lib/providers/seoul-metro-facilities.ts`, `src/app/api/station/metro-facilities/route.ts`, `src/lib/surroundings-scene.ts`·`clinics.ts`·`romanize.ts`(**확장만**), `src/lib/types.ts`(**`SeoulMetroFacilityParts`·`SceneItem`·`NightClinic` 절만**), `src/components/DirectionsView.tsx`·`NightClinicsNearby.tsx`·`SurroundingsScene.tsx`·`SeoulMetroFacilities.tsx`, iOS `StationSections.swift`·`ClinicNearbyView.swift`·`Nearby/Surroundings*.swift`·`Directions/DirectionsEndpointSearchView.swift`·`DirectionsTabView.swift`·`Directions.swift`·`ManualLocation*.swift`·`LocationBarView.swift`, Kit `BilingualName.swift`(**확장만**)·`StationModels`류, `messages/*.json` `clinic.*`·`surroundings.*`·`directions.*`·`manualLocation.*` |
| ios-quality | Kit `RouteService.swift`·`WalkAction.swift`·`RouteGuide.swift`(**`GuideActionSource` 절만**)·`GuideLiveRows.swift`(참조만), iOS `BeaconModel.swift`(**`actionSource` 참조만**), `ios/i18n/arg-order.json`(신규)·`ios/i18n/ios-extra/*.json`(**0건 문구 3키만**), `ios/scripts/messages-to-xcstrings.mjs`, 게이트 테스트 신규 |
| small-batch | `packages/cli/**`·`packages/mcp/**`(카탈로그 미러), `src/app/api/route/car/route.ts`·`src/app/api/chat/route.ts`·`src/lib/lang-param.ts`, `src/__ab__/**`, `src/lib/chat/system-instruction.ts`, `docs/evals/` |

**겹침과 처리**:
- transit-data ∩ transit-guide = `types.ts` 절 분리 + **③④는 transit-data 통합 뒤**(위 표). transit-data는 `transit-guide.ts`·`TransitGuide.swift`를 만지지 않는다(판정 계층 소유는 transit-guide).
- en-ios ∩ transit-guide = `TransitTrackingSheet.swift`(en-ios ⑤ enum 호출부 한 줄) → en-ios ⑤를 **세션 마지막 + rebase 직후**로, 자진 신고.
- en-ios ∩ ios-quality = `DirectionsTabView` 없음(ios-quality는 만지지 않는다). `BeaconModel` — en-ios 없음.
- `src/lib/types.ts`는 셋(transit-data·en-ios)이 **절 단위**로 나눠 갖는다 — rebase 시 텍스트 충돌은 절이 달라 자동 병합된다.
- small-batch ∩ 나머지 = 없음(`packages/`는 small-batch 단독).

**공유 생성물·공용 파일 규약**: `messages/*.json`은 자기 네임스페이스만(6로케일 동시) / `Localizable.xcstrings` 2벌은 손 머지 금지, rebase 뒤 `node ios/scripts/messages-to-xcstrings.mjs` + `node ios/scripts/check-xcstrings-keys.mjs` / `project.pbxproj` 새 파일은 ID 재사용 금지(`xcodebuild -list` 검증) / `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`CLAUDE.md`는 **자기 항목·자기 줄만**, rebase 뒤 `comm -23 <(git show origin/main:CHANGELOG.md | sort) <(sort CHANGELOG.md)` **와 역방향 `comm -13`** 둘 다로 소실·되살림 전수 대조 / `PORTS.md`는 코디네이터(doc-audit)가 등록 / 릴리스 노트(`docs/appstore/release-notes.md`)는 이번 묶음에서 쓰지 않는다(1.15 판정 뒤).

## 3. git 격리 절차 (각 세션 공통)

```bash
git worktree add ~/gildongmu-wt/<name> -b feat/<name> main
cp ~/Mac-Projects/gildongmu/.env.local ~/gildongmu-wt/<name>/   # gitignore라 안 따라온다
cd ~/gildongmu-wt/<name> && npm install                           # 심링크 금지
# 작업: 자기 브랜치에만, pathspec 커밋(git add -A 금지)
# 리뷰(서브에이전트 spec-compliance + code-quality, iOS a11y 변경은 a11y 감사) 통과 뒤:
git fetch && git rebase origin/main → 생성물 재생성 → npm run test:run && npx tsc --noEmit && npm run lint
#   (packages/ 변경 시 (cd packages/cli && npx vitest run) (cd packages/mcp && npx vitest run) 도 — 루트 include 밖)
#   (iOS 변경 시 xcodebuild 시뮬 빌드 + Kit 테스트)
git push origin feat/<name>:main     # ff만, --force 금지, 거부면 rebase 재시도
git worktree remove ~/gildongmu-wt/<name>
```

- 리뷰가 도는 동안 rebase하지 않는다. 리뷰 보고 머리에 HEAD SHA.
- **실기기 배포는 한 번에 한 세션**: 코디네이터(`gildongmu` 메인 세션)에 "배포 시작" 보고 → "해제" 뒤 배포. 배포 직전 `xcrun devicectl list devices`로 연결 재확인(실패면 빌드 안 돌림). transit-guide는 `CONFIGURATION=Experimental`만, en-ios·ios-quality는 `CONFIGURATION=Experimental`·`CONFIGURATION=Release` 둘 다([[ios-device-deploy-both-configurations]]).
- 통합·배포 시작·완료마다 코디네이터에 SendMessage로 보고하되, **보고는 파일로도 남긴다**: `/private/tmp/claude-502/-Users-hunyongkim-Mac-Projects-gildongmu/d179d2ba-b890-466c-83b1-c05f0ff73a51/scratchpad/report-<name>.md`(통합 SHA·소유권 밖 파일 자진 신고·남은 판정 위치·배포 상태). SendMessage는 통보 채널이지 질의 채널이 아니다 — 코디네이터 답을 기다리는 구조를 만들지 말 것(배포 락만 예외).
- 세션 안에서 위원장 판정이 새로 필요하면 그 세션이 `AskUserQuestion`으로 직접 묻는다(코디네이터 경유 금지).

## 4. 웨이브

- **웨이브 1(동시 5)**: transit-data · transit-guide(①② 즉시, ③④는 transit-data 통합 뒤) · en-ios · ios-quality · small-batch
- **웨이브 2**: doc-audit(+ 위원장 승인 시 cli-v0.10.0 발행, iOS 1.15 제출 판정)

최종 순서는 사용자 결정으로 남긴다(기본값은 위).

## 5. 세션별 착수 프롬프트

착수 프롬프트 원문은 코디네이터 세션이 `launch-session.sh`로 넘긴다(프롬프트 파일은 scratchpad, 본 문서에 복제하지 않음). 머리말 고정: `[병렬 세션 배정: 이 세션의 역할 이름은 **<이름>** 다. 첫 응답 첫 줄에 "세션 <이름>" 라고 밝혀라.]`, 본문은 §1 자기 행 + §2 자기 행 + §3.
