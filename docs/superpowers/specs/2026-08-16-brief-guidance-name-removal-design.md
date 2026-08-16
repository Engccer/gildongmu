# "간략 안내" 명칭 제거 — 설계 (E16 축1)

**2026-08-16** · 백로그 [E16](../../BACKLOG.md#e16-간략-안내를-개념째-지운다) 축1 · 웹·iOS 공통

---

## 1. 배경

"간략 안내"는 졸업시킬 기능이 아니라 **폐지 대상**이다(위원장 전제 정정 2026-08-16). 상세 안내가 구현 가능한지조차 모르던 시기에 시중 보행자 내비를 차용해 만든 아이디어 탐색의 산물이고, 그 탐색은 도보 상세 안내가 출시되며 끝났다.

E16은 축이 셋이고 **순서가 곧 안전**이다: **①명칭 제거 → ③비-ko에 상세 → ②웹 진입점 제거**. 웹 진입점을 먼저 지우면 아직 상세를 받지 못하는 비-ko 사용자에게 남는 것이 0이 된다.

이 문서는 **축1만** 다룬다. 축3(비-ko 상세)은 provider 계약 문제라 성격이 달라 별도 spec으로 간다(위원장 판정 2026-08-16). 축1을 축3과 묶으면 지금 실사용자가 듣는 문장의 수정이 큰 축을 기다리게 된다.

### 백로그 목록의 누락 1건

백로그 축1은 대상을 8건으로 적었으나 실제로는 **12건**이다. 빠진 것은 `guide.detailStart`("**상세 안내 시작.** 안내 {count}개, 총 {distance}. {first}")이며, **"간략"이라는 글자가 없어 문자열 검색에서 새어 나갔다.**

"상세"는 "간략"의 짝이므로 간략이 사라지면 홀로 남아 무엇과 대비되는지 알 수 없는 말이 된다. **지워야 할 것은 낱말이 아니라 대비 구조(간략↔상세)다.**

정답 형태는 이미 코드 안에 있다 — 자동차 짝인 `guide.carStart`가 "**자동차** 안내 시작"으로 **모드가 아니라 수단**으로 가른다. 도보를 "도보 안내 시작"으로 맞추면 모드 이름이 저절로 사라지고 새 어휘를 발명할 필요도 없다.

---

## 2. 목표·비목표

**목표**
- 사용자에게 노출되는 문장에서 "간략 안내"·"상세 안내"라는 **모드 이름을 없앤다**(6개 로케일 전부).
- 강등된 상태에서 사용자가 **무엇을 받는지** 문장이 스스로 말한다(위원장 선택 2026-08-16: "무엇을 주는지 말한다").
- 같은 명칭이 다시 들어오지 못하게 **결정론 가드**를 건다.

**비목표 (명시적으로 하지 않는다)**
- **강등 사유를 더 잘게 가르지 않는다.** 백로그 §5가 6갈래 표를 두었으나, 지금 2갈래가 이미 **사용자 행동을 가른다**(위치 없음 → 하늘 트인 곳으로 이동 / 그 외 → 그대로 걷는다). 사용자가 취할 행동이 같으면 한 문장이다. `fetchGuideRoute`의 반환 계약(실패 = `null`)은 그대로 둔다.
- **iOS가 강등 뒤 상세로 자동 복귀하게 만들지 않는다.** 별개 문제이고 이 축의 범위 밖이다(§7 참조).
- **코드 로직·상태 머신·i18n 키를 바꾸지 않는다.** 바뀌는 것은 **문자열 값과 가드 테스트뿐**이다.

---

## 3. 설계 리뷰 판정

**적대적 설계 리뷰 생략.** 근거: 새 불변식·판정 계층 신설 없음(3-state 분화를 명시적으로 비목표로 두었다), 새 외부 계약 없음, 문자열 값 한정이라 완전 가역. 안전·정확성 축(실보행 낭독)에 닿지만 **낭독 문안 자체를 위원장이 직접 선택**했으므로 설계 리뷰가 더할 판단이 없다.

대신 잔여 리스크는 **가드의 검출력**에 있으므로 §6의 변이 주입 실측으로 대체한다([[mutation-proves-test-detection-power]] · [[real-call-gate-weak-predicate]]).

---

## 4. 어휘 결정

| 사라지는 말 | 대체 | 근거 |
|---|---|---|
| 간략 안내 | **직선거리 안내** | 앱에 이미 있는 말이다(`beacon.straightLineNote` = "직선거리 기준입니다."). 새 어휘를 만들지 않는다 |
| 상세 안내 (전환 짝) | **경로 안내** | 이 모드의 실체가 "경로를 따라간다"이다 |
| 상세 안내 (시작 통지) | **수단 이름**(도보) | `guide.carStart`("자동차 안내 시작")가 이미 이 형태다 |

---

## 5. 대상 문자열 12건

⚠ **i18n 키는 바꾸지 않는다.** 키는 사용자에게 보이지 않는 코드 식별자이고, 바꾸면 두 가지가 함께 깨진다 — 봉인 감시 테스트 `guidance-gate-drift.test.ts`가 `"beacon.briefGuideStart"`라는 **문자열 자체를 창 검사 앵커**로 쓰고, `ios/scripts/messages-to-xcstrings.mjs`가 이 키로 iOS 문자열 카탈로그를 생성한다. 게다가 축2가 곧 지울 것들이라 개명은 낭비다.

편집 대상: `messages/{ko,en,es,fr,it,ja}.json` → `node ios/scripts/messages-to-xcstrings.mjs`로 `ios/Gildongmu/Resources/Localizable.xcstrings` 재생성(수기 편집 금지 — [[gildongmu-ios-i18n-architecture]]).

### 5.1 정식판 iOS가 실제로 듣는 2건 (최우선)

`BeaconModel.fallbackToBrief` 경로이며 봉인 플래그 밖이라 **도보 졸업 이후 정식판 사용자가 듣는다**(호출 3곳: 첫 fix 타임아웃 · 경로 nil · fetch throw).

| 로케일 | `guide.detailUnavailable` | `guide.detailNoLocation` |
|---|---|---|
| ko | 경로 정보를 가져오지 못했습니다. 목적지까지 직선거리로 안내합니다. | 현재 위치를 확인하지 못했습니다. 위치가 잡히면 직선거리로 안내합니다. |
| en | Route details unavailable. Guiding by straight-line distance to the destination. | Location unavailable. Guidance will use straight-line distance once your position is found. |
| es | No hay detalles de la ruta. Se guiará por distancia en línea recta hasta el destino. | No se pudo obtener tu ubicación. Cuando se obtenga, se guiará por distancia en línea recta. |
| fr | Détails de l'itinéraire indisponibles. Guidage à vol d'oiseau jusqu'à la destination. | Position introuvable. Le guidage se fera à vol d'oiseau dès que votre position sera trouvée. |
| it | Dettagli del percorso non disponibili. Guida in linea d'aria fino alla destinazione. | Posizione non disponibile. La guida userà la linea d'aria appena la posizione sarà disponibile. |
| ja | 経路情報を取得できませんでした。目的地まで直線距離で案内します。 | 現在地を確認できませんでした。現在地が分かり次第、直線距離で案内します。 |

⚠ **"다시 시도하면 된다"는 약속을 넣지 않는다.** iOS는 `fallbackToBrief` 이후 `awaitingRoute = false`가 되고 그 뒤 fix가 들어와도 **상세 경로를 다시 조회하지 않는다**(재조회 트리거는 목적지 변경·세션 재시작뿐). 웹에는 전환 버튼과 `resolvePending` 재시도가 있으나 iOS는 그 버튼을 2026-08-11에 폐지했다. 문장이 복구를 약속하면 iOS에서 거짓이 된다.

### 5.2 시작 통지 1건

| 로케일 | `guide.detailStart` (before → after) |
|---|---|
| ko | ~~상세 안내 시작.~~ → **도보 안내 시작.** 안내 {count}개, 총 {distance}. {first} |
| en | ~~Detailed guidance started.~~ → **Walking guidance started.** {count} instructions, {distance} total. {first} |
| es | ~~Guía detallada iniciada.~~ → **Guía a pie iniciada.** {count} indicaciones, {distance} en total. {first} |
| fr | ~~Guidage détaillé démarré.~~ → **Guidage à pied démarré.** {count} instructions, {distance} au total. {first} |
| it | ~~Guida dettagliata avviata.~~ → **Guida a piedi avviata.** {count} indicazioni, {distance} in totale. {first} |
| ja | ~~詳細案内を開始しました。~~ → **徒歩案内を開始しました。** 案内{count}件、合計{distance}。{first} |

⚠ **플레이스홀더 3개(`{count}`·`{distance}`·`{first}`)와 그 순서를 보존한다** — 어순을 바꾸면 xcstrings 위치 인자가 뒤집힌다([[guidance-template-value-type]]).

### 5.3 웹 진입·전환 UI 8건

축2가 지울 자리이나, 축2는 축3을 기다리므로 그 사이 동안 이 문장들이 계속 낭독된다.

| 키 | ko | en |
|---|---|---|
| `beacon.briefGuideStart` | 직선거리 안내 시작 | Start straight-line guidance |
| `guide.briefStarted` | 직선거리 안내 시작 | Straight-line guidance started |
| `guide.toBriefButton` | 직선거리 안내로 전환 | Switch to straight-line guidance |
| `guide.toDetailButton` | 경로 안내로 전환 | Switch to route guidance |
| `guide.toBriefDone` | 직선거리 안내로 전환했습니다 | Switched to straight-line guidance |
| `guide.toDetailDone` | 경로 안내로 전환했습니다 | Switched to route guidance |
| `guide.resolveFailed` | 현재 위치를 경로 위에서 확인하지 못해 직선거리 안내를 유지합니다 | Could not fix your position on the route; keeping straight-line guidance |
| `guide.speedSuggest` | 위치 신호가 불안정하거나 이동 속도가 빨라 직선거리 안내가 적합할 수 있습니다 | Your location signal may be unstable or you may be moving fast; straight-line guidance may fit better |

es·fr·it·ja는 §4 어휘표를 그대로 적용한다(간략→`guía en línea recta`/`guidage à vol d'oiseau`/`guida in linea d'aria`/`直線距離案内`, 상세→`guía de ruta`/`guidage d'itinéraire`/`guida del percorso`/`経路案内`).

### 5.4 손대지 않는 1건

`guide.resolvePending`("현재 위치를 파악하는 중입니다")은 모드 이름을 쓰지 않으므로 그대로 둔다.

---

## 6. 가드 — 명칭 재유입 차단

**전 로케일 파일 전수 스캔**으로 만든다. 네임스페이스 내부만 보는 검사는 실패한 전례가 있다(`manualLocation` 안만 보던 게이트가 `whereAmI.ready`="현재 위치"를 통과시켰다).

- 대상: `messages/{ko,en,es,fr,it,ja}.json` + `ios/i18n/ios-extra/*.json` **전 키 전 값**.
- 금지 표현(대소문자 무시): ko `간략 안내`·`상세 안내` / en `simple guidance`·`detailed guidance` / es `guía simple`·`guía detallada` / fr `guidage simple`·`guidage détaillé` / it `guida semplice`·`guida dettagliata` / ja `簡易案内`·`詳細案内`.
- ⚠ **낱말이 아니라 구(句)로 검사한다.** `상세`·`detail` 단독은 장소 상세 등 정당한 용례가 있어 오탐이 난다.
- 파일: `src/lib/__tests__/guidance-mode-name.test.ts` (신규).

**검출력은 변이 주입으로 실측한다** — ko 값 하나에 `간략 안내`를 되돌려 넣어 테스트가 실패하는지, 로케일 6개 각각에서 실패하는지를 확인하고 결과를 이 문서 §8에 적는다. "가드가 있다"와 "그 축이 지켜진다"는 다르다.

---

## 7. 한계 (축1이 닫지 못하는 것)

- **웹에는 여전히 두 모드 이름이 남는다** — "직선거리 안내"와 "경로 안내". 축1은 이름을 *정직한 서술어*로 바꿀 뿐이고, 그 노출을 실제로 없애는 것은 **축2**다. iOS 정식판은 전환 버튼이 이미 없어 축1만으로 **모드 이름 노출 0**에 도달한다.
- **iOS의 편도(片道) 강등은 그대로다.** 한 번 강등되면 세션 재시작 전까지 경로 안내로 돌아오지 않는다. 문장이 이 사실에 맞춰졌을 뿐 동작은 바뀌지 않았다. 되살릴 신호: 실보행에서 "경로 안내가 안 돌아온다"가 실제 불편으로 보고되면 그때 축을 연다.
- **비-ko 사용자는 여전히 경로 안내를 받지 못한다** — 축3의 몫이다.

---

## 8. 검증

| 축 | 방법 |
|---|---|
| 문자열 파리티 | `npm run test:run`의 `i18n-messages.test.ts`(6로케일 키 일치) |
| 명칭 재유입 | 신규 `guidance-mode-name.test.ts` + **변이 주입 실측**(§6) |
| iOS 카탈로그 동조 | `node ios/scripts/messages-to-xcstrings.mjs` 후 `node ios/scripts/check-xcstrings-keys.mjs` |
| 봉인 가드 무손상 | `guidance-gate-drift.test.ts`(키를 안 바꾸므로 통과해야 한다 — 통과가 곧 "키를 안 건드렸다"의 증거다) |
| 기준선 | `npm run test:run` · `npx tsc --noEmit` · `npm run lint` 전부 0/green |

**실기기 판정은 필요 없다.** 동작이 바뀌지 않고 문자열만 바뀌며, 낭독 문안은 위원장이 이미 선택했다. 다만 다음 실보행에서 강등이 자연 발생하면 §5.1 두 문장이 실제로 들리는지 귀로 확인할 수 있다(판정 항목으로 등재하지는 않는다 — 자연 발생 대기 항목을 늘리지 않는다).

---

## 9. 후속

- **축3**(비-ko에 상세): 별도 spec. 벽은 문장 틀이 아니라 `walkStepAction`의 한국어 부분 문자열 판정과 고유명사 로마자 표기다.
- **축2**(웹 진입점 제거): 축3 완주 후. 이 문서 §5.3의 8건이 그때 삭제 대상이 된다.
