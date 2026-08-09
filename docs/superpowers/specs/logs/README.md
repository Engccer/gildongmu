# 실기기 계측 로그 보관소

실보행·실주행에서 회수한 `guide-diag.log` 원본(gzip). 각 로그는 그것을 판정 근거로 쓴 spec·BACKLOG 항목이 소비자다. 판독은 `gunzip -c <파일> | less`.

| 파일 | 내용 | 소비자 |
|---|---|---|
| `guide-diag-2026-08-09.log.gz` | 도보 281 fix(길동, 0.9m/s) + 자동차 2,131 fix(17.7km). **A6 방위 축 판정 근거** — 보행 courseAcc 중위 83°로 기기 course 전제 무효화. 위치 이력 유도 방위(3안 ⓐ)의 타당성 평가에 같은 로그를 그대로 쓸 수 있다(fix별 lat/lng/acc/t 전량 수록) | BACKLOG A6 설계 재론, spec `2026-08-09-off-route-course-axis-design.md` |
