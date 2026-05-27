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
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) {
    throw new Error(`FRED ${series.id} failed: ${response.status}`);
  }
  const csv = await response.text();
  return parseFredCsv(csv, series.id);
}

async function fetchWorldBankIndicator(indicator) {
  const url = `https://api.worldbank.org/v2/country/KOR/indicator/${indicator.id}?format=json&per_page=90`;
  const response = await fetch(url, { headers: requestHeaders });
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

async function readExistingSnapshot(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    const match = contents.match(/^window\.USDKRW_SNAPSHOT = (.*);\n?$/s);
    return match ? JSON.parse(match[1]) : null;
  } catch {
    return null;
  }
}

function comparableSnapshot(snapshot) {
  return JSON.stringify({
    fred: snapshot.fred,
    worldBank: snapshot.worldBank,
    metadata: snapshot.metadata,
  });
}

async function main() {
  const fred = {};
  const metadata = {};

  for (const series of fredSeries) {
    process.stdout.write(`Fetching FRED ${series.id}...\n`);
    fred[series.id] = await fetchFredSeries(series);
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
    worldBank[indicator.key] = await fetchWorldBankIndicator(indicator);
    worldBankMetadata[indicator.key] = {
      label: indicator.label,
      source: "World Bank",
      url: `https://data.worldbank.org/indicator/${indicator.id}?locations=KR`,
    };
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    fred,
    worldBank,
    metadata: {
      fred: metadata,
      worldBank: worldBankMetadata,
      notes: [
        "This prototype uses market and annual macro data that can be fetched without API keys.",
        "Korean monthly trade, semiconductor exports, foreign investor flows, and BOK ECOS series are reserved as next connectors.",
      ],
    },
  };

  const snapshotPath = resolve(root, "data", "snapshot.js");
  const existing = await readExistingSnapshot(snapshotPath);
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
