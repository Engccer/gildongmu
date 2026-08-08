# CHANGELOG — 길동무 (gildongmu)

날짜별 변경 이력. **"언제 무엇이 바뀌었나"만** 담는다.

- 설계 근거·검증 상세는 각 항목의 `docs/superpowers/specs`·`plans` 링크가 정본이다.
- 항구 규칙·패턴·함정은 `CLAUDE.md`가 정본이다 — 여기에 다시 적지 않는다.
- 지금 무엇이 동작하고 무엇이 열려 있는지는 `PROGRESS.md`, 열린 백로그는 `docs/BACKLOG.md`.
- npm 패키지 릴리스 노트는 `packages/cli/CHANGELOG.md`·`packages/mcp/CHANGELOG.md`, App Store 릴리스 노트는 `docs/appstore/release-notes.md`.

---

## 2026-08-08

### 지하철 빠른하차 출입문 병치
하차역·방향별로 계단·엘리베이터에 가장 가까운 칸·문을 승차 전에 안내한다. 서울교통공사 빠른하차 데이터 2,358행을 정적 seed로 굳혀 런타임 upstream 호출이 없다. 1~8호선 범위이고 분기역·급행·방면 미확정은 침묵한다.
정본: [spec](docs/superpowers/specs/2026-08-08-subway-quick-exit-design.md) · [plan](docs/superpowers/plans/2026-08-08-subway-quick-exit.md). 백로그 E5 종결.

### 계단 회피가 실시간 안내까지 전달
브리핑에서 계단 회피를 켜고 안내를 시작하면 안내가 따라가는 경로는 계단 회피가 꺼진 기본 경로였다. 안내 세션이 현재 위치 기준으로 재조회하면서 `accessible`을 빠뜨렸고, 화면과 귀가 다른 경로를 가리키는데 어느 쪽도 오류를 내지 않아 실패가 조용했다.
정본: [spec](docs/superpowers/specs/2026-08-08-walk-guidance-stepfree-design.md) · [plan](docs/superpowers/plans/2026-08-08-walk-guidance-stepfree.md). 백로그 A4·D1 종결.

### 백그라운드 사운드·톤 커버리지
잠금·백그라운드에서 톤도 음성도 들리지 않던 것을 톤은 남기고 음성만 억제하는 구조로 바꿨다. 안내 톤 판정을 배타적 계층(신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축)으로 재편하고, 정지 판정을 도플러 3-state로, fix 부재 감시를 타이머 워치독으로 세웠다. 소리 9종.
정본: [spec](docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md) · [plan](docs/superpowers/plans/2026-08-08-background-tone-coverage.md).

## 2026-08-07

### 길찾기 화면 재편
ODsay 정규화를 "정규화(전체) → 강등(전체) → 선정(5) → 축 라벨" 파이프라인으로 교체했다. 종전에는 선정이 강등보다 앞이라 운행 중인 유일한 무환승 경로가 목록 밖에 묻혔다. 대안 축은 최단·최소환승 둘이고 운행 시간 밖 경로는 축 후보에서 뺀다. 도보 구간에 거리·행선지를 실었다.
정본: [spec](docs/superpowers/specs/2026-08-07-directions-view-restructure-design.md) · [plan](docs/superpowers/plans/2026-08-07-directions-view-restructure.md).

### 안내 문장 어순 재배치
자동차 실주행 피드백에서 출발. 한 자리에 완결 서술문과 목적지 명사가 번갈아 들어와 낭독이 어긋났다("…300미터 이동까지 약 129미터"). 틀을 값 타입별로 둘로 갈랐다: 서술문은 `{거리} 앞 {안내}`, 목적지는 `{목적지}까지 {거리}`.

### 대중교통·도보 문구 다듬기
같은 계열 결함이 대중교통·도보에도 있는지 전수 점검했고 없음을 확인했다. 실사용 지적 3건을 반영: 승·하차에 조사 추가(`{역}에서 승차`), 수단별로 갈리던 단위를 `{count} 정거장`으로 통일, 버스 번호에 `{route}번 버스` 표기. 도보 안내문은 provider 원문 재조합 금지 계약을 뒤집고 서버가 다시 쓰도록 바꿨다(거리 침묵 39%·괄호 도로명·"왼쪽길로" 3건이 근거).

## 2026-08-06

### 실시간 안내 실사용 피드백 라운드1 (M0~M5)
위원장 실승차 피드백 13건에서 출발한 마일스톤. M0 즉효 4건, M1 추적 정보 품질, M2 대기 국면 탈출구·계측, M3 경유역 목록·도보 핸드오프, M4 속도 가드·백그라운드 위치 승격, M5 대안 경로에서 안내 시작. 경로 대안 데이터원 채택은 보류(백로그 E6).
정본: [plan](docs/superpowers/plans/2026-08-06-realtime-guidance-feedback-r1.md).

### TAGO 지하철 API 업스트림 복구
`resultCode 01 "서비스키는 필수입니다"`가 포털 개편 작업 오류로 확인되어 조치됐다(2026-08-04 오류신고 회신). 코드 변경 0으로 소비자 3곳(역 시간표·대중교통 경로 지하철 구간·지하철 4-state)이 전부 정상 복귀했다.

## 2026-08-04

### 실시간 길 안내 봉인 후 1.3 출시
수단별 경로 안내가 실주행·실승차 판정 대기이고 거리 추적은 그 마일스톤의 중간 계단이라 단독 출시가 성립하지 않아 두 층을 함께 봉인해 내렸다. 봉인은 revert가 아니라 플래그다.

### 실험 기능은 빌드 구성이 가른다
플래그를 손으로 고치던 방식을 폐기하고 `Experimental` 빌드 구성을 신설했다. 실험판은 번들 ID `.dev`·표시 이름 "…실험"·전용 아이콘으로 공식판과 한 기기에 공존한다. 릴리스마다 코드를 고칠 일이 없어졌다.

### data.go.kr 평문 http hang 수정
프로덕션 대중교통 길찾기가 71초 걸려 앱 타임아웃으로 실패했다. `apis.data.go.kr`에 평문 http로 붙으면 TCP 연결까지는 되고 응답이 오지 않는다(같은 요청이 https로는 0.07초). 세 파일 https 전환 + 10초 타임아웃. 실측 71초 → 0.89초.

### B2: 대중교통 실시간 길 안내
수단별 진입점의 마지막 수단. 신호 정본은 GPS가 아니라 도착 API의 차량·열차 식별자다. 차량 도착과 사용자 하차를 구분해, 도착은 자동 통지하되 다음 구간 전환은 사용자 확인으로 둔다.
정본: [spec](docs/superpowers/specs/2026-08-04-transit-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-04-transit-guidance.md).

## 2026-08-03

### B1: 수단별 안내 진입점 재편 + 자동차 안내
길찾기 뷰 수단 섹션마다 "도보/자동차 안내 시작"을 두고, 리듀서를 수단별 프로파일로 갈랐다(차량은 임박·예고·이탈 임계가 도보와 다르다).
정본: [spec](docs/superpowers/specs/2026-08-03-mode-entrypoints-car-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-03-mode-entrypoints-car-guidance.md) · [조사](docs/RESEARCH-2026-08-03-mode-specific-guidance.md).

### 실시간 길 안내(E4)
"거리 추적"이 "실시간 길 안내"로 확장됐다. 간략(직선거리)·상세(경로 추종형, 도보·ko 전용) 2모드를 한 시트에서 제공한다. 사운드 8종을 위원장 청취로 선정해 교체했다.
정본: [spec](docs/superpowers/specs/2026-08-03-realtime-route-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-03-realtime-route-guidance.md).

### 실사용 피드백 묶음 A
"현재 안내 반복" 버튼 제거 확정, "가까워지는 중" 통지를 잔여 거리 적응형 사다리로 완화(멀어지는 중은 경고라 50m 고정 유지 — 비대칭이 정책이다), 상세 모드에 경로 기준 잔여 거리·예상 시간 상시 표시.

### GEO 대응
소개·FAQ 페이지 + JSON-LD + llms.txt 프로덕션 검증.

## 2026-08-02

### 위치 정확도 A3
단발 위치 취득이 게이트(30m·10초)+타임아웃+세대 토큰으로 바뀌고, 정밀 위치 꺼짐이 별개 상태가 됐다. "정확한 위치 허용" 버튼이 그 자리에서 시스템 팝업을 띄운다.
정본: [spec](docs/superpowers/specs/2026-08-02-location-accuracy-design.md).

### 거리 표기 정본 통일
"1km 200m" 나눠쓰기를 하루 만에 폐기하고 소수 km 원값(`1.1km`·`6.285km`)으로 되돌렸다. 3벌 정본(웹·Swift·CLI)에 가드가 없어 지역 사본 4곳이 갈려 있었고, 그중 CLI·iOS 도보 요약은 850m를 `0.8km`로 내고 있었다. 드리프트 가드 3종 신설.

### 거리 추적 실보행 통과
위원장 실보행에서 목적지 거리 추적이 정상 작동해 백로그 F-b가 닫혔고 B1이 확정됐다. 추적 시트를 "시작 = 표시, 중지 = 닫힘"으로 1:1 묶어 "닫혔는데 추적은 살아 있는" 상태를 없앴다.
정본: [spec](docs/superpowers/specs/2026-08-02-beacon-feedback-design.md).

### TAGO 미커버 지역 버스 안내
강릉에서 터미널·역 바로 앞에서도 0건이라 "주변에 정류소가 없습니다"가 낭독되던 거짓말을 고쳤다. 조회 반경이 약 700m 고정이라 0건 대부분은 미커버가 아니라 정상적인 반경 밖이고, 판정을 0건일 때만 발동시키자 인접 지역 반례가 전부 사라졌다.
정본: [spec](docs/superpowers/specs/2026-08-02-bus-uncovered-region-design.md). 백로그 A2 종결.

### 지역별 미제공 표기 + 지하철 최근접 역
따릉이·문화행사처럼 서울에만 있는 도메인을 조회 없이 즉답한다. 판정선은 그 도메인의 조회 반경에서 유도해 상수 복제를 없앴다. 지하철은 거리가 전국에 연속 분포해 어떤 임계값도 자의적이라 판정 대신 최근접 역을 싣는다.

부수로 seed 좌표 혼입을 잡았다: 경의중앙선 양원역 레코드에 동명이역인 영동선 양원역(경북 봉화)의 좌표가 들어 있었다.

### 내 주변 지하철 4-state
심야에 근접역이 전부 사라져 "주변에 지하철역이 없습니다"가 낭독되던 것을 고쳤다. 실시간 API의 `INFO-200`이 "운행 시간 밖"과 "실시간 미제공 역"에 함께 쓰이는데 후자로만 읽어 역을 숨겼다. 역은 어떤 상태에서도 목록에서 빼지 않고 4-state로 가른다.

### 스크린리더 통지 문장 전수 정리
"잠시 후 다시 시도해 주세요"류 자명한 꼬리 문장을 걷어냈다(여러 문장 문자열 41 → 35건). 판정선은 "뒷문장이 새 정보를 주는가"다. `route.briefing.disclaimer`의 "실제 경로는 길찾기 앱을 이용하세요"는 잉여인 데다 타 앱 사용 권유로 읽혀 특히 제거 대상이었다.

### 포커스 착지 2건
길찾기 탭 시트 확정 후 커서가 최상단으로 이탈하던 것과, "이 장소 주변" 4종이 로드 완료 후에도 커서가 네비게이션 바에 남던 것. 공유 계층 `NearbyFocusLander`로 시퀀스를 한 곳에 뒀다.

## 2026-08-01

### 실시간 인구 혼잡도
서울 `citydata_ppltn` 116개 영역. 종전 보류 사유("영역 경계 미공개")가 사실이 아니었음이 드러났다 — 전체 `citydata`의 지하철역·버스정류장 좌표가 그 영역을 정의한다. 판정은 중심-반경 원이 아니라 최근접 구성 지점 300m다.
정본: [spec](docs/superpowers/specs/2026-08-01-realtime-congestion-design.md) · [plan](docs/superpowers/plans/2026-08-01-realtime-congestion.md).

### 근처 문화행사
서울 `culturalEventInfo`. 10번째 "내 주변" 도메인. 안전한 페이지 절단선이 없어(진행 중 행사가 183~18,587행에 흩어짐) 전수 수집을 일자 키 캐시로 감쌌다.
정본: [spec](docs/superpowers/specs/2026-08-01-nearby-culture-events-design.md) · [plan](docs/superpowers/plans/2026-08-01-nearby-culture-events.md).

### data.go.kr envelope 파서 공용화
중복이 6벌이 아니라 25지점이었다. 9벌이 같은 모양을 다르게 읽어 원시값을 감싼 유령 항목(전 필드 `undefined`)과 조용한 전멸을 만들고 있었다. 설계 경계는 "모양은 공용, 봉투 정책은 provider".
정본: [spec](docs/superpowers/specs/2026-08-01-datagokr-envelope-design.md) · [plan](docs/superpowers/plans/2026-08-01-datagokr-envelope.md).

### 좌표 파라미터·서울 열린데이터 위장 제거
오류로 보이지 않는 오류 둘을 걷어냈다. 좌표 누락이 `Number("")===0`으로 (0,0)이 되어 `200 {"outOfCoverage":true}`로 나가던 것(라우트 14곳)과, 무효 키가 `/json/` 경로에서도 200 + XML을 주어 `Unexpected token '<'`로 원인을 지우던 것. 정적 가드 2개로 재발 차단. 백로그 D2·D3 종결.

### 지하철 구간 운행 시간 판정
ODsay가 출발 시각을 반영하지 않아 심야에 첫차 04:00 노선을 추천하던 결함의 지하철 축. 버스 축은 2026-08-01 별건으로 처리했다.
정본: [spec](docs/superpowers/specs/2026-08-01-subway-service-hours-design.md) · [plan](docs/superpowers/plans/2026-08-01-subway-service-hours.md).

### ODsay 심야 결함 수정 (버스 축)
노선 운행시간을 조인해 leg에 `serviceStatus`를 싣고 안정 정렬로 강등한다. 분기는 도시 코드가 아니라 TOPIS 보유 여부로 가른다(TOPIS가 수도권 광역 노선도 갖는다).
정본: [spec](docs/superpowers/specs/2026-08-01-odsay-service-hours-design.md) · [plan](docs/superpowers/plans/2026-08-01-odsay-service-hours.md).

### iOS 목적지 거리 추적 이식
판정을 Kit 순수 함수로 내리고 `BeaconModel`을 얇은 껍데기로 뒀다(앱 타깃에 테스트 번들이 0건이라 앱에 두면 검증이 구조적으로 불가능하다). 웹 원본의 잠복 결함도 함께 잡았다: 도착음이 매 fix 반복되던 것.
정본: [spec](docs/superpowers/specs/2026-08-01-ios-distance-beacon-design.md) · [plan](docs/superpowers/plans/2026-08-01-ios-distance-beacon.md).

### iOS 장소 상세 "이 장소 주변"
버스 도착·따릉이·날씨/공기질(2026-08-02에 지하철 추가로 4행). 데이터 계층은 이미 있었고 없던 것은 "현재 위치 대신 장소 좌표로 앵커하는 길" 하나뿐이었다.
정본: [spec](docs/superpowers/specs/2026-08-01-ios-place-nearby-design.md) · [plan](docs/superpowers/plans/2026-08-01-ios-place-nearby.md).

### Google Maps provider 후보 평가 (도입 없음)
Gemini SDK Maps grounding은 길동무 인증 모드에서 400으로 사용 불가. Routes API는 한국 도보·자동차가 200 + 빈 배열(도쿄 대조군은 정상이라 지역 제약 확정)이라 후보 탈락. TRANSIT은 시간대 반영·근거리 응답이 우위이나 도보 안내 문장이 없어 낭독 정본 계약에 미달. Places는 ko 열위·en 우위. 이 평가가 위 ODsay 심야 결함을 부수로 드러냈다.

## 2026-07-31

### 1.1 출시
1.0 승인 후 쌓인 110커밋. en 스토어 로컬라이제이션이 이 제출과 함께 공개됐다.

### Gemini 전용 GCP 프로젝트 분리
`GEMINI_API_KEY`가 Converters·dodo-planet과 공유하는 프로젝트에 묶여 사용량 귀속이 불가능했다. model 라벨 분리도 성립하지 않았다(dodo도 같은 모델을 쓴다). `gildongmu-prod` 신설.

### 과금·쿼터 상태 리포트
`node scripts/usage-report.mjs`가 돈·가용성·시한·걱정불필요 4섹션을 평문으로 낸다. 200에 오류를 담는 벤더 4종은 judge로 가른다.
정본: [spec](docs/superpowers/specs/2026-07-31-usage-cost-report-design.md) · [plan](docs/superpowers/plans/2026-07-31-usage-cost-report.md).

### iOS Nearby 상태 골격 추출
11개 모델이 각자 갖고 있던 `load()` 상태 머신을 Kit `NearbyLoadCore`로 수렴시켰다. 취소 결함도 함께 닫혔다.
정본: [spec](docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md) · [plan](docs/superpowers/plans/2026-07-31-ios-nearby-skeleton.md).

### `@google/genai` 2.15.0 업그레이드
breaking change가 Interactions API에만 있어 해당 없음을 확인하고 진행. 프로젝트 분리와 별도 커밋으로 나눴다(한 번에 하면 장애 시 키 문제와 SDK 문제를 가를 수 없다).

## 2026-07-30

### 1.0 App Store 승인·출시
2.1(a) 반려 1회 대응 후 승인. 반려 사유는 홀드 받아쓰기를 비-VoiceOver 심사자가 짧게 탭했을 때 무반응으로 보인 것이고, 기본값을 탭 토글로 바꿔 대응했다.

### 옴니박스 중심 웹 IA 재편
홈을 "길찾기"·"내 주변" 칩 2개로 축소하고 nearby 10종을 허브 뷰로 옮겼다. 딥링크 압축·채팅 진입 수렴.
정본: [spec](docs/superpowers/specs/2026-07-30-omnibox-web-ia-redesign-design.md) · [plan](docs/superpowers/plans/2026-07-30-omnibox-web-ia-redesign.md).

### 웹 nearby 중복 추출
9종이 복붙하던 상태 머신·렌더 골격을 `useNearbyFetch`+`NearbyPanelShell`로 수렴시키고 잠복 결함(닫힌 패널의 늦은 응답)을 닫았다.
정본: [spec](docs/superpowers/specs/2026-07-30-nearby-dedup-design.md) · [plan](docs/superpowers/plans/2026-07-30-nearby-dedup.md).

### 자동차 경로 ko 기본 Tmap 전환
도보와 반대 구도로, Tmap `description`이 도로명 포함 완성 문장인 반면 카카오 `guidance`는 도로명 없는 조각이다. 폴백은 Tmap throw 시에만 카카오모빌리티.
정본: [plan](docs/superpowers/plans/2026-07-30-car-route-tmap-primary.md).

### 장소 상세 브리핑 진입점 일원화
길찾기 뷰와 채팅 렌더 카드로 진입점을 모으고 장소 상세의 단일 수단 브리핑을 제거했다(중복).

### 레거시·중복 감사 수정 묶음
웹 UI·iOS·lib·라우트/i18n 전반.
정본: [plan](docs/superpowers/plans/2026-07-30-legacy-audit-fix-batch.md).

## 2026-07-29

### 도보 경로 카카오 기본 전환
동좌표 문체 대조 실측 근거로 방향을 역전했다(위원장 판정: "이견의 여지가 없을 정도로 카카오 우월"). 카카오는 의미 단위 병합·역사 내 이동·계단/지하보도 명시, Tmap은 미세 분절·상대방향 중심. 계단 회피 모드(`route_mode=ACCESSIBLE`)도 이때 들어왔다.
정본: [spec](docs/superpowers/specs/2026-07-29-kakao-walk-primary-design.md) · [plan](docs/superpowers/plans/2026-07-29-kakao-walk-primary.md).

### 서비스 지역 커버리지 계약 + 받아쓰기 재설계
App Review 반려 대응. 좌표 의존 라우트가 한국 밖이면 오류가 아니라 200 `{"outOfCoverage":true}`로 응답한다(3-state에 더한 4번째 정직 상태). 받아쓰기 기본값을 탭 토글로 바꾸고 홀드는 설정 선택지로 남겼다.
정본: [spec](docs/superpowers/specs/2026-07-29-coverage-contract-dictation-design.md) · [plan](docs/superpowers/plans/2026-07-29-coverage-contract-dictation.md).

### 웹→iOS 기능 갭 이식 1차
계단 회피 토글 + 보행 인프라 화면.

## 2026-07-28

### 1.0 App Store 심사 제출
스크린샷 ko 7컷, VoiceOver QA 스모크 4항목 위원장 실기기 합격으로 게이트 대체.

### 일본어(ja) 로케일
6번째 언어. iOS 설정 언어 메뉴 피커 포함.

### 나머지
"더 보기" 단계 공개를 V2 3종 라우트로 확장([plan](docs/superpowers/plans/2026-07-27-nearby-show-more-v2-three-domains.md), [웹](docs/superpowers/plans/2026-07-28-nearby-show-more-v2-web.md)), 도보 경로 횡단보도 단계에 음향신호기 주석([spec](docs/superpowers/specs/2026-07-28-walk-route-audio-signal-annotation-design.md)), 듣기 속도 설정 이식.

## 2026-07-27

### Phase 0 출시 전 방어
STT 라우트 레이트리밋+크기 상한, 채팅 웹검색 1시간 캐시, 좌표 반올림으로 캐시 키 실효화, 리전 icn1 고정, 정본 도메인 `gildongmu.dodoplanet.space` 확정.
정본: [plan](docs/superpowers/plans/2026-07-27-phase0-launch-defense.md).

### "내 주변" 장소 목록 "더 보기"
소아 진료부터 시작해 4종에 단계 공개를 도입했다. 교통 목록·보행 인프라·랜드마크는 절단 너머가 행동을 바꾸지 않아 의도적 비적용.
정본: [plan](docs/superpowers/plans/2026-07-27-nearby-show-more-v1-clinics.md).

## 2026-07-26

### 소아 진료 커버리지 확장
위원장 실사용 제보(일요일 진료 중인 강동 소아과가 "내 주변"에 없음)에서 출발. 달빛 지정 명부 단독이던 것을 일반 소아청소년과 보완 소스와 병합했다. 명부 커버리지가 6.5%였다(강동 20km에서 123곳 중 115곳 누락).
정본: [spec](docs/superpowers/specs/2026-07-26-clinic-coverage-expansion-design.md).

### 내 주변 → 장소 상세 UI 이식 (iOS)
내 주변 4종 항목을 검색 탭과 같은 상세로 통일해 로터 액션 6종을 획득했다.
정본: [spec](docs/superpowers/specs/2026-07-26-nearby-place-detail-port-design.md) · [plan](docs/superpowers/plans/2026-07-26-nearby-place-detail-port.md).

### 최근 검색 기록
검색 탭 + 길찾기 출발/도착지, 웹·iOS.
정본: [spec](docs/superpowers/specs/2026-07-26-recent-searches-design.md) · [plan](docs/superpowers/plans/2026-07-26-recent-searches.md).

## 2026-07-22

### 도보 길찾기(Tmap) + 길찾기 뷰·iOS 4탭
3수단 비교 화면 신설. 위원장 실기기 QA 통과("의도했던 기능이 잘 구현").
정본: [spec](docs/superpowers/specs/2026-07-21-walk-route-directions-tab-design.md) · [plan](docs/superpowers/plans/2026-07-21-walk-route-directions-tab.md).

### 역 상세 보강
첫차·막차 시간표 + 시설 패널 보강 그룹(음성유도기 seed·엘리베이터 폴백) + 역명 매칭 수정. 카카오 역 place_name이 "강동역 5호선" 형태라 정규화 없이는 역 섹션 전체가 죽어 있었다.
정본: [spec](docs/superpowers/specs/2026-07-22-station-detail-enrichment-design.md) · [plan](docs/superpowers/plans/2026-07-22-station-detail-enrichment.md).

### 보행 인프라 ("내 주변" 7번째)
음향신호기(서울 열린데이터 OA-15543 정적 seed) + 횡단보도·점자블록(Overpass).
정본: [spec](docs/superpowers/specs/2026-07-22-walk-infrastructure-design.md) · [plan](docs/superpowers/plans/2026-07-22-walk-infrastructure-plan.md).

## 2026-07-21

### App Store 출시 필수 요건 완비
채팅 AI 동의 게이트(5.1.2(i)), `PrivacyInfo.xcprivacy`, 웹 개인정보처리방침 5개 언어, `/api/chat` 레이트리밋.
정본: [spec](docs/superpowers/specs/2026-07-21-appstore-release-gates-design.md) · [plan](docs/superpowers/plans/2026-07-21-appstore-release-gates.md).

### 장소 결과 플랫 리스트 + 칩
버킷 섹션 그룹핑을 폐지했다. 고정 섹션 서열이 정확도 1위를 최하단 '기타'에 매몰시킨 실측 6사례가 근거다. 분류는 순위를 결정하지 않는다.

## 2026-07-20

### 정확도순 검색 전환
거리순을 폐지하고 정확도순+좌표 블렌딩으로 바꿨다. 랜드마크가 자연히 부상하면서 명소 전용 라우트가 중복이 되어 함께 폐지했다.
정본: [spec](docs/superpowers/specs/2026-07-20-accuracy-first-search-design.md) · [plan](docs/superpowers/plans/2026-07-20-accuracy-first-search.md).

### iOS 받아쓰기 WhatsApp식 홀드
누른 동안 녹음·떼면 확정. 위로 밀면 잠금(일시정지+확정), 왼쪽으로 밀면 취소. 실기기 3차에 합격했고, 그 과정에서 SwiftUI 제스처 조합을 UIKit 인식기 계층으로 교체했다(List 스크롤 팬 경합·VO pass-through 드래그 유실).

### iOS 채팅 멀티 턴 먹통 수정
몇 턴 대화 후 앱 전면 무응답. 먹통 생존 상태에서 CPU 리포트를 회수·심볼화해 `LazyVStack`의 lazy 크기 추정 진동 루프로 확정하고 eager `VStack`으로 교체했다.

## 2026-07-19

### iOS 다국어(5개 언어) + 설정 언어 픽커
웹 `messages/{locale}.json` 정본에서 결정론 스크립트로 String Catalog를 생성한다. Bundle이 언어 협상을 프로세스 시작 시 1회만 캐싱해 앱 내 즉시 전환이 안 되던 것을 언어별 `.lproj` 직접 조회로 해결했다.
정본: [spec](docs/superpowers/specs/2026-07-19-ios-i18n-design.md) · [plan](docs/superpowers/plans/2026-07-19-ios-i18n.md).

### iOS 제목 메뉴 + 테마
새로고침·설정 메뉴, 테마 3택.
정본: [spec](docs/superpowers/specs/2026-07-19-ios-title-menu-refresh-theme-design.md) · [plan](docs/superpowers/plans/2026-07-19-ios-title-menu-refresh-theme.md).

## 2026-07-18

### iOS 채팅 탭
3탭 전환(채팅·검색·내 주변). 실기기 VoiceOver에서 산문이 통짜 객체 하나로 낭독되던 것을 블록 분할로 고쳤다.
정본: [spec](docs/superpowers/specs/2026-07-18-ios-chat-tab-design.md) · [plan](docs/superpowers/plans/2026-07-18-ios-chat-tab.md).

### iOS 단축어(App Intents) + 유휴 복귀 초기화
"길동무 음성 검색"·"내 주변" Siri 진입.
정본: [App Intents spec](docs/superpowers/specs/2026-07-18-ios-app-intents-shortcuts-design.md) · [유휴 리셋 spec](docs/superpowers/specs/2026-07-18-idle-reset-title-refresh-design.md).

### TestFlight 외부 테스터 배포 개시
App Store Connect 앱 신규 등록(App ID 6792234349).

## 2026-07-16

### CLI(`gildongmu`) + MCP(`gildongmu-mcp`) npm 첫 발행
REST 카탈로그를 중계하는 씬 클라이언트. 버전별 이력은 [CLI CHANGELOG](packages/cli/CHANGELOG.md)·[MCP CHANGELOG](packages/mcp/CHANGELOG.md).
정본: [spec](docs/superpowers/specs/2026-07-15-cli-mcp-design.md) · [plan](docs/superpowers/plans/2026-07-15-cli-mcp.md).

## 2026-07-06 ~ 2026-07-10

### iOS 네이티브 재작성 (M0~M6b)
SwiftUI 앱 신설. M0 검색, M1 장소 상세, M2 내 주변·위치, M3 역 상세·날씨/공기질, M4 경로 브리핑, M5 장소 채팅, M6 음성 받아쓰기, M6b 웹 동등성 누락분 7건.
정본: [spec](docs/superpowers/specs/2026-07-06-ios-native-rewrite-design.md) · plans `2026-07-06~10-ios-native-rewrite-m*.md`.

## 2026-07-04

### ODsay 대중교통 프로덕션 해소
apiKey가 발급 시점 플랫폼에 묶여 Server 앱 키로는 referer 식별이 안 됐다. URI 전용 앱을 새로 만들고 서버 fetch에 `Referer`를 명시해 해결했다.

### dodo-planet 전량 이식 완결
Phase A~E 이식 대상 자산 전부 dodo 합류.
정본: [spec](docs/superpowers/specs/2026-07-03-dodo-full-port-design.md).

### `DistanceBeacon` 패치
훅 계층 버그 2개로 죽어 있었다. `useScreenWakeLock`이 매 렌더 새 객체를 반환해 정리 effect가 매 렌더 돌면서 `watchPosition`이 등록 직후 해제되고 있었다(시작 톤 후 fix 0회, 영원한 침묵).

## 2026-06-27 ~ 2026-06-30

- **무장애 여행 정보**(한국관광공사 KorWithService2) — [spec](docs/superpowers/specs/2026-06-30-barrier-free-travel-design.md)
- **현재 위치 정위 카드**(where-am-i) — [spec](docs/superpowers/specs/2026-06-28-where-am-i-location-card-design.md)
- **자연어 검색 라우터 폐기**: Gemini 라우터를 통째로 제거하고 장소·주소·웹 항상 병렬 3섹션으로 회귀했다. deterministic 검색 위에 LLM 재해석을 얹으니 "위스키바→바→미용실"로 멀쩡한 쿼리가 악화됐다. [plan](docs/superpowers/plans/2026-06-27-remove-search-router-parallel-web-section.md)

## 2026-06-20 ~ 2026-06-24

- **채팅 에이전틱 전환**(Gemini function calling) — [spec](docs/superpowers/specs/2026-06-20-chat-agentic-workflow-design.md) · [chat interface](docs/superpowers/specs/2026-06-20-chat-interface-design.md)
- **장소별 채팅**(장소 앵커 불변식) — [spec](docs/superpowers/specs/2026-06-21-place-scoped-chat-design.md)
- **Perplexity 웹 검색** — [spec](docs/superpowers/specs/2026-06-21-perplexity-web-search-design.md)
- **내 주변 둘러보기**(카카오 카테고리+8방위) — [spec](docs/superpowers/specs/2026-06-20-surroundings-awareness-design.md)
- **이 지역 날씨**(기상청 격자 변환) — [spec](docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md)
- **목적지 거리 추적 (웹)** — [spec](docs/superpowers/specs/2026-06-20-distance-beacon-design.md)

## 2026-06-14 ~ 2026-06-19

초기 구축. 각 기능의 현재 상태는 `PROGRESS.md` 운영 표를 본다.

- **v2**: 검색→상세 흐름, 역 교통약자 편의시설(코레일), 언어 분리 UI — [spec](docs/superpowers/specs/2026-06-14-gildongmu-v2-upgrade-design.md)
- **v2.1**: 음성 받아쓰기(Deepgram), PWA 수제 서비스워커 — [spec](docs/superpowers/specs/2026-06-14-gildongmu-v2.1-voice-pwa-design.md)
- **시내버스**: TAGO 지방 + 서울 TOPIS 병합 — [TAGO spec](docs/superpowers/specs/2026-06-14-gildongmu-tago-bus-design.md) · [서울버스 spec](docs/superpowers/specs/2026-06-15-seoul-bus-api-design.md)
- **따릉이** — [spec](docs/superpowers/specs/2026-06-16-seoul-bike-design.md)
- **서울 지하철**: 교통약자 시설 9종 + 실시간 도착 + 전국 도시철도역 메타 seed
- **소아 야간·휴일 진료** — [spec](docs/superpowers/specs/2026-06-17-nearby-night-clinic-design.md)
- **공기질**(에어코리아 TM중부원점 변환) — [spec](docs/superpowers/specs/2026-06-17-air-quality-design.md)
- **아이 놀 곳** — [spec](docs/superpowers/specs/2026-06-18-kids-places-design.md)
- **대중교통 길찾기**(ODsay) — [spec](docs/superpowers/specs/2026-06-18-odsay-transit-routing-design.md)
- **주소·우편번호 검색**(juso) — [spec](docs/superpowers/specs/2026-06-19-juso-official-address-design.md)
- **검색창 3섹션 병렬** — [spec](docs/superpowers/specs/2026-06-19-unified-place-address-search-design.md)

## 2026-06-12

최초 커밋. Next.js 16 + next-intl 기반 프로젝트 신설.
