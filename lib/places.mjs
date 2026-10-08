import { evaluateOpeningHours, openFromClockRanges } from "./hours.mjs";
import { clampRadius, geocodeCity, haversineMeters, reverseAddress, validPoint } from "./geo.mjs";

const USER_AGENT = "perto/0.1 (busca local; contato: uso-local)";

const NEAREST = 5;

const CATEGORIES = [
  { test: /encanador|hidr[aá]ulic|vazamento/, tags: [["craft", "plumber"]] },
  { test: /eletricist/, tags: [["craft", "electrician"]] },
  { test: /pedreiro|alvenaria|gesseiro|azulejist/, tags: [["craft", "bricklayer"], ["craft", "stonemason"], ["craft", "plasterer"]] },
  { test: /pintor|pintura predial/, tags: [["craft", "painter"]] },
  { test: /marceneir|carpinteir/, tags: [["craft", "carpenter"]] },
  { test: /serralheir|vidraceir/, tags: [["craft", "metal_construction"], ["craft", "glaziery"]] },
  { test: /jardineir|paisagis/, tags: [["craft", "gardener"]] },
  { test: /diarista|faxina|dom[eé]stic|limp(eza|adora)/, tags: [["craft", "cleaner"]] },
  { test: /baba\b|bab[aá]|cuidador|cuidadora/, tags: [["office", "nursing_service"]] },
  { test: /aula|professor|professora|refor[cç]o|particular|idioma|ingl[eê]s|viol[aã]o|piano/, tags: [["amenity", "language_school"], ["amenity", "music_school"], ["amenity", "prep_school"], ["amenity", "driving_school"]] },
  { test: /dentista/, tags: [["amenity", "dentist"]] },
  { test: /m[eé]dic/, tags: [["amenity", "doctors"], ["amenity", "clinic"]] },
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
    instagram: missing(partial.instagram),
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

async function resolveOrigin({ cidade, location, radius, semLimite }) {
  const raio = semLimite ? null : clampRadius(radius);
  if (cidade && cidade.trim()) {
    const point = await geocodeCity(cidade);
    if (!point) {
      return { error: `Não achei a cidade "${cidade.trim()}" no mapa.` };
    }
    return {
      origin: point,
      label: point.label,
      city: point.city || cidade.trim(),
      state: point.state || "",
      raio,
    };
  }
  if (location && validPoint(location.lat, location.lon)) {
    let city = "";
    let state = "";
    let label = location.label || "sua localização";
    try {
      const area = await reverseAddress(location.lat, location.lon);
      city = area.city;
      state = area.state;
      if (!location.label) label = area.label;
    } catch {
      city = "";
      state = "";
    }
    return {
      origin: { lat: location.lat, lon: location.lon },
      label,
      city,
      state,
      raio,
    };
  }
  return { error: "Sem localização. Peça a cidade ou para ativar o GPS." };
}

const ESTADOS = [
  "mato grosso do sul",
  "rio grande do norte",
  "rio grande do sul",
  "distrito federal",
  "espirito santo",
  "minas gerais",
  "rio de janeiro",
  "santa catarina",
  "sao paulo",
  "mato grosso",
  "pernambuco",
  "alagoas",
  "amazonas",
  "maranhao",
  "paraiba",
  "rondonia",
  "roraima",
  "sergipe",
  "tocantins",
  "goias",
  "bahia",
  "ceara",
  "parana",
  "piaui",
  "acre",
  "amapa",
];

function estadosCitados(text) {
  let rest = fold(text);
  const found = [];
  for (const name of ESTADOS) {
    const pattern = new RegExp(`\\b${name}\\b`, "g");
    if (pattern.test(rest)) {
      found.push(name);
      rest = rest.replace(pattern, " ");
    }
  }
  return found;
}

function estadoLocal(name, state) {
  const local = fold(state);
  if (!local || !name) return false;
  if (local === name) return true;
  const par = [
    ["mato grosso", "mato grosso do sul"],
    ["rio grande do sul", "rio grande do norte"],
  ];
  if (par.some(([a, b]) => (local === a && name === b) || (local === b && name === a))) return false;
  return local.includes(name) || name.includes(local);
}

function paginaNaRegiao(card, where) {
  const text = `${card.name || ""} ${card.snippet || ""}`;
  const outros = estadosCitados(text).filter((name) => !estadoLocal(name, where.state));
  if (outros.length) return false;
  const locais = [where.city, where.state, where.label]
    .map((item) => fold(item))
    .filter((item) => item.length >= 4);
  if (!locais.length) return false;
  return locais.some((item) => fold(text).includes(item));
}

function lugarNoRaio(card, where) {
  if (where.raio == null) return true;
  if (card.kind === "link") return paginaNaRegiao(card, where);
  if (!validPoint(card.lat, card.lon) || !where.origin) return false;
  const dist = Number.isFinite(card.distanceMeters)
    ? card.distanceMeters
    : haversineMeters(where.origin, { lat: card.lat, lon: card.lon });
  return dist <= where.raio;
}

const STOP_WORDS = new Set([
  "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma",
  "para", "pra", "com", "sem", "que", "por", "ao", "e", "ou", "o", "a", "os", "as",
  "perto", "agora", "aberto", "aberta", "onde", "quero", "queria", "procurar",
  "buscar", "busca", "hoje", "aqui", "mim", "meu", "minha", "algum", "alguma",
]);

function fold(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function hoursToday(descriptions) {
  if (!Array.isArray(descriptions) || !descriptions.length) return null;
  const weekday = fold(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
  }).format(new Date()));
  const line = descriptions.find((item) => fold(item).startsWith(weekday));
  if (!line) return descriptions[0];
  const time = line.replace(/^[^:]+:\s*/, "").trim();
  return time ? `Hoje, ${time}` : line;
}

function searchWords(consulta) {
  const words = fold(consulta)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 4);
}

function categoryTags(consulta) {
  const text = fold(consulta);
  const found = CATEGORIES.find((category) => category.test.test(text));
  return found ? found.tags : [];
}

const BEBIDAS = /vinho|cerveja|bebida|refrigerante|destilad|whisky|vodka|cachaca|gelo|energet|agua mineral|fardo|engradado|licor|espumante|chopp|chope|breja|cigarro|cigar|tabac|isqueiro|palheiro|\bfumo\b|vape/;
const PRATELEIRA = /pao|\bleite\b|salgad|biscoito|bolacha|chocolate|suco|snack|\bdoce\b|bala|chiclete|\bcafe\b|achocolat|iogurte|queijo|presunto|frios|agua|refrigerante|miojo|macarrao|arroz|feijao|\boleo\b|acucar|\bsal\b|bateria|pilha|carregador|carvao|botijao|gas de cozinha/;

function varejoDaConsulta(consulta) {
  if (pessoaServico(consulta)) return null;
  const text = fold(consulta);
  const bebida = BEBIDAS.test(text);
  const comida = PRATELEIRA.test(text) || /alimento|comida|lanche/.test(text);
  if (!bebida && !comida) return null;
  const lugares = ["posto de combustível", "conveniência", "mercado"];
  const tags = [["amenity", "fuel"], ["shop", "convenience"], ["shop", "supermarket"]];
  if (comida) {
    lugares.push("padaria");
    tags.push(["shop", "bakery"]);
  }
  if (bebida) {
    lugares.push("adega", "distribuidora de bebidas");
    tags.push(["shop", "alcohol"], ["shop", "beverages"], ["shop", "tobacco"]);
  }
  return {
    lugares: [...new Set(lugares)],
    tags: [...new Map(tags.map((tag) => [tag.join("="), tag])).values()],
  };
}

function pessoaServico(consulta) {
  return /encanador|eletric|pedreiro|pintor|diarista|faxina|marceneir|carpinteir|jardineir|aula|professor|reforc|gesseiro|azulejist|serralheir|vidraceir|dedetiz|chaveiro|baba|cuidador|personal|yoga|pilates|domest/i.test(fold(consulta));
}

function osmToken(word) {
  return word.replace(/[.*+?^${}()|[\]\\"]/g, "");
}

function instagramFromValue(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text.includes("instagram.com")) {
    try {
      const url = new URL(text.startsWith("http") ? text : `https://${text}`);
      const handle = url.pathname.split("/").filter(Boolean)[0];
      if (!handle || ["explore", "p", "reel", "reels", "stories", "accounts"].includes(handle)) return null;
      return `https://www.instagram.com/${handle}/`;
    } catch {
      return null;
    }
  }
  const handle = text.replace(/^@/, "");
  if (/^[A-Za-z0-9._]{2,30}$/.test(handle)) return `https://www.instagram.com/${handle}/`;
  return null;
}

function addSource(current, source) {
  const parts = String(current || "").split(" + ").filter(Boolean);
  if (!parts.includes(source)) parts.push(source);
  return parts.join(" + ");
}

function distinctiveTokens(value) {
  const generic = new Set(["borracharia", "farmacia", "posto", "loja", "mercado", "aula", "aulas", "servico", "servicos"]);
  return fold(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !generic.has(word) && !STOP_WORDS.has(word));
}

function samePlace(a, b) {
  const bothPoints = validPoint(a.lat, a.lon) && validPoint(b.lat, b.lon);
  const dist = bothPoints ? haversineMeters(a, b) : null;
  if (dist != null && dist <= 180) return true;
  if (dist != null && dist > 800) return false;
  const left = distinctiveTokens(a.name);
  const right = distinctiveTokens(b.name);
  if (left.length && right.length && left.some((token) => right.includes(token))) return true;
  const na = fold(a.name);
  const nb = fold(b.name);
  return na.length > 8 && nb.length > 8 && (na.includes(nb) || nb.includes(na));
}

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function overpass(query) {
  let lastError = new Error("O mapa aberto não respondeu.");
  const started = Date.now();
  for (const endpoint of OVERPASS) {
    if (Date.now() - started > 16000) break;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(9000),
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
  const tags = [...categoryTags(consulta), ...(varejoDaConsulta(consulta)?.tags || [])];
  const seenTags = new Set();
  const uniqueTags = tags.filter((tag) => {
    const key = tag.join("=");
    if (seenTags.has(key)) return false;
    seenTags.add(key);
    return true;
  });
  const words = searchWords(consulta);
  const pattern = words.map(osmToken).filter((word) => word.length >= 3).join("|");
  const clauses = [];
  for (const [key, value] of uniqueTags) {
    clauses.push(`nwr["${key}"="${value}"](around:${raio},${origin.lat},${origin.lon});`);
  }
  if (pattern) {
    clauses.push(`nwr["name"~"${pattern}",i](around:${raio},${origin.lat},${origin.lon});`);
  }
  if (!clauses.length) return { cards: [], note: "Diz o que você quer achar, com pelo menos uma palavra." };
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
      instagram: instagramFromValue(tagsOf.instagram || tagsOf["contact:instagram"]),
      openNow,
      hours,
      lat,
      lon,
      url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
      sourceName: "OpenStreetMap",
      sourceUrl: "https://www.openstreetmap.org/copyright",
    }), origin));
  }
  const unique = dedupe(sortCards(cards)).slice(0, 25);
  const note = semHorario && abertoAgora
    ? "O OpenStreetMap não tem horário para parte desses lugares. O card não afirma que estão abertos."
    : null;
  return { cards: unique, note, source: "OpenStreetMap" };
}

async function searchGoogle({ consulta, origin, raio, abertoAgora, limitar = true }) {
  const body = {
    textQuery: consulta,
    languageCode: "pt-BR",
    regionCode: "BR",
    pageSize: limitar ? 20 : NEAREST,
  };
  if (limitar) {
    body.rankPreference = "DISTANCE";
    body.locationBias = {
      circle: {
        center: { latitude: origin.lat, longitude: origin.lon },
        radius: Math.min(raio || 20000, 50000),
      },
    };
  } else if (raio) {
    body.locationBias = {
      circle: {
        center: { latitude: origin.lat, longitude: origin.lon },
        radius: raio,
      },
    };
  }
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
        "places.websiteUri",
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
      hours: hoursToday(hours?.weekdayDescriptions),
      hoursWeek: hours?.weekdayDescriptions || [],
      lat,
      lon,
      url: place.googleMapsUri || null,
      instagram: instagramFromValue(place.websiteUri),
      sourceName: "Google Places",
      sourceUrl: place.googleMapsUri || "https://maps.google.com",
    }), origin);
  }).filter((place) => !(abertoAgora && place.openNow === false));
  return { cards: dedupe(sortCards(cards)), source: "Google Places" };
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
    cards: dedupe(sortCards(cards)).slice(0, NEAREST),
    source: "Brave Place Search",
    note: semHorario && abertoAgora
      ? "A Brave não informou horário de alguns lugares. O card não afirma que estão abertos."
      : null,
  };
}

async function searchTavily(query, limit = 5) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      max_results: limit,
      include_answer: false,
      country: "brazil",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Tavily respondeu ${response.status}: ${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  const cards = results.slice(0, limit).map((result, index) => cardBase({
    id: `web-${index}-${result.url}`,
    kind: "link",
    name: result.title || result.url,
    snippet: result.content || null,
    url: result.url,
    sourceName: "Tavily",
    sourceUrl: result.url,
  }));
  return {
    cards,
    source: "Tavily",
    note: "Links de páginas públicas. Estoque, entrega e horário ficam no site ou no aplicativo.",
  };
}

async function searchWeb({ consulta, label, limit = 5 }) {
  const query = `${consulta} ${label || ""}`.trim();
  if (process.env.TAVILY_API_KEY) return searchTavily(query, limit);
  if (process.env.BRAVE_SEARCH_API_KEY) return searchBraveWeb({ consulta: query, label: "" });
  return { cards: [], source: null, note: null };
}

function hasWebSearch() {
  return Boolean(process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
}

function webSourceName() {
  return process.env.TAVILY_API_KEY ? "Tavily" : "Brave Search";
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

function mergePlace(base, extra) {
  const next = { ...base };
  if (extra.phone && !next.phone) next.phone = extra.phone;
  if (extra.address && !next.address) next.address = extra.address;
  if (extra.hours && !next.hours) {
    next.hours = extra.hours;
    next.hoursWeek = extra.hoursWeek;
  }
  if (next.openNow == null && extra.openNow != null) next.openNow = extra.openNow;
  if (extra.instagram && !next.instagram) next.instagram = extra.instagram;
  if (extra.url && String(extra.sourceName).includes("Google Places")) next.url = extra.url;
  next.sourceName = addSource(next.sourceName, extra.sourceName);
  return next;
}

function absorb(pool, card) {
  const index = pool.findIndex((item) => item.kind !== "link" && card.kind !== "link" && samePlace(item, card));
  if (index === -1) {
    pool.push(card);
    return;
  }
  pool[index] = mergePlace(pool[index], card);
}

async function enrichFromGoogle(card) {
  if (!process.env.GOOGLE_PLACES_API_KEY || card.kind === "link") return card;
  if (card.sourceName.includes("Google Places") || !validPoint(card.lat, card.lon)) return card;
  if (fold(card.name) === "lugar sem nome") return card;
  try {
    const google = await searchGoogle({
      consulta: card.name,
      origin: { lat: card.lat, lon: card.lon },
      raio: 600,
      abertoAgora: false,
      limitar: false,
    });
    const match = google.cards.find((candidate) => samePlace(card, candidate));
    return match ? mergePlace(card, match) : card;
  } catch {
    return card;
  }
}

async function findInstagram(name, city) {
  const web = await searchWeb({ consulta: `"${name}" ${city} instagram`, limit: 5 });
  const tokens = distinctiveTokens(name);
  const foldedName = fold(name);
  for (const card of web.cards) {
    const profile = instagramFromValue(card.url);
    if (!profile) continue;
    const hay = fold(`${card.name} ${card.snippet || ""} ${card.url}`);
    if (tokens.length && tokens.some((token) => hay.includes(token))) return profile;
    if (!tokens.length && foldedName.length >= 4 && hay.includes(foldedName)) return profile;
  }
  return null;
}

async function attachInstagram(cards, label) {
  const city = String(label || "").split(",")[0].trim();
  return Promise.all(cards.map(async (card) => {
    if (card.instagram || card.kind === "link") return card;
    try {
      const profile = await findInstagram(card.name, city);
      if (!profile) return card;
      return { ...card, instagram: profile, sourceName: addSource(card.sourceName, webSourceName()) };
    } catch {
      return card;
    }
  }));
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

export async function buscarLocais({ consulta, abertoAgora, raio, cidade, location, semLimite }) {
  const where = await resolveOrigin({ cidade, location, radius: raio, semLimite });
  if (where.error) return { cards: [], sources: [], note: where.error };
  const varejo = varejoDaConsulta(consulta);
  const args = {
    consulta,
    origin: where.origin,
    raio: where.raio ?? 20000,
    abertoAgora: Boolean(abertoAgora),
    limitar: where.raio != null,
  };
  const consultasGoogle = varejo ? varejo.lugares.slice(0, 5) : [consulta];
  const notes = [];
  const pool = [];
  const sources = [];

  if (process.env.GOOGLE_PLACES_API_KEY) {
    try {
      const antes = pool.length;
      const lotes = await Promise.all(consultasGoogle.map(async (item) => {
        try {
          return await searchGoogle({ ...args, consulta: item });
        } catch (error) {
          return { cards: [], message: error.message };
        }
      }));
      for (const lote of lotes) {
        for (const card of lote.cards) {
          if (lugarNoRaio(card, where)) absorb(pool, card);
        }
      }
      if (pool.length > antes) sources.push("Google Places");
      else if (lotes.every((lote) => !lote.cards.length)) {
        notes.push(lotes.find((lote) => lote.message)?.message || "Google Places não devolveu lugares para essa consulta.");
      }
    } catch (error) {
      notes.push(error.message);
    }
  }

  if (pool.length < NEAREST) {
    try {
      const antes = pool.length;
      const osm = await searchOsm(args);
      for (const card of osm.cards) {
        if (lugarNoRaio(card, where)) absorb(pool, card);
      }
      if (pool.length > antes) sources.push("OpenStreetMap");
      if (osm.note) notes.push(osm.note);
    } catch (error) {
      notes.push(error.message);
    }
  }

  if (!pool.length && process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const brave = await searchBravePlaces(args);
      const perto = brave.cards.filter((card) => lugarNoRaio(card, where));
      pool.push(...perto);
      if (perto.length) sources.push("Brave Place Search");
      if (brave.note) notes.push(brave.note);
    } catch (error) {
      notes.push(error.message);
    }
  }

  let cards = sortCards(pool.filter((card) => card.kind !== "link")).slice(0, NEAREST);
  if (process.env.GOOGLE_PLACES_API_KEY) {
    const enriched = [];
    for (const card of cards) enriched.push(await enrichFromGoogle(card));
    cards = enriched;
    if (cards.some((card) => card.sourceName.includes("Google Places"))) sources.push("Google Places");
  }
  if (hasWebSearch()) {
    cards = await attachInstagram(cards, where.label);
    if (pessoaServico(consulta)) {
      try {
        const web = await searchWeb({ consulta: `${consulta} contato`, label: where.label, limit: 3 });
        const links = web.cards.filter((card) => lugarNoRaio(card, where));
        cards = [...cards, ...links];
        if (links.length && web.source) sources.push(web.source);
      } catch (error) {
        notes.push(error.message);
      }
    }
  }
  if (pessoaServico(consulta) && !process.env.GOOGLE_PLACES_API_KEY && !hasWebSearch() && !cards.some((card) => card.phone || card.instagram)) {
    notes.push("Diarista, pedreiro, encanador e aula particular quase não têm telefone no mapa aberto. A ficha com telefone entra com GOOGLE_PLACES_API_KEY. Páginas e Instagram entram com TAVILY_API_KEY.");
  }

  if (!cards.length && where.raio) {
    const km = Math.round(where.raio / 1000);
    notes.push(`Nada em até ${km} km. Outra cidade ou outro estado só entra se você pedir o lugar.`);
  }

  return {
    cards: cards.slice(0, 8),
    sources: [...new Set(sources)],
    note: notes.filter(Boolean).join(" ") || null,
    label: where.label,
    concierge: Boolean(varejo),
    onde: varejo ? varejo.lugares : [],
  };
}

export async function buscarEntrega({ consulta, cidade, location, raio, semLimite }) {
  const where = await resolveOrigin({ cidade, location, radius: raio, semLimite });
  const label = where.label || cidade || "";
  if (where.error) return { cards: [], sources: [], note: where.error, label };
  if (!hasWebSearch()) {
    const locais = await searchOsm({ consulta, origin: where.origin, raio: where.raio || 20000, abertoAgora: false });
    const cards = (locais.cards || []).filter((card) => lugarNoRaio(card, where)).slice(0, NEAREST);
    return {
      cards,
      sources: cards.length && locais.source ? [locais.source] : [],
      note: "Busca em iFood, 99 e páginas de entrega precisa da Tavily. Abaixo só o que o mapa aberto tiver, sem confirmar entrega.",
      label,
    };
  }
  const web = await searchWeb({ consulta, label, limit: 5 });
  const cards = (web.cards || []).filter((card) => lugarNoRaio(card, where));
  const note = cards.length
    ? web.note
    : `Nada de entrega em até ${Math.round((where.raio || 20000) / 1000)} km. Outra cidade só entra se você pedir o lugar.`;
  return { ...web, cards, sources: cards.length && web.source ? [web.source] : [], note, label };
}

export function fontesAtivas() {
  return {
    cohere: Boolean(process.env.COHERE_API_KEY),
    google: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    tavily: Boolean(process.env.TAVILY_API_KEY),
    osm: true,
  };
}
