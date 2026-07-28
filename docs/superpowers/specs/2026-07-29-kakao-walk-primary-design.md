# 도보 경로 기본 provider 카카오 전환 + Tmap 폴백 + 계단 회피 모드 (2026-07-29)

> 적대적 설계 리뷰(codex, 2026-07-29) 반영 개정본. 주요 반영: 계단 회피 상태 union·안전 문구의 결정론 삽입·병합 스텝 주석 생략·fetch 단위 캐시·unknown status fail-closed·유료 전환 미신청 유지.

## 배경·목표

동일 좌표 4구간 실호출 문체 대조(2026-07-29, PROGRESS 검증 로그)로 위원장 판정 확정: 출발 전 미리 듣기 브리핑 용도에서 카카오 도보 안내문이 Tmap보다 우월하다. 근거는 ① 의미 단위 스텝 병합(동구간 20 vs 29스텝) ② "역사 내 이동"·"계단이용"·"지하보도 이용" 등 수직 이동·맥락 명시(Tmap은 전부 무언급) ③ 교차로명·상호 기반 목적지형 안내. 이에 따라:

1. **도보 경로 기본 provider를 Tmap에서 카카오로 전환**하고, Tmap은 카카오 실패 시 폴백으로 강등한다.
2. **계단 회피 모드(카카오 `route_mode=ACCESSIBLE`)를 신설**한다: 계단을 우회하고 역 진출입을 엘리베이터로 안내하는 경로. Tmap에는 없는 축이라 카카오 전용.

- 측정 가능한 성과: ① 같은 좌표쌍의 도보 브리핑이 카카오 문체(역사 내 이동·계단 명시)로 나온다(실호출 게이트) ② 카카오 강제 실패 시 Tmap 브리핑으로 응답이 계속되고 폴백 원인이 서버 로그에 남는다 ③ 계단 회피 모드에서 실측 확정 구간(서울역→서울로7017)의 우회 경로가 나오고, 무계단 경로 부재 구간(광나루한강공원→천호역)은 기본 경로+사유 문장으로 응답한다.
- 실주행 딥링크 위임(`nmap://`·`kakaomap://`)·대중교통(ODsay)·자동차 경로는 이 spec 범위 밖(현행 유지).

## 실측 근거 (2026-07-22·07-29 실호출, 재조사 금지)

- 엔드포인트: GET `https://dapi.kakao.com/v2/routing/walk`, 헤더 `Authorization: KakaoAK`(기존 `KAKAO_REST_API_KEY` 재사용, 신규 키 없음). 파라미터 `start_x`/`start_y`/`end_x`/`end_y`(x=경도, y=위도), `route_mode`(미지정=기본, `ACCESSIBLE`=계단 회피).
- envelope: **top-level `route` 단수 객체**(`routes` 배열 아님) + top-level `status`. `route.legs[].steps[].properties.guidance`가 한국어 완성 문장, `steps[].path.points`가 `[lng,lat]` 폴리라인. `route.properties.totalDistance`(m)/`totalTime`(초)/`landingUrl`(카카오맵 딥링크).
- 경로 불가: HTTP 200 + `status: "TOO_FAR_AWAY"` 또는 `"ROUTE_RESULT_NOT_FOUND"` + 빈 `legs`.
- ACCESSIBLE 실차이: 계단 회피 우회(서울역→서울로7017 765m→1,019m)·역 진출입 엘리베이터 안내·무계단 경로 부재 시 `ROUTE_RESULT_NOT_FOUND` 거부. 지하보도는 회피 대상 아님(계단 특정 회피로 추정). 평지는 기본 모드와 사실상 동일 경로.
- 도보 API 별도 활성화 불필요: 공유 앱 키 무활성화 200 실증(2026-07-22). "키 존재 ≠ 도보 권한" 우려는 이 실측으로 반박됨(prod 실호출 게이트가 재확인).
- **en 미지원**: `lang`·`Accept-Language` 무시, guidance 한국어 고정. 도보 V1 ko 전용은 그대로(en 공백 해소 불가 종결, 2026-07-22).
- 쿼터: 경로 API 일 1,000건 무료. **dodo-planet과 같은 카카오 앱 공유**(도보 쿼터 풀은 도보끼리 1,000건).

## 아키텍처

```
라우트(/api/route/walk) ─┐
                          ├─▶ walk-route.ts (서비스) ─▶ kakao-walk provider (기본)
채팅 get_walk_route ─────┘         │                        │ throw 시
                                   │                        ▼
                                   │                    tmap-pedestrian provider (폴백)
                                   └─ 음향신호기 주석(annotateAudioSignals) 후 좌표 제거
```

- **신규 provider `src/lib/providers/kakao-walk.ts`**: 카카오 응답을 `WalkRouteBriefing`으로 정규화하는 순수 provider. guidance 완성 문장이 낭독 정본(turnType류 재조합 금지, Tmap description 원칙 동형). 각 step의 `coord`는 `path.points` 첫 좌표(진입점)를 `{lat,lng}`로 투영(내부 전달용, 서비스가 주석 후 제거). 모든 leg의 steps를 순서대로 평탄화(첫 leg만 취하기 금지). 빈 guidance 스텝은 안내 단계에서 제외(Tmap의 description 없는 Point 제외 원칙 동형).
- **fail-closed 정규화**: 경로 불가는 **실측 확정 status 2종(`TOO_FAR_AWAY`·`ROUTE_RESULT_NOT_FOUND`)만** graceful `null`. 그 외 미관측 status·스키마 위반(route/legs 부재, 총거리·시간 비유한, guidance 전멸)은 **throw**(upstream 장애로 취급 → 폴백 경로). 미관측 status를 null에 흡수하면 장애가 "경로 없음"으로 뭉개진다.
- **`walk-route.ts` 서비스가 provider 선택·폴백을 소유**(라우트·채팅은 계속 `getWalkRoute()`만 호출, provider 직접 호출 금지 유지):
  - `hasKakaoKey()`면 카카오 호출. **카카오 throw 시에만 Tmap 폴백**(`hasTmapKey()`면). 카카오가 정상 판정한 "경로 없음"(`null`)은 폴백 없이 `null`이 정본이다: 폴백은 가용성 장치이지 커버리지 보강 장치가 아니다. null-폴백은 "카카오 없음·Tmap 있음" 실관측 근거가 생기면 추가(추측 금지).
  - 카카오 fetch에 **타임아웃 명시**(예: `AbortSignal.timeout(8_000)`, 값은 구현 시 확정): 무한 대기는 throw가 아니라 폴백이 영영 발동하지 않는다. Tmap 폴백에도 동일 타임아웃.
  - 카카오 키 없으면 Tmap 단독(현행 동작). 둘 다 없으면 기능 미노출. 둘 다 throw면 throw(502). 폴백 성공 시 응답은 Tmap 브리핑 그대로(문체 혼합 없음).
  - **폴백 발동 시 서버 로그에 원인 기록**(`console.warn`: 좌표 반올림값·오류 요지): 전면 폴백은 "카카오 전환 실패"의 은폐 모드다. Vercel 로그로 폴백률을 관측할 수 있어야 배포 직후 파서 회귀를 조기 발견한다. 응답 스키마에 provider 필드는 넣지 않는다(사용자 행동을 바꾸지 않음: 정직성 표기는 API 계층 계약 판정 동형).
- **게이트 통일**: `env.ts`에 `hasWalkRouteKey() = hasKakaoKey() || hasTmapKey()` 신설. `page.tsx` `canShowWalk`·`/api/route/walk` 라우트 가드·채팅 `router.ts` declaration 게이트가 기존 `hasTmapKey()` 단독 참조를 이것으로 교체. 게이트·provider 선택이 같은 술어를 쓰는지 테스트로 고정(split-brain 금지). 키 조합 4종(両·카카오만·Tmap만·無) × 동작을 fixture로 고정.

## 계단 회피 모드 (ACCESSIBLE)

- **서비스 시그니처 확장**: `getWalkRoute({origin, dest, accessible?: boolean})`. `accessible: true`면 카카오에 `route_mode=ACCESSIBLE`.
- **상태는 boolean이 아니라 union**: 응답에 `stepFree?: "applied" | "no_stepfree_route" | "unavailable"` 필드. **accessible 요청 시 항상 존재**(요청했는데 부재면 구현 결함, 테스트로 고정), 미요청 시 필드 자체 부재(기존 응답 byte-호환, 기존 클라·iOS·CLI 영향 0). boolean이면 "무계단 경로 없음"·"provider가 지원 안 함"·"카카오 장애 강등"이 한 값에 뭉개진다.

| 상황 | 경로 | `stepFree` |
|---|---|---|
| ACCESSIBLE 경로 있음(계단 문구 없음) | 해당 브리핑 | `applied` |
| ACCESSIBLE 응답에 "계단" guidance 존재(계약 위반 방어) | 해당 브리핑 | `no_stepfree_route` |
| `ROUTE_RESULT_NOT_FOUND`(무계단 경로 부재) | **기본 모드 재호출** 브리핑 | `no_stepfree_route` |
| 카카오 throw → Tmap 폴백(동등 모드 없음) | Tmap 일반 브리핑 | `unavailable` |
| Tmap 단독 배포에 accessible 요청 | Tmap 일반 브리핑 | `unavailable` |
| 기본 모드도 경로 없음 | `null` | (응답 없음) |

- **안전 문구는 LLM·클라이언트에 맡기지 않고 서비스가 브리핑에 결정론 삽입**: `stepFree`가 `applied`가 아니면 steps 맨 앞에 안내 문장 1개를 넣는다("계단 없는 경로를 찾지 못해 일반 경로를 안내합니다. 계단이 포함될 수 있습니다." / `unavailable`은 "계단 회피 경로를 조회하지 못했습니다. …"). 계단 회피를 요청한 사용자가 계단 있는 경로를 받는 것은 안전 정보라 침묵 금지인데, 웹 UI 문구만으로는 채팅(LLM이 축약 가능)·CLI/MCP가 커버되지 않는다. 문장 삽입이 안전 계약의 정본이고 `stepFree` 필드는 UI 상태 판정용.
- **`applied` fail-closed**: ACCESSIBLE 성공 응답이라도 guidance에 계단 문구가 있으면 `applied`를 선언하지 않는다(위 표 2행). 안전 속성을 "파라미터 전송 성공"과 동일시하지 않는다.
- **라우트 파라미터는 엄격 파싱**: 쿼리 `accessible`은 부재(기본)·`true`·`false`만 허용, 그 외 값은 400(`limit` 계약 동형). 안전 옵션의 오입력을 기본 모드로 조용히 강등하지 않는다.
- **채팅 도구**: `accessible` boolean 파라미터를 declaration에 추가하되 긍정 트리거로 서술("계단 회피·엘리베이터 경로를 명시 요청할 때만 true"). 안전 문구는 위 삽입 문장이 data에 이미 포함되므로 LLM 재량과 무관하게 전달된다.
- **UI(웹 V1)**: `DirectionsView` 도보 수단에 토글 1개("계단 없는 경로"). 토글 시 재조회하며 **기존 request-id ref 패턴으로 stale 응답 폐기**(검색과 동형: ACCESSIBLE은 not_found 시 재호출까지 있어 기본 요청보다 느릴 수 있고, 토글 연타 시 늦은 응답이 화면을 덮는다). `?dir=` URL 동기화에 accessible 토큰 포함(새로고침·뒤로 가기 후 토글과 경로의 모드 일치 복원). `stepFree` 사유는 삽입 문장이 브리핑에 이미 있으므로 별도 표기·별도 live region 신설 금지. iOS 토글은 후속 phase(스키마가 옵트인이라 iOS는 이번 배포로 변경 0, 기본 문체 개선은 즉시 수혜).

## 음향신호기 주석 호환 (재캘리브레이션 필수)

`annotateAudioSignals`는 서비스 계층이라 provider 교체와 독립이지만, **매칭 반경 40m는 Tmap Point 좌표 분포(4~15m vs 127m+)로 캘리브레이션된 값**이라 카카오 스텝에 이월 금지. 규칙:

- 판정 좌표는 스텝 폴리라인 **첫 점 하나만**(coord 타입 계약 유지). 폴리라인 전체 최근접점 방식은 긴 스텝일수록 우연 매칭이 늘어 도입하지 않는다.
- **병합·복수 횡단보도 스텝("2개의 횡단보도 이용" 류 수량 표현)은 주석 생략**: seed 1개 매칭으로 문장 전체에 "음향신호기 있음"이 붙으면 나머지 횡단보도에도 있다는 거짓 안전 정보가 된다. positive-only의 연장: 특정할 수 없으면 침묵.
- 구현 시 **단일 횡단보도 스텝의 첫 좌표 × OA-15543 seed 거리 분포를 실측 재대조**(2026-07-28 spec의 대조 방법 재사용). 합격 기준: 신호기 **있는** 횡단보도(양성)와 **없는** 횡단보도(음성)를 모두 포함한 구간에서 **거짓 양성 0**(안전 정보라 미탐보다 오탐이 해롭다). 분리가 무너지면 반경 축소 또는 주석 보수적 생략. 결과·확정 반경은 PROGRESS에 기록.
- positive-only·쉼표 흡수·응답 전 coord 제거 계약은 그대로.

## 캐시·쿼터·비용 방어

- **캐시는 provider fetch 단위**(upstream GET 응답, Next fetch `revalidate: 3600` + 좌표 4자리 반올림 유지, 카카오 URL에 `route_mode` 포함이라 모드별 캐시 자연 분리). 서비스 최종 응답을 캐시하지 않으므로: ① 일시 장애로 나온 Tmap 폴백 결과가 1시간 고착되는 문제 없음(카카오 fetch 실패는 캐시되지 않고 다음 요청이 카카오 재시도) ② ACCESSIBLE not_found 후 기본 모드 재호출은 같은 좌표의 기본 fetch 캐시를 자연 재사용(2배 호출은 캐시 미스 시에만) ③ 채팅·라우트가 같은 fetch 캐시를 공유(채팅 우회 없음. 채팅은 자체 레이트리밋 60초 10회 별도 보유).
- IP 레이트리밋 60초 10회(`/api/route/walk`) 유지.
- **카카오 앱의 유료 전환(과금 동의)을 신청하지 않은 상태를 유지한다**: 미신청 상태에서 쿼터 초과는 과금이 아니라 오류 응답이고, 오류는 throw → Tmap 폴백이라 **무과금 + 가용성이 동시에 성립**한다. 유료 전환 신청은 비용 하드 스톱(위원장 승인 사안). 구현 시 카카오 developers 콘솔에서 현 앱의 유료 전환 여부를 확인하고 PROGRESS에 기록(신청돼 있으면 초과가 조용히 과금되므로 위원장에게 해제 여부 확인). 쿼터 초과 응답 코드는 실관측 시 기록(추측 금지).
- 일일 사용량 하드캡 카운터는 만들지 않는다(YAGNI: 미신청 유지 시 초과=오류=폴백이라 비용 상한이 구조적으로 0원. dodo 도보 이식 시 재평가).

## 경계·불변식

- **guidance 완성 문장이 낭독 정본**: 스텝 문장을 자르거나 재조합하지 않는다(안전 문구는 별도 스텝 삽입이지 기존 문장 개변 아님).
- **3-state 유지**: 키 없음(미노출) ≠ 경로 없음(null) ≠ upstream 장애(502). `stepFree`는 이 위에 얹는 옵트인 축.
- **개인정보 3자 일치 점검**: 좌표 전송 제3자로서의 카카오는 기존(장소 검색·자동차 경로)과 동일 주체. 단 점검은 "Tmap 명시 여부"만이 아니라 **위치정보 전송 목적 서술**까지: 웹 `/{locale}/privacy`·iOS `PrivacyInfo.xcprivacy`·ASC 라벨이 카카오 전송 목적을 "장소 검색·자동차 길찾기" 식으로 한정 서술했다면 도보 경로 산출 목적을 추가해 세 곳 동시 갱신(불일치는 심사 사유).
- **CLI/MCP 카탈로그**: `/api/route/walk`에 `accessible` 파라미터·`stepFree` 응답 필드가 생기므로 `endpoint-catalog-shared.ts` 両미러 동조 갱신(drift 테스트 강제). 발행(cli-v 태그)은 다음 릴리스에 편승(옵트인 파라미터라 구버전 CLI 동작 불변).
- **Tmap 키·provider는 제거하지 않는다**: 폴백 정본으로 유지. `tmap-pedestrian.ts` 변경 0(주석의 "기본" 서술만 폴백으로 갱신).

## 테스트·검증 계획

fixture 단위테스트(전부 같은 커밋 동반):
1. 카카오 정규화: 정상(다중 leg 평탄화·빈 guidance 제외·coord 첫 좌표)·경로 불가 2 status→null·미관측 status→throw·스키마 위반(legs 부재·비유한 총거리)→throw.
2. 폴백 분기: 카카오 throw→Tmap / 카카오 null→폴백 없이 null / 둘 다 throw→throw / 키 조합 4종 × 게이트·선택 정합(split-brain).
3. ACCESSIBLE: 표 6행 전부(applied·계단 문구 fail-closed·not_found 재호출·재호출마저 throw·Tmap 단독·null) + accessible 요청 시 `stepFree` 필수 존재 + 안내 문장 삽입 + 라우트 오입력 400.
4. 주석: 단일 횡단보도 매칭·수량 표현 스텝 생략·coord 없는 스텝 생략.

머지 게이트 실호출(전부 실측 좌표 보유):
1. 기본 전환: 강동역→길동생태공원이 카카오 문체(1스텝 "강동역 2번 출구까지 역사 내 이동")로 응답.
2. 폴백: 로컬 기동에서 카카오 키 무효화로 Tmap 브리핑 응답 + 폴백 로그 확인 후 원복(prod 폴백은 로그 관측 계약으로 상시 감시).
3. ACCESSIBLE: 서울역→서울로7017 우회 경로+`stepFree: "applied"`, 광나루한강공원→천호역 기본 경로+`no_stepfree_route`+안내 문장.
4. 주석 재캘리브레이션: 분포 재대조·거짓 양성 0 확인·PROGRESS 기록.
5. 경로 없음: 서울→제주 좌표 `null`(TOO_FAR_AWAY graceful) 유지.
6. `npm run test:run`·`lint`·`build` 전부 통과, push 후 prod 실호출 재확인.
