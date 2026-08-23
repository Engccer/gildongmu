# 2026-08-23 백로그 전수 소화 계획 — 병렬 세션 작업 분할

> 출처: `docs/BACKLOG.md` 전수 판독(2026-08-23 오후, HEAD `8da33a4`). 위원장 지시 "백로그 확인하고 모두 처리". 이 문서는 병렬 터미널 세션들의 **착수 브리프**이고 각 마일스톤의 설계 정본은 그 세션이 쓰는 spec이다. 절차 정본은 `parallel-sessions` 스킬, 직전 선례는 `2026-08-23-feedback-260822-parallel-plan.md`.

## 0. 전제 (코디네이터 판독 결과, 관측 시점 `8da33a4`)

- **1.11은 READY_FOR_SALE**(ASC `--check` 2026-08-23). 1.12(빌드 19 업로드됨) 뒤에 iOS 커밋 2건(`606d5c7`·`eb16b35` 계단 회피 라벨·원좌표)이 더 있다. **위원장 판정: 1.12 제출 보류.** 이 묶음은 코드 작업만 한다. 제출 시 빌드 20 재아카이브가 필요하다는 사실만 `docs/BACKLOG.md` G5에 남긴다.
- **백로그 §2(판정 대기)·§8(위원장 액션)은 코드로 닫을 수 없다.** 응답소 20260820900034는 2026-08-20 동부도로사업소 담당자 접수, 답변 미도착. ITS 승인 메일 없음(2026-08-23 Gmail 확인). E22는 리뷰순 판정, E18은 보류, M2·D11·E6·E1·E3은 조건 미성립 — 전부 현행 유지.
- **CLI는 0.8.0 이후 미발행 변경이 있다**(`via`·`nearby overview`). A19가 CLI 포매터를 또 바꾸므로 **발행은 A19 통합 뒤 한 번**(cli-v0.9.0)이고 그때 D26(`--provenance`)을 켜 본다. 발행은 외부 배포라 **코디네이터가 위원장에게 묻고** 한다 — 세션이 태그를 push하지 않는다.
- `scripts/verify-korea-subway-timetable.mjs`는 dodo 경로라 gildongmu에 없다(doc-audit 신호). A19 세션이 gildongmu판을 만들고 BACKLOG 참조를 고친다.
- 웹 `DirectionsView.tsx`는 `alternatives` 응답 필드를 렌더하지만 **요청에 `alternatives=1`을 붙이지 않는다**(B9 실측 그대로).

## 1. 마일스톤과 확정 판정

| ID | 이름 | 백로그 | 판정·설계 결정(코디네이터) | 규모 | 웨이브 |
|---|---|---|---|---|---|
| **A19** | TAGO 시간표 (역·노선) 0행을 3-state로 | §1 A19 | 0행 노선을 `lines[]`에 남기되 방향 없는 `unknown` 상태로. 소비자 4곳(웹 `StationTimetable`·CLI `formatters`·채팅 `get_station_timetable`·iOS `StationSections`) 전부 "시간표 정보 없음"을 운행 종료·0건과 다르게 낭독. `subway-nearby` 심야 4-state도 `unknown`으로 가른다. `subway-service-hours`는 손대지 않는다(이미 3-state). 실호출 관측 게이트 `scripts/verify-korea-subway-timetable.mjs` 신설(홍대입구 2호선·강남 신분당·서울역 공항 0행이 `unknown`으로 나오는지). ⚠ **웹 배포가 앱보다 먼저**: iOS 디코딩은 새 필드를 옵셔널로 받는다 | 중 | 1 |
| **B9** | 웹 길찾기 도보 대안 2행 disclosure + N4 잔여 딥링크 | §4 B9 ①·§5 N4 | `alternatives=1` 요청 + 추천·최단 2행 disclosure(iOS `DirectionsTabView` 도보 섹션 동형, `stepFreeNotice` 병기). `useRouteGuide` variant 전환은 **범위 밖**(B9 ②, 실보행 미검증). 같은 세션에서 `nmap://` 경유지 인자(`v1lat/v1lng`)를 얹는다(`kakaomap://`은 인자 없음 — 변경 없음). spec `2026-08-12-walk-route-alternatives-design.md` §4·§7이 정본 | 소~중 | 1 |
| **E15-2** | 대중교통 안내 "주변 확인" 능력 | §5 E15 다음 능력 ① | 앵커 주입만 — 하차역 좌표, 승차 중이고 조망 `here`가 `station`이면 현재역. `SurroundingsSceneSection`은 앵커를 받으므로 배선이다. 백로그 판정대로 **조망 프로토콜을 넓히지 않고** 자기 능력을 따로 둔다(프로토콜이 필요 없으면 버튼 배선만, 그 판정을 spec 한 줄로). 설계 리뷰 생략 사유: 검증된 컴포넌트 재배선·국소·가역. 실험판 봉인 안이라 산출물 검증은 실험판 | 소 | 1 |
| **E8** | 전국횡단보도표준데이터 — 차로 수·횡단 길이 낭독 | §5 E8(착수 확정) | 도보 안내의 횡단보도 스텝 문장에 "N차로, Mm"를 덧붙인다(서버 `getWalkRoute` 주석 단계 — 재작성 → 주석 파이프라인, 음향신호기 병합과 같은 자리). **있는 곳만 말하고 없는 곳은 침묵**(위원장 확정, 3-state 적용 대상 아님). `greenSgngnrTime` 제외. 데이터 전달은 세션이 정한다: 이용허락 조건에 국외 반출 제한이 없으면 정적 seed(58,831건, `NOTICE.md` 등재), 있으면 런타임 API + `revalidate`. 봉투는 `{header, body}` 최상위(공용 `readItems` 밖), 빈 값은 공백 한 칸(`trim()`). 매칭은 스텝 좌표 최근접 + 반경(실측으로 정하고 spec에 근거). **실호출 게이트 필수**. ⚠ `walkStepAction`의 "횡단보도" 마커 판정을 깨지 않는다 | 중 | 1 |
| **E16** | 간략 안내 제거 축 3 → 축 2 | §5 E16 | 축 3(비-ko에 상세): Tmap `turnType` 구조화 행동 + juso `engAddr` 로마자 지명으로 provider 계약을 언어에서 푼다 — **설계 리뷰 필수**(새 판정 계층·외부 계약). 축 3이 실호출로 성립한 뒤에만 축 2(웹 단독 진입점 제거 — `DistanceBeacon`·`briefFallback`·전환 버튼, i18n 잔재, `speedSuggest` 웹 발화만). 순서 `3 → 2` 엄수. 강등 사유 3-state(재시도로 풀리는가)를 축 2에 포함 | 큼 | 2 |
| **E14 / A16-L1** | 급행 정차역 데이터원 판정 | §1 A16 L1·§5 E14 | 실호출 probe: ODsay 급행 경로 필드·data.go.kr 도시철도 시간표·KRIC·`realtimePosition` 9호선 커버리지. 결과를 `docs/research/`에 적고, 소스가 있으면 spec(설계 리뷰 대상) → 구현, 없으면 A16 L1·E14를 "데이터원 부재"로 닫는다(BLOCKED 근거 기록) | 중(조사) | 2 |
| **E19** | 커버리지 사각형 → 국경 폴리곤 승격 | §5 E19 | 판정 축 확정: `isInKorea`의 뜻은 **"한국 안인가"**(upstream 범위가 아님 — upstream 범위는 `unavailableHere`·0건 축이 따로 든다). 그러므로 폴리곤 승격이 맞다. walk seed `boundary`를 `coverage.ts`로 옮겨 웹 ↔ Kit `Coverage.swift` 미러, 채팅 `coverageGate`·CLI `isOutOfCoverage` 동조. 라우트별 "근처에 없다"/"제공 안 됨" 문장 갈림은 표로 기록만(수정은 범위 밖) | 중 | 2 |
| **doc-audit** | 문서 전수 정합 | — | 전 웨이브 뒤 새 창. G5 "빌드 20 필요" 한 줄, 종결 식별자 이동, PORTS.md 등록 | — | 3 |

**처리하지 않는 것(근거)**: §2 전부·§8 전부(위원장) / G5 제출(보류 판정) / E22(리뷰순 판정 선행) / E18(보류) / M2(도보 판정 선행) / E6·E1·E2·E3(조건 미성립) / D11(의도적 동결) / D26(발행 시 코디네이터) / E20(응답소 답변 대기) / A1(동결).

## 2. 파일 소유권 (겹침 지도)

| 마일스톤 | 소유 파일(주요) |
|---|---|
| A19 | `src/lib/providers/tago-subway.ts`·`subway-nearby.ts`, `src/app/api/station/timetable/route.ts`, `src/components/StationTimetable.tsx`, `src/lib/chat/router.ts`(**`get_station_timetable` 분기만**)·`declarations.ts`(그 항목만), `packages/cli/src/lib/formatters.ts`(**시간표 포매터만**), `ios/Gildongmu/StationSections.swift`, Kit `StationModels.swift`·`StationService.swift`, `scripts/verify-korea-subway-timetable.mjs`(신규), `messages/*.json` `station.*`, 관련 테스트 |
| B9 | `src/components/DirectionsView.tsx`, `src/lib/deeplink.ts`, `messages/*.json` `directions.*`, 관련 테스트 |
| E15-2 | `ios/Gildongmu/Directions/TransitTrackingSheet.swift`·`TransitGuideModel.swift`, `Nearby/SurroundingsSceneSection.swift`(**시그니처 불변, 호출만**), `messages/*.json` `ios.transitGuide.*`(또는 기존 네임스페이스) |
| E8 | `src/lib/providers/crosswalk-*.ts`(신규), `src/lib/walk-route.ts`(**주석 단계 1함수 추가**), `scripts/build-crosswalk-seed.*`(선택), `src/lib/data/`(seed, 선택), `NOTICE.md`, `docs/INTEGRATIONS.md` §도보 경로, 관련 테스트·fixture |
| E16 (웨이브 2) | `src/lib/walk-route.ts`·`walk-guidance.ts`·`walk-action.ts`·`providers/tmap-pedestrian.ts`, `DirectionsView.tsx`·`DistanceBeacon.tsx`·`useRouteGuide.ts`, iOS `DirectionsTabView.swift`(로케일 게이트), Kit `WalkAction.swift`, i18n `guide.*` |
| E14 (웨이브 2) | `docs/research/`, 신규 provider(있을 때), `TransitGuideModel.swift`(L1 자리) |
| E19 (웨이브 2) | `src/lib/coverage.ts`, Kit `Coverage.swift`, `packages/*/isOutOfCoverage`, 채팅 `coverageGate`, 테스트 |

**겹침**: E8∩E16 = `walk-route.ts` / B9∩E16 = `DirectionsView.tsx` → **E16은 웨이브 2**. A19∩나머지 = 없음. E15-2∩나머지 = 없음. 웨이브 1 넷은 서로 독립.

**공유 생성물·공용 파일 규약**: `messages/*.json`은 자기 네임스페이스만(6로케일 동시) / `Localizable.xcstrings` 2벌은 손 머지 금지, rebase 뒤 `node ios/scripts/messages-to-xcstrings.mjs` + `node ios/scripts/check-xcstrings-keys.mjs` / `project.pbxproj` 새 파일은 ID 재사용 금지(`xcodebuild -list` 검증) / `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`CLAUDE.md`는 **자기 항목·자기 줄만**, rebase 뒤 `comm -23 <(git show origin/main:CHANGELOG.md | sort) <(sort CHANGELOG.md)`로 소실 줄 전수 대조 / `PORTS.md`는 코디네이터(doc-audit)가 등록.

## 3. git 격리 절차 (각 세션 공통)

```bash
git worktree add ~/gildongmu-wt/<name> -b feat/<name> main
cp ~/Mac-Projects/gildongmu/.env.local ~/gildongmu-wt/<name>/   # gitignore라 안 따라온다
cd ~/gildongmu-wt/<name> && npm install                           # 심링크 금지
# 작업: 자기 브랜치에만, pathspec 커밋(git add -A 금지)
# 리뷰(서브에이전트 spec-compliance + code-quality) 통과 뒤:
git fetch && git rebase origin/main → 생성물 재생성 → npm run test:run && npx tsc --noEmit && npm run lint
git push origin feat/<name>:main     # ff만, --force 금지, 거부면 rebase 재시도
git worktree remove ~/gildongmu-wt/<name>
```

- 리뷰가 도는 동안 rebase하지 않는다. 리뷰 보고 머리에 HEAD SHA.
- 실기기 배포(iOS 세션)는 **코디네이터에 "배포 시작" 보고 → 해제 뒤** `CONFIGURATION=Experimental ./ios/deploy-device.sh`와 정식 `./ios/deploy-device.sh` 둘 다.
- 통합·배포 시작·완료마다 코디네이터(`gildongmu` 메인 세션)에 SendMessage로 보고: SHA·소유권 밖 파일 자진 신고·남은 판정 위치.

## 4. 웨이브

- **웨이브 1(동시 4)**: A19 · B9 · E15-2 · E8
- **웨이브 2(웨이브 1 전부 ff 통합 뒤, 동시 3)**: E16 · E14 · E19
- **웨이브 3**: doc-audit(+ 위원장 승인 시 cli-v0.9.0 발행·D26)

최종 순서는 사용자 결정으로 남긴다(기본값은 위).

## 5. 세션별 착수 프롬프트

착수 프롬프트 원문은 코디네이터 세션이 `launch-session.sh`로 넘긴다(프롬프트 파일은 scratchpad, 본 문서에 복제하지 않음). 머리말 고정: `[병렬 세션 배정: 이 세션의 역할 이름은 **<이름>** 다. 첫 응답 첫 줄에 "세션 <이름>" 라고 밝혀라.]`, 본문은 §1 자기 행 + §2 자기 행 + §3.
