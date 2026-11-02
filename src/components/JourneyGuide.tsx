"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Coord, EgressOption, JourneyVariant } from "@/lib/types";
import { DistanceBeacon } from "./DistanceBeacon";
import { TransitGuidePanel } from "./TransitGuidePanel";
import { buildTransitGuideRoute } from "@/lib/transit-guide";
import { claimGuideSession, releaseGuideSession } from "@/lib/guide-session-store";
import { getGeolocationSnapshot } from "@/lib/geolocation";
import { haversineMeters } from "@/lib/geo";
import { displayStationName } from "@/lib/journey/display";
import { boardsAtBusStop } from "@/lib/journey/journey-lines";
import {
  JOURNEY_ACCESS_WALK_MIN_M,
  JOURNEY_BRIDGE_DELAY_MS,
  JOURNEY_HANDOFF_DELAY_MS,
  JOURNEY_STALE_TRANSITION_MS,
  journeyStart,
  journeyStep,
  journeyToken,
  type JourneyEvent,
  type JourneyShape,
  type JourneyStage,
  type JourneyState,
  type JourneyToken,
} from "@/lib/journey/journey-step";

/** 안내 시작 때 굳히는 여정 계획(결과 화면에서 고른 변형·출구의 스냅숏). */
export interface JourneyGuidePlan {
  variant: JourneyVariant;
  /** 고른 출구·승강장(하차 쪽을 지정하지 않았으면 null). */
  egress: EgressOption | null;
  alightDesignated: boolean;
  dest: Coord;
  destLabel: string;
}

let journeySeq = 0;

/**
 * 여정 이어 안내(E70-f spec `2026-11-02-e70-web-journey-design.md` §7). 택시(자동차 승객) → 접근 도보 → 대중교통 → 출구 도보 →
 * 택시를 **한 컴포넌트 안에서** 이어 붙인다 — 웹엔 앱 수명 코디네이터가 없어 여정 상태·준비 타이머·단계 패널을 이 컴포넌트가
 * 소유한다. 전이는 Kit `journeyStep`의 미러(`journey-step.ts`)가 정하고, 모든 사건은 자기가 관측한 token을 들고 와 낡은 사건은
 * 버려진다.
 *
 * 점유(§7.1): 단계 세션이 도는 동안은 그 세션이 `guide-session-store`를 claim한다. 사이 상태(준비·실패)에는 세션이 없으므로
 * 이 컴포넌트가 자기 중지 함수를 claim해 둔다 — 다른 안내 시작·목적지 편집(`stopActiveGuideSession`)이 여정을 끝낸다. 단계를
 * 시작하기 직전엔 그 claim을 **동기로** 놓는다(자식 패널의 claim이 이 여정을 끝내지 않게 — 자식 effect가 부모보다 먼저 돈다).
 *
 * 통지는 화면 단일 창구(`announce`, A40) 하나다. 단계 사이에 새 문장을 더하지 않는다 — 다음 세션의 시작 통지가 전환을 말한다.
 */
export function JourneyGuide({
  plan,
  announce,
  onFinished,
}: {
  plan: JourneyGuidePlan;
  announce: (text: string, lang?: "ko") => void;
  /** 여정이 끝났다(어느 갈래든). `keepTransit`이면 대중교통 패널이 남아 있다(말미 도보 인계·완료 화면). */
  onFinished: (keepTransit: boolean) => void;
}) {
  const t = useTranslations("journey");
  const tBeacon = useTranslations("beacon");
  const tGuide = useTranslations("guide");
  const tDirections = useTranslations("directions");
  const tTransit = useTranslations("transitGuide");
  const tRoute = useTranslations("route.transit");

  const shape: JourneyShape = {
    startsWithTaxi: plan.variant.taxiIn !== undefined && plan.variant.boardStation !== undefined,
    alightDesignated: plan.alightDesignated,
    hasEgressWalk: plan.alightDesignated && plan.egress !== null && plan.egress.kind !== "none",
  };
  const [state, setState] = useState<JourneyState | null>(() => journeyStart(String(++journeySeq), shape));
  const stateRef = useRef(state);
  /** 사이 상태로 들어온 사건 — 준비 지연(첫 시작·재시도 0, 접근 도보 시작 실패 다리 문장 2.5초, 그 밖 600ms)을 가른다. */
  const lastEventRef = useRef<JourneyEvent | null>(null);
  /** 대중교통 단계에서 끝났는가 — 끝난 뒤에도 그 패널(말미 도보 인계)을 남긴다. */
  const [keptTransit, setKeptTransit] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatusRef = useRef(false);
  /** 단계 패널의 [안내 중지]를 누른 직후의 "ended"를 사용자 중지로 읽는다(§7.3). */
  const userStopRef = useRef(false);
  const transitKeyRef = useRef("journey-transit");

  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  // 사이 상태 동안 들고 있는 claim의 중지 함수 — 다른 세션 시작·목적지 편집이 부르면 여정을 끝낸다.
  const [occupyStop] = useState(() => () => {
    const s = stateRef.current;
    if (!s || s.phase.kind === "running") return;
    stateRef.current = null;
    setState(null);
    onFinishedRef.current(false);
  });

  const act = useCallback(
    (event: JourneyEvent, token: JourneyToken) => {
      const current = stateRef.current;
      if (!current) return;
      const r = journeyStep(current, event, token);
      if (r.kind === "ignore") return;
      if (r.kind === "end") {
        releaseGuideSession(occupyStop);
        stateRef.current = null;
        setState(null);
        const keep = current.phase.kind === "running" && current.phase.stage === "transit";
        setKeptTransit(keep);
        onFinishedRef.current(keep);
        return;
      }
      const next = r.state;
      lastEventRef.current = event;
      if (next.phase.kind === "running") {
        // 단계 세션의 claim이 이 여정을 끝내지 않게 먼저 놓는다(자식 effect가 부모보다 먼저 돈다).
        releaseGuideSession(occupyStop);
      } else {
        claimGuideSession(occupyStop);
        // 누른 버튼이 사라지는 전이(단계 버튼·실패 버튼)와 실패 진입은 상태 문장으로 착지한다(헌장 §5).
        focusStatusRef.current = true;
        if (next.phase.kind === "failed" && event.kind === "staleTimeout") announce(failedText(next.phase.stage));
      }
      // 접근 도보를 시작하지 못하고 대중교통으로 넘어간다 — 원인은 도보 패널이 이미 냈고, 다리 문장을 잇는다(판정 27, §7.4).
      if (
        current.phase.kind === "running" &&
        current.phase.stage === "access" &&
        event.kind === "stageEnded" &&
        event.reason === "startFailed"
      ) {
        announce(tTransit("prewalkUnavailable"));
      }
      stateRef.current = next;
      setState(next);
    },
    // failedText·announce·번역기는 렌더마다 같은 값을 읽으면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announce, occupyStop],
  );

  function failedText(stage: JourneyStage): string {
    switch (stage) {
      case "egress":
        return t("egressStartFailed");
      case "taxiIn":
      case "taxiOut":
        return t("taxiOutFailed");
      default:
        return tRoute("error");
    }
  }

  // 시작 상태는 사이 상태라 마운트 때 claim한다(앞서 돌던 다른 안내는 여기서 멈춘다). 언마운트는 자원 회수.
  useEffect(() => {
    claimGuideSession(occupyStop);
    return () => releaseGuideSession(occupyStop);
  }, [occupyStop]);

  // 사이 상태의 준비: 인계 지연 → (접근 도보면) 위치 스토어 스냅숏으로 30m 판정 → prepared. 30초 상한은 staleTimeout.
  const seq = state?.seq ?? 0;
  const phaseKind = state?.phase.kind;
  useEffect(() => {
    const s = stateRef.current;
    if (!s || s.phase.kind !== "transitioning") return;
    const token = journeyToken(s);
    const stage = s.phase.stage;
    const last = lastEventRef.current;
    const delay =
      last === null || last.kind === "retry"
        ? 0
        : last.kind === "stageEnded" && last.reason === "startFailed" && stage === "transit"
          ? JOURNEY_BRIDGE_DELAY_MS
          : JOURNEY_HANDOFF_DELAY_MS;
    const prep = window.setTimeout(() => {
      let ready: JourneyStage = stage;
      const board = plan.variant.boardStation;
      if (stage === "access" && board) {
        // 캐시 우선(새 측위 없음) — 측위가 없으면 걷기 안내를 시작한다(빠진 안내보다 군더더기가 낫다).
        const geo = getGeolocationSnapshot();
        if (
          geo.status === "ready" &&
          haversineMeters(geo.coords.lat, geo.coords.lng, board.coord.lat, board.coord.lng) < JOURNEY_ACCESS_WALK_MIN_M
        ) {
          ready = "transit";
        }
      }
      act({ kind: "prepared", stage: ready }, token);
    }, delay);
    const stale = window.setTimeout(() => act({ kind: "staleTimeout" }, token), JOURNEY_STALE_TRANSITION_MS);
    return () => {
      window.clearTimeout(prep);
      window.clearTimeout(stale);
    };
  }, [seq, act, plan.variant.boardStation]);

  // 대중교통 단계가 설 수 없는 경로(안내 경로 변환 실패)면 세션 없는 running에 남지 않게 시작 실패로(§6.4 불변식).
  useEffect(() => {
    const s = stateRef.current;
    if (!s || s.phase.kind !== "running" || s.phase.stage !== "transit") return;
    if (buildTransitGuideRoute(plan.variant.transit) === null) {
      act({ kind: "stageEnded", reason: "startFailed" }, journeyToken(s));
    }
  }, [seq, act, plan.variant.transit]);

  useLayoutEffect(() => {
    if (!focusStatusRef.current) return;
    focusStatusRef.current = false;
    statusRef.current?.focus();
  }, [seq, phaseKind]);

  const variant = plan.variant;
  if (!state) {
    // 대중교통 단계에서 끝났으면 그 패널을 남긴다(B 미지정 여정의 말미 도보 인계, 완료 뒤 트리거).
    // ⚠ 감싸는 요소가 running 때와 같아야 같은 인스턴스로 남는다(트리 위치가 바뀌면 다시 마운트돼 인계 상태를 잃는다).
    return keptTransit ? <div className="mt-2">{transitPanel(null)}</div> : null;
  }

  const token = journeyToken(state);
  const board = variant.boardStation;
  const atStop = boardsAtBusStop(variant);
  const boardLabel = board ? (atStop ? board.name : `${displayStationName(board.name)}역`) : "";

  function beaconEnd(reason: "arrived" | "ended") {
    const stopped = userStopRef.current;
    userStopRef.current = false;
    act({ kind: "stageEnded", reason: reason === "arrived" ? "arrived" : stopped ? "userStopped" : "ended" }, token);
  }
  const beaconCallbacks = {
    onSessionEnd: beaconEnd,
    onUserStop: () => {
      userStopRef.current = true;
    },
    onFailure: (when: "start" | "running") =>
      act({ kind: "stageEnded", reason: when === "start" ? "startFailed" : "ended" }, token),
  };

  function transitPanel(tk: JourneyToken | null) {
    // 끝난 뒤에도 같은 key로 남겨야 패널 상태(말미 도보 인계)가 이어진다 — 마지막으로 선 대중교통 단계의 key를 쓴다.
    if (tk) transitKeyRef.current = `journey-transit-${tk.journeyId}-${tk.seq}`;
    return (
      <TransitGuidePanel
        key={transitKeyRef.current}
        route={variant.transit}
        triggerLabel={tBeacon("start")}
        dest={plan.alightDesignated ? undefined : { lat: plan.dest.lat, lng: plan.dest.lng, name: plan.destLabel }}
        walkAccessible={false}
        announce={announce}
        autoStart={tk !== null}
        {...(tk && plan.alightDesignated ? { onRideCompleted: () => act({ kind: "rideCompleted" }, tk) } : {})}
        {...(tk ? { onStopped: () => act({ kind: "transitStopped" }, tk) } : {})}
      />
    );
  }

  const phase = state.phase;
  const buttonClass =
    "mt-2 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300";

  if (phase.kind === "running") {
    const key = `journey-${phase.stage}-${token.journeyId}-${token.seq}`;
    switch (phase.stage) {
      case "taxiIn":
        return (
          <div className="mt-2">
            <DistanceBeacon
              key={key}
              dest={{ lat: board?.coord.lat ?? 0, lng: board?.coord.lng ?? 0, name: boardLabel }}
              kind="car"
              accessible={false}
              variant={null}
              announce={announce}
              autoStart
              focusTriggerOnMount
              arrivalText={
                atStop
                  ? t("arrivedStop", { stop: board?.name ?? "" })
                  : t("arrivedStation", { station: displayStationName(board?.name ?? "") })
              }
              {...beaconCallbacks}
            />
            <button type="button" onClick={() => act({ kind: "taxiDropped" }, token)} className={buttonClass}>
              {t("taxiDropped")}
            </button>
          </div>
        );
      case "access":
        return (
          <div className="mt-2">
            <DistanceBeacon
              key={key}
              dest={{ lat: board?.coord.lat ?? 0, lng: board?.coord.lng ?? 0, name: boardLabel }}
              kind="walk"
              accessible={false}
              variant={null}
              announce={announce}
              autoStart
              focusTriggerOnMount
              arrivalText={tTransit("prewalkArrived", { station: board?.name ?? "" })}
              {...beaconCallbacks}
            />
            {/* 승차 전 도보 선례(A25)의 선언 버튼 — 지하로 먼저 들어가 도착 판정이 닿지 않을 때의 탈출구. */}
            <button
              type="button"
              onClick={() => act({ kind: "stageEnded", reason: "arrived" }, token)}
              className={buttonClass}
            >
              {tTransit("prewalkArrivedButton", { station: board?.name ?? "" })}
            </button>
          </div>
        );
      case "transit":
        return <div className="mt-2">{transitPanel(token)}</div>;
      case "egress": {
        const option = plan.egress;
        return (
          <div className="mt-2">
            {option && (
              <DistanceBeacon
                key={key}
                dest={{ lat: option.coord.lat, lng: option.coord.lng, name: option.placeName }}
                kind="walk"
                accessible={false}
                variant={null}
                announce={announce}
                autoStart
                focusTriggerOnMount
                arrivalText={option.kind === "exit" ? t("arrivedExit", { exit: option.label }) : t("arrivedStand")}
                {...beaconCallbacks}
              />
            )}
            <button type="button" onClick={() => act({ kind: "taxiBoarded" }, token)} className={buttonClass}>
              {t("taxiBoarded")}
            </button>
          </div>
        );
      }
      case "taxiOut":
        return (
          <div className="mt-2">
            <DistanceBeacon
              key={key}
              dest={{ lat: plan.dest.lat, lng: plan.dest.lng, name: plan.destLabel }}
              kind="car"
              accessible={false}
              variant={null}
              announce={announce}
              autoStart
              focusTriggerOnMount
              {...beaconCallbacks}
            />
          </div>
        );
    }
  }

  // 사이 상태(준비 중)·실패: 상태 문장 한 줄 + (실패면) 재시도·단계 버튼 + [안내 종료].
  const failedStage = phase.kind === "failed" ? phase.stage : null;
  return (
    <div className="mt-2 rounded-md border border-gray-300 p-3">
      <p ref={statusRef} tabIndex={-1} className="text-sm">
        {failedStage ? failedText(failedStage) : tDirections("loading")}
      </p>
      {failedStage && (
        <div className="flex flex-wrap gap-2">
          {/* 출구 도보 시작 실패는 「자동차에 탔어요」가 곧 다음 단계라 재시도를 두지 않는다(원 spec §6.4 표). */}
          {failedStage !== "egress" && (
            <button type="button" onClick={() => act({ kind: "retry" }, token)} className={buttonClass}>
              {tGuide("rerouteButton")}
            </button>
          )}
          {failedStage === "taxiIn" && (
            <button type="button" onClick={() => act({ kind: "taxiDropped" }, token)} className={buttonClass}>
              {t("taxiDropped")}
            </button>
          )}
          {failedStage === "egress" && (
            <button type="button" onClick={() => act({ kind: "taxiBoarded" }, token)} className={buttonClass}>
              {t("taxiBoarded")}
            </button>
          )}
        </div>
      )}
      <button type="button" onClick={() => act({ kind: "userEnded" }, token)} className={buttonClass}>
        {tBeacon("stop")}
      </button>
    </div>
  );
}
