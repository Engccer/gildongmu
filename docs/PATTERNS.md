# PATTERNS — UI·상태·채팅·도구층·빌드 구성의 상세 계약

`CLAUDE.md`가 **요지만 남기고 여기로 옮긴 상세 계약**이다(2026-09-02 문서 축소 — CLAUDE.md는 매 세션·매 리뷰어가 전량 읽으므로 규칙 한 줄만 두고, 근거·실사고·함정의 세부는 여기에 둔다). `CLAUDE.md`의 항목이 `→ PATTERNS`로 끝나면 **그 코드를 수정하기 전에 같은 제목의 절을 읽는다**.

- 외부 통합(provider·route·envelope·좌표·영문 응답)과 **실시간 안내 세션**(도보·자동차·대중교통 안내의 판정·시트·톤·띠바)의 상세는 `docs/INTEGRATIONS.md`, 여기는 그 밖의 내부 계약(접근성 repo 디테일·위치·포커스·강등·검색·i18n·채팅·WebMCP·iOS 빌드 구성·CLI 릴리스)이다.
- 여기 있는 것은 전부 실측으로 확정된 계약이고, 어기면 대개 **조용한 실패**(포커스 이탈·거짓 라벨·죽은 기능)가 된다. 설계 근거는 각 항목이 가리키는 spec이 정본이다.

---

## 접근성 repo 디테일

### "내 주변" 결과 각 항목 이름은 `<h4>`

**"내 주변" 결과 각 항목 이름은 `<h4>`**(8종 nearby). 정적 정보 리스트라 발견 경로(버튼)가 없어 heading이 유일한 빠른 점프 수단(자동 등장 섹션과 동형). 계층: nearby 섹션 헤더 `h3` → 항목 `h4`(장소 상세는 장소명 `h2`→nearby `h3`→항목 `h4`). 정류소·역은 이름만 `h4`, 도착편 목록엔 heading 미부여(과잉). **신규 nearby 항목 이름은 `<h4>`로.** 예외: 보행 인프라 패널은 항목이 이름 없는 인프라 점이라 그룹 헤더만 `h4` 3개(음향신호기·횡단보도·점자블록), 항목 무헤딩(도착편 관례 동형).

### 한 줄 = 한 접근성 객체 (시각 목적 인라인 분절 금지)

**한 줄 = 한 접근성 객체 (시각 목적 인라인 분절 금지).** 한 항목의 한 줄(역명+노선+거리, 라벨+값)을 시각 스타일용 인라인 `<span>`(`opacity-70` 흐림, `text-xs` 작게, `font-medium` 라벨, `bg-accent` 배지, `ml-N` 간격)으로 쪼개면 **각 span이 별도 접근성 객체**가 되어 VoiceOver가 조각마다 멈춘다 — 한 항목 읽는 데 스와이프 여러 번(가운뎃점까지 별도 객체). Chrome 접근성 트리로 실측 확정. **수정 정본: `joinText(...)`(`src/lib/format.ts`)로 한 줄을 단일 텍스트로 합친다** — falsy 조각 자동 제거(선택 항목은 `cond && text`), 구분자는 쉼표(가운뎃점은 일부 SR이 단어로 낭독해 금지 — i18n 문자열도 같다: `i18n-messages.test.ts`가 6로케일을 스캔하고 **판정 축은 양옆 공백**이라 한국어 합성어의 가운뎃점(`관광·명소`)은 낱말 안이라 대상이 아니다). 의미 있는 배지(급행·환승·실내/외)는 장식이 아니라 정보이므로 **텍스트로 흡수**(제거가 아니라 합침). **인터랙티브 요소(`tel:` 전화 `<a>`·버튼·입력)는 별도 객체가 정상 — 절대 합치지 말 것.** 글로벌 CLAUDE.md "한 줄 = 한 접근성 객체" 정본.

### definition list(`<dl>/<dt>/<dd>`)는 단순 라벨-값에 금지

**definition list(`<dl>/<dt>/<dd>`)는 단순 라벨-값에 금지.** SR이 항목마다 "용어/정의" 역할과 콜론을 별도 낭독해 "표처럼" 읽힘. **평문 단일 텍스트** `<p>{`${라벨} ${값}`}</p>`로(콜론 제거). ⚠ 과거엔 `<span class="font-medium">라벨</span>`로 라벨만 볼드 처리했으나 **그 라벨 span도 별도 객체로 분절**되므로(위 "한 줄 = 한 객체") 라벨 볼드를 포기하고 라벨+값을 한 텍스트로 합친다. `<html lang={locale}>`가 있어 콘텐츠 언어 == 로케일이면 `lang` 속성 불필요, 다국어는 `prefersEnglish`로 현재 언어 하나만.

### 받아쓰기 엔진은 OS 버전이 정하고 둘 다 온디바이스다

**받아쓰기 엔진은 OS 버전이 정하고 둘 다 온디바이스다**(2026-08-19, 최소 지원 18 하향): `SpeechService`는 `SpeechEngine` 계약(`prepare → attach → run → finish/cancel`)만 알고, iOS 26+는 `AnalyzerSpeechEngine`(SpeechAnalyzer, 앱이 모델을 내려받는다), 그 아래는 `LegacySpeechEngine`(`SFSpeechRecognizer` + `requiresOnDeviceRecognition = true`). ⚠ **그 옵션 한 줄이 개인정보 3자 일치(웹 privacy "기기 안에서 처리"·PrivacyInfo·ASC 라벨)의 근거다** — 지우거나 서버 인식으로 폴백하면 세 문서가 동시에 거짓이 된다. 온디바이스 자산이 없는 언어·기기(`supportsOnDeviceRecognition == false`)는 `.onDeviceUnsupported`로 정직 실패하고, 앱이 그 자산을 내려받을 수 없어 준비 단계도 없다. 26 미만은 음성 인식 권한을 마이크와 별개로 한 번 더 묻는다(`.recognitionDenied`). 상태 전이·취소 세대·VO 차단·통지는 서비스에 남긴다 — 엔진에 옮기지 말 것. ⚠ **`SFSpeechRecognizer.requestAuthorization`·`recognitionTask` 콜백은 `@Sendable` 명시 필수** — 마이크 탭 클로저와 같은 계열로, 미표기 시 MainActor 격리를 상속해 TCC 백그라운드 큐에서 SIGTRAP(iOS 18.6 시뮬레이터 실측 크래시).

### 화면을 띄울지 말지를 가르는 판정은 동기로 한다

**화면을 띄울지 말지를 가르는 판정은 동기로 한다**(2026-08-19, 도보 안내 종료 화면): 비동기 판정은 화면을 띄운 뒤 지워 깜빡임과 VO 착지 경합을 만든다. `BeaconModel`은 `PedometerService.startLiveUpdates`로 라이브 누적을 들고 있다가 종료 순간 `WalkHealth.isMeaningfulWalk`(50m)를 동기로 판정하고, 스와이프·VO escape는 종료 화면을 지우지 않고 시트를 **최소화**만 하며(`isMinimized`, 2026-08-22 N1), 소거는 시트 닫기 버튼의 명시 `clearArrival()`뿐이다 — sheet set 클로저 안에서 바인딩을 되돌리지 말 것. 세부는 spec `2026-08-17-walk-arrival-health-summary-design.md`.

### 채팅 산문 블록은 언제나 한 접근성 객체이고, 장소 언급 수로 활성화 방식만 가른다

**채팅 산문 블록은 언제나 한 접근성 객체이고, 장소 언급 수로 활성화 방식만 가른다**(2026-08-17 위원장 판정, 실호출 표본 27블록 중 26이 1개): 1개면 **블록 전체가 버튼**(VO "…, 버튼"·더블탭=상세, 시각 사용자는 줄 아무 데나 탭, 이름만 링크색·링크 속성 없음), 2개 이상이면 이름별 인라인 링크(자체 스킴 `gildongmu-place-mention`, `openURL` 가로채기) + 로터 커스텀 액션 "○○ 상세 보기". 근거는 같은 답변의 렌더 카드뿐이라(`chatPlaceMentions`) 카드 없는 답변(장소 앵커 모드)엔 아무것도 붙지 않는다. nearby류 self-fetch 렌더 4종(소아 진료·아이 놀 곳·둘러보기·무장애)은 서버가 `places`(`src/lib/nearby-place.ts` 투영 ↔ Kit `PlaceProjection.swift`)를 함께 실어 iOS가 장소 카드로 디코딩한다 — **새 nearby 도구에 렌더를 달면 이 투영도 함께 싣는다**(안 실으면 iOS에서 그 답변만 상세 진입이 죽는다). 카드 활성화·블록 활성화 모두 상세 **시트**(닫기 버튼, "물어보기" 숨김)로 열고, 닫으면 연 원점(카드·블록)으로 포커스를 복원한다(`focusedOriginKey`). ⚠ 2개 이상 블록의 인라인 링크가 VO 객체를 쪼개는지는 실기기 판정 항목 — 쪼개면 `.accessibilityElement(children: .combine)`으로 묶는다. **말풍선 안 구획(카드 묶음·출처)은 헤딩으로 나눈다**(`sectionHeading`, 수 포함 "장소 N곳"·"출처", 빈 묶음엔 금지) — 산문 → 카드 → 출처 경계가 VO 선형 읽기에서 안 들렸다(위원장 실기기 2026-08-17). 웹 `SourceList`는 "출처 " 접두 텍스트가 같은 역할.

---

## 내 주변·위치·포커스

### iOS "내 주변" 화면도 공유 상태 머신으로 만든다

**iOS "내 주변" 화면도 공유 상태 머신으로 만든다**(2026-07-31 골격 추출, 위 웹 규칙의 iOS 판): Kit `NearbyLoadCore<Payload>`(좌표 소스 `.current`/`.none`·`coverage` `.korea`/`.none`·`fetch`·`willCommit`·`onEvent` 주입)+`RevealWindow`(더 보기 창)+앱 `nearbyAnnouncer`(이벤트→VO 통지)·`NearbyOverlayDescriptor`(`.list`/`.plain`/`.absentCapable` 팩토리, init 봉인)·`NearbyStateOverlayView`. **`load()` 상태 머신 복붙 금지** — 모델은 core 껍데기(phase 포워딩+load 위임)이고 도메인 고유물(fetch·통지 문구·부가 상태)만 남긴다. 전이표 정본은 스펙 `docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md` §5, 계약은 `NearbyLoadCoreTests`가 못 박는다(신규 도메인도 이 스위트에 케이스 추가). ⚠ 취소는 코어가 2겹(오류형+`Task.isCancelled` 커밋 게이트)으로 흡수해 상태·통지를 억제한다 — 껍데기에서 재구현 금지. descriptor는 `.nearbyStateOverlay { }` 안에서 매 렌더 생성(캐싱하면 언어 전환 고착).

### 위치 스토어(`src/lib/geolocation.ts` 싱글턴)에는 TTL이 없다 — "지금 어디 있는가"가 답의 일부인 조회는 전부 `{force:true}`다

⚠ **이 스토어에는 TTL이 없다 — "지금 어디 있는가"가 답의 일부인 조회는 전부 `{force:true}`다**(2026-08-08 실보행 발견). 한 번 `ready`가 되면 force 없이는 세션 내내 **같은 좌표**가 나오므로, 사용자가 이동한 뒤의 조회는 조용히 옛 자리를 출발지로 삼는다. 오류도 빈 결과도 아니라 그럴듯한 응답이 와서 실패가 보이지 않는다(이탈해서 누른 재조회가 출발점에서 같은 경로를 다시 받아 온 실사고). 판별선은 "이 조회의 답이 사용자 위치에 의존하는가"이지 "새로고침 버튼인가"가 아니다 — 안내 시작·이탈 재조회·ETA 갱신이 전부 여기 해당한다. 그래서 `useRouteGuide`의 `fetchGuideRoute(force)`는 **기본값 없는 필수 인자**다([[no-default-for-safety-parameters]]). 반대로 순위 가중용 근접 블렌딩처럼 정밀도 요구가 낮은 조회는 캐시가 옳다.

### 그 사이에 세 번째 축이 있다: 나이 상한

**그 사이에 세 번째 축이 있다: 나이 상한**(`LocateOptions.maxAgeSeconds`, 2026-08-16 A7). 길찾기 조회는 수단을 바꿔 가며 여러 번 도는 화면이라 매번 force면 매번 최대 15초를 기다리고, 캐시면 앱을 켜고 처음 잰 좌표가 세션 내내 출발지가 된다. **3분보다 낡았을 때만** 정밀 재취득한다(`DIRECTIONS_ORIGIN_MAX_AGE_SECONDS`). 나이를 재려면 좌표에 취득 시각이 있어야 해서 `Coord.at`(epoch **초**)이 그때 생겼다 — ⚠ **없으면 "나이 불명"이고 신선하지 않은 것으로 본다**(나이 없는 캐시를 신선으로 치면 수명 무한이던 종전 동작으로 되돌아간다). iOS는 이 축이 스토어 자체에 있다(`LocationFixPolicy.freshTTL` 60초 + `canReuseCachedFix`) — 두 값이 다른 것은 드리프트가 아니라 계층 차이다.

### 화면이 요청하지 않은 측위는 표시 상태를 흔들지 않는다

⚠ **화면이 요청하지 않은 측위는 표시 상태를 흔들지 않는다**(`silent`, 2026-08-16 D19). 수동 위치 이동 판정은 포그라운드 복귀마다 `force:true`로 도는데, 그때 공유 스토어가 `locating`으로 후퇴하면 그 좌표를 쓰는 섹션이 통째로 **언마운트·재마운트**된다(포커스 이탈 + 재fetch). `silent`는 `ready`를 유지한 채 좌표만 갈고 실패해도 직전 좌표를 남긴다. ⚠ **그래서 silent 실패 뒤에는 옛 좌표를 받을 수 있다** — 그것이 안전한 이유는 `Coord.at`이 있고 판정 자격이 나이 상한(10초)을 보기 때문이다(옛 fix는 `undecidable`로 떨어진다). 두 기능이 서로를 떠받치므로 한쪽만 되돌리지 말 것.

### "내 주변" 섹션들(현재 10개)은 홈이 아니라 허브 뷰(`NearbyHub`, `?panel=nearby` URL+History 연동)에 있다

**"내 주변" 섹션들(현재 10개)은 홈이 아니라 허브 뷰(`NearbyHub`, `?panel=nearby` URL+History 연동)에 있다**(2026-07-30 옴니박스 IA 재편 — 홈은 "길찾기"·"내 주변" 칩 2개로 축소). 허브 안 각 패널은 닫기·Esc·아코디언으로 접는다(`nearby-panel-store.ts` 싱글턴 + `useNearbyPanel`). `claim()`/`close(restoreFocus)`. **포커스 비대칭**: 직접 닫기·Esc는 `restoreFocus=true`(trigger 복귀), 다른 패널이 점유 가져가 자동 닫힐 땐 `false`. ⚠ 채팅 오버레이가 열린 동안은 `engaged:false`로 패널 Esc 비활성(스택된 전역 Esc 경합 — [[stacked-global-esc-listener-conflict]]. 현재 허브 안 채팅 경로 없음 — 재도입 시 적용).

### 둘러보기는 세 요청(조망·장면·목록)을 한 fetch로 묶어 한 번에 커밋한다

**둘러보기는 세 요청(조망·장면·목록)을 한 fetch로 묶어 한 번에 커밋한다**(iOS `AroundNearbyModel` ↔ 웹 `AroundNearby.tsx`의 `fetchAround`, 2026-08-22 M4·B9): 완료 시점이 다른 로드를 따로 커밋하면 늦게 온 쪽이 포커스를 끌어간다(착지는 위치 문장 1회가 계약). 조각별 실패는 payload 안에 남겨 그 자리에 실패 문장으로 — `NearbyLoadCore`는 "payload가 있다/없다"만 본다. "한눈에 보기" 반경은 `OVERVIEW_RADIUS_M` **한 상수**(1km, 실호출 근거 spec §5)이고 불릿마다 다른 "가까운"을 쓰면 조망만 듣는 SR 사용자에게 브리핑이 거짓이 된다. 자동 펼침 장면(`SurroundingsSceneAutoSection`)은 트리거·닫기·착지가 없고 헤딩이 유일한 발견 경로다 — 버튼형(`SurroundingsSceneSection`, 안내 시트)은 종전 계약 그대로. 웹은 `useNearbyFetch`가 `ok`·`json()`만 읽는 점을 이용해 세 응답을 **합성 Response 하나**로 돌려준다(셋 다 실패해야 `error`, 전 키 부재만 `empty`, 조각 실패는 payload 안 플래그로 그 자리 문장). 불릿 문장은 `src/lib/overview-lines.ts` ↔ Kit `buildOverviewLines` ↔ CLI `formatNearbyOverview` 3벌 미러(템플릿은 `whereAmI.overview.*` 한 곳, 조사만 코드). 종전 "현재 위치 확인"(`WhereAmI`·`buildLocationNarrative`·`whereAmI.narrative.*`)은 웹·Kit 모두 삭제됐고 `/api/where-am-i`는 CLI·채팅 계약이라 남아 있다 — 웹 둘러보기에 되살리지 말 것. iOS의 "이 위치에 관해 물어보기" 버튼도 웹엔 없다(홈 범용 채팅·상세 앵커 채팅이 그 자리 — 의도된 비대칭). 장면·목록의 장소 행은 `requestOpenPlace`로 상세를 연다(자동 펼침 장면은 `showPlace={false}` — 패널 헤딩이 이미 같은 위치 문장이다).

### iOS 목록 포커스 이동은 "가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도"가 정본

**iOS 목록 포커스 이동은 "가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도"가 정본**(정본 구현 `SearchView.landFirstRowFocus`·`DirectionsEndpointSearchView.landFirstCandidateFocus`, 선례 `ChatConversationView`). **동기 대입 한 줄은 실패한다** — `List`의 오프스크린 행은 AX 트리에서 컬링되고, 대상이 트리에 없으면 SwiftUI가 대입을 조용히 되돌린다(대상이 화면 밖이면 무이동, 걸치면 엉뚱한 행 착지라 증상이 갈려 원인이 안 보인다). ⚠ **함정 셋**: ①`.accessibilityFocused($binding, equals:)`에 **`Bool` 바인딩을 여러 행에 붙이지 말 것**(나머지 행 전부가 포커스를 주장한다 — **항목 정체성 옵셔널 바인딩**이 정본) ②**`scrollTo` 인자는 포커스 키와 다르다**(포커스는 복합 키, `ForEach` 정체성은 원시 id라 복합 키를 넘기면 가시화가 조용히 실패한다) ③**시뮬레이터로는 검출 불가**(AX 트리는 어느 행이 포커스를 주장하는지 보여 주지 않는다) — 실패 시 가설 패치를 반복하지 말고 `ChatFocusDiag` 로그로 실착지를 확정한다. **"내 주변"·"이 장소 주변"은 공유 계층 `nearbyFocusOnLoad`/`NearbyFocusLander`를 쓴다**(복붙 금지). 그 계층의 계약 셋: **첫 로드에만 착지**(새로고침은 사용자가 그 버튼에 커서를 둔 채 일으키는 행동이다), **`anchor` 미지정**(`.top`을 주면 sticky 섹션 헤더가 네비게이션 바 뒤로 잘린다), **결과 통지 완료를 기다리지 않는다**(`awaitAnnouncementFinish` 부활 금지).

### 화면 배치를 바꾸면 그 자리를 지나가는 포커스 점프를 함께 점검한다

**화면 배치를 바꾸면 그 자리를 지나가는 포커스 점프를 함께 점검한다**(2026-08-02): 길찾기 조회 완료 시 첫 성공 수단 heading으로 보내던 계약은 그 자체로 옳았는데, 거리 추적 섹션이 조회 버튼과 수단 섹션 **사이**에 생기자 그 점프가 새 섹션을 통째로 건너뛰게 됐다. 지금은 조회 완료 시 첫 **성공** 수단 heading으로 1회 이동한다(성공 0건이면 무이동, `51a0625` 2026-08-12) — 종전에 이 점프를 뗐던 이유였던 "거리 추적 섹션이 사이에 낀 배치"는 안내 버튼이 수단 섹션 안으로 들어가며 해소됐다. 계단 회피 토글 재조회는 도보 heading으로 이동한다(사용자가 그 섹션 안에서 조작했다).

---

## 강등·통지·표시 규칙

### iOS 통지 우선순위의 판별선은 "포커스가 움직이고, 그 통지가 착지 라벨로 대체될 수 없을 때 `.high`"다

**iOS 통지 우선순위의 판별선은 "포커스가 움직이고, 그 통지가 착지 라벨로 대체될 수 없을 때 `.high`"다**(헌장 §6 정본, 이 repo의 실사고 자리는 `BeaconModel.performReroute`). 버튼 활성화 응답이 대표 사례다: 핸들러가 **자기를 누른 버튼을 사라지게 하면** 포커스가 다른 컨트롤로 옮겨가고 VoiceOver가 그 라벨을 낭독하는데, 기본 우선순위 통지는 거기에 잠식돼 무발화된다. 같은 선에 걸리는 다른 자리: 목록이 통째로 오버레이로 교체되는 전락 통지(`NearbyLoadState`의 권한·정밀도·커버리지 3종 — 직전 데이터를 유지하는 `announceRefreshFailed`는 포커스가 안 움직여 기본값), 보내기 버튼으로 선점 이동한 직후의 받아쓰기 전사 통지(`ChatConversationView`). 반대로 착지 라벨이 곧 답인 자리(`landFirstCandidateFocus` — "안내가 잘리더라도 즉시 첫 후보로")는 올리지 않는다. ⚠ **한 함수 안에서 실패만 `.high`이고 성공이 기본값이면 그 비대칭 자체가 결함 신호다** — 실패는 상태가 남아 사용자가 재시도로 확인하지만, 성공은 그 통지가 유일한 증거라 놓치면 "버튼이 동작하지 않는다"가 된다(재조회 실사고의 정확한 기제).

### 직선거리는 고를 수 있는 모드가 아니라 이름 없는 내부 강등이다

**직선거리는 고를 수 있는 모드가 아니라 이름 없는 내부 강등이다**(E16 축2, 2026-08-23). 웹에 직선거리 단독 진입점·모드 전환 버튼을 **다시 만들지 말 것** — 사용자가 모드를 고르는 순간 지운 개념이 되돌아온다. **시작 가능한 수단이 0개면 안내 버튼도 0개**이고(iOS 정식판과 같다 — 그쪽은 그 버튼이 봉인 안이다), 직선거리는 최종 접근·도착 인계·조회 실패에서만 이름 없이 선다. ⚠ **기능을 지울 땐 소비자 기준으로 자른다**: 같은 i18n 키·같은 리듀서 이벤트를 웹과 iOS가 나눠 쓰므로, 웹에서 안 쓴다고 지우면 iOS 실험판 경로가 통째로 깨진다(`beacon.briefGuideStart`·`beacon.straightLineNote`·`guide.detailUnavailable`·`guide.detailNoLocation`·Kit `speedSuggest` 이벤트가 그 자리다). ⚠ **같은 이름이 i18n 키와 콜백 양쪽에 있을 수 있다** — 문자열 검색으로 지울 것을 가르면 죽은 기계가 남거나 살아 있어야 할 코드를 건드린다. **개념으로 훑고 낱말로 훑지 말 것**(축1의 "8건"이 실제로 12건이었던 것과 같은 함정).

### 모드 이름을 지운 대가는 강등 사유가 유일한 단서가 되는 것이다

**모드 이름을 지운 대가는 강등 사유가 유일한 단서가 되는 것이다**(E16 축2). `fetchGuideRoute`는 `{ ok: true, … } | { ok: false, failure }` 태그로 `noLocation`·`retryable`·`unavailable`·`outOfCoverage`를 가른다(`null` 하나로 접지 않는다 — 종전에 그 "그 외"에 재시도로 풀리는 것과 아닌 것이 섞여 있었다). ⚠ **모든 비-200을 재시도 가능으로 접지 말 것** — 400·404는 다시 시작해도 같은 실패라, 재시도 가능으로 위장하면 사용자가 효과 없는 재시작을 반복하고 배포 결함이 강등 뒤에 숨는다. ⚠ **통지와 상시 표시는 다른 문자열이다**: 통지는 *사유*, 상시 표시는 *동작 서술*(`degradedNote`, 종전 `straightLineNote`의 자리) — 같은 문장을 live region과 DOM에 함께 두면 회전자에서 이중 낭독된다. 예외는 `noLocation` 하나로, 직선거리조차 불가해 "방향과 거리로 안내 중"이 거짓이라 사유가 곧 표시다. ⚠ **자동 강등(도착 인계·경로 상실)에도 표시를 세운다** — 시작 실패에만 달면 그 세션은 표시가 빈다. ⚠ **강등 문구에 모드 이름을 쓰지 않는다**([[degraded-guidance-gets-no-mode-name]]).

### 현위치 수동 지정: 유효 위치를 소비하는 화면과 표시줄을 함께 옮긴다

**현위치 수동 지정: 유효 위치를 소비하는 화면과 표시줄을 함께 옮긴다**(2026-08-09). 사용자가 GPS 대신 자기 위치를 지정하면 그 좌표가 "내 주변"·검색 거리·**채팅 앵커**·길찾기 출발지를 정한다(우선순위 **장소 앵커 > 수동 위치 > GPS**, 실시간 안내만 실좌표). ⚠ **상태 표시줄은 "이 화면의 조회 기준"이라는 약속이다** — 화면에 표시줄을 두면 그 화면의 **모든 데이터 경로**가 같은 기준을 쓰는지 전수 확인해야 한다. 시각 사용자는 결과를 보고 어긋남을 알아채지만 SR 사용자에겐 그 문구가 유일한 정보원이다(실사고: 채팅 탭에 표시줄을 달았는데 `ChatModel`·`useChat`은 GPS를 계속 썼다. 같은 마일스톤이 장소 채팅 시트에서 표시줄을 끈 근거가 정확히 이 오해 방지였는데 탭에서는 그 오해가 실재했다). ⚠ **라벨은 `origin` 유무가 아니라 마지막 판정 결과까지 본다**(`isManualLocationVerified`, 웹↔Kit 미러) — `origin`은 있는데 지금 판정 불가(권한 철회·실내 측위 실패)면 검증 가능형 라벨이 나와 **더 나쁜 상태가 더 안심시키는 역전**이 된다. 판정 결과는 **영속하지 않는다**(며칠 전 판정이 새 세션 라벨을 정하면 안 된다). ⚠ **i18n 금지 표현 게이트는 네임스페이스 내부만 보면 못 잡는다** — `manualLocation` 안만 검사하던 게이트가 `whereAmI.ready`="현재 위치"를 통과시켰다. 금지 표현 축은 **전 네임스페이스 스캔**이어야 한다. ⚠ **비-ko 병기용 라틴 표기(`labelRoman`)는 지정 시점에 저장한다**(2026-09-01, 장소=서버 `Place.nameRoman`·주소=juso `engAddr`) — 표시 때 다시 조회하면 왕복마다 값이 달라지고, 라벨은 "사용자가 그때 고른 이름"이라 그 시제가 맞다. 표시줄은 `useManualLocationBilingual`(검증 가능/불가 판정은 `useManualLabelFormatter` 한 곳을 그대로 지난다)을 쓰고, iOS 미러는 `DirectionsEndpoint.place(labelRoman:)`(지정 화면이 싣는다) → `ManualLocation.labelRoman` → `manualLocationLabel(store, accessible:)` 한 함수(표시줄·길찾기 출발지 필드 공용, 2026-09-02)이며, 판정선이 갈리지 않는지는 `manual-location-copy.test.ts`가 훅 **계열** 정규식으로 스캔한다 — 훅 이름 하나만 검사하면 훅이 갈라지는 날 표시줄이 조용히 스캔 밖으로 빠진다.

### 값을 특정 경로에서 배제할 때 1선은 구조, 2선은 소스 가드, 브랜드 타입은 3선이다

**값을 특정 경로에서 배제할 때 1선은 구조, 2선은 소스 가드, 브랜드 타입은 3선이다**(2026-08-09 실측으로 순서 정정). 실시간 안내가 수동 좌표를 못 보게 만든 실제 방어선은 **진입점이 좌표를 아예 주입받지 않는 구조**였다(`useRouteGuide(dest, kind, accessible)`에 좌표 인자 없음, `BeaconModel.toggle()`도 origin 없음). ⚠ **브랜드 타입은 함수 바꿔치기를 못 잡는다** — `awaitRealFix`를 `awaitEffectiveLocation`으로 바꿔도 반환형에 `lat`/`lng`가 있어 `fix.lat`이 그대로 컴파일된다. 그 회귀를 잡는 것은 소스 가드다("타입이 정본, 스캔은 보조"는 틀렸다).

### 런타임 판정이 있는 자리에 상시 고지 문장을 얹지 않는다

**런타임 판정이 있는 자리에 상시 고지 문장을 얹지 않는다**(2026-08-15). 안내 시트가 "화면이 꺼지면 안내가 멈춥니다"를 **조건 없이** 띄우고 있었는데, 백그라운드 모드가 정식판에 들어가는 순간 그 문장이 거짓이 됐다. 문제는 문구 하나가 아니라 **계층이 겹친 것**이다 — 앱은 백그라운드 가청 여부를 이미 런타임에 판정하고(`BeaconTonePlayer.isBackgroundAudible`) 거짓일 때만 `soundDegraded` 행을 띄운다. 정확한 층이 이미 있고 조건까지 맞는데, 그 위에 "언제나 참인 척하는" 문장이 얹혀 있었다. **플랫폼 능력이 바뀌면 조건부 문장은 따라 움직이고 상시 문장만 거짓으로 남는다.** ⚠ 그리고 그 거짓은 **잠금 화면에서 걸을 때만** 드러나므로 리뷰·테스트·전경 시험이 전부 통과시킨다 — 가드가 그 삭제를 지킨다(`guidance-gate-drift.test.ts`). ⚠ 웹은 브라우저 탭이 실제로 백그라운드에서 멈추므로 같은 문장이 참이다 — **같은 문자열이라도 플랫폼마다 참·거짓이 갈리니 삭제 범위를 소비자 기준으로 자른다.**

### 스크린리더 통지에 뻔한 꼬리 문장을 넣지 않는다

**스크린리더 통지에 뻔한 꼬리 문장을 넣지 않는다**(2026-08-02 전수 정리, 35건 잔여). 판정선은 **"뒷문장이 새 정보를 주는가"**다. 제거: "잠시 후 다시 시도해 주세요"(실패했으면 재시도는 자명)·"목록에서 선택해 주세요"·"다른 검색어로 시도해 보세요"·"실제 경로는 길찾기 앱을 이용하세요"(잉여인 데다 **타 앱 사용 권유로 읽힌다**). 유지: 원인·조건·한계를 알리는 문장("위치 권한을 확인해 주세요"·"다른 앱이 사용 중인지"·출처 주석의 커버리지 한계·"기존 정보를 유지합니다" 3-state 신호). ⚠ **잉여가 항상 뒤에 오는 건 아니다**(`offline.body`는 heading이 이미 상태를 말해 첫 문장이 잉여였다). 패턴 정규식으로 훑지 말고 **여러 문장인 문자열 전부**를 놓고 판정할 것(정규식 스캔이 "이용하세요"를 놓친 실사고).

### "내 주변" 장소 목록 5종(소아 진료·둘러보기·아이 놀 곳·무장애·문화행사)은 "더 보기" 단계 공개

**"내 주변" 장소 목록 5종(소아 진료·둘러보기·아이 놀 곳·무장애·문화행사)은 "더 보기" 단계 공개**: 클라 10건 초기 표시 + 회당 +10, 라벨은 수치 없는 `actions.showMore`. 소아 진료만 `limit` 없이 provider `SERVER_CAP=50` 상시이고, 나머지 4종 라우트는 **기본 응답 상한 유지 + 옵트인 `limit`(1~50, 범위 밖 400) + 절단 전 `total`** — limit 미지정 소비자(CLI/MCP)의 출력 팽창을 막고 "더 보기"를 구현한 웹·iOS만 `limit=50`을 명시 요청한다(웹 `NEARBY_LIMIT_MAX` ↔ Kit `fetchLimit` 미러). 포커스 계약: 누르면 첫 새 항목으로 이동하고 **별도 live region·통지 금지**(웹은 `useLayoutEffect` 페인트 전 재포커스, iOS는 `scrollTo` 선행 가시화+`AccessibilityFocusState`). **정본은 `NightClinicsNearby.tsx`·`ClinicNearbyView.swift`.** 교통 목록·보행 인프라·랜드마크는 절단 너머가 행동을 바꾸지 않아 의도적 비적용.

---

## 검색·딥링크·i18n

### 검색창 3섹션 결정론 병렬

**검색창 3섹션 결정론 병렬**: 장소(`/api/places`)+주소(`/api/address/search`)는 **매 검색 병렬**, 웹 검색은 **둘 다 0건일 때만 폴백**. 섹션 순서는 건수 내림차순(`orderResultSections`), 통지는 단일 polite 합산(`combinedLiveMessage`), 포커스는 전부 settled 후 1회. 비용 방어는 IP 레이트리밋(60초 30회)+쿼리 1h 캐시(실패는 throw로 캐시 회피). ⚠ **부활 금지 3종**: Gemini 자연어 라우터(deterministic 위에 LLM을 얹어 멀쩡한 쿼리를 악화 — [[gildongmu-search-router-removed-llm-antipattern]]), 명소 별도 섹션(정확도순 전환으로 랜드마크가 자연 부상해 중복이 됐다), 장소 결과의 버킷 섹션 그룹핑(고정 서열이 정확도 1위를 최하단 '기타'에 매몰시킨 실측 6사례). 결과는 항상 **정확도순 플랫 리스트**이고 버킷(`category.ts` ↔ Kit `SearchFilters.swift`)은 **칩 필터 축으로만** 쓴다 — **분류는 순위를 결정하지 않으며 'other'는 실패가 아니라 솔직한 잔여 라벨**이다. ⚠ 버킷 정규식은 부분 문자열 오탐 이력('문화'→사진관, '미술'→공예공방)이 있으니 수정 시 실측 카테고리로 검증. 카카오·네이버 중복은 `mergePlaces`가 흡수.

### 딥링크는 장소 상세의 보조 출구다

**딥링크는 장소 상세의 보조 출구다**: `nmap://`(`deeplink.ts`)·`kakaomap://`(`deeplink-kakao.ts`)는 장소 상세에만 있고 길찾기 화면에는 두지 않는다(E17 폐기 2026-08-23). 종전 "실주행은 딥링크 위임, 자체는 텍스트 브리핑만" 방침은 2026-08-23 K2로 폐기됐다 — 도보·자동차·대중교통 셋 다 자체 실시간 안내를 가지며(자동차·대중교통은 실험판 봉인), "출발 전 미리 듣기" 텍스트 브리핑은 그 앞 단계다. **브리핑 진입점은 길찾기 뷰(웹 `DirectionsView`·iOS `DirectionsTab` 3수단 비교)와 채팅 렌더 카드로 일원화**(2026-07-30) — 장소 상세의 단일 수단 브리핑 진입점은 중복이라 제거했고 재도입 금지. 대중교통 대안은 요약 라벨 disclosure(웹 `aria-expanded`·iOS `DisclosureGroup`)로 펼침, 펼침 본문은 `includeSummary=false`로 구간만(라벨이 요약 전문이라 인접 중복 금지, 실기기 VO 합격 2026-07-30). 웹 도보도 `shortest`가 있을 때 같은 2행 disclosure(추천·최단, 2026-08-23 B9 ①)이고 `stepFreeNotice`는 両행 라벨에 병기한다 — 서버 `withStepFree`가 비기하 응답에 그 문장을 **스텝 0으로 삽입하고 경유지 인덱스를 +1 밀어 두므로**, 본문에서 그 스텝을 뗄 때(`WalkRouteResult omitNoticeStep`) 인덱스를 한 칸 되돌려야 "경유지 도착" 구획이 제자리다. `alternatives=1`은 `walkRouteUrl` 인자가 아니라 `DirectionsView`가 덧붙인다(실시간 안내의 `includeGeometry=1`과 조합하면 400). 경로 렌더 카드는 웹 전용, iOS 채팅은 산문이 정본(렌더 3종: places·addresses·webResults, 그 외 타입은 `.unsupported`로 강등).

### 수량 문구는 ICU plural이고 iOS는 카탈로그의 ICU 블록을 Kit 해석기가 푼다

**수량 문구는 ICU plural이고 iOS는 카탈로그의 ICU 블록을 Kit 해석기가 푼다**(A29, 2026-08-31, spec `2026-08-31-plural-forms-design.md`): 수 뒤에 굴절하는 명사가 오는 en·es·fr·it 문장은 `{count, plural, one {# place} other {# places}}`로 쓰고(ko·ja는 `{count}` 그대로, 판정 단위는 키가 아니라 **로케일별 문장** — en "Top {count}"는 굴절이 없고 es "{count} lugares"는 있다), 회피 표기 `(s)`·`/i`·`is/are`는 쓰지 않는다(SR이 "device s"로 읽는다). `messages-to-xcstrings.mjs`는 그 블록을 `{N, plural, one {…} other {…}}`(이름 → ko 등장 순서 인덱스, `#` → `%N$@`)로 **문자열 그대로** 카탈로그에 싣고, Kit `formatLocalized`(`pluralCategory` + `resolvePluralBlocks` + 정수 인자 문자열화 + `String(format:)`)가 `appLocalized`·`kitLocalized` 양쪽에서 푼다. ⚠ **xcstrings 네이티브 `variations.plural`을 쓰지 말 것** — lproj로 컴파일되면 `.stringsdict`(`%#@value@`)가 되어 앱의 명시 언어 lproj 조회가 one/other 값에 닿지 못한다(실험 2026-08-31). ⚠ **수량 인자는 `Int`로 넘긴다**(`String(n)`은 해석기가 정수로 읽어 분기는 맞지만 타입이 뜻을 말하지 않는다), **plural 키를 인자 없이 조회하거나 `String(format: appLocalized(…))` 2단계로 채우지 말 것**(ICU 원문 낭독·분기 없는 치환 — `xcstrings-plural.test.ts`가 소스를 스캔하고 DEBUG는 assert). fr은 0도 `one`("0 lieu")이고 백만 단위 CLDR `many`는 문자열이 정의하지 않아 웹·iOS 모두 other다(공유 fixture `plural-category-cases.json`). 변환 스크립트는 지원 밖 ICU(select·few/many·중첩·아포스트로피 인용)를 만나면 **exit 1**이다 — 스킵된 키는 카탈로그에서 빠져 키 문자열이 낭독되는데 린터는 Swift가 참조하는 키만 잡는다. en plural 키를 더하면 `i18n-plurals.test.ts`의 count=1 골든 표에 승인 문장을 함께 적는다(구조 차이 검사는 "1 places!"를 못 잡는다).

### ko 문장의 플레이스홀더 순서는 iOS 위치 인자 ABI이고 `ios/i18n/arg-order.json`이 그것을 잠근다

**ko 문장의 플레이스홀더 순서는 iOS 위치 인자 ABI이고 `ios/i18n/arg-order.json`이 그것을 잠근다**(2026-09-02, §8 게이트): `messages-to-xcstrings.mjs`가 로케일별 `%N$@` 인덱스를 **ko 등장 순서**로 고정하므로 호출부(`appLocalized`·`kitLocalized`)는 로케일과 무관하게 ko 순서 하나만 지킨다 — ko 번역을 자연스럽게 재배열하기만 해도 호출부 인자가 뒤바뀌는데 빌드·린터·테스트가 전부 통과한다(메모리 `gildongmu-ios-i18n-architecture` 함정 6). 그래서 스크립트가 키별 순서를 manifest로 생성·대조하고 **기존 키의 순서가 바뀌면 exit 1**이다(`xcstrings-arg-order.test.ts`도 저장본 동조를 본다). ko 어순을 바꿔야 하면 그 키의 호출부 인자 순서를 같이 고친 뒤 `node ios/scripts/messages-to-xcstrings.mjs all --update-arg-order`로 manifest를 갱신한다 — 플래그 없이 통과시키는 길은 없다. 신규 키·사라진 키는 자동 반영(계약의 생성·소멸이지 변경이 아니다 — 그래서 **키 개명은 게이트 밖이다**: 개명하며 ko 어순을 바꾸면 "제거 1·등록 1"로 통과하니 개명 때는 호출부 인자 순서를 눈으로 본다). 인자 없는 키는 manifest에 없다(0 → 1인자는 호출부가 어차피 바뀐다). ⚠ 인자를 문장 **중간**에 더하는 것도 순서 변경이다(뒤 인자 인덱스가 밀린다). 게이트는 카탈로그를 쓰기 **전에** 돌아 실패하면 두 카탈로그 다 그대로이고, manifest가 없을 때의 부트스트랩도 플래그로만 한다(지우고 재생성하면 재기준선이 되므로). manifest는 앱·Kit 두 타깃 공용 한 벌이라 같은 키가 extra 오버라이드로 타깃마다 순서가 다르면 생성이 throw한다.

### 데이터 언어 분리

**데이터 언어 분리**(`src/lib/data-locale.ts`): 외부 API는 ko/en만 제공 → 비한국어(en/es/fr/it/ja)는 영문 데이터 공유. **외부 fetch·영문 분기에 `useLocale()` 원시값 직접 금지, `dataLocale`/`prefersEnglish` 경유**(예외: STT Deepgram은 es/fr/it/ja 직접 인식). i18n 키 일관성은 `i18n-messages.test.ts`가 머지 게이트. 언어 선택 UI는 disclosure 메뉴(국기 이모지 금지, 각 언어 자국어 텍스트+`lang` 속성). ⚠ **iOS에서 문장 안 수치는 기기 로케일이 아니라 앱 선택 언어로 포맷한다**(`NumberFormatter.locale = Locale(identifier: AppLanguage.current)`, 매 호출 생성 — 2026-08-17 걸음 수 천 단위 구분자 실사고): `appLocalized` 문장은 앱 언어를 따르는데 숫자만 기기 로케일이면 한 문장 안에서 언어가 갈린다.

---

## 채팅

### 채팅 도구는 24개이고 목록 정본은 코드다

**채팅 도구는 24개이고 목록 정본은 코드다**(`src/lib/chat/declarations.ts`, 도구 실행은 `router.ts`의 `executeFunction`이고 `agent-loop.ts`는 그 루프다, 2026-08-23 K3로 20→24). 각 도구는 키 게이트를 통과할 때만 declaration에 오른다. ⚠ **카드 없이 산문이 정본인 도구 8종**(문화행사·날씨·혼잡도·보행 인프라·도보 경로 + K3 신규 3종: 첫차·막차·무장애 상세·정위)은 렌더 카드를 만들지 않는다. **한눈에 보기(`get_nearby_overview`)는 예외다**(2026-08-24 K4, 유라 님 리포트 — 산문 전용이던 K3 설계가 iOS 장소 카드·"장소 N곳" 헤딩·산문 블록 버튼을 통째로 지웠다. 셋 다 같은 답변의 렌더 카드 장소에서 파생되므로 카드가 없으면 본문 버튼도 없다): `assembleNearbyOverview`가 불릿과 별도로 장소 투영 `places`(불릿 순서 → 거리순, id dedupe)를 내고 라우터가 `{type:"places"}` 카드로 싣는다 — props-driven 카드라 지명·앵커 조회에도 낸다(self-fetch 카드 금지는 좌표가 어긋나는 카드에만 걸린다). wire(`/api/nearby/overview`)엔 싣지 않는다. 불릿당 명명 수는 고정 2가 아니라 `overviewNearestCap(count)` 계단식(<5: 2 · 5~9: 3 · ≥10: 4)이고 웹·iOS 둘러보기·채팅이 한 조립을 쓴다. **지명(`place`)·장소 앵커 조회는 기기 위치 self-fetch 카드(`subway-nearby`·`clinics-nearby`·`barrier-free-nearby`·`kids-nearby`·`surroundings-nearby`)를 내지 않는다** — 카드가 산문과 다른 좌표를 보여 주면 SR 사용자에겐 반증 채널이 없다(`placeMode` 판정, `place-arg-tool.test.ts`). 지명→좌표는 `resolveCoord` 한 곳(카카오 키워드 1위)이고 **해석된 장소를 `resolvedPlace`로 data에 되돌린다** — "후쿠오카"가 대구의 동명 가게로 풀린 실측(2026-08-23)이 있어 조용한 대체가 거짓 답이 된다. 해석 실패는 현재 위치로 폴백하지 않고 `placeNotFound`(위치 부재 문구와 다른 문구 — 같으면 사용자가 권한을 의심한다). 길찾기 `via`도 같은 원칙이고 대중교통은 ODsay 미호출 `unsupported:"waypoint"`(route:null만 주면 "경로 없음"으로 낭독돼 거짓). 공기질·날씨 declaration은 긍정 트리거("직접 질문·야외 활동 적합성일 때만")로 과잉 조회를 억제하되, **공기질 호출 시 `get_weather` 동반**을 공기질 쪽에 명시한다 — 날씨 쪽 트리거 문구만으로는 동반이 성립하지 않았다(실측). `get_walk_infrastructure`는 무키라 게이트가 없고 서비스 계층만 호출한다. `get_bus_route`는 V1 제외.

### 모델 교체는 `npm run eval:ab`(스킬 공통 명령, `test:ab`와 동일 — 실호출 A/B 하네스 `src/__ab__`)로 판정한다 — 벤더 벤치마크로 올리지 말 것

**모델 교체는 `npm run eval:ab`(스킬 공통 명령, `test:ab`와 동일 — 실호출 A/B 하네스 `src/__ab__`)로 판정한다 — 벤더 벤치마크로 올리지 말 것.** 날조 축은 사람이 읽는 judge가 아니라 `src/__ab__/grounding.ts`가 자동 판정한다(도구 반환 JSON 대비 답변 엔티티 대조 + 강등 전용 어휘, `safety` 케이스는 REPS회 전부 통과 pass^k가 게이트, 머지 게이트 `grounding.test.ts`). 케이스 스키마·리포트 6항은 스킬 `llm-model-eval`이 정본. 프로덕션 systemInstruction·도구 선언·`runAgentLoop`를 그대로 태워 도구 선택·지연·토큰·산문을 비교한다(⚠ systemInstruction 정본은 `src/lib/chat/system-instruction.ts` 하나다 — 라우트·하네스 어디에도 복제하지 말 것. 사본을 두면 한쪽만 개정됐을 때 A/B의 전제가 조용히 무너진다)(구글이 내세우는 축은 코딩·장기 에이전트라 우리 부하와 다르다 — 2026-08-15 3.7-flash가 그 벤치마크 우위에도 날조 축에서 회귀해 기각됐다, `docs/BACKLOG.md` C5). ⚠ **비용 비교 시 `candidatesTokenCount`에 `thoughtsTokenCount`를 더해야 한다** — 요금은 "thinking 포함 출력"인데 두 필드는 분리돼 있어(`total = prompt + candidates + thoughts`, 실측 확인) 빼먹으면 thinking을 적게 쓰는 모델이 되레 비싸 보인다.

### iOS 채팅 AI 동의 게이트(App Review 5.1.2(i), 2026-07-21)

**iOS 채팅 AI 동의 게이트(App Review 5.1.2(i), 2026-07-21)**: 미동의 시 채팅 탭·장소 sheet가 `ChatConsentView`로 대체되고 `ChatModel.send`도 `AIChatConsent.granted` 가드로 전송을 구조 차단(이중 방어) — 채팅에 새 전송 경로를 추가하면 이 가드를 우회하지 않는지 확인. 철회는 설정 "AI 채팅" 토글. `/api/chat`엔 IP 레이트리밋(60초 10회, `checkChatRateLimit`). **follow-up 칩**(`/api/chat/suggestions`, 2026-08-24 dodo 이식)은 답변당 1회 경량 호출이라 **별도 리밋**(60초 20회)이고 실패·키 없음은 200 `{suggestions: []}`(칩 부재는 정상 상태). 구성은 2개 자연 연속 + 1개 뜻밖(앱이 답할 수 있는 범위로 제한 — 못 답하는 칩은 SR 사용자에게 헛걸음). ⚠ `gemini-3.6-flash`는 `thinkingBudget: 0`을 400으로 거부한다 — `ThinkingLevel.LOW`. 칩 탭은 칩이 사라지기 전에 보내기 버튼으로 포커스를 선점한다(웹 `sendButtonRef`, iOS는 `questionRevision`이 덮는다).

---

## WebMCP 도구층

### 도구 목록 정본은 코드다

**도구 목록 정본은 코드다**(`src/lib/webmcp/manifest.ts` — `describe_app`·`search_places`·`get_place_info`·`plan_directions`·`get_transit_route_detail`·`get_route_steps`·`read_current_view`). **루트 `PlaceSearch`가 마운트 1회 상시 등록**(`useWebMcpTools`, 뷰 전환에 재등록 0, 런타임 부재는 침묵). 가용하지 않은 도구도 등록하고 실행 시 `notConfigured`다. 화면별 등록·진입 전용 `open_*` 도구·`focus_item`·안내 세션 도구는 W2에서 삭제됐고 `webmcp-removal.test.ts`가 재발을 막는다 — **도구가 필요한 화면으로 스스로 옮긴다**(`ensure-view.ts`: 홈은 `toHome` 유한 언와인드, 상세는 `requestOpenPlace`, 길찾기는 `openDirections(null)` — 전부 화면이 원래 쓰는 핸들러).

### 장소 정보 축은 화면 소유 명령이다

**장소 정보 축은 화면 소유 명령이다**(`place-axes.ts` + `useAxisSource`): `PlaceDetail`이 축 엔트리 6개를 만들고 `present`를 **props에서 게시 시점에 확정**한다(자식 attach 여부가 아니다 — 게시 직후 미등록 창의 거짓 `notConfigured` 차단). 역 섹션은 `load(force, source)`를 채워 넣을 뿐이고 `source:"tool"`은 **헤딩 착지만** 건너뛴다. 정착은 명령 시점 세대에 결박되며 `gen < 기대`는 커밋 전 대기, `>`는 `superseded`, `=`일 때만 status를 본다 — ⚠ **마운트 축의 초기 `loading` 세대는 마운트 로드 세대(1)와 같아야 한다**(다르면 게시 직후 첫 `ensureLoaded`가 거짓 `superseded`, 리뷰 실측). ⚠ 정착 통지는 부모 effect가 아니라 **자식이 자기 status 커밋 뒤** 낸다(자식 setState는 부모 effect를 돌리지 않는다). ⚠ 레지스트리는 `useMemo`라 StrictMode 이중 effect에서 `arm()`으로 재무장한다(안 하면 dev에서 전부 `aborted`). `refresh`는 직전 데이터를 유지한 채 재조회하고 실패는 `refreshError`다. 사용자 클릭은 종전대로 `load(false,"user")`이고 `force`는 도구 refresh 전용이다(사용자 새로고침 실패가 "직전 데이터+ready 통지"로 위장하지 않게).

### 출력은 `finish(value, SHAPE)`만 지난다

**출력은 `finish(value, SHAPE)`만 지난다**(`output.ts`): allowlist에 좌표성 키가 없고 `assertNoCoordinates`가 값 안의 좌표(쿼리 이름·JSON 키·십진 쌍·URL 경로 쌍·2원소 배열)를 잡는다. 1,500자 상한은 **항목 단위 생략**뿐이고 문자열을 자르지 않는다. `get_place_info`는 축 순서(`arrivals.items → facilities.metro.groups → facilities.korail.lines → timetable.lines → basic.stationMeta.lines → barrierFree.facilities`)로 빼고, 단일 축 + `offset`(0도 페이징이다)이면 page 모드로 전량 회수가 가능하다. 정착 데이터의 재직렬화는 fetch가 아니라 예산(`tool-budget.ts`)을 쓰지 않는다. 예산 버킷은 upstream 단위다 — 한 축이 upstream 둘을 부르면 버킷도 둘(`stationFacilities`·`stationFacilitiesMetro`, 안 나누면 첫 호출이 항상 `partial`, W2-B1 2026-08-30). `search_places.web[].url`은 origin+path만이고 path에 좌표쌍이 있으면 키를 뺀다.

### 사람 문장은 화면과 같은 함수에서 나온다

**사람 문장은 화면과 같은 함수에서 나온다**: 역·무장애 줄은 `src/lib/place-lines/*`(컴포넌트와 도구 공용, `t`는 화면이 넘긴다 — 소스가 `data`에 줄을 실어 도구는 i18n을 모른다), 스텝은 `src/lib/route-step-items.ts`, 대중교통 라벨은 `DirectionsView.transitRouteLabel`. ⚠ **공유 헬퍼는 컴포넌트 모듈이 아니라 lib에 둔다** — 기존 컴포넌트 테스트가 `../WalkRouteBriefing`류를 통째로 목킹하므로 그 모듈의 새 named export는 목에 없어 스위트가 통째로 죽는다(2026-08-27 실측 40건). ⚠ 렌더 대조 테스트는 동어반복이다(컴포넌트가 같은 함수를 부른다) — 문장 변이는 **리터럴 기대값**만 잡는다.

---

## iOS 빌드 구성

### 실기기 배포

**실기기 배포**: 실험판은 `CONFIGURATION=Experimental ./ios/deploy-device.sh`, **공식 번들은 `CONFIGURATION=Release ./ios/deploy-device.sh`**(2026-08-24). 환경변수 미지정이면 `Debug`인데, ⚠ **Debug는 공식 번들 ID로 설치되면서 `#if DEBUG || EXPERIMENTAL` 진단 UI(내 주변 하단 음향신호기 BLE 진단 섹션·설정의 자동차 안내 청취자·좌우 안내음 피커)를 켜므로 위원장 기기에서 "정식판에 실험 섹션이 보인다"로 나타난다**(실사고 2026-08-24 — App Store 빌드에는 없다. Release 바이너리 대조로 확인). Debug는 시뮬레이터·로컬 dev 서버 전환용이지 기기 정식판 확인용이 아니다. `deploy-device.sh`는 **세 repo 공통본**이라 구성 이름·기본값을 스크립트에 박지 않는다.

### 코드 게이트

**코드 게이트**: `AppConfig.experimentalGuidanceEnabled`가 `#if EXPERIMENTAL`로 갈린다(자동차·대중교통·간략 단독 진입 봉인. 도보는 2026-08-15 졸업해 플래그를 보지 않는다). 같은 자리의 `experimentalTabOrderEnabled`(2026-08-23 K1)는 탭 순서·기본 탭(실험판 검색 - 길찾기 - 내 주변 - 채팅 / 정식판 채팅 첫 탭)을 `AppTab.order`로 가른다 — 판정 뒤 졸업 또는 삭제. 실험 기능을 새로 넣을 때도 같은 자리에 플래그를 두고, **기능이 검증되면 `#if`를 지운다(플래그 졸업)** — 안 지우면 플래그가 쌓인다. 항상 참인 상수(`walkGuidanceEnabled = true`)를 남기는 것이 바로 그 쌓임이라, 졸업은 검사 **삭제**로 한다.

### 봉인의 판정 축은 플래그 참조 목록이 아니라 세션을 시작시키는 호출 전수다

⚠ **봉인의 판정 축은 플래그 참조 목록이 아니라 세션을 시작시키는 호출 전수다**(2026-08-15). 둘은 같은 집합이 아니다 — 참조 중 일부는 진입점이 아니고(사전 고지 문구), 반대로 진입점인데 플래그를 안 보는 자리가 있다(실패 뒤 재시작). 그래서 가드가 `beacon.toggle(`·`beacon.restart(`·`session.startBeacon(`·`self.startBeacon(` **네 형태의 호출 수**를 세고(현재 8곳 — 2026-08-23 K2 자동차 종료 화면의 도보 인계 `acceptCarWalkHandoff`가 7번째, 2026-08-30 A25 승차 전 도보 `GuideSession.startTransit`의 `startBeacon`이 8번째), 늘면 실패해 spec 표를 갱신하며 정식판 도달 여부를 판정하게 한다(`src/lib/__tests__/guidance-gate-drift.test.ts`). ⚠ `restart`가 목록에 있는 이유가 바로 위 "실패 뒤 재시작"이다 — A13이 그것을 더했을 때 `toggle`만 세던 검사가 새 진입점을 통째로 놓쳤다. 게이트 property만 검사하면 새 진입점을 영영 놓친다.

### `INFOPLIST_KEY_*` 빌드 설정만으로는 구성별 분기가 안 된다

⚠ **`INFOPLIST_KEY_*` 빌드 설정만으로는 구성별 분기가 안 된다.** `InfoPlist.xcstrings`의 로컬라이제이션이 그 값을 **이긴다**(실측). 그래서 표시 이름은 빌드 페이즈 `ios/scripts/experimental-infoplist.sh`가 컴파일된 `*.lproj/InfoPlist.strings`를 후처리한다. 그 스크립트는 **접미사가 실제로 붙었는지 다시 읽어 확인**하고 하나라도 실패하면 빌드를 멈춘다(2026-08-15 개정 — 종전 파일-존재 카운트는 추출 실패·replace 실패를 성공으로 셌다. 스크린 리더 사용자에게 표시 이름은 두 앱을 구분하는 유일한 수단이라 조용한 실패가 곧 접근성 결함이다). **구성별로 달라야 하는 Info.plist 값은 종류로 경로를 가른다**(2026-08-06 정정 — 종전 "스크립트에도 넣는다" 지침은 로컬라이즈 문자열에만 참): 로컬라이즈 문자열(표시 이름·권한 문구)은 그 스크립트, **비로컬라이즈 키(`UIBackgroundModes` 등)는 `Support/Info-Experimental.plist`**(Experimental의 `INFOPLIST_FILE` 분기, `Support/Info.plist`와 수동 동기화). 비로컬라이즈 키는 스크립트 후처리로 못 넣는다 — `ProcessInfoPlistFile`이 스크립트 **뒤에** 매 빌드 실행돼 덮어쓰고, `INFOPLIST_KEY_UIBackgroundModes` 같은 설정은 존재하지 않아 조용히 무시된다(둘 다 산출물 실측).

### 두 plist 계약의 의도된 예외: Bluetooth 권한 문구와 CoreBluetooth 심볼

⚠ **두 plist의 "공통 항목은 양쪽에" 계약에는 의도된 예외가 하나 있다**(2026-08-17): `NSBluetoothAlwaysUsageDescription`은 `Info-Experimental.plist`에만 있다(음향신호기 BLE 진단이 `#if DEBUG || EXPERIMENTAL` 안이라 정식판은 그 권한을 쓰지 않고, 쓰지 않는 권한 선언은 심사 신호이자 개인정보 3자 일치의 근거 없는 확장이다). 정식 plist로 복사하면 `check-release-artifact.mjs`가 제출을 막는다. ⚠ **문구를 빼는 것만으로는 부족하다 — Apple은 plist가 아니라 바이너리의 CoreBluetooth 심볼 참조를 보고 문구를 요구한다**(ITMS-90683, 1.8~1.10 네 빌드 연속 경고, 2026-08-20 정정). 그래서 전송 층 `AudioSignalController`는 Kit이 아니라 앱 타깃 `#if DEBUG || EXPERIMENTAL` 안에 있다(SPM 패키지는 Experimental 구성을 모른다). `check-release-artifact.mjs`가 정식 실행 파일의 `otool -L`에서 CoreBluetooth를 잡는다. **Kit에 `import CoreBluetooth`를 넣지 말 것.** 부수 효과: **Debug 구성은 정식 plist를 쓰므로 진단 섹션이 보여도 스캔이 열리지 않는다**(번들 키 런타임 가드) — BLE 실측은 반드시 Experimental로. 그리고 진단 모델의 `shutdown()`은 **화면 수준 `onDisappear`**에만 건다 — List 안 Section에 걸면 lazy 렌더라 아래로 스크롤하는 순간 스캔·연결이 죽는다(`DirectionsTabView` 동형).

### 졸업 때 옮겨야 하는 것은 코드 게이트만이 아니다

⚠ **졸업 때 옮겨야 하는 것은 코드 게이트만이 아니다** — 실험판 plist에만 있던 **백그라운드 모드를 정식 plist로 함께 승격**하지 않으면 빌드는 성공하고 **전경에서는 완전히 정상인데 화면을 끄면 안내가 죽는다**(2026-08-15). 손에 들고 하는 시험은 이 계열을 통과시킨다. 소스 검사도 부족하다(대상이 다른 `INFOPLIST_FILE`을 참조하거나 병합에서 누락되는 경우를 못 잡는다) — **산출물의 최종 `Info.plist`를 직접 읽는 것**이 유일한 검출이라 `ios/scripts/check-release-artifact.mjs`가 제출 직전에 돈다.

### 새 게이트는 그것을 실제로 부르는 경로로 한 번 밟아 본다

⚠ **새 게이트는 그것을 실제로 부르는 경로로 한 번 밟아 본다**(2026-08-15). 위 산출물 검사가 1.7 제출을 두 번 막았는데 **둘 다 검사 자신의 결함**이었다: ①ASC `versionString`(`1.7`)과 산출물 `CFBundleShortVersionString`(`1.7.0`)을 문자열 완전 일치로 비교 ②`asc-submit`이 경로 없이 넘기는 `--expect-version 1.7`의 값을 산출물 경로로 오인. 둘 다 **손으로 인자를 주면 통과하고 `asc-submit`이 부르면 항상 실패**하는 조합이라, 도입 마일스톤의 리뷰·테스트·수동 실행이 전부 통과시켰다. 게이트는 "있다"가 아니라 "그 자리에서 돈다"가 성립해야 게이트다.

---

## CLI/MCP 릴리스

### 릴리스 절차: 버전 4곳 + CHANGELOG 2곳 동조 갱신

릴리스 절차: **버전 4곳 + CHANGELOG 2곳 동조 갱신**(두 `packages/*/package.json` + 두 `src/index.ts` 선언 — CLI는 citty `meta.version`, MCP는 `McpServer` version — + 두 `packages/*/CHANGELOG.md`에 그 버전 항목) → 커밋 → `git tag cli-v<버전> && git push origin main --tags`. ⚠ index.ts 버전은 하드코딩이라 package.json만 올리면 **발행본이 옛 버전을 보고한다**(0.6.0 tarball이 `--version`·MCP `serverInfo.version` 모두 0.5.0을 출력한 실사고 2026-07-31). `version-drift.test.ts`가 두 패키지에서 셋 다 강제한다(버전 일치·CHANGELOG 항목 존재·`files` 포함).

### `lang` 같은 선택 파라미터는 카탈로그가 정본이고 인자 선언·전달 판정이 같은 술어를 쓴다

**`lang` 같은 선택 파라미터는 카탈로그가 정본이고 인자 선언·전달 판정이 같은 술어를 쓴다**(`catalogSupportsLang`, 2026-09-01 E26). 카탈로그 params에 한 줄 더하는 것이 **곧 MCP 도구 입력 스키마**다(도구는 params에서 자동 생성). CLI 쪽은 함정이 둘이다: ①`runEndpoint`의 `lang`은 **기본값 없는 필수 인자**여야 한다 — 생략을 허용하면 인자를 빠뜨린 호출이 조용히 컴파일되고 사용자는 영어를 요청한 채 한국어를 받는다(오류도 빈 결과도 아니라 반증 채널이 없다) ②`sharedArgs`에 blanket으로 붙이면 서버가 그 파라미터를 모르는 명령의 `--help`까지 옵션을 광고하고 실행 시엔 조용히 버린다 — 받는 명령에만 spread한다(`langArgs`). 값은 정규화하지 않고 그대로 보낸다(오타는 라우트 400이 정직하다, `--accessible` 동형) — `/api/route/car`(`langParam()`)·`/api/chat`(지원 6로케일 enum, 400 `invalid_locale`)도 2026-09-02부터 검증하므로 `lang`을 받는 전 라우트가 미지 값을 400으로 거절한다. ③`search`·`station info`처럼 여러 조회를 `allSettled`로 묶는 명령은 **400을 즉시 종료로 가른다** — 400은 부분 실패가 아니라 요청이 틀렸다는 뜻이라 흡수하면 섹션이 통째로 사라진 exit 0이 되고, 사용자는 0건인지 거절인지 구분할 수 없다(502는 부분 성공 유지). ⚠ **텍스트 포매터의 라벨·조사는 한국어 고정이라 `--lang en`이 바꾸는 것은 서버가 쓴 문장과 `*En` 필드뿐이다** — 그 경계를 `--help`와 README에 적어 두었다(포매터 i18n은 별개 마일스톤).
