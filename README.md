# USD/KRW Macro Map

원-달러 환율을 단기, 중기, 장기 렌즈로 보는 정적 대시보드입니다.

이 프로젝트의 목표는 환율을 한 점으로 맞히는 것이 아니라, 환율 상승과 하락을 만드는 힘을 시각화하고, 과거 USD/KRW 데이터로 보정한 예측구간을 보여주는 것입니다.

## Features

- USD/KRW 차트와 국면 배경
- 환율 상승/하락 압력 지도
- 과거 USD/KRW 롤링 백테스트로 보정한 forecast cone
- 장기 원화 위치 밴드
- 네이버 금융 하나은행 고시환율, FRED, World Bank 데이터 스냅샷
- GitHub Actions 기반 하루 두 번 데이터 갱신

## Local usage

```bash
node scripts/fetch-data.mjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/index.html
```

## Deploy

See [docs/deploy.md](docs/deploy.md).

## Notes

This is an analytical prototype, not financial advice. The forecast cone is a calibrated range, not a guarantee of future maximum or minimum exchange rates.
