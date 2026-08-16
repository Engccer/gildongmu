# "간략 안내" 명칭 제거 (E16 축1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자에게 노출되는 문장에서 "간략 안내"·"상세 안내"라는 모드 이름을 6개 로케일 전부에서 없애고, 재유입을 결정론 가드로 막는다.

**Architecture:** 코드 로직은 손대지 않는다. `messages/*.json`의 **값 12건**만 바꾸고(키 불변), `ios/scripts/messages-to-xcstrings.mjs`로 iOS 문자열 카탈로그를 재생성하며, 전 로케일 파일을 훑는 금지 표현 가드를 신설한다. 가드는 변이 주입으로 검출력을 실측한다.

**Tech Stack:** Vitest(node env) · next-intl 메시지 JSON · `ios/scripts/messages-to-xcstrings.mjs` · `ios/scripts/check-xcstrings-keys.mjs`

**Spec:** `docs/superpowers/specs/2026-08-16-brief-guidance-name-removal-design.md`

**구현 방식 판정(자율성 헌장 §구현 방식 판정):** **inline.** 두 태스크가 같은 6개 파일을 순차로 만지고(수정 파일이 겹친다), 태스크 2는 태스크 1의 실측 결과를 문서에 옮기므로 선행 관계가 있다. 독립 도메인 병렬 신호 0.

## Global Constraints

- **i18n 키를 바꾸지 않는다.** `guidance-gate-drift.test.ts`가 `"beacon.briefGuideStart"` 문자열을 창 검사 앵커로 쓰고, xcstrings가 이 키로 생성된다.
- **`ios/Gildongmu/Resources/Localizable.xcstrings`를 손으로 편집하지 않는다.** 생성물이다.
- **플레이스홀더(`{count}`·`{distance}`·`{first}`)와 그 등장 순서를 보존한다.** 어순을 바꾸면 xcstrings 위치 인자가 뒤집힌다.
- **`guide.resolvePending`은 건드리지 않는다**(모드 이름을 쓰지 않는다).
- 커밋은 `git add <의도 경로> && git commit -m "…" -- <의도 경로>` 원자화. `git add -A` 금지.
- 커밋 메시지 한국어, 하니스 푸터 유지.

---

### Task 1: 명칭 제거 + 재유입 가드

**Files:**
- Create: `src/lib/__tests__/guidance-mode-name.test.ts`
- Modify: `messages/ko.json` · `messages/en.json` · `messages/es.json` · `messages/fr.json` · `messages/it.json` · `messages/ja.json`
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: 없음(신규).
- Produces: 후속 축(E16 축2·축3)이 의존하는 것은 **어휘 계약**뿐이다 — 간략 = `직선거리 안내`/`straight-line guidance`, 상세(전환 짝) = `경로 안내`/`route guidance`, 시작 통지 = 수단 이름(`도보 안내 시작`).

- [ ] **Step 1: 가드 테스트를 쓴다 (아직 실패해야 한다)**

`src/lib/__tests__/guidance-mode-name.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ⚠ 로케일 파일을 정적 import 하지 않고 디렉터리를 훑는다 — import 목록 방식은
// 새 로케일이 추가될 때 추가를 잊으면 그 파일만 조용히 비검사로 남는다.
const ROOTS = ["messages", path.join("ios", "i18n", "ios-extra")];

// "간략 안내"만 지우면 짝인 "상세 안내"가 홀로 남아 무엇과 대비되는지 알 수 없는
// 말이 된다. 지우는 대상은 낱말이 아니라 대비 구조다(spec §1).
// ⚠ 낱말이 아니라 구(句)로 검사한다 — `상세`·`detail` 단독은 장소 상세 등
// 정당한 용례가 있어 오탐이 난다.
const FORBIDDEN = [
  "간략 안내", "상세 안내",
  "simple guidance", "detailed guidance",
  "guía simple", "guía detallada",
  "guidage simple", "guidage détaillé",
  "guida semplice", "guida dettagliata",
  "簡易案内", "詳細案内",
];

function* strings(value: unknown, trail: string[]): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [trail.join("."), value];
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) yield* strings(v, [...trail, k]);
  }
}

const FILES = ROOTS.flatMap((root) =>
  readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(root, f)),
);

describe("안내 모드 명칭 재유입 가드", () => {
  // 스캔이 0개 파일을 훑고도 통과하는 것이 이 계열 가드의 전형적 실패다.
  it("검사 대상이 6개 로케일 이상이다", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(FILES)("%s에 안내 모드 명칭이 없다", (file) => {
    const hits: string[] = [];
    for (const [key, value] of strings(JSON.parse(readFileSync(file, "utf8")), [])) {
      const lower = value.toLowerCase();
      for (const phrase of FORBIDDEN) {
        if (lower.includes(phrase.toLowerCase())) hits.push(`${key} = ${value}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/guidance-mode-name.test.ts`
Expected: **FAIL** — `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`·`ja.json` 6개 파일 전부에서 hits가 비지 않는다. `검사 대상이 6개 로케일 이상이다`는 PASS.

- [ ] **Step 3: ko 문자열 12건을 바꾼다**

`messages/ko.json` — `beacon` 네임스페이스:

```json
"briefGuideStart": "직선거리 안내 시작",
```

`guide` 네임스페이스:

```json
"briefStarted": "직선거리 안내 시작",
"detailStart": "도보 안내 시작. 안내 {count}개, 총 {distance}. {first}",
"speedSuggest": "위치 신호가 불안정하거나 이동 속도가 빨라 직선거리 안내가 적합할 수 있습니다",
"toDetailDone": "경로 안내로 전환했습니다",
"toBriefDone": "직선거리 안내로 전환했습니다",
"resolveFailed": "현재 위치를 경로 위에서 확인하지 못해 직선거리 안내를 유지합니다",
"detailUnavailable": "경로 정보를 가져오지 못했습니다. 목적지까지 직선거리로 안내합니다.",
"detailNoLocation": "현재 위치를 확인하지 못했습니다. 위치가 잡히면 직선거리로 안내합니다.",
"toDetailButton": "경로 안내로 전환",
"toBriefButton": "직선거리 안내로 전환",
```

⚠ `resolvePending`("현재 위치를 파악하는 중입니다")은 그대로 둔다.

- [ ] **Step 4: en 문자열을 바꾼다**

`messages/en.json`:

```json
"briefGuideStart": "Start straight-line guidance",
"briefStarted": "Straight-line guidance started",
"detailStart": "Walking guidance started. {count} instructions, {distance} total. {first}",
"speedSuggest": "Your location signal may be unstable or you may be moving fast; straight-line guidance may fit better",
"toDetailDone": "Switched to route guidance",
"toBriefDone": "Switched to straight-line guidance",
"resolveFailed": "Could not fix your position on the route; keeping straight-line guidance",
"detailUnavailable": "Route details unavailable. Guiding by straight-line distance to the destination.",
"detailNoLocation": "Location unavailable. Guidance will use straight-line distance once your position is found.",
"toDetailButton": "Switch to route guidance",
"toBriefButton": "Switch to straight-line guidance",
```

- [ ] **Step 5: es 문자열을 바꾼다**

`messages/es.json`:

```json
"briefGuideStart": "Iniciar guía en línea recta",
"briefStarted": "Guía en línea recta iniciada",
"detailStart": "Guía a pie iniciada. {count} indicaciones, {distance} en total. {first}",
"speedSuggest": "La señal de ubicación puede ser inestable o te mueves rápido; la guía en línea recta puede ser más adecuada",
"toDetailDone": "Cambiado a guía de ruta",
"toBriefDone": "Cambiado a guía en línea recta",
"resolveFailed": "No se pudo determinar tu posición en la ruta; se mantiene la guía en línea recta",
"detailUnavailable": "No hay detalles de la ruta. Se guiará por distancia en línea recta hasta el destino.",
"detailNoLocation": "No se pudo obtener tu ubicación. Cuando se obtenga, se guiará por distancia en línea recta.",
"toDetailButton": "Cambiar a guía de ruta",
"toBriefButton": "Cambiar a guía en línea recta",
```

- [ ] **Step 6: fr 문자열을 바꾼다**

`messages/fr.json`:

```json
"briefGuideStart": "Démarrer le guidage à vol d'oiseau",
"briefStarted": "Guidage à vol d'oiseau démarré",
"detailStart": "Guidage à pied démarré. {count} instructions, {distance} au total. {first}",
"speedSuggest": "Le signal de position est peut-être instable ou vous vous déplacez vite, le guidage à vol d'oiseau peut mieux convenir",
"toDetailDone": "Passé au guidage d'itinéraire",
"toBriefDone": "Passé au guidage à vol d'oiseau",
"resolveFailed": "Impossible de déterminer votre position sur l'itinéraire, le guidage à vol d'oiseau est maintenu",
"detailUnavailable": "Détails de l'itinéraire indisponibles. Guidage à vol d'oiseau jusqu'à la destination.",
"detailNoLocation": "Position introuvable. Le guidage se fera à vol d'oiseau dès que votre position sera trouvée.",
"toDetailButton": "Passer au guidage d'itinéraire",
"toBriefButton": "Passer au guidage à vol d'oiseau",
```

- [ ] **Step 7: it 문자열을 바꾼다**

`messages/it.json`:

```json
"briefGuideStart": "Avvia guida in linea d'aria",
"briefStarted": "Guida in linea d'aria avviata",
"detailStart": "Guida a piedi avviata. {count} indicazioni, {distance} in totale. {first}",
"speedSuggest": "Il segnale di posizione potrebbe essere instabile o ti stai muovendo velocemente, la guida in linea d'aria potrebbe essere più adatta",
"toDetailDone": "Passato alla guida del percorso",
"toBriefDone": "Passato alla guida in linea d'aria",
"resolveFailed": "Impossibile determinare la tua posizione sul percorso, la guida in linea d'aria resta attiva",
"detailUnavailable": "Dettagli del percorso non disponibili. Guida in linea d'aria fino alla destinazione.",
"detailNoLocation": "Posizione non disponibile. La guida userà la linea d'aria appena la posizione sarà disponibile.",
"toDetailButton": "Passa alla guida del percorso",
"toBriefButton": "Passa alla guida in linea d'aria",
```

- [ ] **Step 8: ja 문자열을 바꾼다**

`messages/ja.json`:

```json
"briefGuideStart": "直線距離案内を開始",
"briefStarted": "直線距離案内を開始しました",
"detailStart": "徒歩案内を開始しました。案内{count}件、合計{distance}。{first}",
"speedSuggest": "位置情報が不安定か移動速度が速いため、直線距離案内が適している場合があります",
"toDetailDone": "経路案内に切り替えました",
"toBriefDone": "直線距離案内に切り替えました",
"resolveFailed": "経路上の位置を確定できないため直線距離案内を続けます",
"detailUnavailable": "経路情報を取得できませんでした。目的地まで直線距離で案内します。",
"detailNoLocation": "現在地を確認できませんでした。現在地が分かり次第、直線距離で案内します。",
"toDetailButton": "経路案内に切り替え",
"toBriefButton": "直線距離案内に切り替え",
```

- [ ] **Step 9: 가드가 통과하는지 확인한다**

Run: `npx vitest run src/lib/__tests__/guidance-mode-name.test.ts`
Expected: PASS(파일 수 = `messages` 6 + `ios/i18n/ios-extra` 파일 수).

- [ ] **Step 10: 변이 주입으로 검출력을 실측한다**

가드가 "있다"와 그 축이 "지켜진다"는 다르다. 로케일마다 **한 건씩** 되돌려 넣고 그 파일의 케이스가 실패하는지 확인한다.

```bash
for L in ko en es fr it ja; do
  cp messages/$L.json /tmp/$L.bak
done
# ko: 되돌리기
python3 - <<'EOF'
import json
p='messages/ko.json'; d=json.load(open(p))
d['guide']['toBriefDone']='간략 안내로 전환했습니다'
json.dump(d, open(p,'w'), ensure_ascii=False, indent=2)
EOF
npx vitest run src/lib/__tests__/guidance-mode-name.test.ts   # ko 케이스만 FAIL 이어야 한다
cp /tmp/ko.bak messages/ko.json
```

en·es·fr·it·ja도 각각 `toBriefDone`을 원래 값으로 되돌려 같은 절차를 반복하고, **각 로케일에서 그 파일의 케이스만 실패**하는지 확인한다. 6회 전부 확인한 뒤 원본을 복원한다.

Expected: 6/6 검출. 결과를 spec `§8`에 한 줄로 기록한다(예: `변이 주입 6/6 검출(2026-08-16)`).

- [ ] **Step 11: 원본 복원을 검증한다**

Run: `git diff --stat messages/`
Expected: 6개 파일 모두 **Step 3~8의 변경만** 남아 있고 변이 주입 흔적이 없다. `git diff messages/ | grep -c "간략 안내\|簡易案内\|simple guidance"`가 **삭제 줄에서만** 잡히는지 눈으로 확인한다.

- [ ] **Step 12: iOS 문자열 카탈로그를 재생성한다**

Run:
```bash
node ios/scripts/messages-to-xcstrings.mjs
node ios/scripts/check-xcstrings-keys.mjs
```
Expected: 재생성 성공, 키 린터 통과. `git diff --stat ios/Gildongmu/Resources/Localizable.xcstrings`에 변경이 잡힌다.

- [ ] **Step 13: 기준선 3종을 돌린다**

Run:
```bash
npm run test:run
npx tsc --noEmit
npm run lint
```
Expected: 전부 0/green. 특히 `guidance-gate-drift.test.ts`(키를 안 바꿨다는 증거)와 `i18n-messages.test.ts`(6로케일 키 파리티)가 통과해야 한다.

- [ ] **Step 14: 커밋**

```bash
git add src/lib/__tests__/guidance-mode-name.test.ts messages/ko.json messages/en.json \
        messages/es.json messages/fr.json messages/it.json messages/ja.json \
        ios/Gildongmu/Resources/Localizable.xcstrings \
        docs/superpowers/specs/2026-08-16-brief-guidance-name-removal-design.md
git commit -m "$(cat <<'MSG'
feat(i18n): 안내 모드 이름을 지운다 — 간략·상세는 짝이라 함께 나간다 (E16 축1)

"간략 안내"만 지우면 "상세 안내"가 홀로 남아 무엇과 대비되는지 알 수 없다.
백로그가 적은 8건이 실제로는 12건이고, 누락된 detailStart는 "간략"이라는
글자가 없어 문자열 검색에서 새어 나갔다. carStart("자동차 안내 시작")가
이미 정답 형태를 갖고 있어 도보도 수단 이름으로 맞췄다.

- 정식판 iOS가 듣는 2건은 "무엇을 주는지" 말한다. iOS는 강등 뒤 재조회가
  없으므로 복구를 약속하지 않는다
- 키 불변 — guidance-gate-drift가 키 문자열을 창 검사 앵커로 쓴다
- 전 로케일 파일 전수 스캔 가드 신설, 변이 주입 6/6 검출

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xg42bY9vjRWRPaMJn3fKd7
MSG
)" -- src/lib/__tests__/guidance-mode-name.test.ts messages/ko.json messages/en.json \
        messages/es.json messages/fr.json messages/it.json messages/ja.json \
        ios/Gildongmu/Resources/Localizable.xcstrings \
        docs/superpowers/specs/2026-08-16-brief-guidance-name-removal-design.md
git show HEAD --stat
```

Expected: 의도한 파일만 들어 있다(병렬 세션 흡수 검증).

---

### Task 2: 문서 분배 + 백로그 순서 모순 정정

**Files:**
- Modify: `docs/BACKLOG.md` · `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1의 커밋 SHA와 변이 주입 실측 결과.
- Produces: 없음(종결 문서).

- [ ] **Step 1: 백로그 E16 항목에서 축1을 종결 표기한다**

`docs/BACKLOG.md` §5 E16 "작업 축 셋"의 1번을 `~~취소선~~ + ✅ 종결` 형태로 바꾸고 spec 경로를 건다. **8건이 12건이었다는 정정과 `guide.detailStart` 누락 사유를 한 줄로 남긴다** — 같은 방식으로 다음 축에서도 새어 나갈 수 있다.

- [ ] **Step 2: 순서 모순을 고친다**

`docs/BACKLOG.md` 맨 끝 "다음에 할 일" 3번이 E16 순서를 `명칭 제거 → 웹 진입점 제거 → 비-ko 상세`(1→2→3)로 적었다. E16 본문은 `1 → 3 → 2`이고 "순서가 곧 안전이다"라고 못 박았으므로 **본문이 정본**이다. "다음에 할 일" 쪽을 본문에 맞춘다.

- [ ] **Step 3: CHANGELOG에 등재한다**

`CHANGELOG.md` 2026-08-16 아래 2~4줄 + spec 링크. 담을 것: 12건 6로케일, 키 불변 이유, 정식판 iOS 2건이 복구를 약속하지 않는 이유, 가드 변이 주입 결과.

- [ ] **Step 4: 커밋**

```bash
git add docs/BACKLOG.md CHANGELOG.md
git commit -m "$(cat <<'MSG'
docs: E16 축1 종결 분배 — 순서 모순 정정 포함

"다음에 할 일"이 E16 순서를 1→2→3으로 적었으나 본문은 1→3→2이고 그것이
안전 근거다(웹 진입점을 먼저 지우면 비-ko 사용자에게 남는 것이 0). 본문을
정본으로 두고 목록을 맞췄다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xg42bY9vjRWRPaMJn3fKd7
MSG
)" -- docs/BACKLOG.md CHANGELOG.md
git show HEAD --stat
```

- [ ] **Step 5: push**

```bash
git push origin main
```

⚠ 웹 자동 배포가 걸린다. iOS는 문자열 카탈로그만 바뀌었으므로 다음 릴리스에 실린다 — 이 변경만으로 실기기 배포를 하지 않는다(동작 무변경).

---

## Self-Review

**Spec coverage**
- §4 어휘 결정 → Task 1 Step 3~8 (전 로케일에 반영).
- §5.1 정식판 2건 → Step 3~8의 `detailUnavailable`·`detailNoLocation`.
- §5.2 `detailStart` → 같은 스텝, 플레이스홀더 순서 보존을 Global Constraints가 못 박음.
- §5.3 웹 8건 → 같은 스텝.
- §5.4 `resolvePending` 불변 → Step 3 말미 ⚠ + 가드가 이 문자열을 걸지 않음.
- §6 가드 + 변이 주입 → Step 1·2·9·10·11.
- §7 한계 → 코드 작업 없음(문서 §7이 정본). Task 2 Step 3에서 CHANGELOG로 옮기지 않는다(한계는 spec이 정본).
- §8 검증 → Step 9·12·13, 결과 기록은 Step 10.

**Placeholder scan:** 없음 — 전 로케일 문자열이 축자로 들어 있고 테스트 코드가 전문이다.

**Type consistency:** 신규 심볼은 테스트 내부 `strings()`·`FILES`·`FORBIDDEN` 셋뿐이고 외부 소비자가 없다.
