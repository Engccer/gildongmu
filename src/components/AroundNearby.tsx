"use client";

import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import { useLocale, useTranslations } from "next-intl";
import type { SurroundingPlace } from "@/lib/types";
import type { Scene } from "@/lib/surroundings-scene";
import type { NearbyOverview } from "@/lib/nearby-overview";
import { buildOverviewLines } from "@/lib/overview-lines";
import { formatDistance } from "@/lib/format";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { requestOpenPlace } from "@/lib/place-open-request";
import { surroundingPlaceToPlace } from "@/lib/nearby-place";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { SurroundingsSceneView } from "@/components/SurroundingsScene";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/**
 * 둘러보기 — 위치 문장 + "한눈에 보기" 6불릿 + 주변 상황(자동 펼침) + 주변 가게와 시설.
 * iOS `AroundNearbyView`(M4, spec `2026-08-22-nearby-tab-restructure-design.md`)의 웹 이식.
 * 종전 `WhereAmI`(현재 위치 확인)·`SurroundingsNearby`(둘러보기) 두 패널을 하나로 합쳤다.
 *
 * 세 요청(조망·장면·목록)을 **한 fetch 안에서 allSettled로 묶어 한 번에 커밋**한다(iOS
 * `AroundPayload` 동형) — 완료 시점이 다른 로드를 따로 커밋하면 늦게 온 쪽이 포커스를
 * 끌어간다. 조각별 실패는 payload 안에 남겨 그 자리에 실패 문장으로(침묵 금지). 셋 다
 * 실패해야 패널 error다. `useNearbyFetch`는 `ok`·`json()`만 읽으므로 합성 응답을 돌려준다.
 *
 * 패널 헤딩(h3, 첫 로드 착지)이 곧 위치 문장이고 GPS/수동 출처를 선언하는 유일한 자리다
 * (`status.origin` 기록 기준 — 좌표 대조·현재 라벨은 둘 다 틀린다, 종전 WhereAmI D21 주석).
 */
interface AroundPayload {
  /** null = 전 키 부재(data null) 또는 실패(`overviewFailed`로 가른다). */
  overview: NearbyOverview | null;
  overviewFailed: boolean;
  /** null = 실패 또는 0건(`total === 0` — 장면은 빈 결과를 `surroundings.empty`로 말한다). */
  scene: Scene | null;
  sceneFailed: boolean;
  /** null = 조회 실패. 0건은 빈 배열. */
  places: SurroundingPlace[] | null;
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await p };
  } catch {
    return { ok: false };
  }
}

/** 응답을 읽어 `ok`면 body, 아니면 throw — allSettled 한 조각(HTTP 실패도 rejected로). */
async function readJson(res: Response): Promise<unknown> {
  const body = await res.json();
  if (!res.ok) throw new Error(String(res.status));
  return body;
}

/** 세 요청 → `useNearbyFetch`가 읽는 표면(`ok`·`json()`)만 갖춘 합성 응답. */
async function fetchAround(lat: number, lng: number): Promise<Response> {
  const q = `lat=${lat}&lng=${lng}`;
  const [overview, scene, places] = await Promise.all([
    settle(fetch(`/api/nearby/overview?${q}`, { cache: "no-store" }).then(readJson)),
    settle(fetch(`/api/surroundings/scene?${q}`, { cache: "no-store" }).then(readJson)),
    settle(
      fetch(`/api/places/around?${q}&limit=${NEARBY_LIMIT_MAX}`, { cache: "no-store" }).then(
        readJson,
      ),
    ),
  ]);
  const allFailed = !overview.ok && !scene.ok && !places.ok;
  // 커버리지 마커는 조망 응답이 대표한다(세 라우트가 같은 판정을 내므로 하나면 충분).
  if (overview.ok && isOutOfCoverageBody(overview.value)) {
    return { ok: true, status: 200, json: async () => overview.value } as unknown as Response;
  }
  const body: AroundPayload = {
    overview: overview.ok ? ((overview.value as { data?: NearbyOverview | null }).data ?? null) : null,
    overviewFailed: !overview.ok,
    scene: scene.ok ? ((scene.value as { data?: Scene | null }).data ?? null) : null,
    sceneFailed: !scene.ok,
    places: places.ok ? ((places.value as { places?: SurroundingPlace[] }).places ?? []) : null,
  };
  return {
    ok: !allFailed,
    status: allFailed ? 502 : 200,
    json: async () => body,
  } as unknown as Response;
}

export function AroundNearby() {
  const t = useTranslations("around");
  const tWhere = useTranslations("whereAmI");
  const tSurroundings = useTranslations("surroundings");
  const tSurroundingsNearby = useTranslations("surroundingsNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const bilingual = useBilingualName();
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<AroundPayload>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) => fetchAround(lat, lng),
      parse: (body) => {
        const b = body as AroundPayload;
        // 세 조각 전부 비었고 실패도 아닌 상태(전 키 부재)만 empty — 실패는 각 조각 자리의
        // 문장이 말하므로 여기서 empty로 뭉개지 않는다(iOS `isAllAbsent` 동형).
        const allAbsent =
          b.overview === null && !b.overviewFailed && b.scene === null && !b.sceneFailed &&
          b.places !== null && b.places.length === 0;
        if (allAbsent) return { kind: "empty" };
        return { kind: "done", data: b };
      },
    });
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore<HTMLButtonElement>(doneSeq);
  // done 통지는 수동 여부로 갈린다 — 수동 위치일 때 "현재 위치"라고 알리지 않는다(전역 제약).
  const live = nearbyLiveMessage(status, t, tCommon, () =>
    status.kind === "done" && status.origin === "manual" ? t("readyManual") : t("ready"),
  );

  // 위치 문장(패널 헤딩) — 이 산문이 **무엇을 기준으로 만들어졌나**를 말한다(`origin` 기록).
  // 비-ko는 위치 문장의 주소가 로마자(주소 규칙)이고 한글은 헤딩 끝 괄호(E28 R1).
  const headingPlace =
    status.kind === "done" && status.data.overview?.place
      ? bilingual(status.data.overview.place, { roman: status.data.overview.placeRoman })
      : null;
  const heading = (() => {
    if (status.kind !== "done") return "";
    const place = headingPlace?.primary ?? null;
    const manual = status.origin === "manual";
    if (place) return manual ? t("hereManual", { place }) : t("here", { place });
    return manual ? t("hereManualNoPlace") : t("hereNoPlace");
  })();

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done"}
      heading={heading}
      headingSecondary={headingPlace?.secondary}
      headingRef={headingRef}
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <>
          {/* 한눈에 보기 — 헤딩 + 반경 부제 한 줄(반경은 여기서 한 번만), 불릿당 <li> 하나(=한 객체). */}
          {status.data.overview ? (
            <section className="mt-3">
              <h4 className="font-medium">
                {`${tWhere("overview.heading")} (${tWhere("overview.radius", {
                  distance: formatDistance(status.data.overview.radiusMeters),
                })})`}
              </h4>
              <ul className="mt-1 space-y-1">
                {buildOverviewLines(status.data.overview, tWhere, locale).map((line, i) => (
                  <li key={i} className="text-sm" lang={langFor(line.text)}>
                    {line.text}
                    <KoTail secondary={line.secondary} />
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            status.data.overviewFailed && (
              <section className="mt-3">
                <h4 className="font-medium">{tWhere("overview.heading")}</h4>
                <p className="mt-1 text-sm">{tWhere("overview.failed")}</p>
              </section>
            )
          )}

          {/* 주변 상황 — 자동 펼침(헤딩이 발견 경로, 포커스 이동 없음). 장소 행은 상세로 열린다. */}
          <section className="mt-3">
            <h4 className="font-medium">{t("sceneHeading")}</h4>
            {status.data.scene ? (
              status.data.scene.total === 0 ? (
                <p className="mt-1 text-sm">{tSurroundings("empty")}</p>
              ) : (
                <SurroundingsSceneView
                  scene={status.data.scene}
                  resetKey={doneSeq}
                  headingLevel={4}
                  showPlace={false}
                />
              )
            ) : (
              <p className="mt-1 text-sm">
                {status.data.sceneFailed ? tSurroundings("error") : tSurroundings("empty")}
              </p>
            )}
          </section>

          {/* 주변 가게와 시설 — 종전 둘러보기 목록(500m·10종·더 보기). 이름 행이 상세 진입 버튼. */}
          <section className="mt-3">
            <h4 className="font-medium">{t("placesHeading")}</h4>
            {status.data.places === null ? (
              <p className="mt-1 text-sm">{t("placesFailed")}</p>
            ) : status.data.places.length === 0 ? (
              <p className="mt-1 text-sm">{t("empty")}</p>
            ) : (
              <>
                <ul className="mt-1 space-y-4">
                  {status.data.places.slice(0, visibleCount).map((p, i) => {
                    const itemName = bilingual(p.name, { roman: p.nameRoman });
                    return (
                    <li key={p.id}>
                      {/* "더 보기" 착지는 컨테이너가 아니라 버튼 — 컨테이너에 두면 VO가 같은
                          텍스트를 컨테이너·버튼으로 두 번 읽는다(a11y 감사 2026-08-22). */}
                      <h5 className="font-medium">
                        <button
                          type="button"
                          ref={(el) => {
                            itemHeadingRefs.current[i] = el;
                          }}
                          onClick={() => requestOpenPlace(surroundingPlaceToPlace(p))}
                          className="min-h-11 text-left underline"
                        >
                          {/* 버튼은 이름이 계산되는 요소라 괄호를 이름 바로 뒤에 둬도 한 객체다(E28 R2). */}
                          {itemName.primary}
                          <KoTail secondary={itemName.secondary} />
                          {`, ${tSurroundingsNearby("item", {
                            category: tSurroundingsNearby(`category.${p.category}`),
                            direction: tSurroundingsNearby(`direction.${p.bearing}`),
                            distance: formatDistance(p.distanceMeters),
                          })}`}
                        </button>
                      </h5>
                      {p.phone && (
                        <p className="mt-1 text-sm">
                          <a href={`tel:${p.phone}`} className="text-accent underline">
                            {`${p.phone} ${tSurroundingsNearby("call")}`}
                          </a>
                        </p>
                      )}
                    </li>
                    );
                  })}
                </ul>
                {status.data.places.length > visibleCount && (
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
          </section>
        </>
      )}
    </NearbyPanelShell>
  );
}
