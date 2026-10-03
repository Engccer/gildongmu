# 백로그 9차 소화: 병렬 세션 계획 (2026-10-03)

코디네이터 `gildongmu-b7 [8eaa71]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이고, 낭독·표시 문장의 정본은 `docs/superpowers/specs/2026-10-03-guidance-wording-confirmed.md`(이하 "문안 확정본")다.

설계 리뷰 판정: 계획 문서라 적대적 설계 리뷰 대상이 아니다(새 불변식은 각 세션 spec이 판정한다).

## 0. 전제 (관측 시점: `6536b367`, 2026-10-03)

- **push 동결 없음.** 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel, 스킵 규칙 없음).
- **스토어에 iOS 2.0(`ef5f2330`, 빌드 30)이 있고 그 앞 판 1.19(`5c3bf9bf`)도 사용자 기기에 남아 있다.** 두 빌드와 안드로이드 설치본은 프로덕션 서버의 응답을 그대로 받는다. 이번 회차는 **서버가 만드는 도보·자동차 낭독 문장을 바꾸므로** 이 전제가 가장 무겁다(§1 코디네이터 판정 2).
- **디스크 여유 약 8.5GB**, 스왑 0, 부팅된 시뮬레이터 0. 정리할 재생성 캐시가 남아 있지 않아(DerivedData 0.75GB, DeviceSupport는 현재 기기 판 하나) 여유를 늘릴 수 없다. 웨이브당 빌드 세션은 2개까지. 세션은 DerivedData·산출물을 자기 폴더에만 쓰고, 여유가 3GB 밑으로 내려가면 빌드를 멈추고 보고한다. 시뮬레이터를 부팅하지 않는다.
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). 웨이브 1 base는 이 문서를 담은 커밋이고 각 세션 보고 디렉터리의 `base.sha`가 그 값을 든다.
- 안내 판정 계층은 웹(`src/lib/route-guide.ts` 등) · Kit(`ios/GildongmuKit`) · 안드로이드 `:kit` 세 벌 미러이고 공유 fixture(`src/lib/__tests__/fixtures/route-guide-scenarios.json` 등)를 세 벌이 함께 읽는다. **fixture나 리듀서를 고치는 세션은 세 벌을 같은 커밋에서 고친다**(한 벌만 고치면 다른 두 게이트가 빨개진다).

## 1. 마일스톤·판정·모델 배정

| 세션 | 웨이브 | 항목 | 모델·노력 | 한 줄 |
|---|---|---|---|---|
| `e61-car` | 1 | E61 · 문안 바·사 · 문안 라의 자동차 시작 문장 · E51 ④(자동차 두절 15분) | opus·high | 자동차 짧은 안내에 지점과 방면, 자동차 세션 안전망 두절 축을 15분으로 |
| `e62-crossing` | 1 | E62 · 문안 가·나 · 문안 라의 도보 시작 문장 · "회전은 끊어 말한다" · "되읽기는 회전 문장을 뗀다" · "행동 없는 다음 구간은 예고하지 않는다" | opus·high | 횡단보도 안내 재설계와 도보 예고 문장 틀(서버·웹·iOS·`:kit`) |
| `e63-research` | 1 | E63 조사·설계 | opus·high | 과거 로그 재생으로 문턱과 구멍 ①②를 재고 spec을 확정(repo 코드 수정 0) |
| `e63-offroute` | 2 | E63 구현 · 문안 다·마 · 문안 라의 재조회 문장 셋 · A55 | opus·high | 이탈 방향 안내와 "먼저 돌아가게, 계속 벗어나면 자동"(도보·자동차, 웹·iOS·`:kit`). `e62-crossing` 통합과 `e63-research` spec 뒤 |
| `small-11` | 1.5 | E58 후속 ②③④ · A53 후속 후보 셋 · 카카오 캐시 300초 | opus·medium | 소형 묶음(iOS·웹·서버). `e61-car` 통합 뒤 바로 착수(§6 둘째 정정) |
| `android-3` | 3 | E62·E63의 안드로이드 앱 층 이식 · E43 이식 후보 ③ | opus·high | iOS 통합본을 보고 `WalkGuideModel`·`GuideText`·안내 시트로 옮긴다. `e63-offroute` 통합 뒤 |
| `doc-audit` | 끝 | 문서 만료 점검 | opus·medium | 전 웨이브 통합 뒤 새 창 |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사는 `model: opus`, 적대적 설계 리뷰와 데이터 무결성 최종 검토만 `model: fable`(동시 하나, `name` 부여).

### 위원장 판정 (2026-10-03, 코디네이터 세션)

1. **자동차 안내의 GPS 끊김 자동 종료는 15분으로 한다**(E51 후속 ④). 도보는 5분 그대로다. 긴 터널·지하도로는 정상 주행으로도 5분을 넘고, 정체면 더 짧은 터널에서도 넘어 터널 안에서 안내가 끝났다.
2. **카카오 응답 캐시는 두되 보관 시간만 줄인다**(BACKLOG §9 "카카오 응답 캐시 약관 질의" 행, E58 후속 ⑥). 주소·도보 경로의 3600초를 장소 검색과 같은 300초로 내린다.

3. **둘로 나눌 수 없는 "횡단보도 2개" 병합 안내는 한 문장으로 하고 길이 라벨은 "전체 길이"다**(`e62-crossing` 판정 요청 `judgment-202610031814.md`, 실측 15곳 중 8곳이 중앙분리대 일직선형이라 분해 불가). "…횡단보도 2개를 연속으로 건너세요. 전체 길이 12m". 나뉘는 횡단과 단일 횡단은 문안 확정본대로 "횡단보도 길이".

4. **E63 추가 판정 4건**(`e63-research` 판정 요청, 문장은 BACKLOG E63 "위원장 추가 판정 4건"): 새 경로가 걷던 방향 그대로면 "진행 방향 그대로" · 경로가 등 뒤면 "뒤로 도세요" · 방향 불확실이면 벗어난 쪽만 · **나란한 길을 계속 걸으면 50m쯤 뒤 자동 재조회**(조사 세션 기본안과 반대).
5. **공개 히스토리 정리는 웨이브가 전부 끝난 뒤 한다**(BACKLOG A56, 대상은 저장소 밖. 강제 push라 실행 직전 위원장에게 다시 확인받는다). 그 전까지 force push 금지.

E61·E62·E63의 판정과 문안은 2026-10-03 접수 세션에서 끝났다(BACKLOG 각 본문, 문안 확정본).

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **`CLAUDE.md`는 코디네이터만 고친다**(7차 판정 유지, 현재 77KB/80KB). 세션은 새 함정의 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 규칙 한두 줄과 낡게 된 기존 문장은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 이번 회차는 `CLAUDE.md`의 안내 규칙 여러 줄이 낡는다(E10ⓑ 자동 채택, 결정 지점 두 층, 이탈 판정, 도보 경로 문장, 캐시 수명): 낡게 된 문장을 빠짐없이 적는다.
2. **서버 문장 변경의 하위 호환은 세션 spec이 스토어 빌드의 코드로 판정한다.** `git show ef5f2330:<파일>`·`git show 5c3bf9bf:<파일>`로 2.0·1.19가 새 응답을 받았을 때 ⓐ 문장 부분 문자열에 건 판정이 깨지는가 ⓑ 낭독이 종전보다 나빠지는가(문안 확정본이 지적한 "되읽기가 회전 문장을 다시 말한다"가 2.0에서 그대로 일어난다)를 본다. 둘 중 하나라도 해당하면 새 문장은 **옵트인 판본**(쿼리 파라미터, `lines=2`·`coords=1` 선례)으로 내고 미지정 응답은 종전 그대로 둔다. 새 구조화 필드는 additive로 싣는다(A26 패턴). 웹 배포가 앱보다 먼저다.
3. **E62 판정 2의 "길 이름은 실험판 실보행이 게이트"는 코드로 지킨다.** 강한 디폴트: 건너는 길 이름은 옵트인으로만 문장에 들어가고 iOS 실험판 구성만 그것을 켠다(웹·정식판·안드로이드는 시계 방향만). 졸업은 §2 실보행 판정 뒤. 구현 방식은 `e62-crossing` spec이 정한다.
4. **실기기 배포는 코디네이터가 웨이브 경계에서 메인 체크아웃으로 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드까지다.
5. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** 세션은 What's New에 적을 문장만 보고에 남긴다.
6. **안드로이드는 두 층으로 가른다.** `:kit` 미러와 공유 fixture는 리듀서를 고친 세션이 같은 커밋에서 맞추고(게이트가 강제한다), 안드로이드 앱 층(`android/app/.../guide/**`)은 그 세션이 **컴파일과 기존 테스트가 유지되는 최소 수정**까지만 한다. 새 동작의 앱 층 이식은 웨이브 3 `android-3`이 iOS 통합본을 보고 한 번에 옮긴다. 문자열은 `messages`·`ios-extra`가 원천이라 재생성으로 함께 바뀐다. 안드로이드에는 자동차 안내가 없어 E61의 앱 층 몫은 없다.
7. **E63은 조사와 구현을 가른다**(8차 `outing-research` → `outing-nodes` 선례). 문턱과 구멍 ①②는 로그 재생 수치가 설계를 정하고, 구현은 `e62-crossing`이 고친 리듀서 위에 얹혀야 해서 같은 웨이브에 둘 수 없다. `e63-research`는 spec과 재생 수치만 남긴다.
8. **범위에서 뺀 것**: E47(ODsay 실호출은 비용) · N4 자동차 경유지(실주행 판정 선행) · E51 후속 ⑤(실보행 판정 행) · E48 후보 ②③(실승차 뒤) · B13(실보행 뒤) · E58 후속 ①(서울 밖 교차점 타일 분할, 나들이 실보행 판정 뒤) · E45 웹 브리핑(8차 보류 유지) · 웹 전용 대기 묶음(E33 웹·B6·B8·W1-R·B9 안내 중 전환) · E14 ③·E15 ③(설계 선행) · D11(E63이 이탈 리듀서를 다시 열지만 A6 상수 확정이 조건이라 그대로 둔다. `e63-offroute`가 그 자리를 지나며 값싸게 풀리면 함께 닫고 보고한다) · PORTS open 행 넷(전부 조건부: 어휘·모델·Live API를 바꿀 때. 이번 회차는 그 조건에 닿지 않는다).

## 2. 파일 소유권 지도

술어는 "이름이 나오는가"가 아니라 "그 세션이 그 파일을 고쳐야 하는가"다. 아래는 코디네이터가 함수 자리를 열어 확인한 목록이고(관측 `6536b367`), 세션이 틀린 자리를 발견하면 보고한다(코디네이터가 재현해 정정 절을 단다). 안내 코드는 큰 파일 몇 개에 모여 있어(`BeaconModel.swift` 214KB, `route-guide.ts` 80KB, `RouteGuide.swift` 72KB) **소유 단위가 파일이 아니라 함수·영역**이다.

### 웨이브 1

| 세션 | 소유 |
|---|---|
| `e61-car` | 서버 `src/lib/car-guidance.ts`·`car-route.ts`·`car-action.ts`와 자동차 provider의 스텝 투영(`at`·`toward` additive) · 웹 `src/lib/car-route-guide.ts`와 `guide-live-rows.ts`·`DistanceBeacon.tsx`·`useRouteGuide.ts`의 **자동차 문장 조립 자리** · Kit `CarRouteGuide.swift`·`CarAction.swift`·`Models/RouteModels.swift`의 자동차 스텝 필드 · 앱 `GuideText.swift`의 `carStart`·`carImminentText`·`carCommand`·`periodicCar`(`driverNotice`는 현행 유지) · `BeaconModel.swift`에서 그 넷을 부르는 자리 · `messages/*.json`의 `guide.carImminent`·`guide.carPeriodic`·`guide.carStart`·`guide.carCommand`·`guide.carLiveAction` · 세션 안전망: Kit `SessionIdle.swift`·`GuideTuning`의 두절 축 필드·웹 `session-idle.ts`·`:kit` `SessionIdle.kt`와 각 테스트 · `:kit` `CarRouteGuide.kt`·`CarAction.kt` 미러 · CLI/MCP 포매터가 자동차 스텝을 찍으면 그 줄 |
| `e62-crossing` | 서버 `src/lib/walk-guidance.ts`·`walk-action.ts`·`walk-route.ts`(`annotateCrosswalkInfo`·`attachStepActions`·횡단 방향 필드·"N개" 분해)·`walk-junction.ts`·`walk-collapse.ts`와 fixture · 시계 방향 순수 함수(신설, 아래 경계 인터페이스) · 리듀서 `route-guide.ts` ↔ `RouteGuide.swift` ↔ `:kit` `RouteGuide.kt`의 **선행 낭독·주기 통지·되읽기·`quietAfterAnnounce`·횡단 스텝 영역**과 공유 fixture `route-guide-scenarios.json` · `guide-live-rows.ts` ↔ `GuideLiveRows.swift` ↔ `:kit` `GuideLiveRows.kt`의 도보 남은 거리 행(횡단 중 "횡단보도 끝까지") · Kit `WalkAction.swift`·`RouteModels.swift`의 도보 스텝 필드 · 앱 `GuideText.swift`의 `unit`·`start`·`announceAhead`·`farNotice`·`periodic`·`periodicWalk`·`imminentText`·`liveActionPhrase`·`liveTop`·`liveNext` · `BeaconModel.swift`의 `case .announceSteps`·`.bundleReread`·`.imminent`·`.periodic` 소비 자리(2026-10-03 기준 2493~2600행 부근) · `BeaconTrackingSheet.swift`의 남은 거리 행 · 웹 `DistanceBeacon.tsx`·`useRouteGuide.ts`의 도보 낭독·남은 거리 자리 · `messages/*.json`의 `guide.announceAhead`·`guide.detailStart`·`guide.imminent`·`guide.periodic*`와 횡단 관련 새 키 · 조회 화면 줄 목록·CLI·WebMCP가 서버 문장을 그대로 찍는 테스트 기대값 |
| `e63-research` | `docs/superpowers/specs/2026-10-03-offroute-return-design.md`(신설) · 재생 스크립트는 `~/gildongmu-wt/e63-research-reports/scripts/`(repo 밖) · repo 코드 수정 0 · `docs/superpowers/specs/logs/README.md` 색인에 재생 기록 한 줄이 필요하면 그 줄만 |

**웨이브 1 경계**
- 리듀서의 **이탈·복귀·재조회 영역**(`case .offRoute`·`.backOnRoute`, `guide-course-axis.ts` ↔ `GuideCourseAxis.swift`, `course-derivation.ts` ↔ `CourseDerivation.swift`, `RerouteProposalGate.swift`, `BeaconModel`의 `case .offRoute` 소비·`maybeFetchProposal`·`performReroute`, `GuideText.reroute`·`autoReroute`·`variantSwitch`, `guide.offRoute`·`guide.carOffRoute`·`guide.rerouteDone`·`guide.autoReroute`)은 웨이브 1에서 **아무도 고치지 않는다**. `e63-offroute`의 자리다. `e62-crossing`이 그 문장에 닿아야 풀리는 것("방향 구절이 겹치는 자리")은 고치지 말고 완료 보고의 인계 사항에 적는다.
- `BeaconModel.changeDestination`과 그 호출부(`PlaceDetailView`·`BeaconTrackingSheet`의 목적지 전환)는 웨이브 1에서 아무도 고치지 않는다(`small-11`의 A55 자리).
- `RouteModels.swift`의 스텝 구조체에는 두 세션이 각자 선택 필드를 더한다(자동차 `at`·`toward`, 도보 횡단 방향). 뒤에 통합하는 세션이 rebase에서 양쪽을 보존한다.
- `GuideTuning`(Kit `RouteGuide.swift` 머리)에는 `e61-car`가 두절 축 필드 하나를 더한다. `e62-crossing`이 튜닝 필드를 더해야 하면 자기 줄만 더한다.
- `messages/*.json`·`ios/i18n/ios-extra/*.json`은 자기 키만. 생성물(xcstrings·`ios/i18n/arg-order.json`·안드로이드 strings와 `android/i18n/arg-order.json`·`mirrors/*.json`)은 rebase 뒤 재생성하고 손으로 병합하지 않는다.
- `OutingModel.swift`·Kit `Outing*.swift`·`WalkInfraService.swift`·`src/lib/providers/kakao-*.ts`의 `revalidate`는 웨이브 1에서 아무도 고치지 않는다(`small-11`).
- 대중교통 안내(`TransitGuide*`·`transit-guide*`)는 이번 회차 누구의 소유도 아니다. 승차 전 도보는 `BeaconModel`을 그대로 쓰므로 도보 변경이 자동으로 닿는다: `e62-crossing`은 prewalk 경로가 깨지지 않는지 기존 테스트로 확인한다.

**통합 순서(웨이브 1)**: `e63-research`(문서만, 언제든) · `e61-car` · `e62-crossing`은 준비된 순서대로. 둘이 같은 큰 파일의 다른 영역을 고치므로 뒤에 통합하는 쪽은 rebase 뒤 게이트(웹·Kit·`:kit`)를 다시 돌린다.

### 웨이브 2 (`e62-crossing` 통합과 `e63-research` spec 확정 뒤)

| 세션 | 소유 |
|---|---|
| `e63-offroute` | 웨이브 1 경계 첫 줄의 이탈·복귀·재조회 영역 전부(웹·Kit·`:kit` 세 벌과 공유 fixture) · `GuideTuning`의 이탈·재조회 문턱(수단별 데이터) · `BeaconModel`의 이탈 소비·재조회 자리 · 웹 `useRouteGuide.ts`·`DistanceBeacon.tsx`의 이탈·재조회 자리 · `messages`·`ios-extra`의 이탈·재조회 키 · 로그 스키마(`GuideDiag`의 `perp` 부호 등) · spec `2026-10-03-offroute-return-design.md`의 구현 반영 |
| `small-11` | `BeaconModel.changeDestination`과 그 호출부·도보 시작 문장에 넘기는 라벨 인자(A55, `GuideText.start`의 본문과 `guide.detailStart` 문장은 `e62-crossing` 통합본 그대로 두고 인자만) · `ios/i18n/ios-extra/*.json`의 `ios.guide.destChanged*` · Kit `WalkInfraService.swift`의 `nearbyWithCoordinates`(E58 ②) · `OutingModel.swift`의 `places` 종료 시 비움(E58 ④) · `NOTICE.md`와 앱 "정보 출처" 문구의 서울 열린데이터 표기(E58 ③, 확인 뒤 어긋난 쪽만) · A53 후속 셋: Kit·`:kit` 테스트가 `transit-leg-english-cases.json`을 읽게 하기, 웹 en 최근 장소·최근 경로 버튼과 WebMCP `resolved.to`의 라틴 표기, 라틴 문자뿐인 한국어 이름의 `lang="ko"` 감싸기 · `src/lib/providers/kakao-address.ts`·`kakao-walk.ts`의 `revalidate` 3600 → 300과 관련 주석·`docs/INTEGRATIONS.md` 해당 절 |

**웨이브 2 경계**: `e63-offroute`와 `small-11`은 `BeaconModel.swift`의 서로 다른 함수를 고친다(이탈·재조회 대 `changeDestination`). 목적지 전환 뒤 재조회 문장이 겹치면 `small-11`은 라벨 인자만, 문장 순서는 `e63-offroute`.

### 웨이브 3

`android-3`: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/**`(`WalkGuideModel.kt`·`GuideText.kt`·`GuideStrings.kt`·`WalkGuideUiState.kt`·`ui/GuideSheet.kt`)와 그 테스트, `directions/` 접근성 레인 테스트(E43 이식 후보 ③). 착수 프롬프트는 웨이브 2 통합 보고를 읽고 새로 쓴다.

### 경계 인터페이스 (병렬 전에 고정)

- **시계 방향 체계**(E62·E63 공유): 상대 방위 = 기준 방향에서 시계 방향으로 잰 각(0° 이상 360° 미만). 시 = 상대 방위를 30°로 반올림한 값, 0은 12시. 12시(정면)와 6시(뒤)의 낱말은 문안 확정본을 따른다("진행 방향 그대로", "뒤로 도세요"). `e62-crossing`이 React·플랫폼 비의존 순수 함수 한 벌(웹 TS + Kit + `:kit`, 공유 fixture)로 만들고 완료 보고에 모듈·함수 이름을 적는다. `e63-research`는 spec에서 이 정의를 그대로 쓰고, `e63-offroute`는 그 함수를 부른다(다시 만들지 않는다). 기준 방향은 다르다: E62는 경로 좌표의 직전 진행 방향(서버 계산), E63은 사용자의 실제 진행 방위(클라이언트 계산).
- **"N시 방향" 문자열 키**: `e62-crossing`이 만들고 이름을 보고에 적는다. `e63-offroute`가 같은 키를 쓴다.
- **재조회 첫 문장의 방향**(문안 확정본 "방향 구절이 겹치는 자리"): 새 경로 첫 스텝이 횡단이면 방향은 사용자 진행 방위 기준 하나만 싣는다. `e62-crossing`은 횡단 스텝의 방향 조각과 나머지 문장을 **따로 꺼낼 수 있게** 싣고(additive 조각), `e63-offroute`가 재조회 문장에서 방향 조각을 뺀 쪽을 쓴다.
- **회전 문장과 이동 문장의 조각**(문안 확정본 "되읽기는 회전 문장을 뗀다"): `e62-crossing`이 서버 additive 조각으로 싣는다. 필드 이름은 spec이 정하고 보고에 적는다.

## 3. git 격리 절차 (main 직접 push)

```bash
# worktree·node_modules·.env.local은 코디네이터가 미리 만든다(npm install 금지)
cd ~/gildongmu-wt/<이름>            # 브랜치 feat/<이름>, origin/main base
# 작업: 자기 브랜치에만, pathspec 커밋(git add -A 금지)
# 통합(리뷰와 게이트를 통과한 뒤):
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}" && echo "${base}" > ~/gildongmu-wt/<이름>-reports/base.sha
comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 고친 공유 문서마다, 중괄호 필수
comm -13 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 되살림 대조
# 생성물 재생성 → 게이트(gate-lock.py) → push
git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

- `base`는 셸 변수라 같은 명령 안에서만 산다. 호출을 나누면 `base.sha` 파일에서 읽는다.
- `--force` 금지. push가 거부되면 fetch·rebase·대조·게이트부터 다시.
- 무거운 게이트(`test:run`·`tsc`·`build`·`swift test`·`xcodebuild`·gradle·playwright)는 `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- <명령>`으로 감싼다(머신 전체 한 번에 하나).
- xcodebuild는 `-derivedDataPath ~/gildongmu-wt/<이름>-dd`. 통합 뒤 그 폴더와 `ios/GildongmuKit/.build`·`android/*/build`를 지운다.
- 리뷰 전에 전부 커밋하고 리뷰어는 `git diff origin/main...HEAD`(3점)로 읽는다. 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 보고는 `~/gildongmu-wt/<이름>-reports/review-<주제>-<YYYYmmddHHMM>.md`.
- 실기기 배포·App Store 제출·npm 발행·`vercel` 수동 배포·env 변경·유료 API 대량 호출 금지. ODsay 실호출은 건당 과금이라 하지 않는다. 카카오·Tmap 실호출 게이트는 무료 한도 안에서 필요한 만큼만 돌리고 건수를 보고에 적는다(Tmap은 일 1,000건을 도보 폴백과 자동차가 나눈다).

## 4. 웨이브

1. **웨이브 1**: `e61-car` · `e62-crossing` · `e63-research` 동시. 빌드 세션은 앞의 둘.
2. **웨이브 2**: `e62-crossing` 통합 보고와 `e63-research` spec을 코디네이터가 읽은 뒤 `e63-offroute` · `small-11`. `e61-car`가 아직 돌면 그대로 둔다(영역이 다르다).
3. **웨이브 경계마다** 코디네이터가 메인 체크아웃에서 실기기 두 구성 설치, `CLAUDE.md` 반영 요청 모아 반영(`AGENTS.md` 재생성).
4. **웨이브 3**: `e63-offroute` 통합 뒤 `android-3`.
5. **끝**: `doc-audit` 새 창. 다음 iOS 릴리스는 §2 실보행·실주행 판정 뒤 별도 세션.

## 5. 착수 프롬프트와 보고 경로

착수 프롬프트 사본은 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 디렉터리는 `~/gildongmu-wt/<이름>-reports/`(단계별 새 파일 `start`·`integrating`·`done`·`blocked`·`judgment` + `-<YYYYmmddHHMM>.md`, 리뷰 보고 `review-*`, 기준 SHA `base.sha`). 보고는 파일과 `SendMessage` 둘 다, 코디네이터 주소는 `gildongmu-b7 [8eaa71]`. 위원장 판정이 새로 필요하면 세션이 `judgment-*.md`에 쉬운 한국어로 질문·선택지·각 선택지에서 위원장이 듣게 될 문장을 적어 통보하고, 코디네이터 세션이 위원장에게 묻는다.

## 6. 정정 (코디네이터가 재현해 확인한 것)

- **2026-10-03 18:05, 관측 `3092dff0`, 출처 `e61-car` 착수 보고(코디네이터 재현 확인)**: 안내 스텝 구조체는 `RouteModels.swift`가 아니라 **`route-geometry.ts` ↔ `RouteGeometry.swift` ↔ `:kit` `RouteGeometry.kt`의 `GuideStepSpan`·`GuideStepGeometry`**다(§2 웨이브 1 경계의 "스텝 구조체에 두 세션이 각자 선택 필드" 줄은 이 세 파일에도 그대로 적용한다. `e61-car`는 자동차 전용 선택 필드, `e62-crossing`은 도보 횡단·조각 필드, 뒤에 통합하는 쪽이 rebase에서 양쪽 보존). 세션 안전망 `sessionIdleStep`의 호출부는 `BeaconModel.swift`·`OutingModel.swift`·안드로이드 `WalkGuideModel.kt` 셋이다: 두절 값을 인자로 받게 바꾸면 `OutingModel.swift` 한 줄과 `WalkGuideModel.kt` 한 줄이 따라 바뀐다(둘 다 도보 값 300초를 명시할 뿐 동작 불변). `e61-car`가 그 두 줄을 고친다(웨이브 1에 `OutingModel.swift`를 만지는 다른 세션은 없다).
- **2026-10-03 20:10, 관측 `d7e00593`**: `e61-car`(`44b0661c`)와 `e63-research`(`d7e00593`)가 통합됐고 `e62-crossing`은 구현 중이다. `small-11`의 항목 중 `e62-crossing`과 겹치는 것은 A55 하나뿐이라(도보 시작 문장 `GuideText.start`·`guide.detailStart`를 `e62-crossing`이 고치는 중) **A55를 `e63-offroute`로 옮기고 `small-11`은 지금 띄운다.** `e62-crossing` 브랜치의 변경 파일 목록(관측 `97a19b0f` 뒤)에 `kakao-*.ts`·`OutingModel.swift`·`WalkInfraService.swift`·`NOTICE.md`·WebMCP 도구·`TransitRouteBriefing.tsx`가 없음을 확인했다. §2 웨이브 2 표의 `small-11` 줄에서 A55 자리(`BeaconModel.changeDestination`·`ios.guide.destChanged*`)는 `e63-offroute` 소유로 읽는다.
- **2026-10-03 21:20, 관측 `fdb0510c`: 웨이브 1·1.5 종료.** 통합 SHA: `e61-car` `44b0661c` · `e63-research` `d7e00593` · `small-11` `19468ebb` · `e62-crossing` `fdb0510c`. 창 넷 모두 닫고 worktree 제거. `CLAUDE.md` 반영 요청 11건(e61 3·small-11 3·e62 5)을 반영했다(79.3KB/80KB: `e63-offroute` 반영 때 코디네이터가 줄을 다시 줄이고, `doc-audit`가 다이어트한다). **실기기 배포는 보류**(위원장 지시 2026-10-03: iPhone이 컴퓨터와 분리돼 있다. 연결했다는 말이 오면 그 시점 통합본을 두 구성으로 설치). 위원장 판정 추가: 병합 횡단 "전체 길이" · 묶음 머리말은 "다음 안내." 뒤 · 출처 문구 "서울특별시 공공데이터(서울 열린데이터광장)" · **자택 노출(BACKLOG A56)은 공개를 유지하고 웨이브 뒤 전용 세션 `sanitize`로 현재 파일과 히스토리를 함께 정리**(§1 위원장 판정 5의 대상이 넓어졌다. 대상 목록은 `~/gildongmu-private/sanitize-2026-10-03.md`).
- **웨이브 순서 갱신**: 웨이브 2 `e63-offroute`(지금) → 웨이브 3 `android-3` → `doc-audit` → `sanitize`(전용, 다른 세션이 하나도 돌지 않을 때. 히스토리 재작성은 실행 직전 위원장 재확인).
- **2026-10-04 01:05, 관측 `origin/main` `fd162869`·브랜치 `feat/e63-offroute` `1a1b97bc`**: `e63-offroute`가 구현 커밋 넷(설계서 J4 개정·계획·구현·A55)을 남기고 **계정 사용 한도로 멈췄다**(2026-10-03 23:29, 구현 리뷰어 셋이 한도로 실패한 직후. 창 화면의 "You've hit your session limit"로 확인). 문맥이 74만 토큰이라 이어 쓰지 않고 창을 닫았고, 같은 worktree·브랜치에서 리뷰·반영·문서 분배·통합만 이어받는 `e63-finish`를 띄웠다(보고 디렉터리·게이트 락 이름은 `e63-offroute` 그대로). 한 세션에 설계 개정 + 세 벌 구현 + 이식 서브에이전트를 실으면 문맥이 이만큼 불어난다: 웨이브 3 `android-3`는 리듀서 미러가 이미 끝난 상태라 앱 층만 맡는다.
- **2026-10-04 01:50, 관측 `ad008230`: 웨이브 2 종료.** `e63-finish` 통합 `ad008230`(E63·A55·D11 종결, 리뷰 3종 + 확인 리뷰 1회, 서버 변경 0). 위원장 판정 추가 2건(2026-10-04): 이탈 중 상태 줄은 벗어난 쪽만 · en 시작 문장의 영문 표기 없는 목적지는 원명 유지(이름 없는 문장 신설 안 함). `CLAUDE.md` 이탈 줄 교체(79.5KB/80KB). 실기기: 위원장이 연결을 알려 `fd162869` 기준 두 구성 설치(01:07), `ad008230` 기준 재설치는 이 줄 뒤. 다음은 웨이브 3 `android-3`(인계: `e62-crossing` 완료 보고 5항목 + `e63-finish` 완료 보고 8항목 + E43 이식 후보 ③).
- **2026-10-04 01:56, 관측 `68475edc`, 출처 `android-3` 착수 보고(코디네이터 확인)**: `android-3` 착수 프롬프트의 "실험판 구성이면 `crossingRoad=1`"은 코디네이터 오기다. 정본은 §1 코디네이터 판정 3(건너는 길 이름은 iOS 실험판만)과 게이트 `e62-crossing-road-gate.test.ts`("안드로이드는 옵트인을 보내지 않는다")이고, 안드로이드는 그 파라미터를 보내지 않는다. `wording=2`는 Kit과 같이 안내 조회와 조회 화면 둘 다 보낸다.
- **2026-10-04 02:35, 관측 `4775118f`: 웨이브 3 종료.** `android-3` 통합 `4775118f`(E62·E63 앱 층 13항목 + E43 ③ 기기 레인 케이스는 컴파일까지). `CLAUDE.md` 한 줄 교체. 리뷰가 남긴 iOS·웹·안드로이드 공통 관찰을 백로그에 올리고(A57 채택 문장의 낡은 방향이 상태 행에 남음 · A58 en 채택 문장 방향 중복 · D31 안드로이드 lint 기존 오류 9건) **웨이브 3.5 `small-12`**(opus·medium)로 닫는다. A57은 위원장 판정 "상태 줄은 벗어난 쪽만"의 적용이라 새 판정 없이 진행한다(새 문장 없음). 그 뒤 `doc-audit` → `sanitize`.
- **2026-10-04 위원장 지시(코디네이터 세션)**: 모든 구현이 끝나면 ①아이폰 미러링으로 실기기 판정 항목 중 닫을 수 있는 것을 닫는다(세션 `device-check`, `iphone-mirroring-control` 스킬) ②정식판을 App Store 심사에 제출한다(세션 `ios-release`, `ios-release-submit` 스킬. 외부 배포 하드 스톱에 대한 위원장의 명시 지시). 둘은 병렬 세션. 순서: `small-12` 통합 → 두 구성 재설치(아이폰 연결 유지 중) → `device-check` ∥ `ios-release` → `doc-audit` → `sanitize`(히스토리 재작성은 릴리스 기록의 SHA를 전부 바꾸므로 맨 뒤, 실행 직전 재확인).
- **2026-10-04 03:05, 관측 `b2a7d641`: 웨이브 3.5 종료.** `small-12` 통합 `b2a7d641`(A57·A58·D31 종결). 구현 웨이브 전부 종료. 남은 관찰: en 첫 스텝이 방향 박은 횡단이면 방향이 두 번(근본은 서버 en `parts`, A58 처리 줄) · 조각 없는 회전 첫 스텝은 새 경로 기준 좌우를 남긴다(§2 E63 ⑦ 실보행 축) · 웹 음성 창구의 지난 방향(B6).
- **2026-10-04 03:50, 관측 `c8f6a458`**: `device-check` 통합 `c8f6a458`(닫은 §2 행 0, 화면 관측 11곳 기록. 남은 행은 전부 실보행·실승차·실주행 또는 VoiceOver 낭독 판정). 결함 후보 셋을 A59(설정 설명의 나들이 구절, `ios-release`가 2.1에 싣는다)·A60(TAGO 출처 라벨 + 자동차 m 표기 관찰)으로 등재. `ios-release`는 2.1(빌드 31) 아카이브 `771a976a`를 올렸고, 위원장 문안 판정(총평 첫 문장 삭제)과 A59로 빌드 32를 다시 만든 뒤 제출한다. 이후 서브에이전트 모델 줄은 `parallel-sessions` 2.16.0 문안(할 일이 정해진 구현·탐색은 `model: sonnet`)을 쓴다.
