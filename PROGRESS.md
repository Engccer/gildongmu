# PROGRESS — 길동무 (gildongmu)

> 마일스톤 상태·실호출 검증 로그·미해결 결정을 담는다. **항구 규칙/패턴은 `CLAUDE.md`**, 설계·검증 정본은 `docs/superpowers/specs`(26개)·`plans`(20개). 이 파일은 "지금 무엇이 동작하고, 무엇이 막혀 있고, 다음은 무엇인가"만 추적한다.

## 운영 중인 기능 (실호출 검증 완료)

| 도메인 | 상태 | 비고 |
|---|---|---|
| 장소 검색 (카카오 좌표 거리순) | ✅ prod | 2026-06-24 길동 "맥도날드"→강동구 지점 1~6위 |
| 검색창 3섹션 병렬 (장소+주소+웹 0건폴백) | ✅ prod | 2026-06-27 LLM 라우터 폐기 후 결정론 전환 |
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
| 대중교통 길찾기 (ODsay) | ⚠ dev only | IP 화이트리스트 — 아래 미해결 |
| 음성 받아쓰기 (Deepgram nova-3) | ✅ prod | 2026-06-19 키 401 사고 복구 |
| PWA (수제 서비스워커) | ✅ prod | 2026-06-21 |
| 채팅 (Gemini FC 14도구 + Perplexity 웹) | ✅ prod | 2026-06-21 장소별 진입 재배치 |

## 프로덕션 env 등록 현황

`vercel env ls production`으로 확인. 등록됨: `KAKAO_REST_API_KEY`, `TOUR_API_KEY`/`DATA_GO_KR_API_KEY`(동일값), `NCP_MAPS_CLIENT_ID/SECRET`, `DEEPGRAM_API_KEY`, `SEOUL_OPEN_DATA_KEY`, `SEOUL_SUBWAY_REALTIME_KEY`, `JUSO_CONFM_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`.

**미등록**: `ODSAY_API_KEY`(IP 문제로 보류 — `canShowTransit` 게이트로 prod 안전).

⚠ **env 변경 후 반드시 재배포** — 키는 배포 시점에 함수로 주입된다(`vercel deploy --prod --yes` 또는 push). 키만 추가하고 재배포 안 하면 기존 함수는 옛 env를 본다.

⚠ **prod 키 검증은 `vercel env pull` 길이가 아니라 실호출로** — pull은 Encrypted 값을 복호화하지 않아 정상 키도 빈값으로 내려온다([[vercel-prod-env-pull-redacts-encrypted]]).

## 미해결·보류

- **ODsay 대중교통 길찾기 prod 미동작**: Server 방식이 공인 IP 화이트리스트라 Vercel 가변 IP와 충돌. 개발 머신 IP만 등록. 해결 후보: 고정 IP 애드온/프록시/유료/URI 재검토([[odsay-transit-server-ip-vercel]]). 별도 마일스톤.
- **둘러보기 기능 B (OSM 횡단보도·점자블록 + 음향신호기)**: 후속 마일스톤. 길동 OSM 보행 태깅 희박 확인(2026-06-20) — OSM은 카카오가 비운 칸만 채우는 보완재. 음향신호기는 OSM 공백→data.go.kr 피벗([[overpass-osm-korea-pedestrian-coverage]]).
- **idle 홈 heading 레벨 점프**: `h1`→`h3`(nearby 섹션 헤더가 h3, 상위 묶음 h2 없음). 회전자 순회는 안 막힘. 완전 정돈하려면 "내 주변" 묶음 `h2` 도입 필요 — 미니멀 UI 판단 보류.
- **dodo-planet 이식**: 한국 API·채팅 카드를 dodo로 이식하는 spec 작성·저장(`docs/superpowers/specs/2026-06-21-dodo-korea-api-port-design.md`), 미구현. 로드맵 `2026-06-21-chat-relocation-and-dodo-port-roadmap.md`.
- **`DistanceBeacon`(목적지 거리 추적) 보류 코드**: 마운트만 제거, 코드 5파일+`beacon.*` i18n 보존. 미래 별도 브랜치 고도화 예정 — ⚠ 죽은 코드 청소 시 제거 금지.

## 신규 data.go.kr API 추가 절차

같은 `DATA_GO_KR_API_KEY`로 data.go.kr 활용신청만 하면 즉시 자동승인(전파 ~5~30분, 직접호출 방식은 7일+). 서울 ws.bus.go.kr·swopenapi 계열은 별도 인증키 동기화 배치 지연 있음([[seoul-bus-datagokr-sync-delay]]).
