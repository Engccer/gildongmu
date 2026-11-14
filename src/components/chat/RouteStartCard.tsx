"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { RouteStartMode } from "@/lib/chat/types";
import type { RouteStartGroup } from "@/lib/chat/route-start-groups";
import { prefersEnglish } from "@/lib/data-locale";
import { carGuideStartable, transitGuideStartable } from "@/lib/guide-startable";
import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";

/** 카드 버튼 하나의 뜻: 그 수단의 안내 시작, 또는 [길찾기에서 열기]. */
export type RouteStartAction = { kind: "start"; mode: RouteStartMode } | { kind: "open" };

/**
 * 카드 버튼의 통로. 받는 쪽(`PlaceSearch`)이 채팅을 닫고 길찾기 화면을 연다. 대중교통 [안내 시작]은 위치를 새로 받는 동안
 * 끝나지 않는 Promise를 돌려준다(그동안 카드가 버튼을 잠근다).
 */
export type RouteStartActionHandler = (group: RouteStartGroup, action: RouteStartAction) => void | Promise<void>;

const START_LABEL_KEY = {
  walk: "guideStartWalk",
  car: "guideStartCar",
  transit: "guideStartTransit",
} as const satisfies Record<RouteStartMode, string>;

/**
 * 이 묶음에서 낼 수단 버튼(E83 R10) — 그 로케일·결과에서 그 수단의 안내를 시작할 수 있을 때만. 판정은 길찾기 화면의 시작 버튼과
 * **같은 함수**(`guide-startable.ts`)다. 순서는 도보 · 자동차 · 대중교통.
 * - 도보: 경로를 찾았으면(렌더가 왔으면) 전 로케일에서 시작할 수 있다(문장을 서버가 만든다).
 * - 자동차: Tmap ∧ 한국어 데이터 ∧ 경유지 없음(R9 — 웹 자동차 안내는 경유지를 싣지 못한다).
 * - 대중교통: 추천 첫 경로(길찾기 화면이 기본으로 펼치는 경로, R5)에 탑승 구간이 있다.
 */
export function routeStartModes(group: RouteStartGroup, english: boolean): RouteStartMode[] {
  const out: RouteStartMode[] = [];
  if (group.walk) out.push("walk");
  if (group.car && carGuideStartable({ provider: group.car.carProvider, english, hasVia: group.car.via !== null })) {
    out.push("car");
  }
  const recommended = group.transit?.transit?.result.recommended;
  if (recommended && transitGuideStartable(recommended)) out.push("transit");
  return out;
}

/**
 * 채팅 경로 안내 시작 카드(E83 spec `2026-11-14-e83-chat-route-start-design.md` 판정 3·R10·R12).
 *
 * 한 답이 한 도착지로 조회한 수단들의 버튼만 둔다: 「도보 안내 시작」·「자동차 안내 시작」·「대중교통 안내 시작」, 맨 끝에
 * 「길찾기에서 열기」. 제목·합계 줄은 없다 — 경로의 내용은 답의 글이 말한다.
 * - heading을 두지 않는다(턴 점프는 질문 heading이 맡는다). 답에 도착지가 둘 이상일 때만(`showDestLine`) 첫 줄에 도착지 이름을
 *   평문 한 줄로 둔다 — 같은 이름의 버튼이 두 벌이면 어느 도착지인지 가를 줄이 필요하다(R12).
 * - 통로(`onAction`)가 없으면 그리지 않는다(버튼뿐인 카드라 남는 것이 없다).
 * - 버튼은 `disabled`를 쓰지 않는다 — 측위를 기다리는 동안 포커스가 버튼에 남아야 한다(`aria-disabled` + in-flight ref 가드).
 * - 통지는 내지 않는다(이 카드에 live region 없음) — 기다리는 대상은 채팅 화면의 창구가 말한다.
 */
export function RouteStartCard({
  group,
  showDestLine,
  onAction,
}: {
  group: RouteStartGroup;
  /** 이 답에 도착지가 둘 이상인가 — 기본값 없음(생략이 「이름 줄 없음」으로 조용히 접히지 않게). */
  showDestLine: boolean;
  onAction: RouteStartActionHandler | undefined;
}) {
  const tBeacon = useTranslations("beacon");
  const tJourney = useTranslations("journey");
  const locale = useLocale();
  const nameOf = useBilingualName();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  if (!onAction) return null;

  async function act(action: RouteStartAction) {
    if (!onAction || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onAction(group, action);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const dest = nameOf(group.destLabel, { roman: group.destRoman });
  return (
    <div className="mt-2 rounded-md border border-border p-3">
      {showDestLine && (
        <p className="mb-2 font-semibold" lang={langFor(dest.primary)}>
          {dest.primary}
          <KoTail secondary={dest.secondary} />
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {routeStartModes(group, prefersEnglish(locale)).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => void act({ kind: "start", mode })}
            aria-disabled={busy}
            className={CARD_BUTTON}
          >
            {tBeacon(START_LABEL_KEY[mode])}
          </button>
        ))}
        <button type="button" onClick={() => void act({ kind: "open" })} aria-disabled={busy} className={CARD_BUTTON}>
          {tJourney("openInDirections")}
        </button>
      </div>
    </div>
  );
}

const CARD_BUTTON =
  "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-disabled:opacity-50";
