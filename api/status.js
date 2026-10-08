import { statusPayload } from "../lib/api.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
  const result = statusPayload();
  res.status(result.status).json(result.body);
}
