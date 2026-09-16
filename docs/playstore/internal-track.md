# Play Console 내부 테스트 트랙 업로드 절차 초안

> **초안·실행 금지** — Play 개발자 계정(등록비 발생)과 서명 키가 생기기 전까지 문서와 스크립트 골격만 둔다. 실행·업로드는 하드 스톱(외부 발신·비용)이라 위원장 확인 뒤에만.

## 0. 원칙

- iOS `ios/scripts/asc-submit.mjs`와 같은 꼴: **드라이런 기본**, `--check`로 준비 상태만, `--apply`로 실제 업로드. 사람이 옮겨 적는 값은 최소(서비스 계정 JSON 파일 하나).
- 키 발급·계정 생성은 자동화하지 않는다(자격 증명을 만드는 일은 사람 몫). 스크립트는 키를 *쓰는* 절차만 흡수한다.
- 서명은 **Play App Signing**(Google이 앱 서명 키 보관) + 우리 **업로드 키**. 업로드 키 keystore는 저장소 밖 `~/gildongmu-private/keystore/`.

## 1. 위원장 1회 작업

1. Play Console 개발자 계정 생성(등록비 1회) → 앱 생성(패키지 `space.dodoplanet.gildongmu`, 기본 언어 ko-KR, 무료).
2. 앱 무결성 > **Play App Signing** 동의(Google 생성 앱 서명 키). 업로드 키는 아래 3에서 만든 것을 등록.
3. 업로드 키 생성(이 머신, 1회):
   ```
   mkdir -p ~/gildongmu-private/keystore && cd ~/gildongmu-private/keystore
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   비밀번호·별칭은 `~/gildongmu-private/keystore/keystore.properties`에(`storeFile=…/upload.jks`, `storePassword=`, `keyAlias=upload`, `keyPassword=`). 저장소에는 절대 넣지 않는다(`.gitignore`에 `*.jks`·`keystore.properties` 확인).
4. API 접근: Google Cloud 프로젝트 `gildongmu-prod`에 **서비스 계정** 생성 → JSON 키 내려받아 `~/gildongmu-private/play/service-account.json`(권한 600) → Play Console > 사용자 및 권한에서 그 서비스 계정을 초대해 **릴리스 관리자**(앱 단위) 부여. Google Play Android Developer API 사용 설정.
5. 콘텐츠 등급 설문·데이터 안전성·타깃 대상·앱 콘텐츠 선언은 Console에서 사람이 입력(초안 `listing.md`·`data-safety.md`).

## 2. 빌드 (이 세션 몫, 실행은 계정 뒤)

- `android/app/build.gradle.kts`에 `signingConfigs.release`를 **`keystore.properties`가 있을 때만** 읽도록 추가한다(파일이 없으면 서명 없이 `assembleDebug`는 그대로 돈다 — 게이트 무영향). 정식판 `applicationId`는 `.dev` 없음, `versionCode`는 업로드마다 +1(`versionName`은 `0.1.0` → 첫 내부 테스트 `0.1.0`, `versionCode 1`).
- 산출물: `cd android && ./gradlew :app:bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.
- 산출물 점검(iOS `check-release-artifact.mjs` 동형, 추후 `android/scripts/check-release-bundle.mjs`): 패키지 이름이 `.dev`가 아닌가, `BuildConfig.EXPERIMENTAL=false`, 매니페스트 권한 목록이 `data-safety.md` 선언과 같은가(`bundletool dump manifest`), 6로케일 `strings.xml`.

## 3. 업로드 (스크립트 골격 `android/scripts/play-upload.mjs`)

```
node android/scripts/play-upload.mjs --check                      # 서비스 계정 JSON·토큰·앱 조회
node android/scripts/play-upload.mjs --aab android/app/build/outputs/bundle/release/app-release.aab \
     --notes-ko docs/playstore/notes/0.1.0-ko.txt --notes-en docs/playstore/notes/0.1.0-en.txt   # 드라이런
node android/scripts/play-upload.mjs ... --apply                  # edits.insert → bundles.upload → tracks.update(internal, draft) → edits.commit
```

API 순서(Google Play Developer API v3): `edits.insert` → `edits.bundles.upload`(업로드 엔드포인트, `uploadType=media`) → `edits.tracks.update`(`track: internal`, `releases[].status: draft` — 완료(`completed`)는 별도 플래그) → `edits.commit`. 인증은 서비스 계정 JWT(RS256, scope `https://www.googleapis.com/auth/androidpublisher`) → OAuth 토큰.

## 4. 내부 테스터

- 내부 테스트 트랙 테스터 목록(이메일, 최대 100) — 위원장 계정 + 검증 기기 계정. 초대 링크는 Console이 준다.
- 스크린 리더 실사용 검증은 실기기(TalkBack 폰·한소네)에서 — `docs/appstore/1.0-voiceover-qa-checklist.md`의 안드로이드판을 추후 작성.

## 5. 아직 정하지 않은 것

- 개발자 계정 주체(개인 vs 조직)와 개발자 이름 표기.
- 첫 공개 트랙(비공개 테스트 → 프로덕션) 일정 — 개인 개발자 계정의 신규 앱은 비공개 테스트 요건(테스터 수·기간)이 있을 수 있어 Console 안내를 따른다.
