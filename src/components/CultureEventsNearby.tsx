"use client";

import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import { useTranslations } from "next-intl";
import type { CultureEvent } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/**
 * 내 주변 문화행사(서울 `culturalEventInfo`) — 10번째 nearby 도메인.
 *
 * 공유 계층(useNearbyFetch·NearbyPanelShell·useRevealMore·nearbyLiveMessage)에
 * 그대로 얹고 도메인 고유물(항목 렌더·fetch URL)만 갖는다. 오늘 진행 중인 행사만
 * 서버가 판정해 내려주므로 여기서 날짜를 다시 해석하지 않는다.
 *
 * 한 줄 = 한 접근성 객체: 이름 h4(제목·분류·거리) + 장소 + 기간·시간 + 참가 조건
 * 4덩이로 합친다. `link`만 인터랙티브라 별도 객체로 남긴다(합치면 안 됨).
 */
export function CultureEventsNearby() {
  const t = useTranslations("eventsNearby");
  const bilingual = useBilingualName();
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } = useNearbyFetch<
    CultureEvent[]
  >({
    source: { kind: "current" },
    fetchAt: ({ lat, lng }) =>
      // "더 보기" 재료는 웹이 NEARBY_LIMIT_MAX로 명시 확보한다(기본 12는 CLI/MCP용).
      fetch(`/api/events/nearby?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`, {
        cache: "no-store",
      }),
    parse: (body) => {
      const events = (body as { events?: CultureEvent[] }).events ?? [];
      return events.length === 0 ? { kind: "empty" } : { kind: "done", data: events };
    },
  });
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore(doneSeq);
  const live = nearbyLiveMessage(status, t, tCommon);

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done"}
      heading={status.kind === "done" ? `${t("ready")} ${t("asOf", { time: status.at })}` : ""}
      headingRef={headingRef}
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <>
          <ul className="mt-2 space-y-4">
            {status.data.slice(0, visibleCount).map((e, i) => {
              const title = bilingual(e.title, { roman: e.titleRoman });
              const titleLine = joinText(
                title.primary,
                e.category,
                t("distance", { distance: formatDistance(e.distanceMeters) }),
              );
              const place = bilingual(e.place, { roman: e.placeRoman });
              const placeLine = joinText(place.primary, e.district);
              return (
              <li key={e.id}>
                {/* 제목·분류·거리를 단일 텍스트로(소아진료 선례). 비-ko는 제목이 로마자이고
                    한글은 줄 끝 괄호(E28 R1). lang은 접근 텍스트에 한글이 남을 때만. */}
                <h4
                  className="font-medium"
                  lang={langFor(titleLine)}
                  tabIndex={-1}
                  ref={(el) => {
                    itemHeadingRefs.current[i] = el;
                  }}
                >
                  {titleLine}
                  <KoTail secondary={title.secondary} />
                </h4>

                <p className="mt-1 text-sm" lang={langFor(placeLine)}>
                  {placeLine}
                  <KoTail secondary={place.secondary} />
                </p>

                {/* dateText는 원본이 이미 완성 표기(2026-06-04~2026-08-23) — 재조합 금지. */}
                <p className="text-sm" lang="ko">
                  {joinText(e.dateText, e.timeText)}
                </p>

                {/* 참가 조건 한 덩이 — 요금과 대상은 "갈 수 있나"를 함께 가른다.
                    유료인데 요금 문구가 없는 행사는 실측 0건이지만, 있어도 "유료 "
                    꼬리 공백이 남지 않게 다듬는다(6로케일 모두 {fee}가 문장 끝). */}
                <p className="text-sm" lang="ko">
                  {joinText(
                    e.isFree ? t("free") : t("paid", { fee: e.fee ?? "" }).trim(),
                    e.target && t("target", { text: e.target }),
                  )}
                </p>

                {e.link && (
                  <p className="mt-1 text-sm">
                    {/* 목록에 같은 이름의 링크가 여럿이라 접근 가능한 이름에 행사명을
                        넣는다. 보이는 텍스트를 접근명이 포함하므로 음성 제어와도 정합. */}
                    <a
                      href={e.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                      aria-label={t("detailAction", { name: e.title })}
                    >
                      {t("detail")}
                    </a>
                  </p>
                )}
              </li>
              );
            })}
          </ul>
          {status.data.length > visibleCount && (
            <button
              type="button"
              onClick={reveal}
              className="mt-2 min-h-11 text-sm text-accent underline"
            >
              {tActions("showMore")}
            </button>
          )}
        </>
      )}
    </NearbyPanelShell>
  );
}
