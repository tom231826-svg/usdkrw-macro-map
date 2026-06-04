import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const fredSeries = [
  {
    id: "DEXKOUS",
    label: "South Korean Won to U.S. Dollar",
    source: "Federal Reserve H.10 via FRED",
  },
  {
    id: "DTWEXBGS",
    label: "Nominal Broad U.S. Dollar Index",
    source: "Federal Reserve via FRED",
  },
  {
    id: "DGS2",
    label: "U.S. 2-Year Treasury Yield",
    source: "U.S. Treasury via FRED",
  },
  {
    id: "DGS10",
    label: "U.S. 10-Year Treasury Yield",
    source: "U.S. Treasury via FRED",
  },
  {
    id: "DFII10",
    label: "U.S. 10-Year Real Yield",
    source: "U.S. Treasury via FRED",
  },
  {
    id: "IRLTLT01KRM156N",
    label: "Korea Long-Term Government Bond Yield",
    source: "OECD via FRED",
  },
  {
    id: "VIXCLS",
    label: "CBOE VIX",
    source: "CBOE via FRED",
  },
  {
    id: "DCOILBRENTEU",
    label: "Brent Crude Oil",
    source: "U.S. EIA via FRED",
  },
  {
    id: "DEXCHUS",
    label: "Chinese Yuan to U.S. Dollar",
    source: "Federal Reserve H.10 via FRED",
  },
  {
    id: "DEXJPUS",
    label: "Japanese Yen to U.S. Dollar",
    source: "Federal Reserve H.10 via FRED",
  },
  {
    id: "SP500",
    label: "S&P 500",
    source: "S&P Dow Jones Indices via FRED",
  },
];

const worldBankIndicators = [
  {
    id: "BN.CAB.XOKA.GD.ZS",
    key: "currentAccountPctGdp",
    label: "Current account balance (% of GDP)",
  },
  {
    id: "NY.GDP.MKTP.KD.ZG",
    key: "gdpGrowth",
    label: "GDP growth (annual %)",
  },
  {
    id: "FI.RES.TOTL.CD",
    key: "reservesUsd",
    label: "Total reserves, including gold (current US$)",
  },
];

const requestHeaders = {
  "User-Agent": "usdkrw-macro-map/0.1 (+local-prototype)",
};

const fetchTimeoutMs = Number(process.env.MARKET_DATA_FETCH_TIMEOUT_MS ?? 10000);
const fetchMaxAttempts = Number(process.env.MARKET_DATA_FETCH_ATTEMPTS ?? 2);
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function describeFetchError(error) {
  if (error?.name === "AbortError") {
    return `timed out after ${fetchTimeoutMs}ms`;
  }
  return error?.message || String(error);
}

async function fetchWithRetry(url, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= fetchMaxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    timeout.unref?.();

    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: controller.signal,
      });

      if (
        response.ok ||
        !retryableStatuses.has(response.status) ||
        attempt === fetchMaxAttempts
      ) {
        return response;
      }

      process.stderr.write(
        `Warning: ${label} returned ${response.status}; retrying (${attempt}/${fetchMaxAttempts})...\n`,
      );
    } catch (error) {
      lastError = error;
      if (attempt === fetchMaxAttempts) {
        throw new Error(`${label} request failed: ${describeFetchError(error)}`);
      }

      process.stderr.write(
        `Warning: ${label} request failed: ${describeFetchError(error)}; retrying (${attempt}/${fetchMaxAttempts})...\n`,
      );
    } finally {
      clearTimeout(timeout);
    }

    await sleep(1000 * attempt);
  }

  throw new Error(`${label} request failed: ${describeFetchError(lastError)}`);
}

function parseKoreaLocalDateTime(text) {
  const match = text.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    date: `${year}-${month}-${day}`,
    observedAt: new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`).toISOString(),
  };
}

function parseFredCsv(csv, id) {
  const lines = csv.trim().split(/\r?\n/);
  const [, valueHeader] = lines[0].split(",");
  if (valueHeader !== id) {
    throw new Error(`Unexpected FRED header for ${id}: ${lines[0]}`);
  }

  const zeroMeansMissing = new Set(["DEXKOUS", "DEXCHUS", "DEXJPUS"]);

  return lines
    .slice(1)
    .map((line) => {
      const [date, rawValue] = line.split(",");
      if (!date || rawValue === "." || rawValue === undefined) return null;
      const value = Number(rawValue);
      if (zeroMeansMissing.has(id) && value <= 0) return null;
      return Number.isFinite(value) ? [date, value] : null;
    })
    .filter(Boolean);
}

async function fetchFredSeries(series) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.id}`;
  const response = await fetchWithRetry(url, `FRED ${series.id}`);
  if (!response.ok) {
    throw new Error(`FRED ${series.id} failed: ${response.status}`);
  }
  const csv = await response.text();
  return parseFredCsv(csv, series.id);
}

async function fetchWorldBankIndicator(indicator) {
  const url = `https://api.worldbank.org/v2/country/KOR/indicator/${indicator.id}?format=json&per_page=90`;
  const response = await fetchWithRetry(url, `World Bank ${indicator.id}`);
  if (!response.ok) {
    throw new Error(`World Bank ${indicator.id} failed: ${response.status}`);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.[1]) ? payload[1] : [];

  return rows
    .filter((row) => row.value !== null && row.value !== undefined)
    .map((row) => [row.date, Number(row.value)])
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => Number(a[0]) - Number(b[0]));
}

async function fetchNaverUsdKrwSpot() {
  const url =
    "https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW";
  const response = await fetchWithRetry(url, "Naver USD/KRW spot");
  if (!response.ok) {
    throw new Error(`Naver USD/KRW spot failed: ${response.status}`);
  }

  const html = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
  const value = Number(
    html
      .match(
        /<option value="([0-9.]+)" label="1"\s+class="selectbox-default"\s+selected="selected">\s*미국 달러 USD/,
      )?.[1]
      ?.replaceAll(",", ""),
  );
  const localTime = html.match(/<span class="date">([^<]+)/)?.[1]?.trim();
  const standard = html.match(/<span class="standard">([^<]+)/)?.[1]?.trim();
  const round = Number(html.match(/<span class="round">고시회차 <em>(\d+)<\/em>회/)?.[1]);
  const parsedDate = localTime ? parseKoreaLocalDateTime(localTime) : null;

  if (!Number.isFinite(value) || !parsedDate) {
    throw new Error("Could not parse Naver USD/KRW spot quote");
  }

  return {
    value,
    date: parsedDate.date,
    observedAt: parsedDate.observedAt,
    localTime,
    source: "Naver Finance",
    sourceDetail: standard || "Hana Bank",
    round: Number.isFinite(round) ? round : null,
    url,
  };
}

async function readExistingSnapshot(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    const match = contents.match(/^window\.USDKRW_SNAPSHOT = (.*);\n?$/s);
    return match ? JSON.parse(match[1]) : null;
  } catch {
    return null;
  }
}

function hasRows(rows) {
  return Array.isArray(rows) && rows.length > 0;
}

function warnUsingCachedData(label, error, detail) {
  process.stderr.write(
    `Warning: ${label} fetch failed (${error.message}). Reusing existing snapshot ${detail}.\n`,
  );
}

function comparableSnapshot(snapshot) {
  return JSON.stringify({
    fred: snapshot.fred,
    market: snapshot.market,
    worldBank: snapshot.worldBank,
    metadata: snapshot.metadata,
  });
}

async function main() {
  const snapshotPath = resolve(root, "data", "snapshot.js");
  const existing = await readExistingSnapshot(snapshotPath);
  const fred = {};
  const metadata = {};

  for (const series of fredSeries) {
    process.stdout.write(`Fetching FRED ${series.id}...\n`);
    try {
      fred[series.id] = await fetchFredSeries(series);
    } catch (error) {
      const cachedRows = existing?.fred?.[series.id];
      if (!hasRows(cachedRows)) {
        throw error;
      }

      warnUsingCachedData(`FRED ${series.id}`, error, `(${cachedRows.length} rows)`);
      fred[series.id] = cachedRows;
    }
    metadata[series.id] = {
      label: series.label,
      source: series.source,
      url: `https://fred.stlouisfed.org/series/${series.id}`,
    };
  }

  const worldBank = {};
  const worldBankMetadata = {};
  for (const indicator of worldBankIndicators) {
    process.stdout.write(`Fetching World Bank ${indicator.id}...\n`);
    try {
      worldBank[indicator.key] = await fetchWorldBankIndicator(indicator);
    } catch (error) {
      const cachedRows = existing?.worldBank?.[indicator.key];
      if (!hasRows(cachedRows)) {
        throw error;
      }

      warnUsingCachedData(`World Bank ${indicator.id}`, error, `(${cachedRows.length} rows)`);
      worldBank[indicator.key] = cachedRows;
    }
    worldBankMetadata[indicator.key] = {
      label: indicator.label,
      source: "World Bank",
      url: `https://data.worldbank.org/indicator/${indicator.id}?locations=KR`,
    };
  }

  process.stdout.write("Fetching Naver USD/KRW spot...\n");
  let usdkrwSpot;
  try {
    usdkrwSpot = await fetchNaverUsdKrwSpot();
  } catch (error) {
    const cachedSpot = existing?.market?.usdkrwSpot;
    if (!Number.isFinite(cachedSpot?.value)) {
      throw error;
    }

    warnUsingCachedData("Naver USD/KRW spot", error, `(${cachedSpot.date})`);
    usdkrwSpot = cachedSpot;
  }
  const market = {
    usdkrwSpot,
  };

  const snapshot = {
    generatedAt: new Date().toISOString(),
    fred,
    market,
    worldBank,
    metadata: {
      fred: metadata,
      market: {
        usdkrwSpot: {
          label: "USD/KRW spot reference rate",
          source: `${market.usdkrwSpot.source} (${market.usdkrwSpot.sourceDetail})`,
          url: market.usdkrwSpot.url,
        },
      },
      worldBank: worldBankMetadata,
      notes: [
        "This prototype uses a current Korean bank reference rate plus market and annual macro data that can be fetched without API keys.",
        "Korean monthly trade, semiconductor exports, foreign investor flows, and BOK ECOS series are reserved as next connectors.",
      ],
    },
  };

  if (existing && comparableSnapshot(existing) === comparableSnapshot(snapshot)) {
    process.stdout.write("No data changes. Keeping existing data/snapshot.js\n");
    return;
  }

  await mkdir(resolve(root, "data"), { recursive: true });
  await writeFile(
    snapshotPath,
    `window.USDKRW_SNAPSHOT = ${JSON.stringify(snapshot)};\n`,
    "utf8",
  );
  process.stdout.write("Wrote data/snapshot.js\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
