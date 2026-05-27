const snapshot = window.USDKRW_SNAPSHOT;

const DAY = 24 * 60 * 60 * 1000;

const regimes = {
  dollar: { label: "글로벌 달러 강세", className: "regime-dollar" },
  risk: { label: "위험회피", className: "regime-risk" },
  local: { label: "원화/아시아 약세", className: "regime-local" },
  relief: { label: "원화 완화", className: "regime-relief" },
  neutral: { label: "혼조", className: "regime-neutral" },
};

const ranges = {
  "3m": 92,
  "1y": 366,
  "5y": 365 * 5,
  all: Infinity,
};

const fmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const fmt2 = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toPoints(rows = [], key = "") {
  const zeroMeansMissing = new Set(["DEXKOUS", "DEXCHUS", "DEXJPUS"]);

  return rows
    .map(([date, value]) => ({
      date: new Date(`${date}T00:00:00`),
      label: date,
      value: Number(value),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.value) &&
        (!zeroMeansMissing.has(key) || point.value > 0),
    );
}

const fred = Object.fromEntries(
  Object.entries(snapshot?.fred ?? {}).map(([key, rows]) => [key, toPoints(rows, key)]),
);

const worldBank = Object.fromEntries(
  Object.entries(snapshot?.worldBank ?? {}).map(([key, rows]) => [key, toPoints(rows)]),
);

function latest(series) {
  return series?.[series.length - 1] ?? null;
}

function firstAtOrAfter(series, date) {
  return series.find((point) => point.date >= date) ?? series[0] ?? null;
}

function atOrBefore(series, date) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].date <= date) return series[i];
  }
  return null;
}

function firstIndexAtOrAfterDate(series, date, startIndex = 0) {
  for (let i = startIndex; i < series.length; i += 1) {
    if (series[i].date >= date) return i;
  }
  return -1;
}

function changePct(series, days, anchorDate = latest(series)?.date) {
  const end = atOrBefore(series, anchorDate);
  if (!end) return null;
  const start = atOrBefore(series, new Date(end.date.getTime() - days * DAY));
  if (!start) return null;
  return ((end.value - start.value) / start.value) * 100;
}

function changeAbs(series, days, anchorDate = latest(series)?.date) {
  const end = atOrBefore(series, anchorDate);
  const start = atOrBefore(series, new Date(end.date.getTime() - days * DAY));
  if (!start || !end) return null;
  return end.value - start.value;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * ratio));
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function strengthFrom(value, weak, strong) {
  const magnitude = Math.abs(value ?? 0);
  const t = clamp((magnitude - weak) / (strong - weak), 0, 1);
  return 34 + t * 62;
}

function toneFromStrength(strength) {
  if (strength > 78) return "강함";
  if (strength > 55) return "보통";
  return "약함";
}

function signText(value, unit = "%") {
  if (!Number.isFinite(value)) return "데이터 없음";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${unit === "bp" ? fmt1.format(value) : fmt1.format(value)}${unit}`;
}

function latestWorldBank(key) {
  const series = worldBank[key] ?? [];
  return latest(series);
}

function classifyRegime(date) {
  const dxy = changePct(fred.DTWEXBGS, 60, date);
  const vix = changePct(fred.VIXCLS, 20, date);
  const vixLevel = atOrBefore(fred.VIXCLS, date)?.value;
  const usdk = changePct(fred.DEXKOUS, 60, date);

  if ((vix ?? 0) > 18 || (vixLevel ?? 0) > 26) return "risk";
  if ((dxy ?? 0) > 1.2) return "dollar";
  if ((usdk ?? 0) > 2 && (dxy ?? 0) < 0.8) return "local";
  if ((usdk ?? 0) < -2 && (dxy ?? 0) < 0) return "relief";
  return "neutral";
}

function movingAverage(points, windowSize) {
  const result = [];
  let sum = 0;
  const queue = [];
  for (const point of points) {
    sum += point.value;
    queue.push(point);
    if (queue.length > windowSize) sum -= queue.shift().value;
    if (queue.length === windowSize) {
      result.push({
        date: point.date,
        label: point.label,
        value: sum / windowSize,
      });
    }
  }
  return result;
}

function svgPath(points, x, y) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.date).toFixed(2)},${y(point.value).toFixed(2)}`)
    .join(" ");
}

function renderChart(rangeKey = "3m") {
  const svg = document.querySelector("#fx-chart");
  const allFx = fred.DEXKOUS ?? [];
  if (!svg || !allFx.length) return;

  const latestFx = latest(allFx);
  const days = ranges[rangeKey];
  const startDate =
    days === Infinity
      ? new Date("1995-01-01T00:00:00")
      : new Date(latestFx.date.getTime() - days * DAY);
  const visible = allFx.filter((point) => point.date >= startDate);
  const padded = allFx.filter(
    (point) => point.date >= new Date(startDate.getTime() - 90 * DAY),
  );
  const ma60 = movingAverage(padded, 60).filter((point) => point.date >= startDate);
  const values = visible.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const pad = (maxValue - minValue || 1) * 0.14;
  const yMin = minValue - pad;
  const yMax = maxValue + pad;

  const width = 920;
  const height = 330;
  const margin = { top: 26, right: 52, bottom: 38, left: 62 };
  const xMin = visible[0].date.getTime();
  const xMax = visible[visible.length - 1].date.getTime();
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const x = (date) =>
    margin.left + ((date.getTime() - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
  const y = (value) =>
    margin.top + ((yMax - value) / Math.max(1, yMax - yMin)) * plotHeight;

  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const xTicks = Array.from({ length: 4 }, (_, index) => {
    const time = xMin + ((xMax - xMin) * index) / 3;
    return new Date(time);
  });

  const segmentDays = rangeKey === "3m" ? 14 : rangeKey === "1y" ? 30 : 90;
  const segments = [];
  let cursor = new Date(visible[0].date);
  while (cursor < visible[visible.length - 1].date) {
    const next = new Date(cursor.getTime() + segmentDays * DAY);
    const regime = classifyRegime(cursor);
    segments.push({ start: new Date(cursor), end: next, regime });
    cursor = next;
  }

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfcfb"></rect>
    ${segments
      .map((segment) => {
        const x1 = clamp(x(segment.start), margin.left, margin.left + plotWidth);
        const x2 = clamp(x(segment.end), margin.left, margin.left + plotWidth);
        return `<rect class="${regimes[segment.regime].className}" x="${x1}" y="${margin.top}" width="${Math.max(0, x2 - x1)}" height="${plotHeight}" opacity="0.46"></rect>`;
      })
      .join("")}
    ${yTicks
      .map(
        (tick) => `
          <line class="grid-line" x1="${margin.left}" y1="${y(tick)}" x2="${margin.left + plotWidth}" y2="${y(tick)}"></line>
          <text class="axis-label" x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${fmt.format(tick)}</text>
        `,
      )
      .join("")}
    ${xTicks
      .map(
        (tick) => `
          <text class="axis-label" x="${x(tick)}" y="${height - 12}" text-anchor="middle">${tick.getFullYear()}.${String(tick.getMonth() + 1).padStart(2, "0")}</text>
        `,
      )
      .join("")}
    <path class="ma-line" d="${svgPath(ma60, x, y)}"></path>
    <path class="chart-line" d="${svgPath(visible, x, y)}"></path>
    <circle class="current-dot" cx="${x(latestFx.date)}" cy="${y(latestFx.value)}" r="6"></circle>
    <text class="axis-label" x="${x(latestFx.date) - 8}" y="${y(latestFx.value) - 14}" text-anchor="end">${fmt.format(latestFx.value)}원</text>
    <text class="axis-label" x="${margin.left}" y="18">검은선: USD/KRW · 파란선: 60일 평균</text>
  `;
}

function renderLegend() {
  const legend = document.querySelector("#regime-legend");
  legend.innerHTML = Object.values(regimes)
    .map(
      (item) => `
        <span class="legend-item">
          <i class="legend-swatch ${item.className}"></i>
          ${item.label}
        </span>
      `,
    )
    .join("");
}

function makeForce({ name, value, weak, strong, directionWhenPositive, reason }) {
  if (!Number.isFinite(value)) return null;
  const direction =
    value >= 0
      ? directionWhenPositive
      : directionWhenPositive === "up"
        ? "down"
        : "up";
  const strength = strengthFrom(value, weak, strong);
  return {
    name,
    direction,
    strength,
    tone: toneFromStrength(strength),
    reason,
    raw: value,
  };
}

function buildForces() {
  const dxy60 = changePct(fred.DTWEXBGS, 60);
  const us2y60 = changeAbs(fred.DGS2, 60) * 100;
  const realYield60 = changeAbs(fred.DFII10, 60) * 100;
  const vix20 = changePct(fred.VIXCLS, 20);
  const cnh60 = changePct(fred.DEXCHUS, 60);
  const jpy60 = changePct(fred.DEXJPUS, 60);
  const oil60 = changePct(fred.DCOILBRENTEU, 60);
  const sp50060 = changePct(fred.SP500, 60);
  const usKrSpread = (latest(fred.DGS10)?.value ?? 0) - (latest(fred.IRLTLT01KRM156N)?.value ?? 0);
  const usKrSpread365 =
    ((atOrBefore(fred.DGS10, new Date(latest(fred.DGS10).date.getTime() - 365 * DAY))?.value ?? 0) -
      (atOrBefore(fred.IRLTLT01KRM156N, new Date(latest(fred.DGS10).date.getTime() - 365 * DAY))?.value ?? 0));
  const spreadChange = (usKrSpread - usKrSpread365) * 100;

  const currentAccount = latestWorldBank("currentAccountPctGdp")?.value;
  const gdpGrowth = latestWorldBank("gdpGrowth")?.value;
  const reserveSeries = worldBank.reservesUsd ?? [];
  const reserveLatest = latest(reserveSeries);
  const reservePrev = reserveSeries[reserveSeries.length - 2];
  const reserveChange = reserveLatest && reservePrev ? ((reserveLatest.value - reservePrev.value) / reservePrev.value) * 100 : null;

  const dxyReason =
    dxy60 >= 0
      ? "달러 자체가 강해지면 환율 상승 부담이 커집니다."
      : "달러 자체가 약해지면 환율 하락 여지가 생깁니다.";
  const us2yReason =
    us2y60 >= 0
      ? "단기 금리 상승은 달러 보유 매력을 키웁니다."
      : "단기 금리 하락은 달러 보유 매력을 낮춥니다.";
  const realYieldReason =
    realYield60 >= 0
      ? "실질금리 상승은 달러 강세 쪽으로 작동하기 쉽습니다."
      : "실질금리 하락은 달러 강세 압력을 낮춥니다.";
  const vixReason =
    vix20 >= 0
      ? "불안이 커지면 달러 수요가 늘어나는 경향이 있습니다."
      : "불안이 낮아지면 달러 방어 수요가 줄어들 수 있습니다.";
  const cnhReason =
    cnh60 >= 0
      ? "위안 약세는 원화에도 같이 부담을 주는 경우가 많습니다."
      : "위안 강세나 안정은 원화 부담을 덜어줄 수 있습니다.";
  const jpyReason =
    jpy60 >= 0
      ? "엔 약세가 강하면 아시아 통화 전반의 압력이 커질 수 있습니다."
      : "엔 강세나 안정은 아시아 통화 부담을 덜어줄 수 있습니다.";
  const oilReason =
    oil60 >= 0
      ? "한국은 에너지 수입국이라 유가 상승은 원화 부담입니다."
      : "유가 하락은 한국의 수입 부담을 낮춰 원화에 우호적입니다.";
  const sp500Reason =
    sp50060 >= 0
      ? "위험자산 선호가 강하면 달러 방어 수요가 줄어들 수 있습니다."
      : "위험자산 약세는 달러 방어 수요를 키울 수 있습니다.";
  const spreadReason =
    spreadChange >= 0
      ? "미국 금리 우위가 넓어지면 달러 쪽으로 힘이 실립니다."
      : "미국 금리 우위가 줄어들면 달러 쪽 힘이 약해질 수 있습니다.";
  const currentAccountReason =
    currentAccount >= 2.5
      ? "흑자가 두꺼우면 원화 하단을 받치는 힘이 생깁니다."
      : "경상수지 완충력이 약하면 원화 방어력이 낮아질 수 있습니다.";
  const growthReason =
    gdpGrowth >= 2.1
      ? "성장이 버티면 장기 원화 체력에 도움이 됩니다."
      : "성장률이 낮아질수록 장기 원화 체력은 약해집니다.";
  const reserveReason =
    reserveChange >= 0
      ? "완충력이 안정되면 급격한 원화 약세를 누그러뜨릴 수 있습니다."
      : "외환보유액 감소는 급격한 약세를 막는 완충력을 얇게 만들 수 있습니다.";

  const forces = [
    makeForce({
      name: "달러지수",
      value: dxy60,
      weak: 0.6,
      strong: 3,
      directionWhenPositive: "up",
      reason: `최근 60일 변화 ${signText(dxy60)}. ${dxyReason}`,
    }),
    makeForce({
      name: "미국 2년물 금리",
      value: us2y60,
      weak: 12,
      strong: 65,
      directionWhenPositive: "up",
      reason: `최근 60일 변화 ${signText(us2y60, "bp")}. ${us2yReason}`,
    }),
    makeForce({
      name: "미국 실질금리",
      value: realYield60,
      weak: 10,
      strong: 55,
      directionWhenPositive: "up",
      reason: `10년 TIPS 기준 최근 60일 변화 ${signText(realYield60, "bp")}. ${realYieldReason}`,
    }),
    makeForce({
      name: "위험회피 심리",
      value: vix20,
      weak: 8,
      strong: 45,
      directionWhenPositive: "up",
      reason: `VIX 최근 20일 변화 ${signText(vix20)}. ${vixReason}`,
    }),
    makeForce({
      name: "위안화 방향",
      value: cnh60,
      weak: 0.4,
      strong: 2.2,
      directionWhenPositive: "up",
      reason: `USD/CNY 최근 60일 변화 ${signText(cnh60)}. ${cnhReason}`,
    }),
    makeForce({
      name: "엔화 방향",
      value: jpy60,
      weak: 1,
      strong: 5,
      directionWhenPositive: "up",
      reason: `USD/JPY 최근 60일 변화 ${signText(jpy60)}. ${jpyReason}`,
    }),
    makeForce({
      name: "유가 부담",
      value: oil60,
      weak: 4,
      strong: 18,
      directionWhenPositive: "up",
      reason: `브렌트유 최근 60일 변화 ${signText(oil60)}. ${oilReason}`,
    }),
    makeForce({
      name: "위험자산 선호",
      value: sp50060,
      weak: 2.5,
      strong: 10,
      directionWhenPositive: "down",
      reason: `S&P 500 최근 60일 변화 ${signText(sp50060)}. ${sp500Reason}`,
    }),
    makeForce({
      name: "미-한 장기금리차",
      value: spreadChange,
      weak: 18,
      strong: 85,
      directionWhenPositive: "up",
      reason: `최근 1년 장기금리차 변화 ${signText(spreadChange, "bp")}. ${spreadReason}`,
    }),
    makeForce({
      name: "경상수지 완충력",
      value: currentAccount - 2.5,
      weak: 0.6,
      strong: 3.2,
      directionWhenPositive: "down",
      reason: `World Bank 최신 연간 경상수지 ${fmt1.format(currentAccount)}% of GDP. ${currentAccountReason}`,
    }),
    makeForce({
      name: "성장 체력",
      value: gdpGrowth - 2.1,
      weak: 0.35,
      strong: 1.4,
      directionWhenPositive: "down",
      reason: `World Bank 최신 연간 성장률 ${fmt1.format(gdpGrowth)}%. ${growthReason}`,
    }),
    makeForce({
      name: "외환보유 완충력",
      value: reserveChange,
      weak: 1.5,
      strong: 8,
      directionWhenPositive: "down",
      reason: `World Bank 외환보유액 최근 연간 변화 ${signText(reserveChange)}. ${reserveReason}`,
    }),
  ].filter(Boolean);

  return forces;
}

function renderForces(forces) {
  const up = forces
    .filter((force) => force.direction === "up")
    .sort((a, b) => b.strength - a.strength);
  const down = forces
    .filter((force) => force.direction === "down")
    .sort((a, b) => b.strength - a.strength);

  const render = (force) => `
    <article class="force">
      <div class="force-head">
        <span class="force-name">${force.name}</span>
        <span class="force-tone">${force.tone}</span>
      </div>
      <div class="force-track"><span class="force-fill" style="--strength: ${force.strength.toFixed(0)}%"></span></div>
      <p>${force.reason}</p>
    </article>
  `;

  document.querySelector("#up-forces").innerHTML = up.map(render).join("");
  document.querySelector("#down-forces").innerHTML = down.map(render).join("");
  document.querySelector("#up-tone").textContent = overallTone(up);
  document.querySelector("#down-tone").textContent = overallTone(down);

  return { up, down };
}

function overallTone(list) {
  const head = list[0]?.strength ?? 0;
  if (head > 80) return "두꺼움";
  if (head > 58) return "뚜렷함";
  return "얇음";
}

function biasLabel(up, down) {
  const upEnergy = up.reduce((sum, force) => sum + force.strength, 0);
  const downEnergy = down.reduce((sum, force) => sum + force.strength, 0);
  if (upEnergy > downEnergy * 1.18) return "상방 우세";
  if (downEnergy > upEnergy * 1.18) return "하방 우세";
  return "방향 충돌";
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = average(clean);
  const variance =
    clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

function forceEnergy(list) {
  return list.reduce((sum, force) => sum + force.strength, 0);
}

function forecastAreaPath(points, x, y) {
  const upper = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.date).toFixed(2)},${y(point.upper).toFixed(2)}`)
    .join(" ");
  const lower = points
    .slice()
    .reverse()
    .map((point) => `L${x(point.date).toFixed(2)},${y(point.lower).toFixed(2)}`)
    .join(" ");
  return `${upper} ${lower} Z`;
}

function logReturns(points) {
  const returns = [];
  for (let i = 1; i < points.length; i += 1) {
    returns.push(Math.log(points[i].value / points[i - 1].value));
  }
  return returns;
}

function calibrateForecastCone(fx, horizons) {
  const minWindow = 260;
  const fallback = { lowerZ: -1.28, upperZ: 1.28, observations: 0, coverage: 0 };
  const calibration = {};

  for (const horizonDays of horizons) {
    if (horizonDays === 0) {
      calibration[horizonDays] = { lowerZ: 0, upperZ: 0, observations: 0, coverage: 1 };
      continue;
    }

    const errors = [];
    for (let i = minWindow; i < fx.length; i += 1) {
      const actualIndex = firstIndexAtOrAfterDate(
        fx,
        new Date(fx[i].date.getTime() + horizonDays * DAY),
        i + 1,
      );
      if (actualIndex < 0) break;

      const returns = logReturns(fx.slice(i - minWindow, i + 1));
      const dailyVol = clamp(standardDeviation(returns), 0.0015, 0.015);
      const meanAnnual = clamp(average(returns) * 252, -0.08, 0.08);
      const annualDrift = clamp(meanAnnual * 0.25, -0.09, 0.09);
      const tradingDays = (horizonDays / 365) * 252;
      const mid = fx[i].value * Math.exp(annualDrift * (horizonDays / 365));
      const denominator = dailyVol * Math.sqrt(tradingDays);
      if (denominator <= 0) continue;
      errors.push(Math.log(fx[actualIndex].value / mid) / denominator);
    }

    const lowerZ = percentile(errors, 0.1);
    const upperZ = percentile(errors, 0.9);
    if (!Number.isFinite(lowerZ) || !Number.isFinite(upperZ)) {
      calibration[horizonDays] = fallback;
      continue;
    }

    const inside = errors.filter((value) => value >= lowerZ && value <= upperZ).length;
    calibration[horizonDays] = {
      lowerZ,
      upperZ,
      observations: errors.length,
      coverage: errors.length ? inside / errors.length : 0,
    };
  }

  return calibration;
}

function buildForecast(up, down) {
  const fx = fred.DEXKOUS ?? [];
  const currentPoint = latest(fx);
  if (!currentPoint) return null;

  const recent = fx.slice(-260);
  const returns = logReturns(recent);

  const dailyVol = clamp(standardDeviation(returns), 0.0015, 0.015);
  const meanAnnual = clamp(average(returns) * 252, -0.08, 0.08);
  const upEnergy = forceEnergy(up);
  const downEnergy = forceEnergy(down);
  const skew = clamp((upEnergy - downEnergy) / Math.max(1, upEnergy + downEnergy), -1, 1);
  const annualDrift = clamp(meanAnnual * 0.25 + skew * 0.06, -0.09, 0.09);
  const horizons = [0, 30, 60, 90, 120, 150, 180];
  const calibration = calibrateForecastCone(fx, horizons);
  const future = horizons.map((days) => {
    const calendarYears = days / 365;
    const tradingDays = (days / 365) * 252;
    const mid = currentPoint.value * Math.exp(annualDrift * calendarYears);
    const { lowerZ, upperZ } = calibration[days] ?? { lowerZ: -1.28, upperZ: 1.28 };
    const spreadUnit = dailyVol * Math.sqrt(tradingDays);
    return {
      days,
      date: new Date(currentPoint.date.getTime() + days * DAY),
      lower: mid * Math.exp(lowerZ * spreadUnit),
      mid,
      upper: mid * Math.exp(upperZ * spreadUnit),
    };
  });

  return {
    annualDrift,
    annualVol: dailyVol * Math.sqrt(252),
    calibration,
    currentPoint,
    future,
    history: fx.filter((point) => point.date >= new Date(currentPoint.date.getTime() - 365 * DAY)),
    skew,
  };
}

function renderForecast(up, down) {
  const forecast = buildForecast(up, down);
  const svg = document.querySelector("#forecast-chart");
  const readout = document.querySelector("#forecast-readout");
  const note = document.querySelector("#forecast-note");
  if (!forecast || !svg || !readout || !note) return;

  const { annualDrift, annualVol, calibration, currentPoint, future, history, skew } = forecast;
  const width = 920;
  const height = 330;
  const margin = { top: 28, right: 66, bottom: 38, left: 62 };
  const allValues = [
    ...history.map((point) => point.value),
    ...future.flatMap((point) => [point.lower, point.mid, point.upper]),
  ];
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const pad = (maxValue - minValue || 1) * 0.14;
  const yMin = minValue - pad;
  const yMax = maxValue + pad;
  const xMin = history[0].date.getTime();
  const xMax = future[future.length - 1].date.getTime();
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const x = (date) =>
    margin.left + ((date.getTime() - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
  const y = (value) =>
    margin.top + ((yMax - value) / Math.max(1, yMax - yMin)) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const xTicks = [
    history[0].date,
    currentPoint.date,
    future.find((point) => point.days === 90).date,
    future[future.length - 1].date,
  ];
  const futureMid = future.map((point) => ({
    date: point.date,
    label: point.date.toISOString().slice(0, 10),
    value: point.mid,
  }));
  const futureUpper = future.map((point) => ({
    date: point.date,
    label: point.date.toISOString().slice(0, 10),
    value: point.upper,
  }));
  const futureLower = future.map((point) => ({
    date: point.date,
    label: point.date.toISOString().slice(0, 10),
    value: point.lower,
  }));
  const last = future[future.length - 1];

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfcfb"></rect>
    ${yTicks
      .map(
        (tick) => `
          <line class="grid-line" x1="${margin.left}" y1="${y(tick)}" x2="${margin.left + plotWidth}" y2="${y(tick)}"></line>
          <text class="axis-label" x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${fmt.format(tick)}</text>
        `,
      )
      .join("")}
    ${xTicks
      .map(
        (tick) => `
          <text class="axis-label" x="${x(tick)}" y="${height - 12}" text-anchor="middle">${tick.getFullYear()}.${String(tick.getMonth() + 1).padStart(2, "0")}</text>
        `,
      )
      .join("")}
    <path class="forecast-area" d="${forecastAreaPath(future, x, y)}"></path>
    <path class="forecast-upper" d="${svgPath(futureUpper, x, y)}"></path>
    <path class="forecast-lower" d="${svgPath(futureLower, x, y)}"></path>
    <path class="chart-line" d="${svgPath(history, x, y)}"></path>
    <path class="forecast-mid" d="${svgPath(futureMid, x, y)}"></path>
    <line class="forecast-divider" x1="${x(currentPoint.date)}" y1="${margin.top}" x2="${x(currentPoint.date)}" y2="${margin.top + plotHeight}"></line>
    <circle class="current-dot" cx="${x(currentPoint.date)}" cy="${y(currentPoint.value)}" r="6"></circle>
    <text class="axis-label" x="${x(currentPoint.date) - 8}" y="${y(currentPoint.value) - 14}" text-anchor="end">현재 ${fmt.format(currentPoint.value)}원</text>
    <text class="axis-label" x="${x(last.date) - 8}" y="${y(last.upper) + 4}" text-anchor="end">상단 ${fmt.format(last.upper)}원</text>
    <text class="axis-label" x="${x(last.date) - 8}" y="${y(last.lower) + 4}" text-anchor="end">하단 ${fmt.format(last.lower)}원</text>
    <text class="axis-label" x="${margin.left}" y="18">검은선: 최근 1년 · 파란 점선: 기준 경로 · 음영: 예측구간</text>
  `;

  const cards = [30, 90, 180].map((days) => future.find((point) => point.days === days));
  const labels = { 30: "1개월", 90: "3개월", 180: "6개월" };
  readout.innerHTML = cards
    .map(
      (point) => `
        <article class="forecast-card">
          <span>${labels[point.days]}</span>
          <strong>${fmt.format(point.mid)}원</strong>
          <div class="forecast-bounds">
            <div class="forecast-bound"><span>상단</span><b>${fmt.format(point.upper)}원</b></div>
            <div class="forecast-bound"><span>하단</span><b>${fmt.format(point.lower)}원</b></div>
          </div>
        </article>
      `,
    )
    .join("");

  const driftLabel =
    annualDrift > 0.015 ? "상방 기울기" : annualDrift < -0.015 ? "하방 기울기" : "중립 기울기";
  const skewLabel = skew > 0.12 ? "환율 상승 쪽" : skew < -0.12 ? "환율 하락 쪽" : "양쪽 충돌";
  const calibration180 = calibration[180];
  const coverageText = calibration180?.coverage
    ? `${fmt1.format(calibration180.coverage * 100)}%`
    : "약 80%";
  note.textContent =
    `최근 1년 실현 변동성은 연 ${fmt2.format(annualVol * 100)}%이고, 현재 압력은 ${skewLabel}입니다. ` +
    `${driftLabel}를 반영하되, 과거 USD/KRW 롤링 백테스트의 10~90% 오차범위로 보정했습니다. ` +
    `6개월 구간의 과거 포함률은 ${coverageText}였고, 실제 최대·최소는 모릅니다.`;
}

function renderSummary(up, down) {
  const topUp = up[0]?.name ?? "상방 요인";
  const topDown = down[0]?.name ?? "하방 요인";
  const short = biasLabel(
    up.filter((force) =>
      ["달러지수", "미국 2년물 금리", "위험회피 심리", "위안화 방향", "엔화 방향"].includes(force.name),
    ),
    down.filter((force) =>
      ["달러지수", "미국 2년물 금리", "위험회피 심리", "위안화 방향", "엔화 방향", "위험자산 선호"].includes(force.name),
    ),
  );
  const mid = biasLabel(
    up.filter((force) => ["미-한 장기금리차", "유가 부담", "성장 체력"].includes(force.name)),
    down.filter((force) => ["경상수지 완충력", "외환보유 완충력", "성장 체력"].includes(force.name)),
  );
  const longText = longPositionText().short;

  document.querySelector("#short-label").textContent = short;
  document.querySelector("#mid-label").textContent = mid;
  document.querySelector("#long-label").textContent = longText;
  document.querySelector("#summary-copy").textContent =
    `지금은 ${topUp} 쪽 힘이 환율 상방을 만들고, ${topDown} 쪽 힘이 반대편에서 버티는 구조입니다. ` +
    `단기는 시장 심리와 달러 방향을, 장기는 원화의 역사적 위치와 대외수지 완충력을 나눠서 봐야 합니다.`;
}

function longPositionText() {
  const fx = fred.DEXKOUS ?? [];
  const current = latest(fx)?.value;
  const history = fx
    .filter((point) => point.date >= new Date("1995-01-01T00:00:00"))
    .map((point) => point.value);
  const p25 = percentile(history, 0.25);
  const p50 = percentile(history, 0.5);
  const p75 = percentile(history, 0.75);

  if (current >= p75) {
    return {
      short: "원화 약한 편",
      title: "역사적으로 원화가 약한 쪽",
      copy: `현재 USD/KRW는 1995년 이후 분포에서 높은 구간에 있습니다. 이것만으로 반전 시점을 말할 수는 없지만, 장기 신규 약세 추격에는 더 많은 확인이 필요합니다.`,
    };
  }
  if (current >= p50) {
    return {
      short: "약한 쪽",
      title: "장기 평균보다 약한 쪽",
      copy: `현재 환율은 장기 중앙값보다 높은 쪽에 있습니다. 달러 강세가 꺾이는지와 한국 대외수지가 버티는지가 핵심입니다.`,
    };
  }
  if (current <= p25) {
    return {
      short: "원화 강한 편",
      title: "역사적으로 원화가 강한 쪽",
      copy: `현재 USD/KRW는 낮은 구간에 있습니다. 이 위치에서는 달러 반등이나 유가 충격에 더 민감해질 수 있습니다.`,
    };
  }
  return {
    short: "중간권",
    title: "역사적 밴드의 중간권",
    copy: `현재 환율은 장기 분포의 중앙부에 있습니다. 방향 판단은 구조보다 단기 달러와 수급 변화에 더 의존합니다.`,
  };
}

function renderLongLens() {
  const fx = fred.DEXKOUS ?? [];
  const current = latest(fx)?.value;
  const history = fx
    .filter((point) => point.date >= new Date("1995-01-01T00:00:00"))
    .map((point) => point.value);
  const p10 = percentile(history, 0.1);
  const p25 = percentile(history, 0.25);
  const p50 = percentile(history, 0.5);
  const p75 = percentile(history, 0.75);
  const p90 = percentile(history, 0.9);
  const left = clamp(((current - p10) / (p90 - p10)) * 100, 0, 100);
  const text = longPositionText();

  document.querySelector("#valuation-marker").style.setProperty("--marker-left", `${left}%`);
  document.querySelector("#valuation-title").textContent = text.title;
  document.querySelector("#valuation-copy").textContent = text.copy;
  document.querySelector("#band-labels").innerHTML = `
    <span>${fmt.format(p10)}원</span>
    <span>${fmt.format(p50)}원</span>
    <span>${fmt.format(p90)}원</span>
  `;

  const currentAccount = latestWorldBank("currentAccountPctGdp");
  const growth = latestWorldBank("gdpGrowth");
  const reserves = latestWorldBank("reservesUsd");
  const reserveHundredMillionUsd = reserves ? reserves.value / 100_000_000 : null;

  const lanes = [
    {
      name: "평가 위치",
      tone: current >= p75 ? "약세권" : current <= p25 ? "강세권" : "중간권",
      mood: current >= p75 ? "warning" : current <= p25 ? "anchor" : "neutral",
      copy: `현재 ${fmt.format(current)}원. 장기 밴드의 기준점은 25% ${fmt.format(p25)}원, 중앙값 ${fmt.format(p50)}원, 75% ${fmt.format(p75)}원입니다.`,
      spark: fx.slice(-160),
    },
    {
      name: "대외수지",
      tone: currentAccount?.value >= 3 ? "완충" : "확인",
      mood: currentAccount?.value >= 3 ? "anchor" : "neutral",
      copy: `${currentAccount?.label}년 경상수지는 GDP 대비 ${fmt1.format(currentAccount?.value)}%입니다. 흑자 폭은 장기 원화 방어력의 핵심입니다.`,
      spark: worldBank.currentAccountPctGdp,
    },
    {
      name: "성장 체력",
      tone: growth?.value >= 2.5 ? "견조" : "둔화",
      mood: growth?.value >= 2.5 ? "anchor" : "warning",
      copy: `${growth?.label}년 실질 GDP 성장률은 ${fmt1.format(growth?.value)}%입니다. 성장률 둔화는 장기 통화가치에 천천히 작용합니다.`,
      spark: worldBank.gdpGrowth,
    },
    {
      name: "외환 완충력",
      tone: "완충",
      mood: "anchor",
      copy: `${reserves?.label}년 외환보유액은 약 ${fmt.format(reserveHundredMillionUsd)}억 달러입니다. 단기 방어력과 장기 신뢰도에 모두 영향을 줍니다.`,
      spark: worldBank.reservesUsd,
    },
  ];

  document.querySelector("#structure-lanes").innerHTML = lanes
    .map(
      (lane) => `
        <article class="lane ${lane.mood}">
          <div class="lane-head">
            <strong>${lane.name}</strong>
            <span>${lane.tone}</span>
          </div>
          <p>${lane.copy}</p>
          ${sparkline(lane.spark)}
        </article>
      `,
    )
    .join("");
}

function sparkline(points = []) {
  const clean = points.filter((point) => Number.isFinite(point.value)).slice(-30);
  if (clean.length < 2) return "";
  const values = clean.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 260;
  const h = 38;
  const path = clean
    .map((point, index) => {
      const x = (index / (clean.length - 1)) * w;
      const y = h - ((point.value - min) / Math.max(1e-9, max - min)) * (h - 6) - 3;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${path}" fill="none" stroke="#2454a6" stroke-width="2" stroke-linecap="round"></path></svg>`;
}

function renderScenarios() {
  const dxy = changePct(fred.DTWEXBGS, 60);
  const cnh = changePct(fred.DEXCHUS, 60);
  const vix = latest(fred.VIXCLS)?.value;
  const currentAccount = latestWorldBank("currentAccountPctGdp")?.value;

  const scenarios = [
    {
      klass: "up",
      tag: dxy > 1 || cnh > 0.8 ? "가까움" : "대기",
      title: "달러 강세가 이어지는 경우",
      copy: "DXY 상승, 미국 금리 상방, 위안 약세가 같이 나오면 USD/KRW는 상단을 다시 시험할 가능성이 커집니다.",
    },
    {
      klass: "down",
      tag: currentAccount > 3 ? "유효" : "확인",
      title: "수출과 경상수지가 버티는 경우",
      copy: "반도체 수출과 경상흑자가 두꺼워지고 외국인 자금이 들어오면 달러 강세 압력을 흡수할 수 있습니다.",
    },
    {
      klass: "watch",
      tag: vix > 22 ? "활성" : "잠복",
      title: "위험회피가 튀는 경우",
      copy: "VIX 급등, 주식 약세, 유가 충격이 동시에 오면 원화는 펀더멘털보다 시장 심리에 먼저 반응할 수 있습니다.",
    },
    {
      klass: "neutral",
      tag: "기본",
      title: "서로 힘이 충돌하는 경우",
      copy: "달러는 강하지만 한국 대외수지가 버티는 구간에서는 큰 방향보다 박스권과 이벤트 반응이 더 중요해집니다.",
    },
  ];

  document.querySelector("#scenario-grid").innerHTML = scenarios
    .map(
      (scenario) => `
        <article class="scenario ${scenario.klass}">
          <span class="tag">${scenario.tag}</span>
          <strong>${scenario.title}</strong>
          <p>${scenario.copy}</p>
        </article>
      `,
    )
    .join("");
}

function init() {
  if (!snapshot) {
    document.body.innerHTML =
      '<main><section class="summary-band"><h1>데이터 스냅샷을 찾을 수 없습니다.</h1></section></main>';
    return;
  }

  const generated = new Date(snapshot.generatedAt);
  const latestFx = latest(fred.DEXKOUS);
  document.querySelector(".snapshot span").textContent = latestFx
    ? "연준 H.10 최신 관측"
    : "데이터 생성";
  document.querySelector("#snapshot-date").textContent = latestFx
    ? latestFx.label.replaceAll("-", ".")
    : `${generated.getFullYear()}.${String(generated.getMonth() + 1).padStart(2, "0")}.${String(
        generated.getDate(),
      ).padStart(2, "0")}`;

  renderLegend();
  renderChart("3m");

  const forces = buildForces();
  const { up, down } = renderForces(forces);
  renderSummary(up, down);
  renderForecast(up, down);
  renderLongLens();
  renderScenarios();

  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-range]")
        .forEach((item) => item.classList.toggle("active", item === button));
      renderChart(button.dataset.range);
    });
  });
}

init();
