"use client";

import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import { useEffect, useRef, type ComponentPropsWithRef } from "react";
import { useTranslations } from "next-intl";
import type { Scene, SceneGroup } from "@/lib/surroundings-scene";
import { formatDistance } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { requestOpenPlace } from "@/lib/place-open-request";
import { sceneItemToPlace } from "@/lib/nearby-place";

/**
 * M1 도착지 부근 상황 재구성 — "여기가 맞나" 확인용 요청형 섹션.
 *
 * 앵커(목적지 좌표 또는 정위에 쓴 좌표)를 받아 입구 기준 왼쪽·오른쪽·맞은편·
 * 건물 너머 묶음을 렌더한다. 축이 안 서면 서버가 절대 방위 묶음으로 물러난
 * 장면을 주므로 렌더 구조는 동일하다(bucket 키만 다르다).
 *
 * ⚠ 진입점 2곳(AroundNearby 패널 = 자동 펼침 `SurroundingsSceneView`·DistanceBeacon 시트 =
 * 버튼형 `SurroundingsScene`)이 모두 **다른 패널 안**이라
 * NearbyPanelShell을 중첩하지 않고 **live region도 만들지 않는다** — 감싸는
 * 패널이 이미 단일 polite 채널을 소유한다(DistanceBeacon은 이를 테스트로 강제).
 * 통지는 전부 포커스·라벨 채널이다(헌장 §5 "라벨이 곧 상태 신호"):
 * 조회 중 = 트리거 라벨 교체, 성공 = 결과 헤딩 포커스, 빈 결과·실패 = 메시지
 * 텍스트로 포커스 이동. 버튼이 발견 경로이므로 패널은 div, 결과 헤딩만 h4(헌장 §3).
 */

/** 묶음이 이보다 크면 제목에 곳수를 병기한다(스와이프 전 규모 예고). */
const COUNT_IN_TITLE_THRESHOLD = 3;

/** 임베드 컨테이너의 헤딩 깊이가 다르다 — 레벨은 호출부가 정한다(계층 스킵 금지). */
type SceneHeadingLevel = 3 | 4;

function GroupSection({
  group,
  resetKey,
  headingLevel,
}: {
  group: SceneGroup;
  resetKey: number;
  headingLevel: SceneHeadingLevel;
}) {
  const t = useTranslations("surroundings");
  const tActions = useTranslations("actions");
  const { visibleCount, reveal, itemHeadingRefs } =
    useRevealMore<HTMLButtonElement>(resetKey);
  const bilingual = useBilingualName();
  const title =
    group.items.length > COUNT_IN_TITLE_THRESHOLD
      ? `${t(`bucket.${group.bucket}`)} ${t("count", { count: group.items.length })}`
      : t(`bucket.${group.bucket}`);
  // 묶음 제목은 장면 헤딩 바로 아래 레벨(h4→h5 또는 h3→h4).
  const BucketHeading = headingLevel === 3 ? "h4" : "h5";
  return (
    <section className="mt-3">
      <BucketHeading className="font-medium">{title}</BucketHeading>
      <ul className="mt-1 space-y-1">
        {group.items.slice(0, visibleCount).map((it, i) => {
          const name = bilingual(it.name, { roman: it.nameRoman });
          // 도로명은 비-ko에서 로마자(서버 `roadRoman`, E28 후속) — 이름과 달리 괄호 병기는 하지 않는다
          // (문장 안 절이라 `KoTail`을 줄 가운데 둘 수 없다, R1). ko·로마자 부재는 원문 그대로.
          const text = it.road
            ? t("itemWithRoad", {
                distance: formatDistance(it.distanceMeters),
                name: name.primary,
                road: bilingual(it.road, { roman: it.roadRoman }).primary,
              })
            : t("item", {
                distance: formatDistance(it.distanceMeters),
                name: name.primary,
              });
          return (
          <li
            key={`${it.id}-${it.distanceMeters}`}
            className="text-sm"
            // 이름·도로명 모두 비-ko에서 로마자(도로명은 `roadRoman` 부재면 한국어 원문) — lang은 접근
            // 텍스트에 한글이 남을 때만(NightClinics 한 줄 lang 선례, E28 R4).
            lang={langFor(text)}
          >
            {/* 한 줄 = 한 접근성 객체 — 거리·이름·길 단서를 단일 텍스트로(헌장 §4).
                행 전체가 장소 상세 진입 버튼이고 "더 보기" 착지도 이 버튼이다(M4 판정 ⑤,
                iOS `NavigationLink` 동형 — 컨테이너 착지는 이중 낭독). 한글 괄호는 줄 끝(E28 R1). */}
            <button
              type="button"
              ref={(el) => {
                itemHeadingRefs.current[i] = el;
              }}
              onClick={() => requestOpenPlace(sceneItemToPlace(it))}
              className="min-h-11 text-left underline"
            >
              {text}
              <KoTail secondary={name.secondary} />
            </button>
          </li>
          );
        })}
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

/**
 * 장면 본문 — 위치 확인 문장 먼저, 그다음 묶음들(발견 경로는 묶음 제목 헤딩).
 * `showPlace=false`는 자동 펼침 임베드(AroundNearby)용 — 패널 헤딩이 이미 같은 위치 문장을
 * 말하므로 반복하면 SR에 두 번 낭독된다.
 */
export function SurroundingsSceneView({
  scene,
  resetKey = 0,
  headingLevel = 4,
  showPlace = true,
}: {
  scene: Scene;
  resetKey?: number;
  headingLevel?: SceneHeadingLevel;
  showPlace?: boolean;
}) {
  const bilingual = useBilingualName();
  const place = scene.place ? bilingual(scene.place, { roman: scene.placeRoman }) : null;
  return (
    <>
      {showPlace && place && (
        <p className="mt-2 text-sm" lang={langFor(place.primary)}>
          {place.primary}
          <KoTail secondary={place.secondary} />
        </p>
      )}
      {scene.groups.map((g) => (
        <GroupSection
          key={g.bucket}
          group={g}
          resetKey={resetKey}
          headingLevel={headingLevel}
        />
      ))}
    </>
  );
}

function SurroundingsSceneInner({
  anchor,
  headingLevel,
}: {
  anchor: { lat: number; lng: number };
  headingLevel: SceneHeadingLevel;
}) {
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

  // 빈 결과·실패는 렌더된 메시지 텍스트로 포커스를 옮겨 통지한다(§5 — live 없음.
  // done의 헤딩 포커스는 useNearbyFetch가 담당하므로 여기선 나머지 종단 상태만).
  const messageRef = useRef<HTMLParagraphElement>(null);
  const terminalMessage =
    status.kind === "empty"
      ? t("empty")
      : status.kind === "error"
        ? t("error")
        : status.kind === "outOfCoverage"
          ? tCommon("outOfCoverage")
          : null;
  useEffect(() => {
    if (
      status.kind === "empty" ||
      status.kind === "error" ||
      status.kind === "outOfCoverage"
    ) {
      messageRef.current?.focus();
    }
  }, [status.kind]);

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => load(status.kind === "done")}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {/* 조회 중 라벨 교체가 진행 신호다(reroute 버튼 관례 — 별도 announce 금지). */}
        {busy ? t("loading") : status.kind === "done" ? t("refresh") : t("button")}
      </button>

      {terminalMessage && (
        <p ref={messageRef} tabIndex={-1} className="mt-2 text-sm">
          {terminalMessage}
        </p>
      )}

      {status.kind === "done" && (
        <div className="mt-2 rounded-md border border-border p-3">
          <SceneHeading
            level={headingLevel}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("ready")}
          </SceneHeading>
          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>
          <SurroundingsSceneView
            scene={status.data}
            resetKey={doneSeq}
            headingLevel={headingLevel}
          />
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}

function SceneHeading({
  level,
  ...rest
}: { level: SceneHeadingLevel } & ComponentPropsWithRef<"h3">) {
  const Tag = level === 3 ? "h3" : "h4";
  return <Tag {...rest} />;
}

/**
 * 앵커가 없으면 아무것도 렌더하지 않는다(진입점이 좌표를 확보한 뒤에만 노출).
 * 앵커가 바뀌면 key로 재마운트해 이전 장면·상태를 버린다.
 * `headingLevel`은 임베드 컨테이너의 직전 헤딩 + 1 — 계층 스킵 금지(헌장 §3):
 * AroundNearby(패널 h3 아래)=4, DistanceBeacon(장소 상세 h2 아래)=3.
 */
export function SurroundingsScene({
  anchor,
  headingLevel = 4,
}: {
  anchor: { lat: number; lng: number } | null;
  headingLevel?: SceneHeadingLevel;
}) {
  if (!anchor) return null;
  return (
    <SurroundingsSceneInner
      key={`${anchor.lat},${anchor.lng}`}
      anchor={anchor}
      headingLevel={headingLevel}
    />
  );
}
