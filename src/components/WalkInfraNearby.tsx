"use client";

import { useTranslations } from "next-intl";
import type { WalkInfrastructure, WalkFeature } from "@/lib/walk-infra";
import { formatDistance, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/** done 데이터 — 두 소스 묶음 한 필드(결과 0건이라는 상태가 없다). */
interface WalkData {
  walk: WalkInfrastructure;
}

/**
 * 내 주변 보행 인프라: 7번째 nearby(음향신호기+OSM 횡단보도·점자블록).
 *
 * 게이트 없음(음향신호기=무인증 seed, OSM=무키 공개 인스턴스)이라 항상 노출한다.
 * spec §2-F 상태×산문 매트릭스: audioSignals(ok>0/ok=0/unsupported/error)와
 * osm(ok>0/ok=0/unsupported/error)을 서로 독립적으로 판정해 각자의 문구를 낭독한다(소스별
 * 강등이 다른 소스를 오염시키지 않음). render 카드 없음(채팅 도구는 별도).
 *
 * a11y: 패널은 버튼이 발견 경로라 <div>(region 금지). 그룹 헤더 <h4> 3개
 * (음향신호기/횡단보도/점자블록)는 항상 렌더한다. 헤딩 내비로 어느 그룹에 먼저
 * 도달해도 그 자리에서 상태를 알 수 있어야 한다. 항목 자체는 이름 없는
 * 인프라 점이라 heading 미부여(joinText 한 줄=한 객체). 방위는 기존
 * surroundingsNearby.direction.* 키를 재사용(신규 중복 정의 금지).
 */
export function WalkInfraNearby() {
  const t = useTranslations("walkInfra");
  const tDir = useTranslations("surroundingsNearby");
  const tActions = useTranslations("actions");
  // coverage:"none"이 의도 계약이다 — 라우트에 커버리지 마커가 없고 두 소스가 각자
  // unsupported로 강등되므로 한국 밖에서도 조회해 소스별 미제공 문구를 낸다. 화면 단위
  // outOfCoverage 분기에는 도달하지 않으며, tCommon은 공유 live 시그니처를 채우는 인자다.
  // ⚠ "korea"로 "정리"하지 말 것 — 소스별 구분이 사라지고 화면 전체가 커버리지 밖 한
  // 문구로 뭉개진다(iOS WalkInfraNearbyView의 `.none` 주석과 같은 이유).
  const tCommon = useTranslations("common");
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<WalkData>({
      source: { kind: "current" },
      coverage: "none",
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/walk/nearby?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      // parse는 항상 done — empty 분기 도달 불가(위 spec §2-F: 결과 0건이라는 상태가
      // 없다). WalkInfra에 empty 개념을 도입하려면 walkInfra.empty i18n 키(6로케일)부터
      // 추가할 것.
      parse: (body) => ({
        kind: "done",
        data: { walk: (body as { walk: WalkInfrastructure }).walk },
      }),
    });

  // 단일 polite 통지(§2-F): ok 소스의 수치만 낭독, error/unsupported는 실패·미제공
  // 문구로("0기" 합성 금지). 두 소스는 서로 독립적으로 강등된다.
  function buildLive(walk: WalkInfrastructure): string {
    const audio =
      walk.audioSignals.status === "ok"
        ? walk.audioSignals.data.deviceCount > 0
          ? t("audioSummary", { count: walk.audioSignals.data.deviceCount })
          : t("audioNone")
        : walk.audioSignals.status === "unsupported"
          ? t("audioUnsupported")
          : t("audioError");
    const osm =
      walk.osm.status === "ok"
        ? walk.osm.data.listedCount > 0
          ? t("osmSummary", { count: walk.osm.data.listedCount })
          : t("osmEmpty")
        : walk.osm.status === "unsupported"
          ? t("osmUnsupported")
          : t("osmError");
    return joinText(audio, osm);
  }

  const live = nearbyLiveMessage(status, t, tCommon, () =>
    status.kind === "done" ? buildLive(status.data.walk) : "",
  );

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
    >
      {status.kind === "done" && (
        <WalkInfraPanel walk={status.data.walk} t={t} tDir={tDir} />
      )}
    </NearbyPanelShell>
  );
}

function WalkInfraPanel({
  walk,
  t,
  tDir,
}: {
  walk: WalkInfrastructure;
  t: ReturnType<typeof useTranslations<"walkInfra">>;
  tDir: ReturnType<typeof useTranslations<"surroundingsNearby">>;
}) {
  const dirLabel = (bearing: WalkFeature["bearing"]) => tDir(`direction.${bearing}`);
  const crossing = walk.osm.status === "ok" ? walk.osm.data.features.filter((f) => f.crossing) : [];
  const tactile =
    walk.osm.status === "ok" ? walk.osm.data.features.filter((f) => !f.crossing && f.tactilePaving) : [];
  // 출처는 실제로 데이터를 보여준 소스만 인용한다(성공한 소스만, 실패한 소스는
  // 인용하지 않는다).
  const showFootnote = walk.audioSignals.status === "ok" || walk.osm.status === "ok";

  return (
    <>
      <div className="mt-3">
        <h4 className="font-medium">{t("groupAudio")}</h4>
        {walk.audioSignals.status === "ok" ? (
          walk.audioSignals.data.deviceCount > 0 ? (
            <>
              <p className="mt-1 text-sm">
                {t("audioSummary", { count: walk.audioSignals.data.deviceCount })}
              </p>
              <ul className="mt-1 space-y-1">
                {walk.audioSignals.data.sites.map((site, i) => (
                  <li key={i} className="text-sm">
                    {t("audioSite", {
                      direction: dirLabel(site.bearing),
                      distance: formatDistance(site.distanceMeters),
                      count: site.deviceCount,
                    })}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm opacity-70">
              {t("audioNone")}
            </p>
          )
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {walk.audioSignals.status === "unsupported" ? t("audioUnsupported") : t("audioError")}
          </p>
        )}
      </div>

      <div className="mt-3">
        <h4 className="font-medium">
          {walk.osm.status === "ok" && walk.osm.data.crossingTotal > 0
            ? walk.osm.data.crossingTotal > crossing.length
              ? t("groupCrossingTruncated", { total: walk.osm.data.crossingTotal, listed: crossing.length })
              : t("groupCrossingCount", { count: walk.osm.data.crossingTotal })
            : t("groupCrossing")}
        </h4>
        {walk.osm.status === "ok" ? (
          crossing.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {crossing.map((f) => (
                <li key={f.osmId} className="text-sm">
                  {joinText(
                    t("itemLocation", { direction: dirLabel(f.bearing), distance: formatDistance(f.distanceMeters) }),
                    f.crossingSignal === "yes" && t("hasSignal"),
                    f.tactilePaving && t("hasTactile"),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm opacity-70">
              {t("crossingEmpty")}
            </p>
          )
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {/* 국내 전역 seed라 한국 밖은 실패가 아니라 미제공이다(3-state).
                "0건"으로도, "조회 실패"로도 뭉개지 않는다. */}
            {walk.osm.status === "unsupported" ? t("crossingUnsupported") : t("crossingError")}
          </p>
        )}
      </div>

      <div className="mt-3">
        <h4 className="font-medium">
          {walk.osm.status === "ok" && walk.osm.data.tactileTotal > 0
            ? walk.osm.data.tactileTotal > tactile.length
              ? t("groupTactileTruncated", { total: walk.osm.data.tactileTotal, listed: tactile.length })
              : t("groupTactileCount", { count: walk.osm.data.tactileTotal })
            : t("groupTactile")}
        </h4>
        {walk.osm.status === "ok" ? (
          tactile.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {tactile.map((f) => (
                <li key={f.osmId} className="text-sm">
                  {joinText(
                    t("itemLocation", { direction: dirLabel(f.bearing), distance: formatDistance(f.distanceMeters) }),
                    f.hostFeature === "busStop" && t("hostBusStop"),
                    f.hostFeature === "subwayEntrance" && t("hostSubwayEntrance"),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm opacity-70">
              {t("tactileEmpty")}
            </p>
          )
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {walk.osm.status === "unsupported" ? t("tactileUnsupported") : t("tactileError")}
          </p>
        )}
      </div>

      {showFootnote && (
        <>
          <p className="mt-2 text-xs opacity-70">
            {t("footnote")}
          </p>
          <p className="mt-1 text-xs opacity-70">
            {joinText(
              walk.osm.status === "ok" && t("sourceOsm"),
              walk.audioSignals.status === "ok" && t("sourceAudio", { baseDate: walk.audioSignals.data.baseDate }),
            )}
          </p>
        </>
      )}
    </>
  );
}
