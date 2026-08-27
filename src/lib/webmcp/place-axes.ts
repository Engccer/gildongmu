/**
 * 장소 상세 축 엔트리 기계(spec §5.4) — React 비의존. `PlaceDetail`이 하나 만들어 자식 역 섹션의
 * `attach`(registrar)와 도구의 `ensureLoaded`/`refresh`(엔트리)를 잇는다.
 *
 * 세 계약:
 * - **attach 대기**: `present`는 부모 props가 정하고, 자식 소스는 `op` 상한 안에서 기다린다
 *   (게시 직후 미등록 창이 거짓 `notConfigured`가 되지 않게).
 * - **세대 결박**: 명령 시점의 `gen`에 결박해 정착을 기다린다. 소스의 `read()`는 React 커밋 뒤에야
 *   새 세대를 보이므로 `gen < 기대`는 "아직 커밋 전"(대기), `gen > 기대`는 사용자가 그 축을 다시
 *   건드린 것(`superseded`), 같을 때만 status를 판정한다.
 * - **정착 판정은 커밋 뒤**: 소스를 가진 자식이 자기 status 커밋 effect에서 `notifyCommit()`을 부른다
 *   (부모 effect는 자식 setState에 돌지 않는다). 언마운트는
 *   `teardown()`으로 대기자 전부를 `aborted`로 끝낸다.
 */
import type { Op } from "./tool-lock";
import type { AxisEntry, AxisKey, AxisOutcome, AxisSnapshot, AxisSource } from "./tools/context";

export interface AxisRegistrar {
  attach(axis: AxisKey, source: AxisSource): () => void;
  /** 소스 상태 커밋 뒤 통지 — 대기자가 `read()`를 다시 본다(`useAxisBridge`가 부른다). */
  notifyCommit(): void;
}

export interface AxisEntryOptions {
  present: boolean;
  kind: "mount" | "trigger";
  /** `present:false`일 때의 결과 — 비역의 역 축은 `notApplicable`, 키 게이트는 `notConfigured`. */
  absentOutcome: "notConfigured" | "notApplicable";
  /**
   * 소스가 붙지 않아도 이 스냅샷으로 즉시 정착한다(비역 `basic`: 역 메타 소스가 없는 것이 정답이라
   * attach를 기다리면 안 된다).
   */
  settleWithoutSource?: AxisSnapshot;
}

export interface AxisRegistry {
  registrar: AxisRegistrar;
  makeEntry(axis: AxisKey, options: AxisEntryOptions): AxisEntry;
  /** 매 React 커밋 뒤 — 대기자가 소스를 다시 읽는다. */
  notifyCommit(): void;
  /** 언마운트 — 대기자 전부 `aborted`. */
  teardown(): void;
}

const PENDING: ReadonlySet<AxisSnapshot["status"]> = new Set(["idle", "loading"]);

export function createAxisRegistry(): AxisRegistry {
  const sources = new Map<AxisKey, AxisSource>();
  const attachListeners = new Set<() => void>();
  const waiters = new Set<() => void>();
  let torn = false;

  function notifyCommit() {
    const pending = [...waiters];
    waiters.clear();
    for (const w of pending) w();
  }

  const registrar: AxisRegistrar = {
    notifyCommit,
    attach(axis, source) {
      sources.set(axis, source);
      for (const l of [...attachListeners]) l();
      return () => {
        if (sources.get(axis) === source) sources.delete(axis);
      };
    },
  };

  function waitSource(axis: AxisKey, op: Op): Promise<AxisSource | null> {
    const now = sources.get(axis);
    if (now) return Promise.resolve(now);
    if (torn || !op.isLive()) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = (value: AxisSource | null) => {
        attachListeners.delete(check);
        op.signal.removeEventListener("abort", onAbort);
        tearListeners.delete(onTear);
        resolve(value);
      };
      const check = () => {
        const s = sources.get(axis);
        if (s) finish(s);
      };
      const onAbort = () => finish(null);
      const onTear = () => finish(null);
      attachListeners.add(check);
      tearListeners.add(onTear);
      op.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  const tearListeners = new Set<() => void>();

  function settle(source: AxisSource, gen: number, op: Op): Promise<AxisOutcome> {
    return new Promise((resolve) => {
      const done = (outcome: AxisOutcome) => {
        waiters.delete(tick);
        op.signal.removeEventListener("abort", tick);
        resolve(outcome);
      };
      const tick = () => {
        if (torn || !op.isLive()) return done({ kind: "aborted" });
        const snap = source.read();
        if (snap.gen > gen) return done({ kind: "superseded" });
        if (snap.gen === gen && !PENDING.has(snap.status)) return done({ kind: "settled", snapshot: snap });
        waiters.add(tick);
      };
      op.signal.addEventListener("abort", tick, { once: true });
      tick();
    });
  }

  function makeEntry(axis: AxisKey, options: AxisEntryOptions): AxisEntry {
    const { present, kind, absentOutcome, settleWithoutSource } = options;
    // 소스가 이미 있으면 **동기**로 load까지 간다 — await로 한 틱 양보하면 그 사이 커밋이
    // 지나가 대기자 등록이 정착 뒤로 밀린다(정착 통지를 영영 못 받는다).
    const proceed = (source: AxisSource, op: Op, force: boolean): Promise<AxisOutcome> => {
      const before = source.read();
      // 진행 중이면 그 세대의 정착을 그대로 기다린다(화면 in-flight 가드가 load를 무시하므로
      // 여기서 load를 다시 부르면 세대가 영영 오지 않는다).
      if (before.status === "loading") return settle(source, before.gen, op);
      if (!force && before.status !== "idle") return Promise.resolve({ kind: "settled", snapshot: before });
      source.load(force, "tool");
      return settle(source, before.gen + 1, op);
    };
    const run = (op: Op, force: boolean): Promise<AxisOutcome> => {
      if (!present) return Promise.resolve({ kind: absentOutcome });
      if (settleWithoutSource && !sources.has(axis)) {
        return Promise.resolve({ kind: "settled", snapshot: settleWithoutSource });
      }
      const existing = sources.get(axis);
      if (existing) return proceed(existing, op, force);
      return waitSource(axis, op).then((source) =>
        source ? proceed(source, op, force) : { kind: "aborted" },
      );
    };
    return {
      axis,
      present,
      kind,
      read: () => sources.get(axis)?.read() ?? settleWithoutSource ?? { status: "idle", gen: 0 },
      ensureLoaded: (op) => run(op, false),
      refresh: (op) => run(op, true),
    };
  }

  return {
    registrar,
    makeEntry,
    notifyCommit,
    teardown() {
      torn = true;
      for (const l of [...tearListeners]) l();
      const pending = [...waiters];
      waiters.clear();
      for (const w of pending) w();
    },
  };
}
