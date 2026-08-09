"use client";

import { useTranslations } from "next-intl";
import type { Scene, SceneGroup } from "@/lib/surroundings-scene";
import { formatDistance } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/**
 * M1 도착지 부근 상황 재구성 — "여기가 맞나" 확인용 요청형 패널.
 *
 * 앵커(목적지 좌표 또는 정위에 쓴 좌표)를 받아 입구 기준 왼쪽·오른쪽·맞은편·
 * 건물 너머 묶음을 렌더한다. 축이 안 서면 서버가 절대 방위 묶음으로 물러난
 * 장면을 주므로 렌더 구조는 동일하다(bucket 키만 다르다).
 */

/** 묶음이 이보다 크면 제목에 곳수를 병기한다(스와이프 전 규모 예고). */
const COUNT_IN_TITLE_THRESHOLD = 3;

function GroupSection({ group, resetKey }: { group: SceneGroup; resetKey: number }) {
  const t = useTranslations("surroundings");
  const tActions = useTranslations("actions");
  const { visibleCount, reveal, itemHeadingRefs } =
    useRevealMore<HTMLLIElement>(resetKey);
  const title =
    group.items.length > COUNT_IN_TITLE_THRESHOLD
      ? `${t(`bucket.${group.bucket}`)} ${t("count", { count: group.items.length })}`
      : t(`bucket.${group.bucket}`);
  return (
    <section className="mt-3">
      <h4 className="font-medium">{title}</h4>
      <ul className="mt-1 space-y-1">
        {group.items.slice(0, visibleCount).map((it, i) => (
          <li
            key={`${it.name}-${it.distanceMeters}`}
            className="text-sm"
            tabIndex={-1}
            ref={(el) => {
              itemHeadingRefs.current[i] = el;
            }}
          >
            {/* 한 줄 = 한 접근성 객체 — 거리·이름·길 단서를 단일 텍스트로(헌장 §4). */}
            {it.road
              ? t("itemWithRoad", {
                  distance: formatDistance(it.distanceMeters),
                  name: it.name,
                  road: it.road,
                })
              : t("item", {
                  distance: formatDistance(it.distanceMeters),
                  name: it.name,
                })}
          </li>
        ))}
      </ul>
      {group.items.length > visibleCount && (
        <button
          type="button"
          onClick={reveal}
          className="mt-1 min-h-11 text-sm text-accent underline"
        >
          {tActions("showMore")}
        </button>
      )}
    </section>
  );
}

/** 장면 본문 — 위치 확인 문장 먼저, 그다음 묶음들(발견 경로는 h4 제목). */
export function SurroundingsSceneView({
  scene,
  resetKey = 0,
}: {
  scene: Scene;
  resetKey?: number;
}) {
  return (
    <>
      {scene.place && (
        <p className="mt-2 text-sm" lang="ko">
          {scene.place}
        </p>
      )}
      {scene.groups.map((g) => (
        <GroupSection key={g.bucket} group={g} resetKey={resetKey} />
      ))}
    </>
  );
}

function SurroundingsSceneInner({ anchor }: { anchor: { lat: number; lng: number } }) {
  const t = useTranslations("surroundings");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<Scene>({
      source: { kind: "place", lat: anchor.lat, lng: anchor.lng },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/surroundings/scene?lat=${lat}&lng=${lng}`, {
          cache: "no-store",
        }),
      parse: (body) => {
        const b = body as { data?: Scene | null };
        // data null = 서버 키 미보유(게이트). 여기 도달했다면 구성 결함이므로
        // 빈 결과로 위장하지 않고 오류로 태운다(3-state).
        if (!b.data) throw new Error("surroundings scene: data null");
        if (b.data.total === 0) return { kind: "empty" };
        return { kind: "done", data: b.data };
      },
    });
  const live = nearbyLiveMessage(status, t, tCommon);

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done"}
      heading={t("ready")}
      headingRef={headingRef}
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <SurroundingsSceneView scene={status.data} resetKey={doneSeq} />
      )}
    </NearbyPanelShell>
  );
}

/**
 * 앵커가 없으면 아무것도 렌더하지 않는다(진입점이 좌표를 확보한 뒤에만 노출).
 * 앵커가 바뀌면 key로 재마운트해 이전 장면·상태를 버린다.
 */
export function SurroundingsScene({
  anchor,
}: {
  anchor: { lat: number; lng: number } | null;
}) {
  if (!anchor) return null;
  return (
    <SurroundingsSceneInner
      key={`${anchor.lat},${anchor.lng}`}
      anchor={anchor}
    />
  );
}
