import { buscarEntrega, buscarLocais } from "./places.mjs";

const MODEL = process.env.COHERE_MODEL || "command-a-03-2025";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_locais",
      description: "Busca qualquer coisa perto da pessoa: comércio, serviço ou profissional. Exemplos: borracharia, encanador, pedreiro, diarista, aula particular, farmácia. Devolve só o que a fonte trouxe.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: "O que a pessoa quer, nas palavras dela. Exemplo: encanador, diarista, aula de inglês, borracharia, pedreiro.",
          },
          aberto_agora: {
            type: "boolean",
            description: "Verdadeiro se a pessoa quer lugar aberto neste momento, de madrugada ou 24 horas.",
          },
          cidade: {
            type: "string",
            description: "Cidade citada na frase. Omitir para usar o GPS. Não invente outra cidade.",
          },
        },
        required: ["consulta", "aberto_agora"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_entrega",
      description: "Busca páginas públicas de entrega e aplicativos, como iFood e 99. Não confirma estoque nem se está aberto.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: "O que a pessoa quer pedir. Exemplo: sorvete de madrugada.",
          },
          cidade: {
            type: "string",
            description: "Cidade citada na frase. Omitir para usar o GPS.",
          },
        },
        required: ["consulta"],
      },
    },
  },
];

function systemPrompt(location) {
  const gps = location
    ? `Localização do aparelho: latitude ${location.lat}, longitude ${location.lon}${location.label ? `, perto de ${location.label}` : ""}.`
    : "Localização do aparelho: não compartilhada.";
  return `Você é o Perto. Ajuda a achar comércio e serviço por perto, em português do Brasil.
${gps}
Regras:
- Telefone, endereço, horário e se está aberto só existem se um documento de ferramenta trouxer o dado.
- Quando o documento disser "não informado", diga isso. Não complete com memória, palpite ou conhecimento anterior.
- Qualquer pedido de coisa, serviço ou profissional chama buscar_locais. Vale encanador, diarista, pedreiro, aula particular, borracharia ou o que mais a pessoa escrever. A consulta leva as palavras dela, sem trocar por uma lista fixa.
- Se a pessoa quer entrega, iFood, 99, Rappi ou aplicativo, chame buscar_entrega.
- Só passe o parâmetro cidade se o nome estiver escrito na frase da pessoa. Não chute cidade.
- A busca fica em até 20 km do GPS, ou da cidade escrita. Não peça resultado de outro estado.
- Sem cidade na frase e sem GPS, não invente lugar: peça a cidade ou a localização.
- Quando a ferramenta achar lugares, responda com uma frase só, sem lista, sem endereço, sem telefone e sem horário. Os cards mostram isso.
- Se não houver resultado, diga que a fonte não encontrou.`;
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function assistantTurn(message) {
  const turn = { role: "assistant" };
  if (message.content) turn.content = message.content;
  if (message.tool_plan) turn.tool_plan = message.tool_plan;
  if (message.tool_calls) turn.tool_calls = message.tool_calls;
  return turn;
}

function looksLikeSearch(text) {
  const value = text.trim().toLowerCase();
  if (/^(oi|ol[aá]|opa|obrigad|valeu|bom dia|boa tarde|boa noite|ajuda|ok|beleza|tudo bem)\b/.test(value) && value.length < 40) {
    return false;
  }
  return value.length > 10;
}

function campo(value, aberto) {
  if (aberto === true) return "sim";
  if (aberto === false) return "não";
  if (value) return value;
  return "não informado";
}

function documentsFrom(result) {
  const docs = [];
  if (result.note) {
    docs.push({
      type: "document",
      document: { id: "nota", data: JSON.stringify({ aviso: result.note }) },
    });
  }
  if (!result.cards.length && !result.note) {
    docs.push({
      type: "document",
      document: { id: "vazio", data: JSON.stringify({ resultado: "Nenhum lugar encontrado." }) },
    });
  }
  for (const card of result.cards) {
    docs.push({
      type: "document",
      document: {
        id: card.id,
        data: JSON.stringify({
          nome: card.name,
          endereco: campo(card.address),
          telefone: campo(card.phone),
          aberto_agora: card.kind === "link" ? "não se aplica" : campo(null, card.openNow),
          horario: campo(card.hours),
          instagram: campo(card.instagram),
          distancia_metros: card.distanceMeters ?? "não informado",
          fonte: card.sourceName,
          link: card.url || "não informado",
          resumo: card.snippet || "não informado",
        }),
      },
    });
  }
  return docs;
}

async function cohereChat(messages, toolChoice) {
  const body = {
    model: MODEL,
    messages,
    tools: TOOLS,
    strict_tools: true,
    temperature: 0.2,
  };
  if (toolChoice) body.tool_choice = toolChoice;
  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.message || payload?.error || response.statusText;
    throw new Error(`Cohere respondeu ${response.status}: ${detail}`);
  }
  return payload;
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  return JSON.parse(raw);
}

function raioDaFrase(userText) {
  const text = String(userText || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const km = text.match(/(\d{1,4})\s*(km|quilometros)\b/);
  if (km) return Number(km[1]) * 1000;
  if (/\b(qualquer lugar|brasil inteiro|todo o brasil|outros estados|fora da cidade|fora do estado|fora da regiao)\b/.test(text)) {
    return null;
  }
  return 20000;
}

function cidadeCitada(cidade, userText) {
  if (!cidade || !String(cidade).trim()) return undefined;
  const norm = (value) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const city = norm(String(cidade));
  const text = norm(userText || "");
  if (text.includes(city)) return String(cidade).trim();
  const words = city.split(/[^a-z0-9]+/).filter((word) => word.length >= 5);
  if (words.some((word) => text.includes(word))) return String(cidade).trim();
  return undefined;
}

async function runTool(name, args, location, userText) {
  const cidade = cidadeCitada(args.cidade, userText);
  const raio = raioDaFrase(userText);
  const semLimite = raio == null;
  if (name === "buscar_locais") {
    return buscarLocais({
      consulta: String(args.consulta || ""),
      abertoAgora: Boolean(args.aberto_agora),
      raio,
      semLimite,
      cidade,
      location,
    });
  }
  if (name === "buscar_entrega") {
    return buscarEntrega({
      consulta: String(args.consulta || ""),
      cidade,
      location,
      raio,
      semLimite,
    });
  }
  return { cards: [], sources: [], note: `Ferramenta desconhecida: ${name}` };
}

export function factsFrom(cards) {
  return cards.map((card) => {
    const aberto = card.kind === "link" ? "link" : card.openNow === true ? "aberto" : card.openNow === false ? "fechado" : "horário não informado";
    return `${card.name} | ${card.phone || "telefone não informado"} | ${card.instagram || "instagram não informado"} | ${aberto} | ${card.sourceName}`;
  });
}

export async function converse({ messages, location }) {
  if (!process.env.COHERE_API_KEY) {
    throw new Error("Falta COHERE_API_KEY no ambiente.");
  }
  const history = messages.slice(-8).map((message) => {
    if (message.role === "assistant" && Array.isArray(message.facts) && message.facts.length) {
      return {
        role: "assistant",
        content: `${message.content}\n\nDados já mostrados nos cards:\n${message.facts.join("\n")}`,
      };
    }
    return { role: message.role, content: message.content };
  });
  const lastUser = [...history].reverse().find((message) => message.role === "user");
  const userText = lastUser?.content || "";
  const cohereMessages = [{ role: "system", content: systemPrompt(location) }, ...history];
  const cards = [];
  const sources = [];
  let force = looksLikeSearch(lastUser?.content || "");

  for (let step = 0; step < 3; step += 1) {
    const response = await cohereChat(cohereMessages, force ? "REQUIRED" : undefined);
    force = false;
    const message = response.message || {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      const ready = dedupeCards(cards);
      const reply = ready.length
        ? resumoCards(ready)
        : (textOf(message) || "Não consegui formular a resposta com os dados da fonte.");
      return { reply, cards: ready, sources: [...new Set(sources)], facts: factsFrom(ready) };
    }
    cohereMessages.push(assistantTurn(message));
    for (const call of calls) {
      let result;
      try {
        result = await runTool(call.function?.name, parseArgs(call.function?.arguments), location, userText);
      } catch (error) {
        result = { cards: [], sources: [], note: error.message };
      }
      cards.push(...(result.cards || []));
      sources.push(...(result.sources || []));
      cohereMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: documentsFrom(result),
      });
    }
  }

  return {
    reply: "A busca não fechou. Tenta de novo dizendo o tipo de lugar e a cidade.",
    cards: dedupeCards(cards),
    sources: [...new Set(sources)],
    facts: factsFrom(dedupeCards(cards)),
  };
}

function resumoCards(cards) {
  const lugares = cards.filter((card) => card.kind !== "link");
  const paginas = cards.filter((card) => card.kind === "link");
  const abertos = lugares.filter((card) => card.openNow === true).length;
  const fechados = lugares.filter((card) => card.openNow === false).length;
  const n = lugares.length;
  const partes = [];
  if (n === 1 && abertos === 1) partes.push("Achei 1 lugar aberto agora.");
  else if (n > 1 && abertos === n) partes.push(`Achei ${n} lugares abertos agora.`);
  else if (n === 1 && fechados === 1) partes.push("Achei 1 lugar, fechado agora.");
  else if (n > 0 && abertos > 0) partes.push(`Achei ${n} lugares. ${abertos} ${abertos === 1 ? "está aberto" : "estão abertos"} agora.`);
  else if (n === 1) partes.push("Achei 1 lugar. A fonte não informou se está aberto.");
  else if (n > 1) partes.push(`Achei ${n} lugares. A fonte não informou se estão abertos.`);
  if (paginas.length === 1) partes.push(n ? "Também achei 1 página." : "Achei 1 página.");
  else if (paginas.length > 1) partes.push(n ? `Também achei ${paginas.length} páginas.` : `Achei ${paginas.length} páginas.`);
  return partes.join(" ");
}

function dedupeCards(cards) {
  const seen = new Set();
  const unique = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    unique.push(card);
  }
  return unique.slice(0, 8);
}
