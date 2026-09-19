#!/bin/bash
# 연결된 iPhone에 CLI만으로 빌드·설치·실행(Xcode UI 불필요, Xcode 15+ devicectl).
# 워크스페이스 공통 제네릭 판: 같은 폴더의 *.xcodeproj를 자동 탐지한다
# (gildongmu·dodo-planet·webfortd·dodo-games 네 repo 동일본 — 수정 시 넷 다 반영).
# 사용: ./deploy-device.sh [UDID]  — UDID 생략 시 페어링된 첫 기기 자동 선택.
# 빌드 구성은 환경변수로 고른다(기본 Debug = 기존 동작).
#   CONFIGURATION=Experimental ./deploy-device.sh
# repo마다 있는 구성이 다르므로 이름을 여기 박지 않는다(공용본 제네릭성 유지).
set -euo pipefail
cd "$(dirname "$0")"

PROJ=$(ls -d *.xcodeproj | head -1)
SCHEME="${PROJ%.xcodeproj}"
CONFIG="${CONFIGURATION:-Debug}"

# 기기 상태 문자열은 Xcode 버전에 따라 다르다("available (paired)" 또는 "connected", 2026-07-18 실측)
UDID="${1:-$(xcrun devicectl list devices 2>/dev/null \
  | awk '/available \(paired\)|connected/{for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-/) print $i}' | head -1)}"
[ -n "$UDID" ] || { echo "페어링된 iOS 기기가 없습니다. USB 연결과 신뢰 설정을 확인하세요." >&2; exit 1; }
echo "대상: $SCHEME ($CONFIG) → $UDID"

# 서명 인증: App Store Connect API 키가 있으면 그것으로(Xcode 계정 로그인 불필요),
# 없으면 Xcode에 로그인된 계정으로. 값은 env 우선, 없으면 repo 루트 .env.local
# (asc-submit.mjs와 같은 키 이름). Key ID만 있으면 .p8 경로는 표준 위치에서 유도한다.
env_local() { [ -f ../.env.local ] && sed -n "s/^$1=//p" ../.env.local | head -1 \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true; }
ASC_KEY_ID="${ASC_KEY_ID:-$(env_local ASC_KEY_ID)}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(env_local ASC_ISSUER_ID)}"
ASC_KEY_PATH="${ASC_KEY_PATH:-$(env_local ASC_KEY_PATH)}"
[ -n "$ASC_KEY_PATH" ] || ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
AUTH=()
if [ -n "$ASC_KEY_ID" ] && [ -n "$ASC_ISSUER_ID" ] && [ -f "$ASC_KEY_PATH" ]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  echo "서명 인증: API 키 $ASC_KEY_ID"
else
  echo "서명 인증: Xcode 계정(API 키 설정 없음)"
fi

xcodebuild -project "$PROJ" -scheme "$SCHEME" -configuration "$CONFIG" \
  -destination "platform=iOS,id=$UDID" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} build

# 번들 ID는 pbxproj 파싱 대신 빌드 산출물의 Info.plist에서 읽는다(타깃 다중일 때 오파싱 방지)
APP=$(ls -dt ~/Library/Developer/Xcode/DerivedData/"$SCHEME"-*/Build/Products/"$CONFIG"-iphoneos/*.app | head -1)
BUNDLE_ID=$(defaults read "$APP/Info" CFBundleIdentifier)

# repo가 서명 검증 훅을 두었으면 설치 전에 게이트로 건다(없는 repo에선 조용히 건너뜀).
# 공용본의 제네릭성을 유지하려고 존재 여부로 분기한다.
if [ -x scripts/verify-aps-environment.sh ]; then
  ./scripts/verify-aps-environment.sh "$APP"
fi
xcrun devicectl device install app --device "$UDID" "$APP"

xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" \
  || echo "설치 완료 — 기기가 잠겨 있어 자동 실행만 실패했습니다. 잠금 해제 후 홈 화면에서 여세요."
