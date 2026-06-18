# ODsay 대중교통 길찾기 — 설계 계약

> 작성: 2026-06-18 / 상태: 설계 승인 완료, 구현 대기
> 전제: ODsay `apiKey` 발급(`ODSAY_API_KEY`) — 사용자 작업, 미발급 시 기능 게이트로 미노출

## 1. 목적·배치

출발지→도착지 **대중교통(버스+지하철 환승) 경로를 텍스트로 "출발 전 미리 듣기"** 하는 기능. 길동무의 기존 "내비게이션은 딥링크 위임" 원칙을, **자동차 텍스트 브리핑(`CarRouteBriefing`)과 동형으로 대중교통까지 확장**한다(실주행 추적이 아니라 경로 미리보기 — 실주행은 여전히 딥링크 위임).

- **배치**: 장소 상세에 "여기까지 대중교통 길찾기" 버튼(자동차 브리핑 옆). 누르면 같은 페이지에 `TransitRouteBriefing` 패널 전개.
- **소스 결정**: 서울 시내버스 data.go.kr 키가 `ws.bus.go.kr`로 전파되지 않아(2026-06-18 이틀째 미동작, `seoul-bus-api-design.md`) 막힌 상황의 우회로이자 상위 기능. ODsay 자체 서버가 TOPIS/공공데이터와 연동해 경로를 제공하므로 `ws.bus.go.kr` 전파 문제를 우회한다.
- **궁극 목표**: dodo-planet 통합 시 외국인·시각장애인 대중교통 이동 지원의 1급 기능.

## 2. 데이터 소스

- **API**: ODsay 대중교통 길찾기 `GET https://api.odsay.com/v1/api/searchPubTransPathT`
  - 파라미터: `SX`(출발 경도) `SY`(출발 위도) `EX`(도착 경도) `EY`(도착 위도) `OPT=0`(추천정렬) `apiKey`.
  - 응답: `result.path[]`(경로 배열) — 각 `path`는 `info`(요약) + `subPath[]`(구간).
- **무료 한도**: Basic 1,000회/일, 개인·학생·5인 이하 스타트업, **앱 등록 후 6개월 무료**. 국문만(다국어 유료).
- **키**: `ODSAY_API_KEY`(서버 전용). **⚠ apiKey는 URL 인코딩된 값을 재인코딩하면 깨짐** — 인코딩 처리 주의.
- **⚠ 필드명·인코딩·에러코드는 pre-merge 실호출로 확정**(fixture green ≠ 실계약). ODsay 문서와 실응답이 어긋날 수 있으므로 강동 길동 기준 실호출로 필드명을 잠근다.

## 3. 불변식 (잠금)

### I1. 공통 shape — ODsay 종속 격리 (`providers/odsay.ts`, 순수)
```ts
TransitRouteResult { recommended: TransitRoute; alternatives: TransitRoute[] }  // 대안 최대 2
TransitRoute {
  summary: { totalMinutes; fare; transfers; walkMinutes; departName?; arriveName? }
  legs: TransitLeg[]
}
TransitLeg {
  mode: "walk" | "bus" | "subway"
  lineName?; fromName?; toName?;  // ODsay 한국어 원문 그대로 (en도 lang="ko")
  stationCount?; minutes
}
```
컴포넌트·route는 ODsay 필드명을 모른다. 향후 유료 전환·API 교체 시 shape만 맞추면 됨(이식성).

### I2. 정규화 — `normalizeOdsayRoute(odsayResponse)`
- `result.path[0]`=추천, 다음 2개=대안(있으면).
- `subPath.trafficType`: **1=지하철 / 2=버스 / 3=도보**.
  - 도보: `sectionTime`→minutes(정류장 없음). **거리/시간 0 도보 구간 skip**.
  - 버스: `lane[0].busNo`→lineName, `startName`/`endName`, `stationCount`, `sectionTime`.
  - 지하철: `lane[0].name`→lineName, 나머지 동일.
- `transfers` = **탑승 leg(버스+지하철) 수 − 1**(ODsay `*TransitCount` 정의 불확실 → leg 수 기반이 안전).
- 지하철 출구·상세 좌표는 V1 비포함(YAGNI).

### I3. 브리핑 텍스트 — deterministic 조립 (next-intl ICU, latent 아님)
ODsay는 완성 문장을 안 주므로(자동차 `guidance`와 다름) leg→문장을 **코드로 조립**. 요약 + 번호 매긴 구간 `<ol>/<li>`가 낭독 정본.

| ko | en (구조 영문, 고유명 한국어 원문) |
|----|----|
| 총 35분, 1,500원, 환승 1회 | 35 min, 1,500 won, 1 transfer |
| 도보 5분 | Walk 5 min |
| {역}에서 {노선} 승차, N정거장 | Board {노선} at {역}, N stops |
| {역}에서 {노선} 환승, N정거장 | Transfer to {노선} at {역}, N stops |
| 도보 3분, 도착 | Walk 3 min, arrive |

역명·노선은 ODsay 한국어 원문을 ICU 변수로 주입, en에서도 `lang="ko"`.

### I4. 입력·UX (접근 A 인라인)
- 기본: **현재위치(geolocation) → 장소** 자동 조회.
- "출발지 바꾸기" → 인라인 검색(기존 검색 로직 재사용) → 선택 좌표가 새 출발지로 재조회.
- in-flight ref 가드 + `aria-disabled`(기존 a11y), request-id ref로 stale 응답 폐기.

### I5. 3-state 에러 (경로없음 ≠ 조회실패 — 프로젝트 반복 invariant)
- **geolocation 거부/실패** → "조회 실패" 아님. *출발지 검색 지정* 안내로 폴백.
- **대중교통 경로 없음**(`outTrafficCheck`·경로 부재) → "경로를 찾지 못했습니다" graceful(빈 결과, 502 아님).
- **upstream 장애**(ODsay `error`·HTTP 실패) → throw→502, 에러 메시지 ko/en 번역.

### I6. 게이트·캐싱·mock
- `canShowTransit = hasOdsayKey()`. 키 없으면 버튼 미노출.
- **mock 폴백 없음**(실데이터 원칙). 키 없음→미노출, 장애→502.
- route `revalidate: 3600`(경로 준정적, 1,000회/일 쿼터 보호. `no-store` 아님).

## 4. 구현 매핑

| 파일 | 책임 |
|------|------|
| `src/lib/providers/odsay.ts` | 순수: fetch + `normalizeOdsayRoute` + 브리핑 조립 헬퍼. `hasOdsayKey()`. |
| `src/app/api/route/transit/route.ts` | `coordSchema`(car route 재사용), origin/dest 검증, normalize 호출, revalidate 3600, 3-state 에러. |
| `src/components/TransitRouteBriefing.tsx` | `CarRouteBriefing` 동형. geolocation 출발, 출발지 변경 인라인 검색, 추천 1개 + 대안 펼치기, polite live region. |
| 장소 상세 컴포넌트 | "여기까지 대중교통 길찾기" 버튼(게이트 `canShowTransit`). |
| `messages/ko.json`·`en.json` | 브리핑 ICU 메시지(구조 영문, 고유명 변수). |

## 5. 테스트 (게이트, 결정적)

- `normalizeOdsayRoute` fixture: 도보/버스/지하철 leg 투영, 환승 계산, 거리 0 도보 skip, 추천/대안 분리(path[0]+다음 2개), `outTrafficCheck`·error 분기.
- 브리핑 조립: leg→문장(ko/en), 환승/단일수단/도보전용 케이스.
- **pre-merge 실호출 게이트**: 실 ODsay 키로 강동 길동→목적지 호출, 필드명·shape 실응답 확정 + fixture 캡처.

## 6. 접근성

- 리스트/텍스트 정본(지도 없음). 요약+구간 `<ol>/<li>`.
- 단일 polite live region(조회 완료·오류). "다른 경로 보기" `<button aria-expanded>`.
- 키보드 도달 + `:focus-visible`, 터치 44px, en 고유명 `lang="ko"`. 불필요 region/landmark 없음(First Rule of ARIA).

## 7. 전제조건 (사용자 작업)

1. ODsay [lab.odsay.com](https://lab.odsay.com) 회원가입 → 애플리케이션 등록 → `apiKey` 발급.
2. `.env.local`에 `ODSAY_API_KEY`, 프로덕션 Vercel env 등록. ⚠ URL 인코딩 재인코딩 금지.
