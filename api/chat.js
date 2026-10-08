import { chatPayload, clientIp, readJsonBody } from "../lib/api.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
  let body = {};
  try {
    body = readJsonBody(req.body);
  } catch {
    res.status(400).json({ error: "JSON inválido." });
    return;
  }
  const result = await chatPayload(body, clientIp(req.headers || {}));
  res.status(result.status).json(result.body);
}
