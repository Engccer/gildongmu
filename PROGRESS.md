# PROGRESS — 길동무 (gildongmu)

> 마일스톤 상태·실호출 검증 로그·미해결 결정을 담는다. **항구 규칙/패턴은 `CLAUDE.md`**, 설계·검증 정본은 `docs/superpowers/specs`(26개)·`plans`(20개). 이 파일은 "지금 무엇이 동작하고, 무엇이 막혀 있고, 다음은 무엇인가"만 추적한다.

## 운영 중인 기능 (실호출 검증 완료)

| 도메인 | 상태 | 비고 |
|---|---|---|
| CLI(`gildongmu`)+MCP(`gildongmu-mcp`) | 운영(npm 발행 완료 2026-07-16) | 씬 클라이언트(REST 카탈로그 22항목 중계). 스펙 `docs/superpowers/specs/2026-07-15-cli-mcp-design.md`. **실호출 검증(프로덕션)**: search 경복궁(명소 5 최상단+장소 15+주소 10, JSON 모드 동작)·nearby subway 강동역(실시간 도착 산문)·route transit 강동역→서울역(추천+대안, legs)·weather/air 길동(등급 단어)·station info 서울역(3섹션 병렬)·whereami·chat 단발(약국 5건)·MCP stdio(tools/list 22, nearby_subway 실도착 4건). 게이트가 실결함 3건 검출·수정: 장소명 지오코딩 폴백(/api/geocode는 주소 전용 → /api/places 2단 폴백), nearby류 지오코딩 실패 스택 노출 제거, station-meta "서울역역" 접미 중복. **npm 발행(2026-07-16)**: `gildongmu@0.1.0`·`gildongmu-mcp@0.1.0` 로컬 발행(웹 2FA·Windows 원격 브라우저 인증), 両패키지 Trusted Publisher(Engccer/gildongmu·cli-publish.yml·npm publish) 등록 완료 — 이후 릴리스는 `cli-v*` 태그 push 자동발행(파이프라인 실증은 차기 릴리스). 글로벌 설치 스모크: `npm i -g gildongmu` 후 `gil search 경복궁` 실왕복 PASS |
| 장소 검색 (카카오 좌표 거리순) | ✅ prod | 2026-06-24 길동 "맥도날드"→강동구 지점 1~6위 |
| 검색창 3섹션 병렬 (장소+주소+웹 0건폴백) | ✅ prod | 2026-06-27 LLM 라우터 폐기 후 결정론 전환 |
| 관광지·명소 섹션 (랜드마크 정확도순 병치) | ✅ prod | 2026-07-01 "경복궁"→명소 섹션 최상단 1위=진짜 경복궁, 카페→0건. category_name 계층 필터(AT4 아님). ko=kakao 정확도순, en=TourAPI contentTypeId=76(영문명)+좌표시 거리순(먼 동명 배제) — 디스패처 `attractions.ts` |
| en 장소 병합 (카카오+TourAPI, juso 영문주소) | ✅ prod | 2026-06-19 |
| 주소·우편번호 검색 (juso) | ✅ prod | 2026-06-19 `JUSO_CONFM_KEY` 등록+배포 |
| 역 교통약자 편의시설 (코레일 406역) | ✅ | 2026-06-14 |
| 서울 지하철역 교통약자 시설 (9 오퍼레이션) | ✅ | 2026-06-17 강동·신도림·서울역 |
| 전국 도시철도역 메타 (정적 seed 1,098역) | ✅ | 2026-06-17 |
| 서울 지하철 실시간 도착 (역상세 + 내주변) | ✅ prod | 2026-06-17 `SEOUL_SUBWAY_REALTIME_KEY` |
| 시내버스 (TAGO 지방 + 서울 TOPIS 병합) | ✅ prod | 2026-06-24 서울 키 전파 9일째 완료 |
| 따릉이 공공자전거 | ✅ | 2026-06-16 |
| 내 주변 소아 야간·휴일 진료 (NMC) | ✅ | 2026-06-17 |
| 이 지역 공기질·날씨 (에어코리아+기상청) | ✅ | 2026-06-20 활용신청 승인+검증 |
| 근처 아이 놀 곳 (카카오 화이트리스트) | ✅ | 2026-06-18 |
| 내 주변 둘러보기 (카카오 카테고리+8방위) | ✅ | 2026-06-20 |
| 현재 위치 정위 카드 (where-am-i) | ✅ prod | 2026-06-28 |
| 자동차 경로 브리핑 (ko 카카오 / en NCP) | ✅ | 2026-06-17 |
| 대중교통 길찾기 (ODsay) | ✅ prod | 2026-07-04 URI(referer) 식별 전환 — 길동→강남 prod 실호출 검증. 아래 해소 기록 |
| 음성 받아쓰기 (Deepgram nova-3) | ✅ prod | 2026-06-19 키 401 사고 복구 |
| PWA (수제 서비스워커) | ✅ prod | 2026-06-21 |
| 채팅 (Gemini FC 15도구 + Perplexity 웹) | ✅ prod | 2026-06-21 장소별 진입 재배치, 2026-06-30 무장애 도구 추가(게이트) |
| 미지원 언어 첫 방문 en 폴백 (proxy Accept-Language 치환) | ✅ prod | 2026-07-03 ja/zh→/en 확인, ko·fr·en·헤더없음(ko)·쿠키 우선순위 기존대로 — 커밋 3abf158 |
| 무장애 여행 정보 (한국관광공사 KorWithService2) | ✅ prod | 2026-06-30 활용신청 자동승인+실호출 검증 완료(서울도서관 130183·덕수궁 1605981). nearby·장소상세 region·채팅 도구 3계층. 라벨 실키 교정(brailepromotion 등)·값 HTML/접미 정제·매칭 50m∩이름 |
| ko 장소 병합 (카카오+네이버 지역검색) | ✅ prod | 2026-07-18 커밋 f3c0032. 발단: 여의도 "백년찌개" 검색 미노출 — 카카오 로컬 DB에 어떤 상호 변형으로도 미등록(커버리지 공백), 네이버에만 "백년찌개집 1971" 등재. 両키 시 `searchPlacesMergedKo` 병합(allSettled 부분실패 보존, 좌표 4자리 dedupe, 좌표 시 Haversine 재정렬 — 네이버는 거리 정렬·좌표 필터 없어 전국 정확도순). **prod 실호출 검증**: 백년찌개(여의도 좌표)→両도메인 1위 백년찌개집 1971 609m·merged 10건, 회귀 맥도날드(길동)→1위 천호로데오점 837m·merged 20건. 네이버 지역검색 일 25,000회·최대 5건 |
| 커스텀 도메인 `gildongmu.dodoplanet.space` | ✅ prod | 2026-07-18 gildongmu 프로젝트에 추가(`vercel domains add`). dodoplanet.space DNS는 Cloudflare 관리인데 기존 와일드카드 CNAME(DNS-only)이 있어 레코드 추가 없이 즉시 해석·인증서 발급. 실호출 검증: 페이지(길동무 타이틀)·places(강남역 15건)·ODsay transit(국회의사당→강남 36분). **API 재신청 불필요** — 전 키가 서버 전용이고 브라우저→외부 API 직호출 0, 유일한 도메인 식별형 ODsay는 서버가 등록 Referer(gildongmu.vercel.app)를 코드로 명시 전송하므로 접속 도메인 무관 |

## 프로덕션 env 등록 현황

`vercel env ls production`으로 확인. 등록됨: `KAKAO_REST_API_KEY`, `TOUR_API_KEY`/`DATA_GO_KR_API_KEY`(동일값), `NCP_MAPS_CLIENT_ID/SECRET`, `DEEPGRAM_API_KEY`, `SEOUL_OPEN_DATA_KEY`, `SEOUL_SUBWAY_REALTIME_KEY`, `JUSO_CONFM_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `ODSAY_API_KEY`(2026-07-04, URI 앱 키 — URL 인코딩 형태로 저장), `NAVER_LOCAL_CLIENT_ID/SECRET`(2026-07-18, 네이버 개발자센터 gildongmu 앱 — 사용자 수동 발급, Claude in Chrome이 naver 도메인 차단).

⚠ **env 변경 후 반드시 재배포** — 키는 배포 시점에 함수로 주입된다(`vercel deploy --prod --yes` 또는 push). 키만 추가하고 재배포 안 하면 기존 함수는 옛 env를 본다.

⚠ **prod 키 검증은 `vercel env pull` 길이가 아니라 실호출로** — pull은 Encrypted 값을 복호화하지 않아 정상 키도 빈값으로 내려온다([[vercel-prod-env-pull-redacts-encrypted]]).

## 미해결·보류

- **iOS 네이티브 재개발(SwiftUI 전면) 진행 중, M0 완료(2026-07-06)**: spec `docs/superpowers/specs/2026-07-06-ios-native-rewrite-design.md`(사용자 승인) + M0 plan `docs/superpowers/plans/2026-07-06-ios-native-rewrite-m0.md`. 개인 기기 우선(무료 프로비저닝)·전체 기능 동등성(M0~M8)·Vercel API 전량 재사용·같은 repo `ios/`·최소 iOS 26. **M0 완료**: GildongmuKit(계약 모델·APIClient·SearchService, 테스트 12/12) + 검색 화면(3섹션+명소·포커스 이동·3-state) + Xcode 26.6 환경 + 실기기 설치(iPhone 13 Pro, Personal Team 72JQ7VD4V5 pbxproj 직접 설정으로 GUI 우회). 표시 이름 "길동무 베타"(PWA "길동무"와 구분, M8에 정식 이름 승계). 실기기 VoiceOver 게이트: 사용자 확인(헤딩 등 핵심 동작 정상, 6항목 개별 전수 검증은 생략 — 비행기모드 실패 문구·웹 폴백은 M1 게이트에서 재확인). code-reviewer 리뷰 4건 반영(URL 언래핑 크래시·allFailed 3-state·id 충돌·포커스). **M1 완료(2026-07-07 사용자 확인)**: 장소 상세(한영 주소·전화·딥링크+웹 폴백)·검색 행 VoiceOver 커스텀 액션(전화·네이버·카카오)·SectionState 3-state 정식화·AppConfig base URL 주입. Kit 테스트 17/17. plan `2026-07-06-ios-native-rewrite-m1.md`. **M2·M3 코드 완료(2026-07-07, 실기기 게이트 대기)**: M2=LocationService(권한 continuation 배열)+탭 구조+내 주변 6종(병렬 서브에이전트 3기, 규범 패턴 미러), M3=역 상세 자동 섹션 4종(heading 발견 경로)+날씨·공기질(등급 단어 정본). Kit 테스트 33/33, 리뷰 fix 3건(권한 continuation 레이스·통지 판정·재진입 가드) 반영, iPhone 설치 완료. **의도적 비수정 결정 2건**: ① 0건 완료 통지와 ContentUnavailableView 병존은 복제 아님(iOS Announcement는 일회성, 회전자 비잔존 — 웹 sr-only 복제 금지 원칙과 다른 매체) ② 평면 단일행 리스트(따릉이·키즈·둘러보기)의 항목 heading 미부여: 웹 h4 규칙의 목적(항목 단위 점프)이 1행=1객체로 이미 충족, heading 전행 부여는 잉여. plans `2026-07-07-ios-native-rewrite-m{2,3}.md`. **M4·M5 코드 완료(2026-07-07)**: M4=자동차·대중교통 브리핑(출발지=실위치 불변식, 단위 회귀 테스트, 상세에서 "미리 듣기" 진입), M5=장소 채팅 sheet(NDJSON 스트림 실캡처 fixture, status 진행 통지 ko.json 카피 미러, done 포커스 이동+햅틱, 렌더는 **props-driven 3종만**(places·addresses·web-results) 의도적 축소: self-fetch 카드류는 산문 정본+전용 화면 존재로 V1 미탑재). Kit 테스트 45/45. **실기기 설치 대기**: M4·M5 빌드는 iPhone 재연결 시(기기 unavailable). 게이트 대기 누적: M2·M3(설치됨)·M4·M5(미설치). **M6 코드 완료(2026-07-09)**: SpeechService 온디바이스 음성 인식(시작·정지 소리+햅틱)+검색·채팅 마이크 버튼(라벨 상태 신호·검색은 자동 실행), 한국어 품질 실측은 실기기 게이트. plan `2026-07-07-ios-native-rewrite-m6.md`. **M6b 웹 동등성 누락분 7건 코드 완료(2026-07-10)**: 사용자 요청("미구현 기능 파악·구현")으로 웹·iOS 전수 대조 → 로드맵(M0~M8) 어디에도 없던 진짜 누락 7건 확정 — ①무장애 관광지 내 주변(M2가 "6종"으로 계획했으나 웹은 7종) ②장소 상세 무장애 편의시설 자동 섹션(match 비-throw, false positive 무음) ③현재 위치 정위 WhereAmI(ko 산문 빌더 Kit 이식+채팅 진입) ④버스 도착 행→노선 경유 정류소 push ⑤내 주변 항목 채팅 진입(진료·키즈·둘러보기, contextMenu+로터 커스텀 액션, Place 합성 4종 헬퍼 — category가 프롬프트 라우팅 키) ⑥주소 복사 버튼(영문>도로명>지번, Announcement 통지) ⑦검색 분류·지역 2축 필터(카운트는 전체 고정·축 1개 이하 숨김)+버킷 그룹핑+보유 좌표 거리 정렬(신규 권한 요청 없음). plan `2026-07-10-ios-native-rewrite-m6b-web-parity-gaps.md`, fixture 5종 실캡처(2026-07-10). Kit 테스트 80/80, 병렬 서브에이전트 11태스크+태스크별 리뷰(fix 3라운드: 거리 km 표기 plan 리터럴 결함·재취득 실패 무신호·산문 빈 문자열 트레일링 쉼표)+a11y 감사 PASS+최종 whole-branch 리뷰(opus) "머지 가능(C/I 0)". **의도적 제외 재확인**: 채팅 self-fetch 렌더 카드류(V1 축소)·지도·PWA/SW·URL 동기화·인앱 언어 메뉴(시스템 언어 추종, M8 String Catalog). **실기기 게이트 항목(M6b)**: contextMenu+accessibilityAction 로터 중복 실측(중복이면 accessibilityAction 제거), 펼침 후 비동기 로드 통지, Dynamic Type 200%(필터 픽커·펼침). 백로그: formatDistanceKo Kit public 승격, chatLabel 공유화, 실패 announce 전 화면 일괄 검토. **부수 진단(2026-07-10 오전)**: prod 실시간 3종(TAGO·TOPIS·지하철) 일시 장애 — 서울시 계열 ConnectTimeout+TAGO 세션 고갈(upstream), 키·코드 무관, ~45분 내 자연 회복 실측. 재발 지속 시 Vercel 함수 리전 icn1 전환 검토. 다음: 실기기 일괄 게이트(M2~M6b) 후 M7 비콘(실기기 실측이 개발 루프 자체에 필요)·M8 마감(String Catalog 5개 언어·설정·아이콘·통합 VoiceOver QA).
- ~~**ODsay 대중교통 길찾기 prod 미동작**~~ → **해소(2026-07-04)**. 결정 기록(spec 생략, 이 단락이 정본): 후보 4안(Web키 referer/자가 프록시/클라 직접/유료 고정 IP) 중 **URI(도메인) 식별 + 서버 Referer 헤더** 채택(무료·최소 diff·키 서버 전용 유지, 커밋 f64831a). 시행착오 2건 — ① ODsay **apiKey는 발급 시점 플랫폼에 묶임**: 기존 Server 앱에 URI 환경을 추가해도 그 키는 referer 식별 불가(전 variant `ApiKeyAuthFailed`, 프로브 실측). **URI 전용 앱**(`gildongmuweb`, ~2027-01-04)을 새로 만들어 해결, 비화이트리스트 IP에서 referer 유/무 대조 실호출로 증명. ② 콘솔 신규 등록 404의 정체는 **앱 이름 하이픈 불가**("영문·숫자·한글만") — 에러 표시 없이 registerPay 404로 죽음. 새 키는 `+`/`/` 포함이라 **URL 인코딩 형태로 env 저장**(provider가 raw로 붙이는 계약과 정합). 기존 `gildongmu` 앱(Server·119.71.23.38)은 백업으로 보존. URI는 앱 간 중복 등록 불가.
- **둘러보기 기능 B (OSM 횡단보도·점자블록 + 음향신호기)**: 후속 마일스톤. 길동 OSM 보행 태깅 희박 확인(2026-06-20) — OSM은 카카오가 비운 칸만 채우는 보완재. 음향신호기는 OSM 공백→data.go.kr 피벗([[overpass-osm-korea-pedestrian-coverage]]).
- **idle 홈 heading 레벨 점프**: `h1`→`h3`(nearby 섹션 헤더가 h3, 상위 묶음 h2 없음). 회전자 순회는 안 막힘. 완전 정돈하려면 "내 주변" 묶음 `h2` 도입 필요 — 미니멀 UI 판단 보류.
- ~~**dodo-planet 이식**~~ → **Phase A~E 전량 이식 완결(2026-07-04, dodo Round 150~155)**. 정본 spec `docs/superpowers/specs/2026-07-03-dodo-full-port-design.md`의 이식 대상 자산 전부 dodo 합류 — 마지막 Phase E(ODsay 대중교통)는 dodo 전용 URI 앱 `dodoplanet`(www.dodoplanet.space, ~2027-01-04) 신규 등록 + 비화이트리스트 IP referer 유/무 대조 실호출 6/6 PASS로 §7.1 절차 그대로 재현(dodo `docs/plans/2026-07-04-gildongmu-port-phase-e.md`). 콘솔 신규 함정 실측 1건 추가: **URI 입력은 프로토콜 제외 도메인만** — `https://` 포함 시 에러 표시 없이 "다음"이 무반응(폼 아래 경고 문구만). gildongmu는 인큐베이터로 존속 — 신규 국내 API는 여기서 검증 후 같은 경로로 졸업.
- ~~**`DistanceBeacon` 보류**~~ → **패치·재마운트 완료(2026-07-04), 실보행 스모크 대기**. 감사로 죽은 원인 규명 후 3개 수정 + `PlaceDetail` 재마운트(route 헬퍼 그룹, 자체 geolocation 게이트라 미지원 시 null). lint·673 test·build 통과. **⚠ 최종 게이트=실기기 보행 스모크**(폰에서 장소 상세 → "거리 추적" 펼침 → 시작 → 걸으며 톤·거리 확인) — 자동 테스트로는 검증 불가, 신뢰 전 실보행 필수.
  - **감사 근본 원인(2026-07-04)**: 설계(순수 리듀서 `beacon.ts`·spec)는 건실. 죽은 원인은 훅 계층 버그 2개(최초 커밋 `fd8d0fc`부터 존재). **①치명**(수정): `useScreenWakeLock`이 매 렌더 새 객체 `{acquire,release}`를 반환(useMemo 없음)하는데 `useDistanceBeacon`의 정리 effect가 `[wakeLock]` 의존 → 렌더마다 cleanup → `start()`가 방금 등록한 `watchPosition`이 자신의 setState 리렌더에서 즉시 `clearWatch`됨(시작 톤 후 fix 0회, 영원한 침묵). → `useScreenWakeLock` 반환값 `useMemo`로 안정화(참조 동일성 3곳 동시 해소). **②2차**(수정): `routeTone` 단일 throttle을 hold tick이 점유해 closer/farther 소실 → 추세 톤/tick 독립 throttle 창 분리(`lastTrendToneAtRef`·`lastTickAtRef`). **③조사 반영**(수정): iOS 무음 스위치가 Web Audio를 침묵시키는 문제 → `useBeaconSound`의 lazy AudioContext 생성 시 `navigator.audioSession.type='playback'`(iOS 17+) 선언, 미지원 graceful.
  - **후속(미적용)**: 조사 권장 first-fix 게이팅(캐시된 첫 fix가 수백 m 튀는 문제 — 첫 판독 무시 + desiredAccuracy 도달까지 대기 + maxWait 폴백)은 `beacon.ts` 리듀서 변경+fixture 필요라 별도 처리. 백그라운드/공간오디오 승격(Capacitor+네이티브 위치 플러그인)은 dodo 이식 로드맵과 합류. 기술스택 조사 정본 `docs/RESEARCH-2026-07-04-realtime-pedestrian-nav-stack.md`.
  - **모델 계층화 교훈(횡단)**: 이 조사는 내장 `deep-research` 스킬로 돌렸는데 하위 에이전트 207회가 전량 세션 모델(Fable 5) 상속 → 12.5M 토큰 일괄 소진·세션 한도. 워크플로 `agent()`는 세션 모델 상속이 기본이고 그 스킬은 per-agent `model` 미지정이 원인. 계층화 포크 `~/.claude/workflows/deep-research-tiered.js`(scope/synthesize=opus·verify=sonnet·search/fetch=haiku) 신설 — 대량 조사 기본값. Anthropic 이슈 등록 [#74171](https://github.com/anthropics/claude-code/issues/74171). [[workflow-fanout-inherits-session-model]]

## 신규 data.go.kr API 추가 절차

같은 `DATA_GO_KR_API_KEY`로 data.go.kr 활용신청만 하면 즉시 자동승인(전파 ~5~30분, 직접호출 방식은 7일+). 서울 ws.bus.go.kr·swopenapi 계열은 별도 인증키 동기화 배치 지연 있음([[seoul-bus-datagokr-sync-delay]]).
