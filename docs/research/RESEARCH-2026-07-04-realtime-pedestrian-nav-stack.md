# 실시간 보행 내비게이션 기술스택 조사 (2026-07-04)

> deep-research 워크플로(5각도 병렬 검색 → 소스 fetch → 주장별 3표 적대적 검증 → 종합, 하위 에이전트 103개) 결과 정본. 배경: `DistanceBeacon`(2026-06-20 spec) 보류 코드의 고도화·부활 및 dodo 이식 판단 자료. 감사 결과(비콘이 죽은 원인은 React 참조 동일성 버그 — 본문 §7)와 함께 읽을 것.

## 0. 한 줄 결론 — 경계선은 "화면 켠 포그라운드"

**화면을 켠 채 손에 들고 쓰는 거리·방향 비콘은 PWA로 구현 가능하다.** 그 전제 조건 3종(Wake Lock·오디오·GPS 정제)이 모두 검증됐다. 반면 **백그라운드·잠금화면 연속 추적과 신뢰성 있는 공간 오디오는 네이티브가 필수**이며, 하이브리드(Capacitor/RN)로 가더라도 위치·네트워크는 네이티브 계층으로 내려야 한다. 이는 기존 spec §2의 "정직한 V1(전경·화면 켬 한정)" 판단이 옳았음을 재확증한다.

## 1. 웹 PWA의 한계와 우회책 (검증 통과)

- **Screen Wake Lock**: iOS 홈 화면 PWA에서 약 2년간(Safari 16.4~) 동작하지 않다가 **iOS/iPadOS 18.4(2025-03)에서 수정**. 2026년 현재 표준 API로 화면 꺼짐 방지 가능하나 구형 iOS 사용자는 여전히 불가. [3-0] — [WebKit #254545](https://bugs.webkit.org/show_bug.cgi?id=254545), [webkit.org/blog/16574](https://webkit.org/blog/16574)
- **iOS 무음 스위치 비대칭**: 무음 스위치가 켜지면 HTML5 `<audio>`는 재생되지만 **Web Audio API는 침묵**(링거 vs 미디어 채널). 우회 정공법은 **`navigator.audioSession.type = 'playback'`(iOS 17+ 공식 API)**, 보조로 [unmute](https://github.com/swevans/unmute) 류 라이브러리(무음 `<audio>` 트릭). soundscape-web-client도 unmute를 채택. [3-0] ⚠ 단 "unmute 트릭으로 완전 우회 가능"이라는 강한 주장은 **기각(1-2)** — audioSession이 정본. — [WebKit #237322](https://bugs.webkit.org/show_bug.cgi?id=237322), [feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio)
- **첫 fix 함정과 게이팅 패턴**: 브라우저 geolocation 첫 fix는 GPS가 아닌 Wi-Fi/기지국/캐시에서 올 수 있어 수백~수천 m 오차 가능. `enableHighAccuracy:true`는 **스펙상 힌트일 뿐**('no guarantee'). `maximumAge:0`이어도 일부 기기는 캐시 위치를 첫 이벤트로 방출(RN·네이티브 이슈 다중 확증). **정본 패턴**: watchPosition 스트림에서 (a) 첫 판독은 accuracy 판정 제외 (b) desiredAccuracy(예: 20m) 도달 시 확정 (c) maxWait(예: 10s) 초과 시 최선 판독 폴백. 갓 부팅 기기에서 보통 2~6회 콜백에 수렴. [3-0 ×3] — [getAccurateCurrentPosition](https://github.com/gregsramblings/getAccurateCurrentPosition), [W3C Geolocation](https://www.w3.org/TR/geolocation/)

## 2. GPS 노이즈 처리 (검증 통과 + 기각 경계)

- **칼만 필터가 표준, 단 두 층위**: GPS(노이즈 크지만 드리프트 없음)+가속도계(정밀하지만 오차 누적)는 상보적이라 칼만 융합이 정석([mad-location-manager](https://github.com/maddevsio/mad-location-manager), GPS/INS 문헌 교차 확증). 그러나 **웹 PWA는 원시 IMU 접근이 제한적이라 풀 융합은 네이티브 영역** — 웹의 현실적 상한은 accuracy 필터링 + [kalmanjs](https://github.com/wouterbulten/kalmanjs) **1D 필터를 위도/경도에 독립 인스턴스로** 적용(저자 공식 가이드, 결합 2D 상태 모델은 구조적 불가). [3-0 ×2]
- ⚠ **"칼만 융합이 주요 노이즈 클래스를 전부 억제"는 기각(0-3)** — 과신 금물. 급격한 점프 제거·정지 시 가짜 이동 제거·단기 신호 손실 필터링 등 개별 효과 주장은 확증[3-0]되었으나 만능은 아님.
- **나침반 heading (1차 실행 확증분)**: Safari는 `deviceorientationabsolute` 미지원 → 비표준 `webkitCompassHeading`을 읽어야 하고(타 브라우저는 표준 이벤트), iOS는 사전에 `DeviceOrientationEvent.requestPermission()` 필수(사용자 제스처 내 호출). [3-0 ×2] — [w3c/deviceorientation #137](https://github.com/w3c/deviceorientation/issues/137)

## 3. 네이티브·하이브리드 대안 (검증 통과)

- **백그라운드 위치는 PWA에서 범주적 불가**(watchPosition은 백그라운드 탭에서 중단, W3C Geolocation Sensor 제안은 미출시). iOS 네이티브 경로는 `NSLocationAlwaysAndWhenInUseUsageDescription` + `UIBackgroundModes=location` — 이 권한 계층 자체가 PWA에 없는 경계선. [3-0]
- **상용**: [Transistorsoft background-geolocation](https://github.com/transistorsoft/react-native-background-geolocation)(RN·Capacitor 동일 SDK) — 모션 센서로 이동/정지 판별, 이동 중 distanceFilter(m) 간격 기록, 정지 시 위치 서비스 자동 off(배터리), `stopOnTerminate:false`+`startOnBoot:true`로 종료·재부팅 후 지속. Android 릴리스 빌드 유료, iOS 정지→이동 재감지에 ~200m 필요. [3-0, Capacitor판 2-1]
- **무료**: [@capgo/background-geolocation](https://www.npmjs.com/package/@capgo/background-geolocation)(MPL-2.0) — iOS·Android 백그라운드 위치 + 네이티브 지오펜싱, 정확도 우선 설계(하이킹 앱 기원), 2026-06 v8.1.1 활발 유지. 단 2025-07 생성으로 어리고 "정확함"은 독립 벤치마크 없음. [3-0]
- **⚠ 하이브리드의 핵심 함정 — WebView는 백그라운드에서 신뢰 불가**: Android는 백그라운드 5분 후 WebView 발 HTTP를 스로틀하고, `android.useLegacyBridge:true` 없이는 위치 업데이트의 JS 전달이 5분 후 중단(네이티브 취득은 계속되나 브리지가 끊김). **백그라운드에서 돌아야 하는 위치 취득·서버 전송은 전부 네이티브 계층(플러그인·CapacitorHttp)으로** — JS/WebView는 포그라운드 UI 전용. "하이브리드 = 웹 코드 그대로 백그라운드 동작"이라는 기대를 구조적으로 차단하는 사실. [3-0] — [capacitor-community #53](https://github.com/capacitor-community/background-geolocation/issues/53)

## 4. 오디오 피드백·대표 레퍼런스 (검증 통과 + 기각 경계)

- **Microsoft Soundscape는 네이티브 Swift iOS 앱**(원본 90.4~90.6%, 커뮤니티 포크 95.8% Swift — JS/Python은 서버·저작도구). 설계 원형: 턴바이턴 대신 **3D 공간 오디오 큐 + 오디오 비콘**(목적지 방향 드럼비트)으로 심상 지도 형성, 헤드셋 head tracking, 타 앱과 병행하는 **백그라운드 동작**(CLLocationManager+백그라운드 오디오 세션). 2023 MS 단종 후 [커뮤니티 포크](https://github.com/soundscape-community/soundscape)가 App Store 'Soundscape Community' v1.8.1(2026-04)로 활발 유지. [3-0 ×6]
- [soundscape-web-client](https://github.com/soundscape-community/soundscape-web-client)는 iPhone·Android·Windows 브라우저 어디서나 동작하는 **플랫폼 비종속성**을 실증[3-0]. 그러나 **"브라우저만으로 Soundscape류 완전 구현 가능"은 기각(0-3)** — 웹 동작은 포그라운드 한정, 백그라운드·잠금화면 동등성 없음. 같은 repo가 Android용 Capacitor 래핑을 병행 유지하는 것 자체가 순수 브라우저 한계의 방증.

## 5. 증거 공백 (후속 조사 필요 — 이번 검증에서 생존 주장 없음)

- **한국 보행 경로 API(TMAP 보행자 등)·map matching·위치 스냅** (조사 축 6 전체): 생존 주장 전무. TMAP 보행자 경로 API 존재는 알려져 있으나 이번 검증을 통과한 소스 없음 — 턴바이턴 확장 검토 시 별도 실호출 조사 필요.
- **BlindSquare·Lazarillo·한국 앱(G-EYE Plus 등)** 접근 방식: 동일하게 공백. fetch 단계에서 SKT VLAM(이미지 기반 측위, 사전 3D 스캔 공간 평균 오차 1m 이내 주장, LBS테크 G-EYE Plus 실증 계획) 뉴스룸 기사가 수집됐으나 검증 미통과 — 미검증 단서로만 기록.
- dead reckoning: 생존 주장 없음.

## 6. 기각된 주장 (오판 방지용 기록)

| 주장 | 표결 |
|---|---|
| Wake Lock이 iOS 브라우저에선 되고 홈 화면 PWA에서만 안 됐다(16.4 실측) | 0-3 (18.4에서 수정 확정으로 대체) |
| unmute 트릭으로 무음 스위치를 웹 코드에서 완전 우회 가능 | 1-2 |
| 칼만 융합이 스마트폰 GPS 노이즈 주요 클래스를 전부 억제 | 0-3 |
| 브라우저 웹 클라이언트만으로 Soundscape류 완전 구현 가능 | 0-3 |
| soundscape-web-client의 Capacitor 병행이 "PWA→Capacitor 승격 전략"의 실증 | 0-3 (일반화 과잉) |

## 7. gildongmu 권장 경로 (감사 결과와 결합)

**감사 결론(2026-07-04, 세션 감사)**: `DistanceBeacon`이 죽은 원인은 설계가 아니라 훅 계층 버그 2개 —
1. **치명**: `useScreenWakeLock`이 매 렌더 새 객체를 반환하는데 `useDistanceBeacon`의 정리 effect가 `[wakeLock]` 의존 → **추적 시작 직후 리렌더에서 방금 등록한 watchPosition이 즉시 `clearWatch`로 제거**(시작 톤 후 영원한 침묵). 최초 커밋(fd8d0fc)부터 존재. 수정: 안정 참조 반환(useMemo) 또는 정리 effect `[]`+ref.
2. **2차**: `routeTone`의 단일 공유 2초 throttle을 hold tick이 점유해 핵심인 closer/farther 톤이 소실. 수정: 톤 우선순위 분리.

**Stage 1 — PWA에서 비콘 완성(포그라운드 한정, 조사로 실현 가능성 확증)**:
- 위 버그 2개 수정 + 첫 fix 게이팅 패턴(§1) + accuracy 필터(+선택: kalmanjs 1D×2) 도입.
- 오디오: `navigator.audioSession='playback'`(iOS 17+) 우선, unmute 폴백 검토. Wake Lock은 iOS 18.4+에서 PWA 지원 확인됨(구형 iOS 한계 고지 유지).
- 방향 안내 확장 시: `webkitCompassHeading`(Safari) + `DeviceOrientationEvent.requestPermission()`(제스처 내).
- 머지 게이트: repo 원칙대로 **실보행 스모크**(fixture green ≠ 실계약).

**Stage 2 — Soundscape류 경험(백그라운드·공간 오디오)이 목표가 되는 시점**: Capacitor 래핑 + 네이티브 위치 플러그인(무료 capgo vs 상용 Transistorsoft), 위치·네트워크는 네이티브 계층 고정(§3 함정). dodo 이식 로드맵과 합류 지점에서 판단.

## 8. 한계 고지

Transistorsoft·capgo 근거는 벤더 문서 비중이 높음. Wake Lock(18.4)·audioSession(17)은 최근 변화라 구형 iOS 점유율에 따라 실사용 커버리지 상이. 문헌 검증과 실기기 실측의 갭은 이 조사가 못 메움 — 스택 결정 전 프로토타입 실보행 테스트 필수.
