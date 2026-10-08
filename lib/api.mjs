import { converse } from "./chat.mjs";
import { reverseLabel, validPoint } from "./geo.mjs";
import { fontesAtivas } from "./places.mjs";

const hits = new Map();

export function clientIp(headers) {
  const forwarded = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return "local";
}

export function limited(ip) {
  const now = Date.now();
  const bucket = hits.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 60_000;
  }
  bucket.count += 1;
  hits.set(ip, bucket);
  return bucket.count > 20;
}

export function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 2000),
      facts: Array.isArray(message.facts) ? message.facts.map((fact) => String(fact).slice(0, 300)).slice(0, 8) : undefined,
    }))
    .filter((message) => message.content.trim());
}

export function sanitizeLocation(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!validPoint(lat, lon)) return null;
  const label = typeof value.label === "string" ? value.label.slice(0, 120) : undefined;
  return { lat, lon, label };
}

export function statusPayload() {
  return { status: 200, body: fontesAtivas() };
}

export async function ondePayload(lat, lon) {
  if (!validPoint(lat, lon)) return { status: 400, body: { error: "Coordenada inválida." } };
  try {
    const label = await reverseLabel(lat, lon);
    return { status: 200, body: { label } };
  } catch (error) {
    return { status: 502, body: { error: error.message } };
  }
}

export async function chatPayload(body, ip) {
  if (limited(ip)) return { status: 429, body: { error: "Muitas buscas seguidas. Espera um minuto." } };
  try {
    const messages = sanitizeMessages(body?.messages);
    if (!messages.length || messages.at(-1).role !== "user") {
      return { status: 400, body: { error: "Manda uma mensagem." } };
    }
    const result = await converse({
      messages,
      location: sanitizeLocation(body?.location),
    });
    return { status: 200, body: result };
  } catch (error) {
    return { status: 502, body: { error: error.message || "Falha ao conversar." } };
  }
}

export function readJsonBody(value) {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  return value;
}
