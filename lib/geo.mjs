const USER_AGENT = "perto/0.1 (busca local; contato: uso-local)";
const cache = new Map();
let lastNominatimAt = 0;

function cacheKey(kind, value) {
  return `${kind}:${value}`;
}

async function nominatimGap() {
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
}

async function nominatim(url) {
  await nominatimGap();
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "pt-BR",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error(`Nominatim respondeu ${response.status}`);
  }
  return response.json();
}

export async function geocodeCity(city) {
  const query = city.trim();
  const key = cacheKey("geo", query.toLowerCase());
  if (cache.has(key)) return cache.get(key);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  const rows = await nominatim(url);
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first) return null;
  const point = {
    lat: Number(first.lat),
    lon: Number(first.lon),
    label: first.display_name?.split(",").slice(0, 2).join(", ") || query,
  };
  cache.set(key, point);
  return point;
}

export async function reverseLabel(lat, lon) {
  const key = cacheKey("rev", `${lat.toFixed(3)},${lon.toFixed(3)}`);
  if (cache.has(key)) return cache.get(key);
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  const row = await nominatim(url);
  const address = row?.address || {};
  const label = address.suburb || address.city || address.town || address.municipality || address.village || row?.display_name || "sua localização";
  cache.set(key, label);
  return label;
}

export function haversineMeters(from, to) {
  const earth = 6371000;
  const p1 = (from.lat * Math.PI) / 180;
  const p2 = (to.lat * Math.PI) / 180;
  const dp = ((to.lat - from.lat) * Math.PI) / 180;
  const dl = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * earth * Math.asin(Math.sqrt(a)));
}

export function clampRadius(value) {
  const radius = Number(value);
  if (!Number.isFinite(radius)) return 8000;
  return Math.min(30000, Math.max(500, Math.round(radius)));
}

export function validPoint(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
