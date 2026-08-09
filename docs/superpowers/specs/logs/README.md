# 실기기 계측 로그 보관소

실보행·실주행에서 회수한 `guide-diag.log` 원본(gzip). 각 로그는 그것을 판정 근거로 쓴 spec·BACKLOG 항목이 소비자다. 판독은 `gunzip -c <파일> | less`.

| 파일 | 내용 | 소비자 |
|---|---|---|
| `guide-diag-2026-08-09.log.gz` | 도보 281 fix(길동, 0.9m/s) + 자동차 2,131 fix(17.7km). **A6 방위 축 판정 근거** — 보행 courseAcc 중위 83°로 기기 course 전제 무효화. 같은 로그로 위치 이력 유도 방위(1안)의 성립을 실증(2026-08-10, spec §3.0) | BACKLOG A6, spec `2026-08-09-off-route-course-axis-design.md` §3.0 |
| `a6-derived-bearing-analysis.py` | 유도 방위 오차 전파 실측(상대 잡음·자동차 교차 검증·도보 지터·커버리지·표결 시뮬). spec §3.0.1~3.0.3 수치의 산출 스크립트 | spec §3.0 재현 |
| `a6-chain-u-replay.py` | 사슬 자기일관성 U 검증 + 합성 이탈(궤적 회전) 검출 지연. spec §3.0.4~3.0.5 수치의 산출 스크립트 | spec §3.0 재현 |
