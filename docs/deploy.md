# GitHub 배포와 자동 업데이트

이 앱은 정적 사이트이지만, GitHub Actions로 `data/snapshot.js`를 주기적으로 다시 만들면 최신 데이터가 반영됩니다.

## 현실적인 한계

- GitHub Actions 스케줄은 정확한 실시간 타이머가 아닙니다. 실행이 늦어질 수 있고, 매우 바쁜 시간에는 일부 실행이 누락될 수 있습니다.
- 현재 데이터 소스는 FRED와 World Bank라서 초단위 실시간 환율이 아닙니다. FRED `DEXKOUS`는 일별 환율이고, World Bank 지표는 연간 지표입니다.
- 진짜 실시간에 가까운 USD/KRW가 필요하면 유료/전문 환율 API 또는 브로커/마켓데이터 API를 서버리스 함수와 연결해야 합니다.

## GitHub에서 켜는 법

1. 이 폴더를 GitHub repository로 올립니다.
2. GitHub repository의 `Settings > Pages`에서 source를 `GitHub Actions`로 설정합니다.
3. `Actions` 탭에서 `Deploy GitHub Pages`를 수동 실행하거나 `main` 브랜치에 push합니다.
4. `Update market data` workflow는 평일 하루 두 번, 00:17 UTC와 12:17 UTC에 실행되고, 데이터가 바뀐 경우에만 `data/snapshot.js`를 commit한 뒤 같은 workflow 안에서 Pages를 다시 배포합니다. 한국시간으로는 평일 09:17, 21:17입니다.
5. `Deploy GitHub Pages` workflow는 사람이 직접 `main`에 push했을 때 정적 파일만 다시 배포하는 용도입니다.

## 다음 단계

- BOK ECOS, 관세청 수출입, KRX 외국인 수급 데이터를 추가합니다.
- 더 촘촘한 업데이트가 필요하면 GitHub Actions보다 Cloudflare Workers Cron, Vercel Cron, Supabase Edge Function, AWS Lambda/EventBridge 같은 서버리스 스케줄러가 낫습니다.
- 초단위/분단위 환율은 데이터 라이선스와 비용 문제가 있으므로, 어떤 API를 쓸지 먼저 정해야 합니다.
