import { getLocale, getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./LanguageSwitcher";

/**
 * 사이트 헤더 — 제목 + 언어 전환기. 제목은 로케일 메시지에서 오므로
 * /ko·/en에서 각각 단일 언어로만 표시된다(한/영 혼용 제거).
 *
 * 제목 '길동무'는 로케일 홈(`/ko`·`/en`)으로 가는 링크다 — "처음으로 돌아가기".
 * 일부러 next-intl Link(소프트 내비)가 아니라 일반 <a>(하드 내비)를 쓴다:
 * PlaceSearch는 별도 클라이언트 섬이라 소프트 내비로 같은 경로를 다시 밟아도
 * 검색어·결과 상태가 남는다. 하드 내비가 깨끗한 초기 화면(idle, ?q= 없음)을
 * 보장한다.
 */
export async function Header() {
  const t = await getTranslations("app");
  const locale = await getLocale();
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div>
          {/* 앱 셸 h1 — heading 내비게이션 진입점(상세 화면의 장소명은 h2).
              링크 텍스트가 곧 접근성 이름('길동무')이라 별도 aria-label 불필요. */}
          <h1 className="text-lg font-bold">
            <a href={`/${locale}`} className="rounded">
              {t("title")}
            </a>
          </h1>
          <p className="text-xs text-muted">{t("tagline")}</p>
        </div>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
