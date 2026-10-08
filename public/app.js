const thread = document.querySelector("#thread");
const form = document.querySelector("#composer");
const input = document.querySelector("#mensagem");
const locBtn = document.querySelector("#loc-btn");
const locStatus = document.querySelector("#loc-status");
const fontesEl = document.querySelector("#fontes");

const state = {
  messages: [],
  location: null,
  busy: false,
};

const stored = sessionStorage.getItem("perto");
if (stored) {
  try {
    const saved = JSON.parse(stored);
    state.messages = Array.isArray(saved.messages) ? saved.messages : [];
    state.location = saved.location || null;
  } catch {
    sessionStorage.removeItem("perto");
  }
}

locBtn.addEventListener("click", () => pedirLocalizacao());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = "";
  enviar(text);
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
thread.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sugestao]");
  if (!button || state.busy) return;
  enviar(button.dataset.sugestao);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();

async function boot() {
  pintarLocal();
  render();
  try {
    const response = await fetch("/api/status");
    const fontes = await response.json();
    const ativas = ["OpenStreetMap"];
    if (fontes.google) ativas.unshift("Google Places");
    if (fontes.brave) ativas.push("Brave");
    fontesEl.textContent = fontes.cohere
      ? `Fontes ligadas: ${ativas.join(", ")}.`
      : "Falta a chave do Cohere no servidor.";
  } catch {
    fontesEl.textContent = "Não consegui ler as fontes do servidor.";
  }
}

function pedirLocalizacao() {
  if (!navigator.geolocation) {
    locStatus.textContent = "Este navegador não entrega localização.";
    return;
  }
  locStatus.textContent = "Pedindo a localização do aparelho…";
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      let label = "ponto do GPS";
      try {
        const response = await fetch(`/api/onde?lat=${lat}&lon=${lon}`);
        const data = await response.json();
        if (data.label) label = data.label;
      } catch {
        label = "GPS ativo";
      }
      state.location = {
        lat,
        lon,
        label,
        accuracy: Math.round(position.coords.accuracy),
      };
      persist();
      pintarLocal();
    },
    () => {
      locStatus.textContent = "Localização bloqueada. Dá para buscar dizendo a cidade.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 },
  );
}

function pintarLocal() {
  if (!state.location) {
    locBtn.dataset.on = "false";
    locBtn.textContent = "Usar minha localização";
    locStatus.textContent = "Sem GPS. Dá para buscar dizendo a cidade.";
    return;
  }
  locBtn.dataset.on = "true";
  locBtn.textContent = "Atualizar localização";
  const precisao = state.location.accuracy ? ` · precisão ${state.location.accuracy} m` : "";
  locStatus.textContent = `${state.location.label}${precisao}`;
}

async function enviar(text) {
  state.messages.push({ role: "user", content: text });
  state.busy = true;
  render();
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.map((message) => ({
          role: message.role,
          content: message.content,
          facts: message.facts,
        })),
        location: state.location
          ? { lat: state.location.lat, lon: state.location.lon, label: state.location.label }
          : null,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "A busca falhou.");
    state.messages.push({
      role: "assistant",
      content: data.reply || "Sem resposta.",
      cards: data.cards || [],
      facts: data.facts || [],
      sources: data.sources || [],
    });
  } catch (error) {
    state.messages.push({ role: "assistant", content: error.message, cards: [], erro: true });
  } finally {
    state.busy = false;
    persist();
    render();
  }
}

function persist() {
  sessionStorage.setItem("perto", JSON.stringify({
    messages: state.messages,
    location: state.location,
  }));
}

function render() {
  const intro = thread.querySelector(".intro");
  thread.replaceChildren();
  if (!state.messages.length) thread.append(intro);
  for (const message of state.messages) {
    thread.append(message.role === "user" ? blocoUsuario(message) : blocoAssistente(message));
  }
  if (state.busy) {
    const pending = document.createElement("p");
    pending.className = "pending";
    pending.textContent = "Procurando nas fontes…";
    thread.append(pending);
  }
  thread.lastElementChild?.scrollIntoView({ block: "end" });
}

function blocoUsuario(message) {
  const article = document.createElement("article");
  article.className = "msg user";
  const p = document.createElement("p");
  p.textContent = message.content;
  article.append(p);
  return article;
}

function blocoAssistente(message) {
  const article = document.createElement("article");
  article.className = "msg assistant";
  const bubble = document.createElement("div");
  bubble.className = message.erro ? "erro" : "bubble";
  const p = document.createElement("p");
  p.innerHTML = formatarTexto(message.content);
  bubble.append(p);
  article.append(bubble);
  if (message.cards?.length) {
    const list = document.createElement("div");
    list.className = "cards";
    for (const card of message.cards) list.append(renderCard(card));
    article.append(list);
  }
  return article;
}

function renderCard(card) {
  const article = document.createElement("article");
  article.className = "card";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = card.name;
  header.append(title, badge(card));
  article.append(header);
  if (card.address) article.append(linha("addr", card.address));
  if (card.snippet) article.append(linha("snippet", card.snippet));
  const meta = [];
  if (card.distanceMeters != null) meta.push(formatarDistancia(card.distanceMeters));
  if (card.hours) meta.push(card.hours);
  if (meta.length) article.append(linha("meta", meta.join(" · ")));
  const actions = document.createElement("div");
  actions.className = "actions";
  if (card.phone) {
    const tel = document.createElement("a");
    tel.href = `tel:${card.phone.replace(/\s/g, "")}`;
    tel.textContent = card.phone;
    actions.append(tel);
  } else if (card.kind !== "link") {
    actions.append(linha("meta", "Telefone não informado pela fonte"));
  }
  if (card.lat != null && card.lon != null) {
    const rota = document.createElement("a");
    rota.href = `https://www.google.com/maps/dir/?api=1&destination=${card.lat},${card.lon}`;
    rota.target = "_blank";
    rota.rel = "noreferrer";
    rota.textContent = "Como chegar";
    actions.append(rota);
  }
  if (card.url) {
    const link = document.createElement("a");
    link.href = card.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = card.kind === "link" ? "Abrir página" : "Ver no mapa";
    actions.append(link);
  }
  if (actions.childNodes.length) article.append(actions);
  const fonte = document.createElement("p");
  fonte.className = "fonte";
  const quando = card.retrievedAt ? new Date(card.retrievedAt).toLocaleString("pt-BR") : "";
  fonte.textContent = `Fonte: ${card.sourceName}${quando ? ` · ${quando}` : ""}`;
  article.append(fonte);
  return article;
}

function formatarTexto(text) {
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

function badge(card) {
  const span = document.createElement("span");
  span.className = "badge";
  if (card.kind === "link") {
    span.classList.add("link");
    span.textContent = "página";
    return span;
  }
  if (card.openNow === true) {
    span.classList.add("open");
    span.textContent = "aberto agora";
  } else if (card.openNow === false) {
    span.classList.add("closed");
    span.textContent = "fechado agora";
  } else {
    span.textContent = "horário não informado";
  }
  return span;
}

function linha(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function formatarDistancia(metros) {
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}
