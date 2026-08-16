"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import type { WhereAmI as WhereAmIData } from "@/lib/types";
import { buildLocationNarrative } from "@/lib/where-am-i";
import { formatDistance } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useManualLabelFormatter, useManualLocationLabel } from "@/hooks/useManualLocation";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { SurroundingsScene } from "@/components/SurroundingsScene";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/** done 데이터 — 정위 결과 한 필드. */
interface WhereAmIState {
  data: WhereAmIData;
}

/**
 * "현재 위치" 정위 카드 — 홈 "내 주변" 묶음 맨 위 별도 버튼. SurroundingsNearby
 * 동형(공유 geolocation·아코디언·force 새로고침·prevStatus 복원·Esc 경합 차단).
 * 차이: 카테고리 리스트가 아니라 도로명·행정동·근접역·기준점을 결정론 산문 두세
 * 단락으로 제시(buildLocationNarrative).
 */
export function WhereAmI() {
  const t = useTranslations("whereAmI");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<WhereAmIState>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/where-am-i?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      parse: (body) => {
        // 조각이 하나도 안 잡히면 라우트가 data:null로 200을 준다(오류 아님).
        const b = body as { data?: WhereAmIData | null };
        if (!b.data) return { kind: "empty" };
        return { kind: "done", data: { data: b.data } };
      },
    });
  // done 통지는 헤딩 포커스(ready+asOf 텍스트)가 담당 — 접근성 헌장 §5(재포커스
  // 라벨이 곧 상태 신호, 별도 announce 중복 금지).
  const live = nearbyLiveMessage(status, t, tCommon, () => "");
  // 수동 위치일 때 "현재 위치"라는 표현을 쓰지 않는다(전역 제약). 좌표는 이미
  // 관문(useNearbyFetch)이 수동으로 바꿔 주는데 문구만 GPS를 말하면, **자기가 지금
  // 어디 있나를 묻는 전용 화면**에서 지정한 좌표가 GPS 판정처럼 낭독되어 사용자는
  // GPS가 고쳐졌다고 믿는다. 판정선은 표시줄과 같은 훅이 소유한다.
  const manualLabel = useManualLocationLabel();
  // ⚠ 헤딩은 **이 산문이 무엇을 기준으로 만들어졌나**를 말한다(D21, 2026-08-16).
  // `manualLabel`은 *지금* 상태라, GPS 결과가 떠 있는 채로 위치를 지정하면 GPS 산문에
  // "지정한 위치" 딱지가 붙었다 — 시각장애 사용자에겐 이 문구가 유일한 정보원이라
  // 반증할 방법이 없다. 근거는 `done.origin`(관문이 좌표를 고른 경로 그대로)이다.
  // ⚠ 좌표 대조로 되짚는 방법은 **틀린다** — 지정한 위치가 마침 GPS와 같은 지점이면
  //   두 출처가 같은 값을 갖는다(변이 주입에서 실제로 드러났다). 트리거 시점 라벨을
  //   얼리는 방법도 틀린다 — force 재조회는 이동 판정으로 수동 위치를 해제한 뒤 GPS로
  //   떨어질 수 있어, 누를 때의 라벨과 실제로 쓰인 좌표가 갈린다.
  // ⚠ 라벨도 `done`에서 읽는다(`useManualLocationLabel`이 아니라) — 조회 뒤 이동 판정이나
  //   직접 해제로 지정이 풀리면 지금 라벨은 null이 되고, 그러면 수동 좌표로 만든 산문이
  //   "현재 위치"로 낭독되는 **대칭형 거짓말**이 생긴다(독립 리뷰 검출 2026-08-16).
  const formatManualLabel = useManualLabelFormatter();
  const fetchedLabel =
    status.kind === "done" && status.origin === "manual" && status.manualLabel
      ? formatManualLabel(status.manualLabel)
      : undefined;

  const narrative =
    status.kind === "done" ? buildLocationNarrative(status.data.data) : null;

  return (
    <NearbyPanelShell
      triggerLabel={
        status.kind === "done" ? t("refresh") : manualLabel ? t("manualButton") : t("button")
      }
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done" && narrative !== null}
      heading={
        status.kind === "done"
          ? `${fetchedLabel ?? t("ready")} ${t("asOf", { time: status.at })}`
          : ""
      }
      headingRef={headingRef}
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {narrative && (
        <>
          {/* 단락 1 — 위치 + 가장 가까운 역. 결정론 산문 한 단락을 한 텍스트 런으로:
              장소·역명·노선을 <span>으로 감싸지 않고 문자열로 보간해 VoiceOver가
              문장을 끊지 않고 한 번에 낭독한다(산문 템플릿 자체는 불변). */}
          <p className="mt-2 text-sm leading-relaxed">
            {narrative.place &&
              t.rich("narrative.here", {
                place: () => narrative.place,
              })}
            {narrative.station && (
              <>
                {" "}
                {t.rich("narrative.station", {
                  name: () => narrative.station!.name,
                  line: () =>
                    narrative.station!.line
                      ? ` (${narrative.station!.line})`
                      : "",
                  direction: t(`direction.${narrative.station.bearing}`),
                  distance: formatDistance(narrative.station.distanceMeters),
                })}
              </>
            )}
          </p>

          {/* 단락 2 — 주변 기준점(거리순 상위 6) */}
          {narrative.landmarks.length > 0 && (
            <p className="mt-2 text-sm leading-relaxed">
              {t("narrative.landmarksLead")}
              {narrative.landmarks.map((l, i) => (
                <Fragment key={l.id}>
                  {i > 0 && ", "}
                  {t.rich("narrative.landmarkItem", {
                    name: () => l.name,
                    category: t(`category.${l.category}`),
                    direction: t(`direction.${l.bearing}`),
                    distance: formatDistance(l.distanceMeters),
                  })}
                </Fragment>
              ))}
              {t("narrative.landmarksTail")}
            </p>
          )}

          {/* M1 부근 재구성 — 앵커는 이 정위에 실제로 쓴 좌표(수동 위치 자동 반영).
              기준점 산문(동서남북 6곳)과 다른 층: 입구 기준 좌우 묶음 + 18종 단서. */}
          {status.kind === "done" && (
            <SurroundingsScene anchor={status.coords} />
          )}
        </>
      )}
    </NearbyPanelShell>
  );
}
