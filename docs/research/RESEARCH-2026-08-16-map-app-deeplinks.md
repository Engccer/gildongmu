# 지도 앱 길찾기 딥링크 규격 비교 (E17 선행)

> 조사 시점 2026-08-16. **시점 고정 기록물** — 특히 Tmap은 공식 문서가 없는 스킴이라 예고 없이 깨질 수 있다.
>
> 대상: 길찾기 화면에서 3수단 비교를 읽은 뒤 실주행으로 넘어갈 경로(BACKLOG E17).

## 핵심 판정: Tmap 보행 딥링크는 "확인 불가"

**공식 문서 자체가 없다.** SK Open API 포털·`tmapapi.tmapmobility.com` 모두 SDK와 REST API 문서만 제공하고 앱 스킴 문서가 없으며, 커뮤니티에 통용되는 두 형식(`tmap://route`, `tmap://navigate`) 어디에도 **이동수단 파라미터가 없다**. 딥링크로 열면 차량 내비 안내로만 진입한다고 보는 것이 현재 근거로 말할 수 있는 전부다.

⚠ Tmap 앱 자체는 2026-08-03 도보 길안내를 출시했으나(뉴스핌 보도), **그 기능이 URL 스킴으로 열리는지는 어떤 출처에서도 확인되지 않았다.** 앱에 기능이 있다는 것과 딥링크로 도달할 수 있다는 것은 다르다.

**반면 도보·대중교통 딥링크는 네이버 지도와 카카오맵 둘 다 공식 문서로 확인된다.**

## 비교표

| 항목 | 네이버 지도 | 카카오맵 | Tmap |
|---|---|---|---|
| 출처 등급 | 공식 | 공식 | **공식 없음**, 커뮤니티 |
| 스킴 | `nmap://route/{mode}?...&appname=` | `kakaomap://route?sp=&ep=&by=` | `tmap://route?rGoName=&rGoX=&rGoY=` |
| 도보 | **지원** `/route/walk` | **지원** `by=foot` | 확인 불가 |
| 대중교통 | **지원** `/route/public` | **지원** `by=publictransit` | 확인 불가 |
| 자동차 | `/route/car` | `by=car` | 지원(사실상 유일 동작) |
| 자전거 | `/route/bicycle` | `by=bicycle` | 없음 |
| 좌표 표기 | `slat`/`slng`·`dlat`/`dlng` 개별 | `sp=위도,경도`·`ep=` 콤마 결합 | `rGoX`=**경도**, `rGoY`=**위도** |
| 출발지 생략 | 현위치가 기본값(문서 명시) | **문서 미기재** | 현위치(커뮤니티) |
| 필수 | `dlat`·`dlng`·**`appname`** | `sp`·`ep`·`by` | `rGoName`·`rGoX`·`rGoY` |
| 경유지 | `v1lat`~`v5lat` 최대 5 | `vp`~`vp5` 최대 5(대중교통 미지원) | `rV1Name` 등(커뮤니티) |
| 미설치 폴백 | 문서에 App Store·`market://` 명시 | 웹 폴백 `m.map.kakao.com/scheme/route` 명시 | 자동 폴백 없음 |
| `LSApplicationQueriesSchemes` | `nmap` | `kakaomap` | `tmap` |

## 구현 함정 셋

1. **카카오맵은 앱 스킴과 웹 링크의 수단 이름이 다르다.** 앱은 `car`/`publictransit`/`foot`/`bicycle`, 웹 링크(`map.kakao.com/link/by/{모드}/...`)는 `car`/`traffic`/`walk`/`bicycle`/`subway`다. 같은 값으로 양쪽을 조립하면 **웹 폴백만 조용히 틀린다.** 단 `m.map.kakao.com/scheme/route` 경로는 앱과 같은 이름을 쓴다.
2. **좌표 축 이름이 Tmap만 반대다.** `rGoX`가 경도, `rGoY`가 위도라 네이버·카카오 조립 코드를 복사하면 위경도가 뒤집힌다. ⚠ **뒤집힌 좌표도 한국 범위 안에 떨어질 수 있어**(위도 37 / 경도 127) 오류 없이 엉뚱한 위치로 안내된다.
3. **네이버는 `appname`이 필수**이며 빠지면 동작하지 않는다. 문서는 "앱 또는 웹 페이지를 식별하는 문자열"로만 규정하고 번들 ID 필수 여부는 명시하지 않는다(예시는 번들 ID 형태).

참고: 네이버 문서가 적은 좌표 유효 범위(위도 31.43~44.35 · 경도 122.37~132.00)가 우리 `isInKorea`(`src/lib/coverage.ts`)와 **동일하다.**

## 확인 불가 항목 (실기기로 닫히는 것과 아닌 것)

**실기기에서 한 번에 판정되는 것**:
- `tmap://route`와 `tmap://navigate` 중 현행 형식.
- 카카오맵 `sp` 생략 시 현위치 대체 여부.
- 카카오맵 `by=foot`·네이버 `/route/walk`가 여는 화면(경로 결과인가 내비 시작인가). 문서에 화면 수준 기술이 없다.

**실기기로도 안 닫히는 것**:
- Tmap 도보·대중교통 **공식 지원 여부**. 실기기로는 "안 열린다"까지만 알 수 있고, 공식 확인은 `tmap@sk.com` 문의가 유일한 경로다.
- 문서 없는 스킴이라는 사실 자체(예고 없는 파손 위험).

## 설계에 주는 함의

E17의 "선택지를 몇 개 줄 것인가"에 조사가 답을 좁힌다: **도보·대중교통 위임은 네이버·카카오 2개가 현실적 최대치**이고, Tmap은 자동차에서만 성립한다. 수단별로 노출 벤더가 갈리는 설계가 되며, 이는 "죽은 버튼 금지"(키 게이트 패턴 동형) 규율과 맞물린다.

## 출처

- 네이버(공식): https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc
- 카카오(공식): https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/ · https://apis.map.kakao.com/android_v2/docs/api-guide/urlscheme/
- Tmap(**비공식** 커뮤니티): https://www.clien.net/service/board/cm_iphonien/17853569
- Tmap 도보 서비스 출시 보도: https://www.newspim.com/news/view/20260803001150
- Tmap 공식 자원(앱 스킴 문서 부재 확인): https://tmapapi.tmapmobility.com/ · https://openapi.sk.com/
