import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "conversas.jsonl");
const PARADAS = new Set(["de", "da", "do", "das", "dos", "em", "no", "na", "para", "pra", "com", "que", "por", "uma", "uns", "umas"]);

function fold(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function tokens(value) {
  return new Set(fold(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !PARADAS.has(word)));
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function lerArquivo() {
  try {
    const text = await readFile(FILE, "utf8");
    return text.split("\n").map((line) => line.trim()).filter(Boolean).slice(-200).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function gravarArquivo(row) {
  await mkdir(dirname(FILE), { recursive: true });
  await appendFile(FILE, `${JSON.stringify(row)}\n`, "utf8");
}

async function lerRemoto(config) {
  const response = await fetch(`${config.url}/rest/v1/conversas?select=pergunta,resposta,onde,lugares&order=criado_em.desc&limit=80`, {
    headers: headers(config.key),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function gravarRemoto(config, row) {
  const response = await fetch(`${config.url}/rest/v1/conversas`, {
    method: "POST",
    headers: headers(config.key, { Prefer: "return=minimal" }),
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 180));
  }
}

export async function lembrar(pergunta) {
  const config = supabaseConfig();
  const rows = config ? await lerRemoto(config).catch(() => []) : await lerArquivo();
  const wanted = tokens(pergunta);
  if (!wanted.size) return [];
  return rows
    .map((row) => ({ row, score: [...tokens(row.pergunta)].filter((word) => wanted.has(word)).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.row);
}

export async function registrar({ pergunta, resposta, onde, lugares }) {
  const row = {
    pergunta: String(pergunta || "").slice(0, 500),
    resposta: String(resposta || "").slice(0, 800),
    onde: Array.isArray(onde) ? onde.slice(0, 6).join(", ") : "",
    lugares: Array.isArray(lugares) ? lugares.slice(0, 8).join(", ") : "",
  };
  if (!row.pergunta || !row.resposta) return;
  const config = supabaseConfig();
  if (config) {
    await gravarRemoto(config, row);
    return;
  }
  await gravarArquivo(row);
}

export function textoExemplos(exemplos) {
  if (!Array.isArray(exemplos) || !exemplos.length) return "";
  const linhas = exemplos.map((item) => {
    const onde = item.onde ? ` Onde procurou: ${item.onde}.` : "";
    const lugares = item.lugares ? ` Lugares daquela vez: ${item.lugares}.` : "";
    return `- Pessoa: ${item.pergunta}\n  Resposta: ${item.resposta}.${onde}${lugares}`;
  });
  return `Conversas já registradas, só como exemplo de onde procurar. Não copie telefone, endereço nem horário daqui:\n${linhas.join("\n")}`;
}
