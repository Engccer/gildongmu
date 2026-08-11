# PROGRESS — 길동무 (gildongmu)

**지금 무엇이 동작하고, 어디까지 도달했고, 무엇이 막혀 있는가.** 이 파일은 *현재 상태*만 담는다.

| 찾는 것 | 정본 |
|---|---|
| 언제 무엇이 바뀌었나 | [`CHANGELOG.md`](CHANGELOG.md) |
| 아직 하지 않은 것 | [`docs/BACKLOG.md`](docs/BACKLOG.md) |
| 항구 규칙·패턴·함정 | [`CLAUDE.md`](CLAUDE.md) |
| 설계·마일스톤 검증 상세 | `docs/superpowers/specs`·`plans` |
| App Store 릴리스 노트·제출 절차 | [`docs/appstore/`](docs/appstore/) |

⚠ **완료된 일을 여기에 쌓지 않는다.** 마일스톤이 끝나면 그 서사는 `CHANGELOG.md`로, 남은 판정은 `docs/BACKLOG.md`로 보내고 이 파일에는 상태 한 줄만 남긴다. 이 규칙이 없던 동안 이 파일은 273KB까지 불어 "지금 상태"를 찾을 수 없게 됐다(2026-08-08 재편).

---

## 배포 현황

| 채널 | 상태 |
|---|---|
| 웹 | https://gildongmu.dodoplanet.space (push = 자동 배포) |
| iOS | **1.5 심사 중**(`WAITING_FOR_REVIEW`, 빌드 11 VALID, 제출 2026-08-11) · 1.0~1.4 `READY_FOR_SALE` |
| npm | `gildongmu` · `gildongmu-mcp` **v0.8.0** |

- iOS 심사 상태 조회: `node ios/scripts/asc-submit.mjs --check`
- 미릴리스 iOS 변경량: `git rev-list --count <직전 릴리스 커밋>..HEAD -- ios/` (숫자를 문서에 박지 않는다 — 사흘에 세 번 낡은 이력이 있다)
- **실시간 안내 계열은 iOS에서 봉인 중**이다(`AppConfig.realtimeGuidanceEnabled`의 `#if EXPERIMENTAL`). 해제 선행 조건은 코드가 아니라 판정이며 `docs/BACKLOG.md` G3·F-a가 정본이다.

---

## 운영 중인 기능

전부 프로덕션 가동 중이다. 구현 방식·함정은 `CLAUDE.md` 통합 카탈로그가, 설계는 각 spec이 정본이다.

### 검색·장소
| 기능 | 비고 |
|---|---|
| 장소 검색 | 카카오 정확도순 + 좌표 블렌딩, ko는 네이버 병합 |
| 주소·우편번호 | juso(무료·무제한) |
| 검색창 3섹션 병렬 | 장소 + 주소 항상 병렬, 웹 검색은 둘 다 0건일 때만 폴백 |
| en 장소 병합 | 카카오 + TourAPI, 영문주소는 juso → NCP 폴백 |
| 최근 검색 기록 | 검색 탭 + 길찾기 출발/도착지 |
| 길찾기 최근 경로 | 출발·도착 쌍 기록, 결과 없는 화면에 노출·활성화 시 즉시 조회(웹·iOS) |
| 현재 위치 정위 | where-am-i, 결정론 산문 |
| 현위치 수동 지정 | 장소 검색으로 직접 지정, 이동 시 자동 해제. 실시간 안내는 실좌표만 |
| 부근 상황 재구성(M1, 웹·iOS) | 입구 기준 좌우·맞은편·건물 너머, 축 실패 시 방위 폴백 (⏳ 실보행·실기기 VO 판정) |

### 교통
| 기능 | 비고 |
|---|---|
| 서울 지하철 실시간 도착 | 4-state(운행 중·운행 종료·조회 실패·정보 없음) |
| 전국 도시철도역 메타 | 정적 seed 1,098역 |
| 역 첫차·막차 시간표 | TAGO, 공휴일 보정 |
| 역 교통약자 시설 | 코레일 406역 + 서울 9종 + 음성유도기·엘리베이터 보강 |
| 시내버스 | TAGO 지방 + 서울 TOPIS 병합, 미커버 지역과 반경 밖 구분 |
| 따릉이 | 서울 |
| 도보 경로 | 카카오 기본 + Tmap 폴백, 계단 회피 모드, 서버 안내문 재작성 |
| 자동차 경로 | ko Tmap 기본 + 카카오모빌리티 폴백, en NCP |
| 대중교통 경로 | ODsay, 운행 시간 밖 강등, 최단·최소환승 축 |
| 지하철 빠른하차 | 1~8호선 하차역·방향별 계단·엘리베이터 최근접 칸·문 (⏳ 실승차 판정) |

### 생활 정보
| 기능 | 비고 |
|---|---|
| 소아 야간·휴일 진료 | 달빛 지정 명부 + 일반 소아청소년과 병합 |
| 공기질·날씨 | 에어코리아 + 기상청 |
| 실시간 인구 혼잡도 | 서울 116개 영역 |
| 근처 문화행사 | 서울, 오늘 진행 중, 반경 3km |
| 아이 놀 곳 | 카카오 카테고리 화이트리스트 |
| 내 주변 둘러보기 | 카카오 10종 + 8방위 |

### 접근성 정보
| 기능 | 비고 |
|---|---|
| 보행 인프라 | 음향신호기(서울 seed) + 횡단보도·점자블록(OSM) |
| 무장애 여행 정보 | 한국관광공사 KorWithService2 |

### 대화·음성
| 기능 | 비고 |
|---|---|
| 채팅 | Gemini function calling + Perplexity 웹 검색, 장소 앵커 |
| 음성 받아쓰기 | 웹 Deepgram / iOS 온디바이스, 탭 토글·홀드 택1 |
| 답변 듣기 | iOS 온디바이스 정본, Google TTS 폴백 |

### 실시간 길 안내
| 기능 | 상태 |
|---|---|
| 목적지 거리 추적(간략) | 웹 prod · **iOS 봉인**(실보행 통과 2026-08-02) |
| 수단별 경로 안내(상세) | 웹 prod · **iOS 봉인**(⏳ 실주행·실승차 판정) |
| 최종 접근(경로 종점→목적지 오프셋 16~89m) | 웹 prod · **iOS 봉인**(⏳ 실보행 판정 — 상수 7종 동결) |
| 백그라운드 사운드·톤 | 웹 prod · **iOS 봉인**(⏳ 실기기 판정 10종) |
| 이탈 판정 방위 축(A6) | 관측을 위치 이력 유도로 교체 완료(2026-08-10, 웹·Kit) — 웹은 prod 활성, iOS는 실험판(보행 전용). ⏳ 검증 보행으로 상수 확정 대기(BACKLOG A6) |
| 하단 2행(현재 행동 카운트다운 + 다음 예고) | 웹·iOS 구현 완료(2026-08-11, walk 상세 전용·표시 좌표계 effectiveD) — ⏳ 실보행 판정 축 5건(BACKLOG H M0) |
| 안내 시트 목적지 메뉴(장소 상세·끊김 없는 목적지 전환) | iOS 구현 완료(2026-08-12, 3수단·웹 미이식) — ⏳ 실기기 판정 축 4건(BACKLOG H M5) |

### 플랫폼
| 기능 | 비고 |
|---|---|
| 웹 PWA | 수제 서비스워커, document network-first |
| iOS 앱 | SwiftUI + GildongmuKit, 4탭, 설정 업데이트 이력(release notes) 화면 |
| CLI · MCP | REST 카탈로그 중계 씬 클라이언트 |
| 다국어 | ko·en·es·fr·it·ja 6개 |
| 커스텀 도메인 · GEO 대응 | 소개·FAQ + JSON-LD + llms.txt |

---

## 프로덕션 env 등록 현황

**실측 2026-08-08 (`vercel env ls production`) — 16개 등록**:

`KAKAO_REST_API_KEY` · `TOUR_API_KEY`(유일하게 Preview·Development 포함) · `DATA_GO_KR_API_KEY`(TOUR_API_KEY와 동일값) · `NCP_MAPS_CLIENT_ID` · `NCP_MAPS_CLIENT_SECRET` · `SEOUL_OPEN_DATA_KEY` · `SEOUL_SUBWAY_REALTIME_KEY` · `JUSO_CONFM_KEY` · `DEEPGRAM_API_KEY` · `PERPLEXITY_API_KEY` · `ODSAY_API_KEY` · `NAVER_LOCAL_CLIENT_ID` · `NAVER_LOCAL_CLIENT_SECRET` · `TMAP_APP_KEY` · `GEMINI_API_KEY` · `GOOGLE_CLOUD_TTS_API_KEY`

⚠ 이 목록은 **명령으로 재확인한다**. 재편 직전까지 `TMAP_APP_KEY`(18일 전 등록)와 `GOOGLE_CLOUD_TTS_API_KEY`가 이 문서에서 빠져 있었다 — 파일이 273KB로 불어 있는 동안 정작 현재 상태인 이 목록이 낡았다.

⚠ **env 변경 후 반드시 재배포** — 키는 배포 시점에 함수로 주입된다(`vercel deploy --prod --yes` 또는 push). 키만 추가하고 재배포하지 않으면 기존 함수는 옛 env를 본다.

⚠ **prod 키 검증은 `vercel env pull` 길이가 아니라 실호출로** — pull은 Encrypted 값을 복호화하지 않아 정상 키도 빈값으로 내려온다([[vercel-prod-env-pull-redacts-encrypted]]).

비용·쿼터·키 만료 상태는 `node scripts/usage-report.mjs`가 정본이다(로컬 전용, 13프로브 무과금).

---

## 정적 게이트 기준선

`docs/BACKLOG.md` 서두가 실측 기준선의 정본이다. 요약하면 테스트는 전량 green이고 `npm run lint` error 0, `tsc --noEmit` error 0이다(선재 5건은 2026-08-11 종결). 세 게이트 모두 0이 기준선이므로, 0에서 벗어난 출력은 그 자체가 신규 결함이다.

---

## 열려 있는 것

**정본은 `docs/BACKLOG.md`다.** 여기에 목록을 복제하지 않는다 — 두 곳에 적으면 어느 쪽이 참인지 판정할 수 없게 된다.

축 요약(2026-08-08 기준): 결함 축(A)은 A1 동결 하나뿐이고, 열려 있는 것은 **도달(G3 봉인 해제)·판정(F-a 실기기·실사용)·편승(D)·신규(E)**다. 갭 축(B)에 B4(웹 안내 세션 시작 포커스 착지) 1건.

---

## 신규 data.go.kr API 추가 절차

같은 `DATA_GO_KR_API_KEY`로 data.go.kr 활용신청만 하면 즉시 자동승인된다(전파 5~30분, 직접호출 방식은 7일+). 서울 `ws.bus.go.kr`·`swopenapi` 계열은 별도 인증키이고 동기화 배치 지연이 있다([[seoul-bus-datagokr-sync-delay]]).

새 API의 첫 호출에서 확인할 것은 `CLAUDE.md` 횡단 함정의 data.go.kr envelope 항목에 있다(JSON 파라미터 이름·단건 응답 모양이 기관코드마다 다르다).
