# A6 이탈 판정 방위 축 — 실호출 경로 fixture

`/api/route/walk?includeGeometry=1` 실호출 응답에서 `steps[].description`·`pathCoords`만 남긴 것이다. 설계 정본은 `docs/superpowers/specs/2026-08-09-off-route-course-axis-design.md`.

| 파일 | 구간 | 길이·스텝 | 왜 넣었나 |
|---|---|---|---|
| `home-gowoo.json` | 자택 → 고우헤어 | 316m · 6 | **위원장 실보행 사례.** 봉래면옥 89.2° 좌회전 뒤 ㄷ자로 돌아오는 자기근접 기하 |
| `gildong-gangdong-office.json` | 길동역 → 강동구청 | 1729m · 13 | 중거리, 턴 다수 |
| `gangnam-samsung-arterial.json` | 강남역 → 삼성역 | 3373m · 14 | 장거리 대로변, 긴 직선 스텝 |
| `gyeongbokgung-gwanghwamun-short.json` | 경복궁 → 광화문 | 543m · 5 | 짧은 스텝이 연속 — 접선이 자주 급변 |
| `cityhall-gwanghwamun-straight.json` | 시청 → 광화문 | 602m · 7 | 도심 직선 대조군 |

⚠ **`pathCoords`가 없으면 `buildGuideRoute`가 경로 전체를 거부한다.** 새 fixture를 뜰 때 `includeGeometry=1`을 빠뜨리면 조용히 빈 경로가 된다.

⚠ **다시 뜨면 값이 달라진다.** 카카오 도보 경로는 시점에 따라 갱신되므로, 이 파일들을 갱신하면 spec §3의 실측 수치도 함께 다시 재야 한다.
