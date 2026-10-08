import { ondePayload } from "../lib/api.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);
  const result = await ondePayload(lat, lon);
  res.status(result.status).json(result.body);
}
