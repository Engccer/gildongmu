# research — 조사 기록물

국내 API 생태계·기술 스택 조사 결과를 담는다. **시점 고정 기록물**이라 다른 문서와 규칙이 다르다.

- **낡는 것이 정상이다.** 조사 시점의 사실을 그대로 두고, 뒤에 사실이 바뀌었다고 본문을 고쳐 쓰지 않는다. 그 시점에 무엇을 알고 무엇을 근거로 결정했는지가 이 폴더의 가치다.
- **다만 결론이 뒤집혔으면 문서 머리에 한 줄로 표기한다.** 본문을 읽는 사람이 폐기된 전제를 현재 사실로 오해하는 것만 막으면 된다(예: `RESEARCH-2026-07-dodo-planet-target-architecture.md`의 "통합이 최종 목표" 전제).
- **여기서 나온 결론이 코드를 구속하게 되면 그 규칙은 다른 문서로 간다**: 항구 함정은 `CLAUDE.md`, 통합별 상세 계약은 `docs/INTEGRATIONS.md`, 착수 후보는 `docs/BACKLOG.md`, 발굴한 서비스 대장은 `docs/SPEC.md` §3.

## 목록

| 문서 | 조사 시점 | 다룬 것 |
|---|---|---|
| `RESEARCH-2026-06-kakao-api-ecosystem.md` | 2026-06-12 | 카카오 로컬·모빌리티·딥링크·메시지 |
| `RESEARCH-2026-06-naver-api-ecosystem.md` | 2026-06-12 | 네이버/NCP 생태계(2025 개편·쿼터·딥링크) |
| `RESEARCH-2026-06-domestic-api-expansion.md` | 2026-06-14 | 우편번호·시내버스·지하철·맛집·예약·접근성 6개 도메인 |
| `RESEARCH-2026-06-seoul-open-data.md` | 2026-06-16 | 서울 열린데이터광장 |
| `RESEARCH-2026-07-dodo-planet-target-architecture.md` | 2026-07-03 | 이식 수용측 코드베이스 지도 (⚠ 전제 일부 폐기) |
| `RESEARCH-2026-07-04-realtime-pedestrian-nav-stack.md` | 2026-07-04 | 실시간 보행 내비 기술 스택 |
| `RESEARCH-2026-07-routing-enhancement.md` | 2026-07-29 | 도보·실시간 교통·교통약자·자전거/택시 4축 |
| `RESEARCH-2026-08-02-realtime-walk-navigation.md` | 2026-08-03 | 경로 추종형 안내 설계(E4의 근거) |
| `RESEARCH-2026-08-03-mode-specific-guidance.md` | 2026-08-03 | 수단별 안내 진입점 분리 |
