# 출혈디버프

둘이 함께 보는 생리 주기 캘린더 (아이폰 홈 화면 웹앱 + 푸시 알림)

- 앱: GitHub Pages
- 기록 저장: Firebase Firestore (익명 로그인 + 커플 코드)
- 알림: Firebase Cloud Messaging, GitHub Actions가 30분마다 `scripts/notify.mjs` 실행
- Firestore 보안 규칙: `firestore.rules` 내용을 Firebase 콘솔 → Firestore → 규칙에 붙여넣기
- 필요한 시크릿: `FIREBASE_SERVICE_ACCOUNT` (Firebase 서비스 계정 비공개 키 JSON 전체)

예측은 평균으로 계산한 대략적인 날짜예요. 피임 기준으로 쓰지 마세요.
