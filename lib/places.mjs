import { evaluateOpeningHours, openFromClockRanges } from "./hours.mjs";
import { clampRadius, geocodeCity, haversineMeters, validPoint } from "./geo.mjs";

const USER_AGENT = "perto/0.1 (busca local; contato: uso-local)";

const CATEGORIES = [
  { test: /borrach|pneu/, tags: [["shop", "tyres"]] },
  { test: /oficina|mec[aâ]nic|autope[cç]|funilar/, tags: [["shop", "car_repair"]] },
  { test: /farm[aá]c/, tags: [["amenity", "pharmacy"]] },
  { test: /sorvet/, tags: [["amenity", "ice_cream"], ["shop", "ice_cream"]] },
  { test: /posto|gasolina|combust/, tags: [["amenity", "fuel"]] },
  { test: /mercado|supermerc|conveni[eê]n/, tags: [["shop", "supermarket"], ["shop", "convenience"]] },
  { test: /padaria/, tags: [["shop", "bakery"]] },
  { test: /hospital|pronto[\s-]?socorro|\bupa\b/, tags: [["amenity", "hospital"], ["amenity", "clinic"]] },
  { test: /restaurante|lanch|pizza|hamb[uú]r/, tags: [["amenity", "restaurant"], ["amenity", "fast_food"]] },
  { test: /hotel|pousada/, tags: [["tourism", "hotel"], ["tourism", "guest_house"]] },
  { test: /veterin/, tags: [["amenity", "veterinary"]] },
  { test: /chaveiro/, tags: [["shop", "locksmith"], ["craft", "locksmith"]] },
  { test: /pet\s?shop|ra[cç][aã]o/, tags: [["shop", "pet"]] },
];

function missing(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function cardBase(partial) {
  return {
    id: partial.id,
    kind: partial.kind || "place",
    name: partial.name,
    address: missing(partial.address),
    phone: missing(partial.phone),
    openNow: partial.openNow === true ? true : partial.openNow === false ? false : null,
    hours: missing(partial.hours),
    hoursWeek: Array.isArray(partial.hoursWeek) ? partial.hoursWeek.filter(Boolean) : [],
    distanceMeters: Number.isFinite(partial.distanceMeters) ? partial.distanceMeters : null,
    lat: Number.isFinite(partial.lat) ? partial.lat : null,
    lon: Number.isFinite(partial.lon) ? partial.lon : null,
    url: missing(partial.url),
    snippet: missing(partial.snippet),
    sourceName: partial.sourceName,
    sourceUrl: missing(partial.sourceUrl),
    retrievedAt: new Date().toISOString(),
  };
}

function withDistance(card, origin) {
  if (!origin || !validPoint(card.lat, card.lon)) return card;
  return { ...card, distanceMeters: haversineMeters(origin, { lat: card.lat, lon: card.lon }) };
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    if (a.distanceMeters == null) return 1;
    if (b.distanceMeters == null) return -1;
    return a.distanceMeters - b.distanceMeters;
  });
}

async function resolveOrigin({ cidade, location, radius }) {
  const raio = clampRadius(radius);
  if (cidade && cidade.trim()) {
    const point = await geocodeCity(cidade);
    if (!point) {
      return { error: `Não achei a cidade "${cidade.trim()}" no mapa.` };
    }
    return { origin: point, label: point.label, raio };
  }
  if (location && validPoint(location.lat, location.lon)) {
    return {
      origin: { lat: location.lat, lon: location.lon },
      label: location.label || "sua localização",
      raio,
    };
  }
  return { error: "Sem localização. Peça a cidade ou para ativar o GPS." };
}

function categoryTags(consulta) {
  const text = consulta.toLowerCase();
  const found = CATEGORIES.find((category) => category.test.test(text));
  return found ? found.tags : null;
}

function osmNamePattern(consulta) {
  const cleaned = consulta.replace(/["\\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned.replace(/[.*+?^${}()|[\]\\]/g, "");
}

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function overpass(query) {
  let lastError = new Error("O mapa aberto não respondeu.");
  for (const endpoint of OVERPASS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(28000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`OpenStreetMap respondeu ${response.status}`);
        continue;
      }
      if (!response.ok) throw new Error(`OpenStreetMap respondeu ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function searchOsm({ consulta, origin, raio, abertoAgora }) {
  const tags = categoryTags(consulta);
  const clauses = [];
  if (tags) {
    for (const [key, value] of tags) {
      clauses.push(`nwr["${key}"="${value}"](around:${raio},${origin.lat},${origin.lon});`);
    }
  } else {
    const name = osmNamePattern(consulta);
    if (name.length < 3) return { cards: [], note: "Consulta curta demais para o mapa aberto." };
    clauses.push(`nwr["name"~"${name}",i](around:${raio},${origin.lat},${origin.lon});`);
  }
  const query = `[out:json][timeout:25];(${clauses.join("")});out tags center 25;`;
  const payload = await overpass(query);
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const cards = [];
  let semHorario = 0;
  for (const element of elements) {
    const tagsOf = element.tags || {};
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!validPoint(lat, lon)) continue;
    const name = tagsOf.name || tagsOf.brand || "Lugar sem nome";
    const hours = tagsOf.opening_hours || null;
    const openNow = evaluateOpeningHours(hours);
    if (!hours) semHorario += 1;
    if (abertoAgora && openNow === false) continue;
    const street = [tagsOf["addr:street"], tagsOf["addr:housenumber"]].filter(Boolean).join(", ");
    const city = tagsOf["addr:city"] || "";
    cards.push(withDistance(cardBase({
      id: `osm-${element.type}-${element.id}`,
      name,
      address: [street, city].filter(Boolean).join(" — ") || null,
      phone: tagsOf.phone || tagsOf["contact:phone"] || tagsOf["contact:mobile"] || null,
      openNow,
      hours,
      lat,
      lon,
      url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
      sourceName: "OpenStreetMap",
      sourceUrl: "https://www.openstreetmap.org/copyright",
    }), origin));
  }
  const unique = dedupe(sortCards(cards)).slice(0, 8);
  const note = semHorario && abertoAgora
    ? "O OpenStreetMap não tem horário para parte desses lugares. O card não afirma que estão abertos."
    : null;
  return { cards: unique, note, source: "OpenStreetMap" };
}

async function searchGoogle({ consulta, origin, raio, abertoAgora }) {
  const body = {
    textQuery: consulta,
    languageCode: "pt-BR",
    regionCode: "BR",
    pageSize: 8,
    locationBias: {
      circle: {
        center: { latitude: origin.lat, longitude: origin.lon },
        radius: raio,
      },
    },
  };
  if (abertoAgora) body.openNow = true;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.currentOpeningHours",
        "places.googleMapsUri",
        "places.location",
      ].join(","),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Places respondeu ${response.status}: ${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const places = Array.isArray(payload.places) ? payload.places : [];
  const cards = places.map((place) => {
    const lat = place.location?.latitude;
    const lon = place.location?.longitude;
    const hours = place.currentOpeningHours;
    const openNow = typeof hours?.openNow === "boolean" ? hours.openNow : (abertoAgora ? true : null);
    return withDistance(cardBase({
      id: `google-${place.id}`,
      name: place.displayName?.text || "Lugar sem nome",
      address: place.formattedAddress || null,
      phone: place.nationalPhoneNumber || null,
      openNow,
      hours: Array.isArray(hours?.weekdayDescriptions) ? hours.weekdayDescriptions[0] : null,
      hoursWeek: hours?.weekdayDescriptions || [],
      lat,
      lon,
      url: place.googleMapsUri || null,
      sourceName: "Google Places",
      sourceUrl: place.googleMapsUri || "https://maps.google.com",
    }), origin);
  }).filter((place) => !(abertoAgora && place.openNow === false));
  return { cards: dedupe(sortCards(cards)).slice(0, 8), source: "Google Places" };
}

async function searchBravePlaces({ consulta, origin, raio, abertoAgora }) {
  const url = new URL("https://api.search.brave.com/res/v1/local/place_search");
  url.searchParams.set("q", consulta);
  url.searchParams.set("latitude", String(origin.lat));
  url.searchParams.set("longitude", String(origin.lon));
  url.searchParams.set("radius", String(raio));
  url.searchParams.set("count", "8");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brave Place Search respondeu ${response.status}: ${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  let semHorario = 0;
  const cards = [];
  for (const place of results) {
    if (place.type && place.type !== "location_result") continue;
    const [lat, lon] = Array.isArray(place.coordinates) ? place.coordinates : [];
    const today = place.opening_hours?.current_day || [];
    const openNow = openFromClockRanges(today, place.timezone || "America/Sao_Paulo");
    if (openNow === null) semHorario += 1;
    if (abertoAgora && openNow === false) continue;
    const hours = today
      .map((slot) => [slot.opens, slot.closes].filter(Boolean).join("–"))
      .filter(Boolean)
      .join(", ");
    cards.push(withDistance(cardBase({
      id: `brave-${place.id || place.title}`,
      name: place.title || "Lugar sem nome",
      address: place.postal_address?.displayAddress || null,
      phone: place.contact?.telephone || null,
      openNow,
      hours: hours || null,
      lat,
      lon,
      url: place.url || place.provider_url || null,
      sourceName: "Brave Place Search",
      sourceUrl: place.provider_url || place.url || "https://search.brave.com",
    }), origin));
  }
  return {
    cards: dedupe(sortCards(cards)).slice(0, 8),
    source: "Brave Place Search",
    note: semHorario && abertoAgora
      ? "A Brave não informou horário de alguns lugares. O card não afirma que estão abertos."
      : null,
  };
}

async function searchBraveWeb({ consulta, label }) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", `${consulta} ${label}`.trim());
  url.searchParams.set("count", "6");
  url.searchParams.set("country", "BR");
  url.searchParams.set("search_lang", "pt-br");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brave Search respondeu ${response.status}: ${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const results = payload.web?.results || [];
  const cards = results.slice(0, 6).map((result, index) => cardBase({
    id: `web-${index}-${result.url}`,
    kind: "link",
    name: result.title || result.url,
    snippet: result.description || null,
    url: result.url,
    sourceName: "Brave Search",
    sourceUrl: result.url,
  }));
  return {
    cards,
    source: "Brave Search",
    note: "Links de páginas públicas. Estoque, entrega e horário ficam no site ou no aplicativo.",
  };
}

function dedupe(cards) {
  const seen = new Set();
  const unique = [];
  for (const card of cards) {
    const key = `${card.name}|${card.address || ""}|${card.url || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique;
}

export async function buscarLocais({ consulta, abertoAgora, raio, cidade, location }) {
  const where = await resolveOrigin({ cidade, location, radius: raio });
  if (where.error) return { cards: [], sources: [], note: where.error };
  const args = { consulta, origin: where.origin, raio: where.raio, abertoAgora: Boolean(abertoAgora) };
  const notes = [];
  if (process.env.GOOGLE_PLACES_API_KEY) {
    try {
      const google = await searchGoogle(args);
      if (google.cards.length) return { ...google, sources: [google.source], label: where.label };
      notes.push("Google Places não devolveu lugares para essa consulta.");
    } catch (error) {
      notes.push(error.message);
    }
  }
  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const brave = await searchBravePlaces(args);
      if (brave.cards.length) {
        return { ...brave, sources: [brave.source], note: [notes.join(" "), brave.note].filter(Boolean).join(" "), label: where.label };
      }
      notes.push("Brave Place Search não devolveu lugares para essa consulta.");
    } catch (error) {
      notes.push(error.message);
    }
  }
  const osm = await searchOsm(args);
  return {
    ...osm,
    sources: [osm.source],
    note: [notes.join(" "), osm.note].filter(Boolean).join(" ") || null,
    label: where.label,
  };
}

export async function buscarEntrega({ consulta, cidade, location }) {
  const where = await resolveOrigin({ cidade, location, radius: 8000 });
  const label = where.label || cidade || "";
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    const locais = where.error
      ? { cards: [], note: where.error, sources: [] }
      : await searchOsm({ consulta, origin: where.origin, raio: where.raio, abertoAgora: false });
    return {
      cards: locais.cards || [],
      sources: locais.source ? [locais.source] : [],
      note: "Busca em iFood, 99 e páginas de entrega precisa da Brave Search. Abaixo só o que o mapa aberto tiver, sem confirmar entrega.",
      label,
    };
  }
  const web = await searchBraveWeb({ consulta, label });
  return { ...web, sources: [web.source], label };
}

export function fontesAtivas() {
  return {
    cohere: Boolean(process.env.COHERE_API_KEY),
    google: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    osm: true,
  };
}
