# CHANGELOG — 길동무 (gildongmu)

날짜별 변경 이력. **"언제 무엇이 바뀌었나"만** 담는다.

- 설계 근거·검증 상세는 각 항목의 `docs/superpowers/specs`·`plans` 링크가 정본이다.
- 항구 규칙·패턴·함정은 `CLAUDE.md`가 정본이다 — 여기에 다시 적지 않는다.
- 지금 무엇이 동작하고 무엇이 열려 있는지는 `PROGRESS.md`, 열린 백로그는 `docs/BACKLOG.md`.
- npm 패키지 릴리스 노트는 `packages/cli/CHANGELOG.md`·`packages/mcp/CHANGELOG.md`, App Store 릴리스 노트는 `docs/appstore/release-notes.md`.

---

## 2026-08-11

### A10 — 최종 접근 진입 거부 데드락 수정 (투영 점프 판정을 리듀서로 이관)
하교 실보행(17:26)에서 확정된 세션 영구 정지 수정. 종전에는 리듀서가 `phase=finalApproach`를 커밋한 뒤 오케스트레이터가 점프 fix의 진입 이벤트를 사후 거부해, 거부된 세션이 0a 가드 국면에 갇혔다(잔여 4m 동결·도착 무통지). 판정을 리듀서 6b **진입 확정 앞**으로 옮겨 이벤트와 phase 전이를 원자화했다 — 리듀서 안에서는 직전 d(`state.d`)·직전 시각(`state.lastFixAt`)이 이미 상태라 별도 기준값 부수효과가 사라진다(백로그가 ②안의 장애물로 지목했던 것). 오케스트레이터 両쪽(`BeaconModel`·`useRouteGuide`)의 `lastRemaining` 기계는 제거하고 추세 톤 게이트는 `GuideOutput.projectionJumped`를 소비한다. 하교 로그의 d 동역학(407.6→458.3→501.2/2s)을 공유 fixture 시나리오로 박아 웹·Kit 양쪽에서 변이 주입(게이트 제거·계수 파손) 검출을 확인했다. spec `2026-08-08-final-approach-guidance-design.md` §3.2 개정.

### A9 — 근접 지하철역 노선 집계의 전국 동명이역 혼입 수정
서울 용산역 앞 prod 응답 `lines`에 대구 용산역의 "대구 도시철도 2호선"이 섞이던 결함(이름만으로 seed 집계). `summarizeStationNear`/`findStationMetaNear`(앵커 = 매칭 seed 레코드 좌표, 복합체 반경 600m — 빌드 가드의 환승 쌍 경계와 동일: 정당 최대 435m·오염 시작 600m)를 신설해 `subway-nearby` 두 지점을 교체했다. 서울 안 동명 분리역(2호선 신촌 vs 경의중앙선 신촌, 701m)도 함께 분리된다. 이름 기반 소비자(채팅 router·`/api/station/meta`)는 좌표 문맥이 없어 종전 `findStationMeta` 유지.

### A8 — 계단 회피 토글 후 조회 요약 수치 갱신
`toggleStepFree`가 `outcomes.walk`만 갈아끼우고 `phase.successCount`를 두어 "N개 수단 준비됨" 낭독이 실제 성공 수와 어긋나던 결함(2026-08-09 최종 리뷰 검출, 낭독 수치라 시각 반증 불가). 토글 재조회 후 성공 수를 재계산해 phase를 함께 갱신한다(변이 검출 확인).

### D10(tsc 절반) — `tsc --noEmit` 기준선 0 회복
선재 테스트 파일 5 error(geolocation mock 튜플 접근 2·`rewriteWalkBriefing` 인자 누락 2·remark fixture 캐스트 1) 해소. 0이 아닌 기준선은 새 에러를 자기 노이즈에 숨긴다는 등록 사유 그대로의 정리.

### 횡단 안내 꼬리 거리에 이름 부여 ("21m" → "횡단보도 길이 21m")
위원장 실사용 지적("다른 거리와 헷갈린다") 반영. `rewriteWalkGuidance`의 횡단 규칙이 내던 벌거벗은 꼬리 거리는 무엇의 거리인지 말하지 않아 구간 잔여·다음 안내까지 거리로 들렸다. 꼬리를 `{횡단보도|지하보도} 길이 {거리}`로 바꿔 라벨을 `kind`에서 가져오므로 지하보도 문장도 같은 형태가 된다. 값 조립은 그대로 `formatDistance` 하나만 통과한다. 문장에 "횡단보도"가 두 번 나오는 중복은 혼동 제거의 대가로 수용했다. 공유 fixture 갱신으로 Kit 동조.

### 상세 안내 closer 톤 간격 단축 (데드밴드 15m → 10m)
위원장 실사용 지적("가까워지고 있다는 사운드 간격이 조금 멀다")을 그날 회수한 실보행 로그로 실측해 반영했다. 실질 간격을 정하는 것은 closer 최소 간격(도보 2초)이 아니라 데드밴드였고, 리플레이 결과 중위 17.5초·15~25초 구간이 절반이었다. 상세 모드에만 별도 상수를 두고(`detailDeadBand` ↔ `DETAIL_DEAD_BAND_M`) 간략 비콘의 15m는 유지했다 — 간략은 직선거리라 GPS 지터가 그대로 실리지만 상세의 잔여 거리는 구속 창 투영·단조 전진·phase 게이트를 거쳐 역행이 구조적으로 없다(로그 5세션 6,047 스텝 역행 0건). 10m에서 중위 11.5초. 자동차는 주행 속도에서 closer 간격 10초가 병목이라 영향이 없고, 정체·신호 대기에서만 도보와 같은 기제로 잦아진다(최대 1.5배, 해롭지 않아 수단을 가르지 않음). 웹↔Kit 드리프트 가드 추가(변이 3종 검출 확인), 재현 스크립트 `docs/superpowers/specs/logs/closer-interval-replay.py` — 리뷰 지적으로 재기준 즉시 1회 톤과 3초 정숙 구간을 반영해 최대 침묵 수치를 교정했다(38초, 미반영 시 86초로 부풀려졌다). 실보행 판정 대상(BACKLOG F-a).

### 경로 목록 모달 닫기 버튼 라벨 축약
실시간 안내 중 낭독 길이를 줄이려 "경로 목록 닫기" → "닫기". 관례 키 `actions.close`로 통합하고 전용 키 `ios.guide.routeListClose`는 6로케일에서 폐기했다.

### 도착지 부근 상황 재구성 M1 — 실사용 판정 통과
위원장 실사용 확인("큰 문제 없었다")으로 유일한 판정 축인 "목적지를 찾는 단서가 됐는가"가 만족됐다. 위원장이 스크린 리더 실사용자이므로 실기기 VO 축 중 사용자가 지나는 면(묶음 제목 점프·한 줄 비분절·WhereAmI 경로)도 같은 판정에 포함된다. 1.5(빌드 11)로 이미 출하됐고, 제출 시점에 "판정 전이지만 정보 제공 축이라 받아들인다"고 적은 판단이 사후 확인됐다. 잔여 두 면(추적 시트 임베드 착지는 실험 경로, 재조회 실패 시 목록 유지는 실패 주입 필요)은 일상 실사용이 닿지 않아 BACKLOG §H M1에 남는다.

### App Store 1.5 제출 (빌드 11)
1.4 출시 이후 iOS 정식 빌드에 **도달하는** 변경 3종을 담았다: 도착지 부근 상황 재구성(내 주변 → 현재 위치 확인 → 주변 확인) · 길찾기 최근 경로 · 설정 업데이트 이력. 같은 창의 실시간 안내 커밋 20여 개는 `realtimeGuidanceEnabled` 게이트 안이라 Release에서 도달 불가고, 서버 전용 변경은 웹 배포로 이미 반영되어 제외했다. 노트는 `docs/appstore/release-notes.md` §1.5.
`asc-submit.mjs` 두 가지 개선: **프로모션 텍스트 자동 승계**(비어 있을 때만 직전 버전 값 PATCH — 1.1~1.4가 네 번 연속 수동 복사였다, BACKLOG D9 종결)와 **제출 3호출의 재사용화**(생성·항목 추가·제출이 각각 기존 것을 재사용 — 이번에 마지막 `submitted:true` PATCH만 ASC 500으로 죽었고, 그대로 재실행하면 미제출 submission이 하나 더 생기는 구조였다). 아카이브는 병렬 세션과 소스가 섞이지 않도록 `git worktree`로 커밋을 격리해 빌드했다.

### 안내 시트 컨트롤 재편 — 전환 버튼 폐지·주변 확인 상향·도착 종료 화면
위원장 실사용 판정 3건 반영(iOS). ①상세⇄간략 전환 버튼 폐지(무용 판정) — `toggleMode`·간략→상세 해소 기계(`resolveDetailIfPending`)까지 제거, `speedSuggest` 이벤트는 Kit 공유라 소비만 no-op. ②주변 확인을 말미 별도 섹션에서 전환 버튼 자리(진행 상황 다음)로 이동 — 말미 배치는 안내 정보 행을 읽다 보면 다음 스와이프가 자꾸 버튼에 닿았다. ③도착 종료 화면 신설 — 도착 즉시 시트가 닫혀 경로 조회 결과로 떨어지던 전이를 대체(`arrivalDest` 유지, 대중교통 핸드오프 제안 §14.2 동형): 도착 헤딩+도착 문장(포커스 착지)+주변 확인(목적지 앵커)+닫기. 웹 DistanceBeacon 미러는 BACKLOG B5.

### 실시간 도보 안내 하단 2행 재설계 — 현재 행동 실시간 갱신 + 다음 안내 예고 (H M0)
실보행 라운드2 최상위 피드백 반영. 윗줄 = 현재 행동(직진 미터 카운트다운 → 10m부터 "{n}m 후 {행동}" → "잠시 후" / 횡단·상태 대체·최종 접근 문형), 아랫줄 = "다음 안내," 종류별 예고 — 종전 currentText/statusText 자리를 walk 상세에서 대체(car·간략은 불변). 표시 좌표계 `effectiveD = d + min(15, 기준점 이후 진행)` 통일 + `IMMINENT_AHEAD_M = 10 + PROJECTION_LAG_M` 유도식 재정의(값 25 불변, 기존 음성 fixture 웹·Kit 전체 무수정 통과가 증명 게이트). 리듀서형 `guideLiveRows` 웹 ↔ Kit 미러 + 공유 fixture(실경로 8스텝 근사, ko 최종 문자열 대조). 서버 `rewriteWalkGuidance`가 `live{target,anchor}` 조각을 `includeGeometry=1` 응답에 노출 — 실호출 게이트가 까지 절 없는 문형의 anchor 유실을 검출·수정(6/6 스텝 조각 확인). spec `2026-08-11-guide-live-two-rows-design.md`, 실보행 판정 축 5건은 BACKLOG §H M0.

## 2026-08-10

### 실보행 라운드2 판정 종결 — 피드백 반영분 전부 만족
위원장 저녁 왕복 실보행(자택↔주택 A, 両다리 완주)으로 라운드1 반영분 전원 만족 판정. 종결 5건: ①도보 임박 큐·도착 종 판정 ①~⑥(25m 임박 큐·분류 커버리지·도착 종 가청·무톤 전환·진동·정숙 구간 — spec `2026-08-09-walk-imminent-cue-design.md` §4) ②진행 상황 조망·하단 2행 판정 ①~⑤ 및 라운드2 ⓐⓑⓒ(조망 모달·2행 분리·"다음 안내," 라벨·횡단보도 행동 문장 — spec `2026-08-10-guide-progress-overview-design.md` §7) ③이탈 재조회 수정 확인(재조회 `.high` 통지·현위치 시작·재이탈 없음) ④현위치 수동 지정 실기기 판정 ⑪건 ⑤최근 경로+업데이트 이력 실기기 확인. 종결분에서 승계 2건: 대중교통 탑승 버튼 `.high` 판정 → 실승차 재판정 ⑨, endpoint 검색 시트 통지 승격 → BACKLOG D13. 계측 로그 `docs/superpowers/specs/logs/guide-diag-2026-08-10.log.gz`(같은 세션에서 유도 방위 축이 첫 결정 표 verdict=on 240행 — A6 §7 3단계 판정은 별도 진행).

### 자동차 안내문 재작성 — "오른쪽 방향 후" 계열 「후」 결합 파손 해소
실주행 리포트(길동→주택 B, "오른쪽 방향 후"가 어색)로 발견. Tmap 실호출 전국 12경로 212문장 전수 조사로 상태·위치 명사+「후」 결합 파손이 53%(112문장)임을 확정하고, 도보 `rewriteWalkGuidance` 동형의 서버 재작성(`src/lib/car-guidance.ts`, `getCarRoute` 진입점 적용)을 신설 — "오른쪽 길로 들어선 뒤"·"터널을 지나"(지점명 중복 흡수 포함)·"입구로 들어선 뒤/출구로 나온 뒤". 회전 계열·출발·도착·미지 어휘·카카오 폴백은 원문 통과(fail-safe). turnType 117/118은 코퍼스 실측(도로 유지 48%/69%)으로 회전이 아니라 갈래 선택임을 확정 — "우회전" 치환 금지를 계약에 박았다(`docs/INTEGRATIONS.md` §자동차 경로).

### 역 seed 인접역 좌표 혼입 수정 (4호선 이촌역 = 신용산 좌표)
CLI 실사용 리포트(Windows, `nearby subway`)로 발견 — 신용산역 앞에서 실거리 1km의 이촌역이 8m 최근접 1순위로 잡혔다. 원인은 표준데이터 XLSX 원본이 4호선 이촌(국립중앙박물관) 레코드에 한 정거장 옆 신용산역 좌표(907m 오차)를 담은 것. `COORD_FIXES` 보정(카카오 실좌표) + 환승 쌍 거리 가드 신설(동명이고 한쪽 이상 환승인 쌍이 600m~30km면 빌드 중단 — 인접역 혼입은 노선 연속성 축의 사각, 변이 주입으로 검출 확인, 오탐 0). seed 변경은 이촌 1건.

### 길찾기 최근 경로 + iOS 설정 업데이트 이력
길찾기 조회 완료(settled) 시 출발·도착 쌍을 기기 로컬에 기록해(최대 20, 쌍 dedupe, 현재 위치는 nil/null 투영) 결과 없는 화면에 최근 경로 섹션으로 노출한다(웹·iOS). 활성화=두 필드 확정+즉시 조회+조회 버튼 포커스 선점, 삭제는 기존 최근 검색 계약을 그대로 따른다(iOS 스와이프=로터, 웹 삭제 버튼). 저장은 웹 `src/lib/recent-searches.ts` ↔ iOS `RecentSearchStore`(`RecentRoute`) 미러.
iOS 설정에 업데이트 이력 화면을 추가했다 — `docs/appstore/release-notes.md`(정본) → `scripts/build-release-notes.mjs` → 번들 `release-notes.json`(1.1~1.4) → `ReleaseNotesView`(버전 heading 로터 점프, ko 외 5개 언어는 en 폴백). 드리프트 가드는 `src/lib/__tests__/release-notes-bundle.test.ts`.
a11y 감사 반영으로 최근 경로 삭제·전체 지우기 통지를 `.high` 우선순위로 올렸다(자기 소멸 버튼이 기본 우선순위 통지를 잠식하는 패턴 재발 방지).
spec `docs/superpowers/specs/2026-08-10-recent-routes-and-release-notes-design.md`.

### 실시간 안내 실보행 라운드1 반영 (같은 날 아침 실보행 4건)
①"현재 안내" 행을 발화 이벤트 연동에서 **현재 구간 상태 유도**로 전환(웹·iOS) — 발화는 경계 40m 선행+1회 래치라 짧은 구간의 15초 재통독이 선행분을 덮은 뒤 영구 고착됐다(마지막 구간 내내 횡단보도 안내 잔류 실사고). ②상태 행의 주기 예고에 "다음 안내," 라벨(iOS 표시 전용, 음성 불변). ③횡단보도·지하보도 재작성을 행동 동사 우선으로("메가 MGC커피 앞에서 횡단보도를 건너세요, 21m" — 서버라 웹·iOS·CLI 동시 반영). ④임박 큐 10m→**25m**(GPS·투영 지연 ~15m가 10m를 잡아먹어 회전을 지난 뒤 발화, 차도 진입 위험 실사고 — 위원장 25m 지정). 공유 시나리오 fixture 재계산 포함. spec `2026-08-10-guide-progress-overview-design.md` §8.

### 실시간 안내 진행 상황 조망 + 하단 2행 분리 (실보행 판정 대기)
실보행 피드백(2026-08-09) 반영 3건, 웹·iOS 미러. ①진행 상황 버튼을 조망형으로 재설계 — 서수 위치("안내 12개 중 5번째 구간")+잔여(+근거 있을 때만 시간)+현재 스텝 전문+다음 스텝. 종전 응답은 주기 통지와 뒷부분이 동일해 고유 정보가 0이었다. iOS는 버튼이 전 구간 조망 모달을 연다(현재 구간 표식, 조망 문장은 모달 헤더가 전달. 초판 인라인 펼침은 위원장 1차 확인 "탐색 개체 과다"로 당일 모달 전환. 웹은 목록이 이미 화면에 있어 의도적 비적용). ②하단 상태를 역할 고정 2행으로 분리 — "현재 안내" 행(`currentGuidanceText`/`currentText`, 실행 안내 시점에만 갱신)+상태 행(기존 슬롯). iOS는 구간을 넘는 순간 상태 행을 비워 중복·낡은 예고 잔류를 제거(전경 복귀 재생은 현재 안내 폴백, 위원장 승인 후 당일 강화). ③묶음 통독 개수 제거("다음 안내. A. B"). spec `docs/superpowers/specs/2026-08-10-guide-progress-overview-design.md`.

### 도착지 부근 상황 재구성 M1 — iOS 이식 (실보행·실기기 VO 판정 대기)
계산이 전부 서버 라우트에 있어 Swift 계산 미러 없이 소비 계층만 이식했다: Kit에 서버 JSON 1:1 Codable 모델+엔드포인트(`NearbyService.surroundingsScene`, fixture는 prod 실캡처 entrance·compass 2종), 앱에 임베드 섹션(`SurroundingsSceneSection` — `NearbyLoadCore` `.fixed` 앵커 + 묶음별 `RevealWindow`, 통지는 Announcement 없이 포커스·라벨 채널만), 진입점 2곳(WhereAmI 정위 좌표·추적 시트 목적지 좌표, `BeaconModel.dest` 읽기 노출). 시뮬레이터 prod 실호출로 트리거→묶음 헤딩→더 보기→닫기 전 경로 검증.
편승 수정: 임박 큐의 동적 i18n 키 조립을 린터 계약대로 리터럴 switch로 교체(키 누락 무증상 결함 차단). plan `docs/superpowers/plans/2026-08-10-surroundings-scene-ios-port.md`.

### 도착지 부근 상황 재구성 M1 — 웹 + 계산 코어 (실보행 판정 대기)
"여기가 맞나"를 확인하는 요청형 기능. 도로명주소 홀짝(시행령 제7조④)과 juso 건물 목록 최소제곱 축 복원으로 **입구를 마주 본 기준의 왼쪽·오른쪽·맞은편·건물 너머** 묶음을 조립한다(추가 데이터 소스 0). 축을 못 세우면 절대 방위로 물러난다(3-state). 진입점은 "내 주변 → 현재 위치 확인" 결과 아래와 안내 시트 두 곳, 앵커는 각각 정위에 쓴 좌표(수동 위치 자동 반영)·목적지 좌표.
카카오 카테고리 18종 전부를 받도록 provider를 인자화했고(둘러보기 기본 10종 불변), 임베드 UI는 live region 없이 포커스·라벨 채널로 통지한다(DistanceBeacon 단일 live 계약이 강제).
검증: 변이 주입(부호 반전 7/14 파손), 실호출 게이트 6/6(신명중 골목 축·강동구청 맞은편·자택 아파트 좌우·망원시장 compass 폴백·수원시청·해외). spec `docs/superpowers/specs/2026-08-09-arrival-surroundings-design.md`, plan `docs/superpowers/plans/2026-08-09-arrival-surroundings.md`.

## 2026-08-09

### 도보 결정 지점 10m 임박 큐 + 도착 종소리 절단 수정 (판정 대기)
위원장 도보 안내 실사용 피드백. 결정 지점 안내가 두 층이 됐다: 40m 전문 낭독(`announceSteps`, **무톤**으로 전환)이 *무엇을* 할지, 새 10m 임박 큐(`imminent`)가 *지금이다*를 알린다. `ahead` 톤이 40m에서 10m로 옮겨 왔고 실측 파형에 동기한 햅틱과 짧은 명령형 문장("잠시 후 왼쪽으로 도세요"·"잠시 후 횡단보도를 건너세요")이 함께 나간다. 문구 선택은 신설 `walkStepAction`(웹 ↔ Kit 미러)이 서버 재작성 문장에서 회전·횡단보도·지하보도를 읽어 맡고, 분류가 없으면 큐 자체가 나가지 않는다(미분류의 정답은 오안내가 아니라 침묵). walk 전용이다.
발화 조건은 `imminentUpTo < announcedUpTo`이고 그래서 이 블록이 전문 낭독보다 앞이다 — 전문 없이 명령만 내보내지 않으면서, 30m 횡단보도 유닛에서 전문에 밀려 모퉁이를 지나 울리던 문제도 함께 막는다.
**도착 종소리**는 `playTone(.nearby)` 다음 줄의 세션 원복이 2.2초짜리 재생을 백그라운드에서 잘라 왔다(정지 톤 1.3초도 같은 경로). 순서 규칙으로는 못 막는 결함이라 `endSession()`이 재생 잔여 시간만큼 원복을 미룬다. 전경에서는 증상이 없어 손에 들고 하는 시험이 통과시켜 온 계열이다.
검증: 공유 fixture 4종 + `toneNull` 단언 축 신설, `walk-action-cases.json` 신설. spec `docs/superpowers/specs/2026-08-09-walk-imminent-cue-design.md`.

### 현위치를 사용자가 직접 지정한다 (웹·iOS 1.4)
GPS가 실내에서 못 잡거나 다른 곳을 잡을 때 스스로 고칠 수단이 없었다. 채팅·검색·내 주변 첫 줄에서 위치를 눌러 장소를 검색해 고르면 그 자리를 현재 위치로 쓴다. 지정 위치는 "내 주변" 전 도메인·검색 거리·**채팅 앵커**·길찾기 출발지에 반영되고, 우선순위는 **장소 앵커 > 수동 위치 > GPS**다.
자리를 옮기면 자동으로 해제하고 통지한다. 판정 기준점은 장소 좌표가 아니라 **지정 시점의 실측 fix**(`origin`)다 — 장소 검색 결과는 건물 중심이나 대표 출입구라 같은 자리에서도 100m 넘게 떨어져 오해제가 난다. 이동 판정은 양쪽 오차 원을 차감한 `separation`으로 재고, 판정 왕복 중 재지정은 `revision` CAS가 가른다. 트리거는 셋(앱·탭 시작 · 포그라운드 복귀 · `force` 조회)이고 전부 `force:true`다 — 캐시를 읽으면 이동을 영영 놓친다.
**실시간 안내는 실좌표만 쓴다.** 봉인의 실제 1선은 구조다(안내 진입점이 좌표를 인자로 받지 않는다). 브리핑과 안내의 출발지가 다를 수 있다는 사실은 시작 전에 알린다 — 웹은 단일 live region에 합치고 iOS는 정적 텍스트다(조회 후 포커스 이동 계약이 반대라 수단이 갈린다).
라벨은 `origin` 유무가 아니라 **마지막 판정 결과까지** 본다(`isManualLocationVerified`, 웹↔Kit 미러). 그러지 않으면 권한 철회·실내 측위 실패에서 검증 가능형 라벨이 나와 더 나쁜 상태가 더 안심시키는 역전이 된다.
검증: 변이 주입 30종(19 + 최종 수정 11) 전부 red 실측. spec `docs/superpowers/specs/2026-08-09-manual-location-design.md`, plan `docs/superpowers/plans/2026-08-09-manual-location.md`.

### 지하철 빠른 하차 문 번호 표기 (비한국어 4로케일)
`"door {door}"`가 명사구로만 읽혀 "거기서 내려라"인지 "그게 5번 문이다"인지 갈리지 않았다. 한국어는 조사가 위치를 표시하지만 영어·스페인어·프랑스어·이탈리아어는 전치사가 필요하다. `"at door {door}"` 계열로 고쳤다.


### 이탈 판정에 방위 축을 더했다 (A6, 판정 대기)
갈림에서 사용자가 반대로 갔는데 82초 동안 안 가는 길의 스텝을 계속 낭독하던 문제. 원인은 판정 축이 수직거리 하나뿐인 것이었고, 재현해 보니 진단이 한 겹 더 있었다 — 그 경로는 ㄷ자로 돌아오는 기하라 이탈 궤적이 **경로의 다른 구간**에 가까워지면서 수직거리가 13m → 4m → 48m로 단조롭지 않았다. 임계를 낮추는 방식으로는 못 고친다(목표 시각의 수직거리가 12m로 GPS 오차와 구분되지 않는다).
진행 방위를 경로 접선과 비교하는 축을 수직거리와 **독립**으로 두고 확정을 OR로 했다. `courseAccuracy`를 통과권이 아니라 불확실성으로 써 `mismatch`/`match`/`unknown` 3-state로 표결하며, 창의 분포로 확정·해제한다. 2-state 다수결은 잡음이 독립일 때만 성립하고 지속 편향에서는 오류를 반복 관측으로 승격시킨다. 축마다 latch를 따로 들어 복귀는 활성 축이 모두 해제될 때만 성립한다.
⚠ **이 변경은 A6을 닫지 않는다.** 상수는 전부 잠정값이고 실보행 로그가 정본이다(spec §6·§7). 보수적 출발점으로 임계를 60에 두었다 — 잡음 모델 실측에서 45는 검출을 54→27초로 줄이지만 가혹 조건 헛경고가 23%였고 60은 54→46초에 4.0%였다. 시각장애 사용자에게 거짓 이탈 경고는 지연보다 해롭다는 판단이다. 축은 보행 전용이고(`GuideTuning.courseAxisEnabled`) 웹은 방위 불확실성 필드가 없어 꺼져 있다. spec `docs/superpowers/specs/2026-08-09-off-route-course-axis-design.md`, plan `docs/superpowers/plans/2026-08-09-off-route-course-axis.md`, 계약 `docs/INTEGRATIONS.md` §이탈 판정 방위 축.

### 도보 안내 fix 진단 로그 (실험 빌드 전용)
방위 축 파라미터를 정할 근거를 만든다. 매 fix의 원시 센서값(위치·정확도·course·courseAccuracy·속도·모션·age)과 판정 결과(국면·진행거리·수직거리·그 fix의 표·창의 표 분포·축 latch·판정)를 남긴다. 게이트를 통과시킨 결과만 남기면 게이트가 무엇을 걸렀는지 알 수 없고, 그 판단이 옳았는지가 파라미터 확정의 핵심 질문이다. 릴리스 빌드에서는 no-op이다.

## 2026-08-08

### 이탈 후 재조회가 실제로 현재 위치를 쓴다
위원장 실보행(자택 → 고우헤어)에서 발견. 이탈해서 "경로 다시 조회"를 눌러도 새 위치 기준 안내가 오지 않았다. 원인이 셋이었다. 웹은 `fetchGuideRoute`가 공유 위치 스토어를 force 없이 읽어 세션 최초 좌표로 같은 경로를 다시 받아 왔고(스토어에 TTL이 없어 한 번 `ready`가 되면 갱신되지 않는다), iOS는 재조회 **성공** 통지만 기본 우선순위라 버튼이 사라지며 커서가 중지 버튼으로 옮겨가는 낭독에 잠식됐으며(같은 함수의 실패 경로는 `.high`였다), 두 플랫폼 모두 성공 통지가 첫 안내 문장 하나뿐이라 그것이 새 경로인지 원래 경로의 다음 스텝인지 구분되지 않았다. 화면 출발지 필드는 길찾기 입력값이라 세션이 갱신하지 않으므로 낭독이 유일한 채널이다.
`force`는 기본값 없는 필수 인자로 뒀고(생략이 조용한 결함이 되는 자리다), 재조회 통지는 시작 통지와 같은 구조로 "현재 위치에서" 다시 찾았음과 새 경로의 규모를 함께 준다. 시작 조회를 정밀 재취득으로 바꾸면서 GPS 락 대기 창이 넓어져, 그동안 간략 안내가 상세 시작 요약보다 먼저 나가는 이중 발화가 생길 수 있었다 — iOS에만 있던 `awaitingRoute` 억제를 웹에 이식해 막았다(독립 리뷰 검출). 회귀 가드는 `src/hooks/__tests__/useRouteGuide.reroute.test.tsx`이고 세 축 모두 변이 주입으로 검출을 확인했다.

### 마지막 몇 미터 — 경로 종점 이후 오프셋 구간 안내
도보 경로는 목적지가 아니라 가장 가까운 보행로 지점에서 끝난다(실측 오프셋 16~89m). 종전 인계는 "경로 잔여 50m"였고 그 판단은 "경로 종점 = 목적지"를 전제했으므로, 오프셋 89m 목적지에서는 실제 목적지까지 139m 지점에서 경로 추종이 꺼지고 그 뒤로 아무 말도 하지 않았다. 이제 경로를 종점까지 따라간 뒤 남은 오프셋 구간을 직선으로 다루고, 종점에서 목적지의 배치(방향·거리·기준 도로명)를 1회 서술한 다음 15초 주기로 짧게 통지하며 도착까지 간다. 시간 상한은 두지 않는다.
오프셋의 거리·방향은 경로 수신 시점에 폴리라인에서 결정론적으로 계산되므로 GPS·나침반이 필요 없다. 실시간 상대 방향은 `course` 3-state 게이트를 통과할 때만 말한다.
정본: [spec](docs/superpowers/specs/2026-08-08-final-approach-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-08-final-approach-guidance.md) · [조사](docs/research/RESEARCH-2026-08-08-last-few-meters.md).

### 지하철 빠른하차 출입문 병치
하차역·방향별로 계단·엘리베이터에 가장 가까운 칸·문을 승차 전에 안내한다. 서울교통공사 빠른하차 데이터 2,358행을 정적 seed로 굳혀 런타임 upstream 호출이 없다. 1~8호선 범위이고 분기역·급행·방면 미확정은 침묵한다.
정본: [spec](docs/superpowers/specs/2026-08-08-subway-quick-exit-design.md) · [plan](docs/superpowers/plans/2026-08-08-subway-quick-exit.md). 백로그 E5 종결.

### 계단 회피가 실시간 안내까지 전달
브리핑에서 계단 회피를 켜고 안내를 시작하면 안내가 따라가는 경로는 계단 회피가 꺼진 기본 경로였다. 안내 세션이 현재 위치 기준으로 재조회하면서 `accessible`을 빠뜨렸고, 화면과 귀가 다른 경로를 가리키는데 어느 쪽도 오류를 내지 않아 실패가 조용했다.
정본: [spec](docs/superpowers/specs/2026-08-08-walk-guidance-stepfree-design.md) · [plan](docs/superpowers/plans/2026-08-08-walk-guidance-stepfree.md). 백로그 A4·D1 종결.

### 백그라운드 사운드·톤 커버리지
잠금·백그라운드에서 톤도 음성도 들리지 않던 것을 톤은 남기고 음성만 억제하는 구조로 바꿨다. 안내 톤 판정을 배타적 계층(신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축)으로 재편하고, 정지 판정을 도플러 3-state로, fix 부재 감시를 타이머 워치독으로 세웠다. 소리 9종.
정본: [spec](docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md) · [plan](docs/superpowers/plans/2026-08-08-background-tone-coverage.md).

## 2026-08-07

### 길찾기 화면 재편
ODsay 정규화를 "정규화(전체) → 강등(전체) → 선정(5) → 축 라벨" 파이프라인으로 교체했다. 종전에는 선정이 강등보다 앞이라 운행 중인 유일한 무환승 경로가 목록 밖에 묻혔다. 대안 축은 최단·최소환승 둘이고 운행 시간 밖 경로는 축 후보에서 뺀다. 도보 구간에 거리·행선지를 실었다.
정본: [spec](docs/superpowers/specs/2026-08-07-directions-view-restructure-design.md) · [plan](docs/superpowers/plans/2026-08-07-directions-view-restructure.md).

### 안내 문장 어순 재배치
자동차 실주행 피드백에서 출발. 한 자리에 완결 서술문과 목적지 명사가 번갈아 들어와 낭독이 어긋났다("…300미터 이동까지 약 129미터"). 틀을 값 타입별로 둘로 갈랐다: 서술문은 `{거리} 앞 {안내}`, 목적지는 `{목적지}까지 {거리}`.

### 대중교통·도보 문구 다듬기
같은 계열 결함이 대중교통·도보에도 있는지 전수 점검했고 없음을 확인했다. 실사용 지적 3건을 반영: 승·하차에 조사 추가(`{역}에서 승차`), 수단별로 갈리던 단위를 `{count} 정거장`으로 통일, 버스 번호에 `{route}번 버스` 표기. 도보 안내문은 provider 원문 재조합 금지 계약을 뒤집고 서버가 다시 쓰도록 바꿨다(거리 침묵 39%·괄호 도로명·"왼쪽길로" 3건이 근거).

## 2026-08-06

### 실시간 안내 실사용 피드백 라운드1 (M0~M5)
위원장 실승차 피드백 13건에서 출발한 마일스톤. M0 즉효 4건, M1 추적 정보 품질, M2 대기 국면 탈출구·계측, M3 경유역 목록·도보 핸드오프, M4 속도 가드·백그라운드 위치 승격, M5 대안 경로에서 안내 시작. 경로 대안 데이터원 채택은 보류(백로그 E6).
정본: [plan](docs/superpowers/plans/2026-08-06-realtime-guidance-feedback-r1.md).

### TAGO 지하철 API 업스트림 복구
`resultCode 01 "서비스키는 필수입니다"`가 포털 개편 작업 오류로 확인되어 조치됐다(2026-08-04 오류신고 회신). 코드 변경 0으로 소비자 3곳(역 시간표·대중교통 경로 지하철 구간·지하철 4-state)이 전부 정상 복귀했다.

## 2026-08-04

### 실시간 길 안내 봉인 후 1.3 출시
수단별 경로 안내가 실주행·실승차 판정 대기이고 거리 추적은 그 마일스톤의 중간 계단이라 단독 출시가 성립하지 않아 두 층을 함께 봉인해 내렸다. 봉인은 revert가 아니라 플래그다.

### 실험 기능은 빌드 구성이 가른다
플래그를 손으로 고치던 방식을 폐기하고 `Experimental` 빌드 구성을 신설했다. 실험판은 번들 ID `.dev`·표시 이름 "…실험"·전용 아이콘으로 공식판과 한 기기에 공존한다. 릴리스마다 코드를 고칠 일이 없어졌다.

### data.go.kr 평문 http hang 수정
프로덕션 대중교통 길찾기가 71초 걸려 앱 타임아웃으로 실패했다. `apis.data.go.kr`에 평문 http로 붙으면 TCP 연결까지는 되고 응답이 오지 않는다(같은 요청이 https로는 0.07초). 세 파일 https 전환 + 10초 타임아웃. 실측 71초 → 0.89초.

### B2: 대중교통 실시간 길 안내
수단별 진입점의 마지막 수단. 신호 정본은 GPS가 아니라 도착 API의 차량·열차 식별자다. 차량 도착과 사용자 하차를 구분해, 도착은 자동 통지하되 다음 구간 전환은 사용자 확인으로 둔다.
정본: [spec](docs/superpowers/specs/2026-08-04-transit-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-04-transit-guidance.md).

## 2026-08-03

### B1: 수단별 안내 진입점 재편 + 자동차 안내
길찾기 뷰 수단 섹션마다 "도보/자동차 안내 시작"을 두고, 리듀서를 수단별 프로파일로 갈랐다(차량은 임박·예고·이탈 임계가 도보와 다르다).
정본: [spec](docs/superpowers/specs/2026-08-03-mode-entrypoints-car-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-03-mode-entrypoints-car-guidance.md) · [조사](docs/research/RESEARCH-2026-08-03-mode-specific-guidance.md).

### 실시간 길 안내(E4)
"거리 추적"이 "실시간 길 안내"로 확장됐다. 간략(직선거리)·상세(경로 추종형, 도보·ko 전용) 2모드를 한 시트에서 제공한다. 사운드 8종을 위원장 청취로 선정해 교체했다.
정본: [spec](docs/superpowers/specs/2026-08-03-realtime-route-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-03-realtime-route-guidance.md).

### 실사용 피드백 묶음 A
"현재 안내 반복" 버튼 제거 확정, "가까워지는 중" 통지를 잔여 거리 적응형 사다리로 완화(멀어지는 중은 경고라 50m 고정 유지 — 비대칭이 정책이다), 상세 모드에 경로 기준 잔여 거리·예상 시간 상시 표시.

### GEO 대응
소개·FAQ 페이지 + JSON-LD + llms.txt 프로덕션 검증.

## 2026-08-02

### 위치 정확도 A3
단발 위치 취득이 게이트(30m·10초)+타임아웃+세대 토큰으로 바뀌고, 정밀 위치 꺼짐이 별개 상태가 됐다. "정확한 위치 허용" 버튼이 그 자리에서 시스템 팝업을 띄운다.
정본: [spec](docs/superpowers/specs/2026-08-02-location-accuracy-design.md).

### 거리 표기 정본 통일
"1km 200m" 나눠쓰기를 하루 만에 폐기하고 소수 km 원값(`1.1km`·`6.285km`)으로 되돌렸다. 3벌 정본(웹·Swift·CLI)에 가드가 없어 지역 사본 4곳이 갈려 있었고, 그중 CLI·iOS 도보 요약은 850m를 `0.8km`로 내고 있었다. 드리프트 가드 3종 신설.

### 거리 추적 실보행 통과
위원장 실보행에서 목적지 거리 추적이 정상 작동해 백로그 F-b가 닫혔고 B1이 확정됐다. 추적 시트를 "시작 = 표시, 중지 = 닫힘"으로 1:1 묶어 "닫혔는데 추적은 살아 있는" 상태를 없앴다.
정본: [spec](docs/superpowers/specs/2026-08-02-beacon-feedback-design.md).

### TAGO 미커버 지역 버스 안내
강릉에서 터미널·역 바로 앞에서도 0건이라 "주변에 정류소가 없습니다"가 낭독되던 거짓말을 고쳤다. 조회 반경이 약 700m 고정이라 0건 대부분은 미커버가 아니라 정상적인 반경 밖이고, 판정을 0건일 때만 발동시키자 인접 지역 반례가 전부 사라졌다.
정본: [spec](docs/superpowers/specs/2026-08-02-bus-uncovered-region-design.md). 백로그 A2 종결.

### 지역별 미제공 표기 + 지하철 최근접 역
따릉이·문화행사처럼 서울에만 있는 도메인을 조회 없이 즉답한다. 판정선은 그 도메인의 조회 반경에서 유도해 상수 복제를 없앴다. 지하철은 거리가 전국에 연속 분포해 어떤 임계값도 자의적이라 판정 대신 최근접 역을 싣는다.

부수로 seed 좌표 혼입을 잡았다: 경의중앙선 양원역 레코드에 동명이역인 영동선 양원역(경북 봉화)의 좌표가 들어 있었다.

### 내 주변 지하철 4-state
심야에 근접역이 전부 사라져 "주변에 지하철역이 없습니다"가 낭독되던 것을 고쳤다. 실시간 API의 `INFO-200`이 "운행 시간 밖"과 "실시간 미제공 역"에 함께 쓰이는데 후자로만 읽어 역을 숨겼다. 역은 어떤 상태에서도 목록에서 빼지 않고 4-state로 가른다.

### 스크린리더 통지 문장 전수 정리
"잠시 후 다시 시도해 주세요"류 자명한 꼬리 문장을 걷어냈다(여러 문장 문자열 41 → 35건). 판정선은 "뒷문장이 새 정보를 주는가"다. `route.briefing.disclaimer`의 "실제 경로는 길찾기 앱을 이용하세요"는 잉여인 데다 타 앱 사용 권유로 읽혀 특히 제거 대상이었다.

### 포커스 착지 2건
길찾기 탭 시트 확정 후 커서가 최상단으로 이탈하던 것과, "이 장소 주변" 4종이 로드 완료 후에도 커서가 네비게이션 바에 남던 것. 공유 계층 `NearbyFocusLander`로 시퀀스를 한 곳에 뒀다.

## 2026-08-01

### 실시간 인구 혼잡도
서울 `citydata_ppltn` 116개 영역. 종전 보류 사유("영역 경계 미공개")가 사실이 아니었음이 드러났다 — 전체 `citydata`의 지하철역·버스정류장 좌표가 그 영역을 정의한다. 판정은 중심-반경 원이 아니라 최근접 구성 지점 300m다.
정본: [spec](docs/superpowers/specs/2026-08-01-realtime-congestion-design.md) · [plan](docs/superpowers/plans/2026-08-01-realtime-congestion.md).

### 근처 문화행사
서울 `culturalEventInfo`. 10번째 "내 주변" 도메인. 안전한 페이지 절단선이 없어(진행 중 행사가 183~18,587행에 흩어짐) 전수 수집을 일자 키 캐시로 감쌌다.
정본: [spec](docs/superpowers/specs/2026-08-01-nearby-culture-events-design.md) · [plan](docs/superpowers/plans/2026-08-01-nearby-culture-events.md).

### data.go.kr envelope 파서 공용화
중복이 6벌이 아니라 25지점이었다. 9벌이 같은 모양을 다르게 읽어 원시값을 감싼 유령 항목(전 필드 `undefined`)과 조용한 전멸을 만들고 있었다. 설계 경계는 "모양은 공용, 봉투 정책은 provider".
정본: [spec](docs/superpowers/specs/2026-08-01-datagokr-envelope-design.md) · [plan](docs/superpowers/plans/2026-08-01-datagokr-envelope.md).

### 좌표 파라미터·서울 열린데이터 위장 제거
오류로 보이지 않는 오류 둘을 걷어냈다. 좌표 누락이 `Number("")===0`으로 (0,0)이 되어 `200 {"outOfCoverage":true}`로 나가던 것(라우트 14곳)과, 무효 키가 `/json/` 경로에서도 200 + XML을 주어 `Unexpected token '<'`로 원인을 지우던 것. 정적 가드 2개로 재발 차단. 백로그 D2·D3 종결.

### 지하철 구간 운행 시간 판정
ODsay가 출발 시각을 반영하지 않아 심야에 첫차 04:00 노선을 추천하던 결함의 지하철 축. 버스 축은 2026-08-01 별건으로 처리했다.
정본: [spec](docs/superpowers/specs/2026-08-01-subway-service-hours-design.md) · [plan](docs/superpowers/plans/2026-08-01-subway-service-hours.md).

### ODsay 심야 결함 수정 (버스 축)
노선 운행시간을 조인해 leg에 `serviceStatus`를 싣고 안정 정렬로 강등한다. 분기는 도시 코드가 아니라 TOPIS 보유 여부로 가른다(TOPIS가 수도권 광역 노선도 갖는다).
정본: [spec](docs/superpowers/specs/2026-08-01-odsay-service-hours-design.md) · [plan](docs/superpowers/plans/2026-08-01-odsay-service-hours.md).

### iOS 목적지 거리 추적 이식
판정을 Kit 순수 함수로 내리고 `BeaconModel`을 얇은 껍데기로 뒀다(앱 타깃에 테스트 번들이 0건이라 앱에 두면 검증이 구조적으로 불가능하다). 웹 원본의 잠복 결함도 함께 잡았다: 도착음이 매 fix 반복되던 것.
정본: [spec](docs/superpowers/specs/2026-08-01-ios-distance-beacon-design.md) · [plan](docs/superpowers/plans/2026-08-01-ios-distance-beacon.md).

### iOS 장소 상세 "이 장소 주변"
버스 도착·따릉이·날씨/공기질(2026-08-02에 지하철 추가로 4행). 데이터 계층은 이미 있었고 없던 것은 "현재 위치 대신 장소 좌표로 앵커하는 길" 하나뿐이었다.
정본: [spec](docs/superpowers/specs/2026-08-01-ios-place-nearby-design.md) · [plan](docs/superpowers/plans/2026-08-01-ios-place-nearby.md).

### Google Maps provider 후보 평가 (도입 없음)
Gemini SDK Maps grounding은 길동무 인증 모드에서 400으로 사용 불가. Routes API는 한국 도보·자동차가 200 + 빈 배열(도쿄 대조군은 정상이라 지역 제약 확정)이라 후보 탈락. TRANSIT은 시간대 반영·근거리 응답이 우위이나 도보 안내 문장이 없어 낭독 정본 계약에 미달. Places는 ko 열위·en 우위. 이 평가가 위 ODsay 심야 결함을 부수로 드러냈다.

## 2026-07-31

### 1.1 출시
1.0 승인 후 쌓인 110커밋. en 스토어 로컬라이제이션이 이 제출과 함께 공개됐다.

### Gemini 전용 GCP 프로젝트 분리
`GEMINI_API_KEY`가 Converters·dodo-planet과 공유하는 프로젝트에 묶여 사용량 귀속이 불가능했다. model 라벨 분리도 성립하지 않았다(dodo도 같은 모델을 쓴다). `gildongmu-prod` 신설.

### 과금·쿼터 상태 리포트
`node scripts/usage-report.mjs`가 돈·가용성·시한·걱정불필요 4섹션을 평문으로 낸다. 200에 오류를 담는 벤더 4종은 judge로 가른다.
정본: [spec](docs/superpowers/specs/2026-07-31-usage-cost-report-design.md) · [plan](docs/superpowers/plans/2026-07-31-usage-cost-report.md).

### iOS Nearby 상태 골격 추출
11개 모델이 각자 갖고 있던 `load()` 상태 머신을 Kit `NearbyLoadCore`로 수렴시켰다. 취소 결함도 함께 닫혔다.
정본: [spec](docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md) · [plan](docs/superpowers/plans/2026-07-31-ios-nearby-skeleton.md).

### `@google/genai` 2.15.0 업그레이드
breaking change가 Interactions API에만 있어 해당 없음을 확인하고 진행. 프로젝트 분리와 별도 커밋으로 나눴다(한 번에 하면 장애 시 키 문제와 SDK 문제를 가를 수 없다).

## 2026-07-30

### 1.0 App Store 승인·출시
2.1(a) 반려 1회 대응 후 승인. 반려 사유는 홀드 받아쓰기를 비-VoiceOver 심사자가 짧게 탭했을 때 무반응으로 보인 것이고, 기본값을 탭 토글로 바꿔 대응했다.

### 옴니박스 중심 웹 IA 재편
홈을 "길찾기"·"내 주변" 칩 2개로 축소하고 nearby 10종을 허브 뷰로 옮겼다. 딥링크 압축·채팅 진입 수렴.
정본: [spec](docs/superpowers/specs/2026-07-30-omnibox-web-ia-redesign-design.md) · [plan](docs/superpowers/plans/2026-07-30-omnibox-web-ia-redesign.md).

### 웹 nearby 중복 추출
9종이 복붙하던 상태 머신·렌더 골격을 `useNearbyFetch`+`NearbyPanelShell`로 수렴시키고 잠복 결함(닫힌 패널의 늦은 응답)을 닫았다.
정본: [spec](docs/superpowers/specs/2026-07-30-nearby-dedup-design.md) · [plan](docs/superpowers/plans/2026-07-30-nearby-dedup.md).

### 자동차 경로 ko 기본 Tmap 전환
도보와 반대 구도로, Tmap `description`이 도로명 포함 완성 문장인 반면 카카오 `guidance`는 도로명 없는 조각이다. 폴백은 Tmap throw 시에만 카카오모빌리티.
정본: [plan](docs/superpowers/plans/2026-07-30-car-route-tmap-primary.md).

### 장소 상세 브리핑 진입점 일원화
길찾기 뷰와 채팅 렌더 카드로 진입점을 모으고 장소 상세의 단일 수단 브리핑을 제거했다(중복).

### 레거시·중복 감사 수정 묶음
웹 UI·iOS·lib·라우트/i18n 전반.
정본: [plan](docs/superpowers/plans/2026-07-30-legacy-audit-fix-batch.md).

## 2026-07-29

### 도보 경로 카카오 기본 전환
동좌표 문체 대조 실측 근거로 방향을 역전했다(위원장 판정: "이견의 여지가 없을 정도로 카카오 우월"). 카카오는 의미 단위 병합·역사 내 이동·계단/지하보도 명시, Tmap은 미세 분절·상대방향 중심. 계단 회피 모드(`route_mode=ACCESSIBLE`)도 이때 들어왔다.
정본: [spec](docs/superpowers/specs/2026-07-29-kakao-walk-primary-design.md) · [plan](docs/superpowers/plans/2026-07-29-kakao-walk-primary.md).

### 서비스 지역 커버리지 계약 + 받아쓰기 재설계
App Review 반려 대응. 좌표 의존 라우트가 한국 밖이면 오류가 아니라 200 `{"outOfCoverage":true}`로 응답한다(3-state에 더한 4번째 정직 상태). 받아쓰기 기본값을 탭 토글로 바꾸고 홀드는 설정 선택지로 남겼다.
정본: [spec](docs/superpowers/specs/2026-07-29-coverage-contract-dictation-design.md) · [plan](docs/superpowers/plans/2026-07-29-coverage-contract-dictation.md).

### 웹→iOS 기능 갭 이식 1차
계단 회피 토글 + 보행 인프라 화면.

## 2026-07-28

### 1.0 App Store 심사 제출
스크린샷 ko 7컷, VoiceOver QA 스모크 4항목 위원장 실기기 합격으로 게이트 대체.

### 일본어(ja) 로케일
6번째 언어. iOS 설정 언어 메뉴 피커 포함.

### 나머지
"더 보기" 단계 공개를 V2 3종 라우트로 확장([plan](docs/superpowers/plans/2026-07-27-nearby-show-more-v2-three-domains.md), [웹](docs/superpowers/plans/2026-07-28-nearby-show-more-v2-web.md)), 도보 경로 횡단보도 단계에 음향신호기 주석([spec](docs/superpowers/specs/2026-07-28-walk-route-audio-signal-annotation-design.md)), 듣기 속도 설정 이식.

## 2026-07-27

### Phase 0 출시 전 방어
STT 라우트 레이트리밋+크기 상한, 채팅 웹검색 1시간 캐시, 좌표 반올림으로 캐시 키 실효화, 리전 icn1 고정, 정본 도메인 `gildongmu.dodoplanet.space` 확정.
정본: [plan](docs/superpowers/plans/2026-07-27-phase0-launch-defense.md).

### "내 주변" 장소 목록 "더 보기"
소아 진료부터 시작해 4종에 단계 공개를 도입했다. 교통 목록·보행 인프라·랜드마크는 절단 너머가 행동을 바꾸지 않아 의도적 비적용.
정본: [plan](docs/superpowers/plans/2026-07-27-nearby-show-more-v1-clinics.md).

## 2026-07-26

### 소아 진료 커버리지 확장
위원장 실사용 제보(일요일 진료 중인 강동 소아과가 "내 주변"에 없음)에서 출발. 달빛 지정 명부 단독이던 것을 일반 소아청소년과 보완 소스와 병합했다. 명부 커버리지가 6.5%였다(강동 20km에서 123곳 중 115곳 누락).
정본: [spec](docs/superpowers/specs/2026-07-26-clinic-coverage-expansion-design.md).

### 내 주변 → 장소 상세 UI 이식 (iOS)
내 주변 4종 항목을 검색 탭과 같은 상세로 통일해 로터 액션 6종을 획득했다.
정본: [spec](docs/superpowers/specs/2026-07-26-nearby-place-detail-port-design.md) · [plan](docs/superpowers/plans/2026-07-26-nearby-place-detail-port.md).

### 최근 검색 기록
검색 탭 + 길찾기 출발/도착지, 웹·iOS.
정본: [spec](docs/superpowers/specs/2026-07-26-recent-searches-design.md) · [plan](docs/superpowers/plans/2026-07-26-recent-searches.md).

## 2026-07-22

### 도보 길찾기(Tmap) + 길찾기 뷰·iOS 4탭
3수단 비교 화면 신설. 위원장 실기기 QA 통과("의도했던 기능이 잘 구현").
정본: [spec](docs/superpowers/specs/2026-07-21-walk-route-directions-tab-design.md) · [plan](docs/superpowers/plans/2026-07-21-walk-route-directions-tab.md).

### 역 상세 보강
첫차·막차 시간표 + 시설 패널 보강 그룹(음성유도기 seed·엘리베이터 폴백) + 역명 매칭 수정. 카카오 역 place_name이 "강동역 5호선" 형태라 정규화 없이는 역 섹션 전체가 죽어 있었다.
정본: [spec](docs/superpowers/specs/2026-07-22-station-detail-enrichment-design.md) · [plan](docs/superpowers/plans/2026-07-22-station-detail-enrichment.md).

### 보행 인프라 ("내 주변" 7번째)
음향신호기(서울 열린데이터 OA-15543 정적 seed) + 횡단보도·점자블록(Overpass).
정본: [spec](docs/superpowers/specs/2026-07-22-walk-infrastructure-design.md) · [plan](docs/superpowers/plans/2026-07-22-walk-infrastructure-plan.md).

## 2026-07-21

### App Store 출시 필수 요건 완비
채팅 AI 동의 게이트(5.1.2(i)), `PrivacyInfo.xcprivacy`, 웹 개인정보처리방침 5개 언어, `/api/chat` 레이트리밋.
정본: [spec](docs/superpowers/specs/2026-07-21-appstore-release-gates-design.md) · [plan](docs/superpowers/plans/2026-07-21-appstore-release-gates.md).

### 장소 결과 플랫 리스트 + 칩
버킷 섹션 그룹핑을 폐지했다. 고정 섹션 서열이 정확도 1위를 최하단 '기타'에 매몰시킨 실측 6사례가 근거다. 분류는 순위를 결정하지 않는다.

## 2026-07-20

### 정확도순 검색 전환
거리순을 폐지하고 정확도순+좌표 블렌딩으로 바꿨다. 랜드마크가 자연히 부상하면서 명소 전용 라우트가 중복이 되어 함께 폐지했다.
정본: [spec](docs/superpowers/specs/2026-07-20-accuracy-first-search-design.md) · [plan](docs/superpowers/plans/2026-07-20-accuracy-first-search.md).

### iOS 받아쓰기 WhatsApp식 홀드
누른 동안 녹음·떼면 확정. 위로 밀면 잠금(일시정지+확정), 왼쪽으로 밀면 취소. 실기기 3차에 합격했고, 그 과정에서 SwiftUI 제스처 조합을 UIKit 인식기 계층으로 교체했다(List 스크롤 팬 경합·VO pass-through 드래그 유실).

### iOS 채팅 멀티 턴 먹통 수정
몇 턴 대화 후 앱 전면 무응답. 먹통 생존 상태에서 CPU 리포트를 회수·심볼화해 `LazyVStack`의 lazy 크기 추정 진동 루프로 확정하고 eager `VStack`으로 교체했다.

## 2026-07-19

### iOS 다국어(5개 언어) + 설정 언어 픽커
웹 `messages/{locale}.json` 정본에서 결정론 스크립트로 String Catalog를 생성한다. Bundle이 언어 협상을 프로세스 시작 시 1회만 캐싱해 앱 내 즉시 전환이 안 되던 것을 언어별 `.lproj` 직접 조회로 해결했다.
정본: [spec](docs/superpowers/specs/2026-07-19-ios-i18n-design.md) · [plan](docs/superpowers/plans/2026-07-19-ios-i18n.md).

### iOS 제목 메뉴 + 테마
새로고침·설정 메뉴, 테마 3택.
정본: [spec](docs/superpowers/specs/2026-07-19-ios-title-menu-refresh-theme-design.md) · [plan](docs/superpowers/plans/2026-07-19-ios-title-menu-refresh-theme.md).

## 2026-07-18

### iOS 채팅 탭
3탭 전환(채팅·검색·내 주변). 실기기 VoiceOver에서 산문이 통짜 객체 하나로 낭독되던 것을 블록 분할로 고쳤다.
정본: [spec](docs/superpowers/specs/2026-07-18-ios-chat-tab-design.md) · [plan](docs/superpowers/plans/2026-07-18-ios-chat-tab.md).

### iOS 단축어(App Intents) + 유휴 복귀 초기화
"길동무 음성 검색"·"내 주변" Siri 진입.
정본: [App Intents spec](docs/superpowers/specs/2026-07-18-ios-app-intents-shortcuts-design.md) · [유휴 리셋 spec](docs/superpowers/specs/2026-07-18-idle-reset-title-refresh-design.md).

### TestFlight 외부 테스터 배포 개시
App Store Connect 앱 신규 등록(App ID 6792234349).

## 2026-07-16

### CLI(`gildongmu`) + MCP(`gildongmu-mcp`) npm 첫 발행
REST 카탈로그를 중계하는 씬 클라이언트. 버전별 이력은 [CLI CHANGELOG](packages/cli/CHANGELOG.md)·[MCP CHANGELOG](packages/mcp/CHANGELOG.md).
정본: [spec](docs/superpowers/specs/2026-07-15-cli-mcp-design.md) · [plan](docs/superpowers/plans/2026-07-15-cli-mcp.md).

## 2026-07-06 ~ 2026-07-10

### iOS 네이티브 재작성 (M0~M6b)
SwiftUI 앱 신설. M0 검색, M1 장소 상세, M2 내 주변·위치, M3 역 상세·날씨/공기질, M4 경로 브리핑, M5 장소 채팅, M6 음성 받아쓰기, M6b 웹 동등성 누락분 7건.
정본: [spec](docs/superpowers/specs/2026-07-06-ios-native-rewrite-design.md) · plans `2026-07-06~10-ios-native-rewrite-m*.md`.

## 2026-07-04

### ODsay 대중교통 프로덕션 해소
apiKey가 발급 시점 플랫폼에 묶여 Server 앱 키로는 referer 식별이 안 됐다. URI 전용 앱을 새로 만들고 서버 fetch에 `Referer`를 명시해 해결했다.

### dodo-planet 전량 이식 완결
Phase A~E 이식 대상 자산 전부 dodo 합류.
정본: [spec](docs/superpowers/specs/2026-07-03-dodo-full-port-design.md).

### `DistanceBeacon` 패치
훅 계층 버그 2개로 죽어 있었다. `useScreenWakeLock`이 매 렌더 새 객체를 반환해 정리 effect가 매 렌더 돌면서 `watchPosition`이 등록 직후 해제되고 있었다(시작 톤 후 fix 0회, 영원한 침묵).

## 2026-06-27 ~ 2026-06-30

- **무장애 여행 정보**(한국관광공사 KorWithService2) — [spec](docs/superpowers/specs/2026-06-30-barrier-free-travel-design.md)
- **현재 위치 정위 카드**(where-am-i) — [spec](docs/superpowers/specs/2026-06-28-where-am-i-location-card-design.md)
- **자연어 검색 라우터 폐기**: Gemini 라우터를 통째로 제거하고 장소·주소·웹 항상 병렬 3섹션으로 회귀했다. deterministic 검색 위에 LLM 재해석을 얹으니 "위스키바→바→미용실"로 멀쩡한 쿼리가 악화됐다. [plan](docs/superpowers/plans/2026-06-27-remove-search-router-parallel-web-section.md)

## 2026-06-20 ~ 2026-06-24

- **채팅 에이전틱 전환**(Gemini function calling) — [spec](docs/superpowers/specs/2026-06-20-chat-agentic-workflow-design.md) · [chat interface](docs/superpowers/specs/2026-06-20-chat-interface-design.md)
- **장소별 채팅**(장소 앵커 불변식) — [spec](docs/superpowers/specs/2026-06-21-place-scoped-chat-design.md)
- **Perplexity 웹 검색** — [spec](docs/superpowers/specs/2026-06-21-perplexity-web-search-design.md)
- **내 주변 둘러보기**(카카오 카테고리+8방위) — [spec](docs/superpowers/specs/2026-06-20-surroundings-awareness-design.md)
- **이 지역 날씨**(기상청 격자 변환) — [spec](docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md)
- **목적지 거리 추적 (웹)** — [spec](docs/superpowers/specs/2026-06-20-distance-beacon-design.md)

## 2026-06-14 ~ 2026-06-19

초기 구축. 각 기능의 현재 상태는 `PROGRESS.md` 운영 표를 본다.

- **v2**: 검색→상세 흐름, 역 교통약자 편의시설(코레일), 언어 분리 UI — [spec](docs/superpowers/specs/2026-06-14-gildongmu-v2-upgrade-design.md)
- **v2.1**: 음성 받아쓰기(Deepgram), PWA 수제 서비스워커 — [spec](docs/superpowers/specs/2026-06-14-gildongmu-v2.1-voice-pwa-design.md)
- **시내버스**: TAGO 지방 + 서울 TOPIS 병합 — [TAGO spec](docs/superpowers/specs/2026-06-14-gildongmu-tago-bus-design.md) · [서울버스 spec](docs/superpowers/specs/2026-06-15-seoul-bus-api-design.md)
- **따릉이** — [spec](docs/superpowers/specs/2026-06-16-seoul-bike-design.md)
- **서울 지하철**: 교통약자 시설 9종 + 실시간 도착 + 전국 도시철도역 메타 seed
- **소아 야간·휴일 진료** — [spec](docs/superpowers/specs/2026-06-17-nearby-night-clinic-design.md)
- **공기질**(에어코리아 TM중부원점 변환) — [spec](docs/superpowers/specs/2026-06-17-air-quality-design.md)
- **아이 놀 곳** — [spec](docs/superpowers/specs/2026-06-18-kids-places-design.md)
- **대중교통 길찾기**(ODsay) — [spec](docs/superpowers/specs/2026-06-18-odsay-transit-routing-design.md)
- **주소·우편번호 검색**(juso) — [spec](docs/superpowers/specs/2026-06-19-juso-official-address-design.md)
- **검색창 3섹션 병렬** — [spec](docs/superpowers/specs/2026-06-19-unified-place-address-search-design.md)

## 2026-06-12

최초 커밋. Next.js 16 + next-intl 기반 프로젝트 신설.
