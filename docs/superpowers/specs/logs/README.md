# 실기기 계측 로그 보관소

실보행·실주행에서 회수한 `guide-diag.log` 원본(gzip). 각 로그는 그것을 판정 근거로 쓴 spec·BACKLOG 항목이 소비자다. 판독은 `gunzip -c <파일> | less`.

| 파일 | 내용 | 소비자 |
|---|---|---|
| `guide-diag-2026-08-09.log.gz` | 도보 281 fix(길동, 0.9m/s) + 자동차 2,131 fix(17.7km). **A6 방위 축 판정 근거** — 보행 courseAcc 중위 83°로 기기 course 전제 무효화. 같은 로그로 위치 이력 유도 방위(1안)의 성립을 실증(2026-08-10, spec §3.0) | BACKLOG A6, spec `2026-08-09-off-route-course-axis-design.md` §3.0 |
| `guide-diag-2026-08-10.log.gz` | 회전 로그 원본이라 08-09 저녁 세션과 겹친다. 오늘분 둘: ①오전 실보행(KST 09:16~09:28, 임박 큐 10m→25m 상향 판정 근거) ②저녁 왕복 실보행(KST 20:00~20:25, 자택↔주택 A, 両다리 arrived=true. **유도 방위 축 첫 실보행 — verdict=on 240행**(08-09는 전량 unknown), imminent 14·announceSteps 14·offRoute 2·uncertain 1쌍) | BACKLOG "도보 임박 큐·도착 종 실보행 판정" ①~⑥, A6 spec §7 3단계 검증 보행 |
| `a6-derived-bearing-analysis.py` | 유도 방위 오차 전파 실측(상대 잡음·자동차 교차 검증·도보 지터·커버리지·표결 시뮬). spec §3.0.1~3.0.3 수치의 산출 스크립트 | spec §3.0 재현 |
| `a6-chain-u-replay.py` | 사슬 자기일관성 U 검증 + 합성 이탈(궤적 회전) 검출 지연. spec §3.0.4~3.0.5 수치의 산출 스크립트 | spec §3.0 재현 |
