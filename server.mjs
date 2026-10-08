import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chatPayload, clientIp, ondePayload, readJsonBody, statusPayload } from "./lib/api.mjs";
import { fontesAtivas } from "./lib/places.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
};

await loadEnv(join(ROOT, ".env"));

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32_000) {
        reject(new Error("Corpo grande demais."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(readJsonBody(Buffer.concat(chunks)));
      } catch {
        reject(new Error("JSON inválido."));
      }
    });
    request.on("error", reject);
  });
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/status" && request.method === "GET") {
    const result = statusPayload();
    sendJson(response, result.status, result.body);
    return;
  }
  if (url.pathname === "/api/onde" && request.method === "GET") {
    const result = await ondePayload(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon")));
    sendJson(response, result.status, result.body);
    return;
  }
  if (url.pathname === "/api/chat" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const result = await chatPayload(body, clientIp(request.headers));
      sendJson(response, result.status, result.body);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "JSON inválido." });
    }
    return;
  }
  sendJson(response, 404, { error: "Rota não encontrada." });
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(PUBLIC, requested));
  if (!file.startsWith(PUBLIC)) {
    response.writeHead(403);
    response.end("Proibido");
    return;
  }
  try {
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Não encontrado");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("Método não permitido");
    return;
  }
  await serveStatic(response, decodeURIComponent(url.pathname));
});

server.listen(PORT, () => {
  const fontes = fontesAtivas();
  console.log(`Perto em http://localhost:${PORT}`);
  console.log(`Fontes: Cohere ${fontes.cohere ? "sim" : "não"}, Google ${fontes.google ? "sim" : "não"}, Tavily ${fontes.tavily ? "sim" : "não"}, OpenStreetMap sim`);
});

async function loadEnv(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
