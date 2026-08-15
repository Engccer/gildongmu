# 실기기 계측 로그 보관소

실보행·실주행에서 회수한 `guide-diag.log` 원본(gzip). 각 로그는 그것을 판정 근거로 쓴 spec·BACKLOG 항목이 소비자다. 판독은 `gunzip -c <파일> | less`.

| 파일 | 내용 | 소비자 |
|---|---|---|
| `guide-diag-2026-08-09.log.gz` | 도보 281 fix(길동, 0.9m/s) + 자동차 2,131 fix(17.7km). **A6 방위 축 판정 근거** — 보행 courseAcc 중위 83°로 기기 course 전제 무효화. 같은 로그로 위치 이력 유도 방위(1안)의 성립을 실증(2026-08-10, spec §3.0) | BACKLOG A6, spec `2026-08-09-off-route-course-axis-design.md` §3.0 |
| `guide-diag-2026-08-10.log.gz` | 회전 로그 원본이라 08-09 저녁 세션과 겹친다. 오늘분 둘: ①오전 실보행(KST 09:16~09:28, 임박 큐 10m→25m 상향 판정 근거) ②저녁 왕복 실보행(KST 20:00~20:25, 자택↔주택 A, 両다리 arrived=true. **유도 방위 축 첫 실보행 — verdict=on 240행**(08-09는 전량 unknown), imminent 14·announceSteps 14·offRoute 2·uncertain 1쌍) | BACKLOG "도보 임박 큐·도착 종 실보행 판정" ①~⑥, A6 spec §7 3단계 검증 보행 |
| `guide-diag-2026-08-11.log.gz` | 회전 로그 원본이라 08-09·08-10 세션을 포함한다. 오늘분 둘(집↔학교 왕복 실보행): ①등교(KST 08:10~08:22, 719행. offRoute 3회 모두 재조회로 이어짐, imminent 6·announceSteps 6, 최종 접근 진입 offset 58.8m·41틱 58.9→40.6m·**arrived=true 0건**) ②하교(KST 17:12~17:26, 842행. **finalApproachEnter가 `projectionJumped` 가드에 버려졌는데 phase는 이미 커밋돼 리듀서가 영구 no-op** — 마지막 30초 d=501.2 고착·도착 판정 없음. verdict=off 1회) | BACKLOG "도보 임박 큐·도착 종 실보행 판정", 최종 접근 진입 가드 결함 |
| `guide-diag-2026-08-13.log.gz` | 회전 로그 원본이라 08-09~08-12 세션을 포함한다. 오늘분: ①등교 실보행(KST 08:20~08:34, 841 fix. imminent 9·offRoute 3·**verdict=off 21행**, 최종 접근 26틱 43.6m로 끝나고 arrived=false) ②귀가 세션(KST 17:03~) — **잊힌 안내 세션 실사고**의 그 세션이라 최종 접근 진입 뒤 로그가 이어진다(도착 추정 자동 종료 설계의 근거) | spec `2026-08-13-presumed-arrival-auto-end-design.md`, BACKLOG E13 |
| `guide-diag-2026-08-15.log.gz` | 회전 로그 원본이라 08-11~08-13 세션을 포함한다(회전 경계를 걸쳐 `.old`+현행을 시간순으로 이어 붙였다). 새 구간은 08-13 17:08 이후 5,521행: ①08-14 등교 실보행(KST 08:47~09:03, 578 fix, verdict=on 323. 최종 접근 121틱 48.6→36.8m, arrived 없이 **`presumedArrival reason=stationary dist=36.8` 첫 실발동**) ②08-14 차량(KST 10:45~10:58, 3.0km) ③08-14 저녁 실보행 둘(16:45~17:01 **arrived=true dist=12.3**, offRoute 12·verdict=off 11 / 17:14~17:24 finalEnter offset=12.5인데 acc 50.8m로 열화돼 60.6m에서 종료, arrived=false) ④08-15 차량(KST 09:23~10:07, 22.7km. uncertain 6쌍·reacquiring 1) | BACKLOG E13(도착 추정 상수 4종 실보행 게이트), A12 실보행 판정, A6·최종 접근 상수 |
| `a6-derived-bearing-analysis.py` | 유도 방위 오차 전파 실측(상대 잡음·자동차 교차 검증·도보 지터·커버리지·표결 시뮬). spec §3.0.1~3.0.3 수치의 산출 스크립트 | spec §3.0 재현 |
| `closer-interval-replay.py` | 상세 모드 closer 톤 간격을 데드밴드별로 재는 리플레이(`<로그> [데드밴드…]`). 도보 세션만 골라 간격 중위·분포를 낸다. ⚠ 로그의 `d`는 **경로상 진행 거리**라 추세 축(잔여)은 `-d`다 | BACKLOG F-a "2026-08-11 추가분", `docs/INTEGRATIONS.md` §톤 계층 |
| `a6-chain-u-replay.py` | 사슬 자기일관성 U 검증 + 합성 이탈(궤적 회전) 검출 지연. spec §3.0.4~3.0.5 수치의 산출 스크립트 | spec §3.0 재현 |
