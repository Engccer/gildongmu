# 목적지 거리 비콘 (Distance Beacon) — 설계 계약

**날짜**: 2026-06-20 · **상태**: 구현 착수 · **게이트**: 없음(브라우저 geolocation, 서버 키 불필요)

## 0. 출처·동기

박정규/Plus Apps의 상용 폐쇄소스 앱 "보행자용 지도, 내비게이션"의 핵심 인터랙션 — *목적지까지 직선거리를 계속 미터로 읽어주고, 숫자가 줄면 제대로·늘면 잘못 가는 것* — 을 차용한다. 코드는 비공개라 **아이디어만** 차용. 기술 한계 조사 결과(웹 백그라운드 위치 불가·GPS 정확도 바닥)를 전제로 **정직하게 한정된 V1**을 설계한다.

설계 결정 근거: 딥리서치 한계 보고서(이 세션) + `~/.claude/CLAUDE.md` latent/deterministic·미니멀 접근성 원칙.

## 1. 목적·포지셔닝

**시각장애인이 "내가 목적지 방향으로 제대로 가고 있나"를 빠르게 확인하는 보조 비콘.** 턴바이턴 경로 안내가 아니라 **방향 감각 보조**(시행착오식: 몇 걸음 가보고 숫자가 줄면 맞는 방향). 실주행 경로 안내는 기존 **딥링크 위임 원칙**대로 네이티브 앱 몫 — 비콘은 보완재.

**배치**: 장소 상세(`PlaceDetail`)에 `<DistanceBeacon dest={{lat,lng,name}} />` 삽입(`RouteLinks` 근처, `CarRouteBriefing`/`TransitRouteBriefing`과 동형). **`canShow*` 서버 게이트 없음** — geolocation은 브라우저 기능. 미지원 브라우저면 컴포넌트 내부에서 graceful(버튼 미노출).

**측정 가능한 성과**: 사용자가 비콘을 켜고 걸을 때, 방향이 맞으면 (a) 하강이 아닌 상승 톤 (b) "가까워지는 중" 음성을 받아 방향 정정 없이 진행, 틀리면 즉시 하강 톤·"멀어지는 중"으로 되돌릴 신호를 받는다.

## 2. 솔직한 한계 (설계에 박는 전제)

1. **백그라운드/화면 꺼짐 = 위치 갱신 정지** (특히 iOS PWA는 백그라운드 위치 추적 구조적 불가). → V1은 **전경·화면 켬 한정**, Wake Lock으로 화면 유지, 시작 시 정직 고지. "주머니에 넣고 장거리 내비"는 약속하지 않는다.
2. **GPS 정확도 바닥 ~10–30m(도심 50–100m+)**. → "도착" 정밀 단정 불가 → `nearby`로 degrade("목적지 근처 약 ±Nm").
3. **직선거리 ≠ 경로거리**(강·벽·막다른 골목). → "직선거리 기준" 정적 고지.
4. **heading 미제공**(나침반 신뢰도·iOS 권한 문제) → V1은 거리+추세만. 방위는 별도 마일스톤 후보.

## 3. 아키텍처 — I/O와 결정 로직 분리

비결정적 I/O(GPS watch·Wake Lock·오디오)와 결정적 판정(거리·추세·발화여부)을 분리. 판정은 순수 함수로 잠그고 fixture 테스트(다른 provider 동형, deterministic 원칙).

| 파일 | 역할 | 의존 | 테스트 |
|---|---|---|---|
| `src/lib/beacon.ts` | **순수 리듀서** `beaconStep(state, fix, dest) → { state, announce }` | `geo.ts` haversine | ★ fixture 게이트 |
| `src/lib/beacon-tones.ts` | 톤 디스크립터(closer/farther/nearby/tick) | 없음(순수 데이터) | ★ 순수 |
| `src/hooks/useScreenWakeLock.ts` | Wake Lock 획득·재획득·해제 | 브라우저 API | I/O(게이트 외) |
| `src/hooks/useBeaconSound.ts` | 톤 재생(Web Audio 합성, `useRecordingSound` 구조) | `beacon-tones.ts` | I/O(게이트 외) |
| `src/hooks/useDistanceBeacon.ts` | **오케스트레이터** — watchPosition 생명주기 + `beaconStep` 위임 + announce 라우팅 + 정리 | 위 전부 | I/O(게이트 외) |
| `src/components/DistanceBeacon.tsx` | UI — 시작/중지 토글, polite live region, 상태·고지 텍스트 | 훅 | 실기기 스모크 |
| `messages/*.json` (×5) | `beacon.*` 키 | — | `i18n-messages.test.ts` 게이트 |

**데이터 플로**:
```
watchPosition fix {lat,lng,accuracy}
  → useDistanceBeacon: beaconStep(prevState, fix, dest)
      → beacon.ts: 거리=haversine, accuracy로 데드밴드 스케일,
                   추세 판정(flapping 억제), 발화여부 결정
      → { state, announce: { kind, distance, accuracy, speak } }
  → 라우팅: 톤(useBeaconSound, throttle) + (speak면) polite live region 음성
```

## 4. 불변식 (잠금) — `beacon.ts`

**상수**(보행 디폴트, 튜닝 가능)
- `MAX_USABLE_ACCURACY_M = 100` — 초과 fix는 거리 무의미 → 추세 제외
- `BASE_DEAD_BAND_M = 15` — 추세 뒤집는 최소 이동량
- `ARRIVAL_BASE_M = 20` — 도착 임박 기준
- `SPEAK_INTERVAL_M = 50` — 음성 거리 갱신 간격

### I1. accuracy 민감도 스케일링 (fix 폐기 X, 데드밴드 확대)
```
deadBand         = max(BASE_DEAD_BAND_M, fix.accuracy)
arrivalThreshold = max(ARRIVAL_BASE_M, fix.accuracy)
```
정확도 나쁜 지역일수록 데드밴드가 커져 노이즈로 추세가 안 뒤집힌다(칼만 없이 jitter 억제하는 가성비 핵심).

### I2. 알고리즘(우선순위 순)
1. `distance = haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng)`. 좌표 비유한(NaN)이면 `{kind:'weak'}` graceful(추세·앵커 불변).
2. **신호 약함**: `accuracy > MAX_USABLE_ACCURACY_M` → `{kind:'weak'}`, 추세·앵커 불변, 톤·음성 없음.
3. **도착 임박**: `distance ≤ arrivalThreshold` → `{kind:'nearby', accuracy}`. **정밀 숫자 대신 "목적지 근처(약 ±round(accuracy)m)"** + 도착 톤. `nearby` 래치(존 진입 1회만 발화, 머무는 동안 침묵).
4. **추세 판정**(앵커 기준 flapping 억제):
   - `distance ≤ anchor − deadBand` → `closer`, 앵커=distance, 상승 톤
   - `distance ≥ anchor + deadBand` → `farther`, 앵커=distance, 하강 톤
   - 그 사이 → `hold`: 추세·앵커 불변(미세 흔들림 무시), tick 톤(V1 포함, throttle 적용·소프트)
5. **음성 발화 여부**(`speak`): 추세 flip(`closer↔farther`) 또는 마지막 발화 후 `|distance − lastSpokenDistance| ≥ SPEAK_INTERVAL_M`일 때만 true. `lastSpokenDistance` 갱신.
6. **nearby 이탈**: `distance > arrivalThreshold + deadBand`면 래치 해제(추세 재개).

### I3. 첫 fix
앵커 = 첫 수용 거리, 추세 `none`, `{kind:'first', speak:true}` → "목적지까지 약 Nm" 1회.

### I4. announce 디스크립터
`{ kind: 'first'|'closer'|'farther'|'hold'|'nearby'|'weak', distance: number, accuracy: number, speak: boolean }`. 순수 로직은 "무엇을 알릴지"만 결정 — "어떻게 소리낼지"(톤 종류·throttle·live region 텍스트)는 오케스트레이터(I/O).

## 5. 피드백 라우팅

### 톤 (`beacon-tones.ts` + `useBeaconSound.ts`)
- `CLOSER` 상승 2음(660→990) · `FARTHER` 하강 2음(990→660) · `NEARBY` 밝은 더블 도착음 · `TICK` 낮은 단음 소프트(hold 하트비트, "추적 중" 연속감 — 톤 우선 선택 반영, V1 포함)
- 훅에서 **최소 ~2초 간격 throttle**(fix 폭주 시 톤 스팸 방지). Web Audio 합성(OscillatorNode, lazy AudioContext, 미지원·음소거 graceful no-op — `useRecordingSound` 동형).

### 음성 (단일 `aria-live="polite"`)
- `announce.speak`일 때만 텍스트 갱신. assertive 미사용, 순차 단일 채널(a11y 규칙).
- 문구: first "목적지까지 약 {meters}m" / closer "{meters}m, 가까워지는 중" / farther "{meters}m, 멀어지는 중" / nearby "목적지 근처 (약 ±{meters}m)" / weak "신호 약함".

## 6. Wake Lock (`useScreenWakeLock.ts`)
- 시작 시 `navigator.wakeLock.request('screen')`. `visibilitychange`에서 문서 가시화 + 비콘 활성 + 락 해제 상태면 재획득. 중지·언마운트 시 해제.
- **미지원·거부는 graceful no-op** — 비콘은 계속 돈다(화면 꺼지면 멈추는 건 고지된 한계, 차단 사유 아님).

## 7. 생명주기·에러 (`useDistanceBeacon.ts` + `DistanceBeacon.tsx`)
- 컴포넌트 상태: `idle | tracking | denied | unsupported`.
- **시작**: `navigator.geolocation` 없으면 `unsupported`(버튼 미노출). 있으면 `watchPosition(onFix, onError, {enableHighAccuracy:true, timeout:15000, maximumAge:0})` + Wake Lock 획득 + 시작 톤. 상태 `tracking`.
- **onFix** → `beaconStep` → 톤·음성·상태 텍스트 라우팅.
- **onError**: `PERMISSION_DENIED` → `denied`(추적 중지, Wake Lock 해제, "위치 권한이 필요합니다"). `POSITION_UNAVAILABLE`/`TIMEOUT` → 추적 유지, 상태 "신호 약함"(일시적, 죽이지 않음).
- **중지**(토글/언마운트): `clearWatch` + Wake Lock 해제 + 오디오 정리 + 정지 톤 → `idle`. 포커스는 토글 버튼 유지.
- **가드**: `mountedRef`(언마운트 후 setState 방지), 단일 watchId ref, 시작 in-flight 가드.
- **토글 버튼**: `aria-pressed` on/off, 접근명 "거리 추적 시작/중지"(`beacon.start`/`beacon.stop`), `min-h-11`.
- **정직 고지(정적 텍스트, 항상 표시)**: `beacon.screenHint`("화면을 켜고 손에 든 채 사용하세요. 화면이 꺼지면 안내가 멈춥니다.") + `beacon.straightLineNote`("직선거리 기준입니다. 실제 경로는 길찾기 앱을 이용하세요.").

## 8. i18n
`beacon.*` 키: `heading`·`start`·`stop`·`first`·`closer`·`farther`·`nearby`·`weak`·`denied`·`screenHint`·`straightLineNote`. **5개 언어 전부**(ko/en/es/fr/it). 숫자는 `{meters}` ICU 플레이스홀더. `t.rich` 불필요(고유명 없음). 외부 데이터 fetch 없음 → `dataLocale` 무관. `i18n-messages.test.ts`가 키 패리티·플레이스홀더 게이트.

## 9. 테스트 게이트
- **`beacon.ts` 리듀서 fixture ~12–15개**(매 커밋 게이트): ① 데드밴드 내 진동→추세 불변(flapping) ② 정확도 큰 fix→데드밴드 확대 ③ accuracy>100→weak ④ 추세 flip→speak ⑤ 50m 마일스톤→speak ⑥ 도착→nearby+±accuracy(정밀숫자 미노출) ⑦ nearby 이탈→추세 재개 ⑧ NaN 좌표 graceful ⑨ first→speak ⑩ hold→speak=false.
- `beacon-tones.ts` 순수 디스크립터 presence 테스트.
- `i18n-messages.test.ts` 자동 커버(키 패리티·플레이스홀더).
- 훅·Wake Lock·watch는 I/O라 node-env 테스트 없음(프로젝트 관행) → **실기기 보행 스모크가 현실 검증**(자동화 불가, 수동: 폰에서 비콘 켜고 걸으며 톤·음성·추세 확인).
- `npm run build`·`lint`·`test:run` 통과.

## 10. 비목표 (V1 제외 — YAGNI)
- heading/나침반 방위 안내(별도 마일스톤 후보).
- 백그라운드/화면 꺼짐 추적(웹 구조적 불가).
- 경로 기반 거리(직선거리만).
- 톤 가이거식 가변 간격(고정 throttle만; v2 여지).
- 음성/톤 사용자 토글 설정(기본 톤 우선+간헐 음성 고정; v2 여지).
