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

const atalho = document.querySelector("#atalho");
const atalhoAjuda = document.querySelector("#atalho-ajuda");
const atalhoTexto = document.querySelector("#atalho-texto");
let deferredInstall = null;
const instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const celular = window.matchMedia("(max-width: 800px)").matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);

if (!instalado && celular) atalho.hidden = false;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event;
  atalho.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  atalho.hidden = true;
});

atalho.addEventListener("click", async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    const escolha = await deferredInstall.userChoice;
    deferredInstall = null;
    if (escolha.outcome === "accepted") atalho.hidden = true;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  atalhoTexto.textContent = ios
    ? "No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início."
    : "No menu do navegador, escolha Adicionar à tela inicial ou Instalar app.";
  atalhoAjuda.showModal();
});

document.querySelector("#atalho-fechar").addEventListener("click", () => atalhoAjuda.close());

boot();

async function boot() {
  pintarLocal();
  render();
  try {
    const response = await fetch("/api/status");
    const fontes = await response.json();
    if (fontes.cohere) {
      fontesEl.hidden = true;
    } else {
      fontesEl.hidden = false;
      fontesEl.textContent = "Falta a chave do Cohere no servidor.";
    }
  } catch {
    fontesEl.hidden = false;
    fontesEl.textContent = "Não consegui ler as fontes do servidor.";
  }
}

let gpsWatch = 0;

function pedirLocalizacao() {
  if (!navigator.geolocation) {
    locStatus.textContent = "Este navegador não entrega localização.";
    return;
  }
  if (gpsWatch) navigator.geolocation.clearWatch(gpsWatch);
  locStatus.textContent = "Pedindo a localização precisa do celular…";
  let best = null;
  let settled = false;
  const stop = () => {
    if (gpsWatch) navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = 0;
    clearTimeout(giveUp);
  };
  const accept = async (position) => {
    if (settled) return;
    settled = true;
    stop();
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
  };
  gpsWatch = navigator.geolocation.watchPosition(
    (position) => {
      if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
      const margem = Math.round(best.coords.accuracy);
      if (margem <= 80) {
        accept(best);
        return;
      }
      locStatus.textContent = `Ainda aproximado, erro de ${margem} m. Esperando o GPS do celular…`;
    },
    () => {
      if (best) accept(best);
      else {
        settled = true;
        stop();
        locStatus.textContent = "Localização bloqueada. Dá para buscar dizendo a cidade.";
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  const giveUp = setTimeout(() => {
    if (best) accept(best);
  }, 20000);
}

function pintarLocal() {
  if (!state.location) {
    locBtn.dataset.on = "false";
    locBtn.setAttribute("aria-label", "Usar minha localização");
    locStatus.textContent = "Sem GPS. Diga a cidade.";
    return;
  }
  locBtn.dataset.on = "true";
  locBtn.setAttribute("aria-label", "Atualizar localização");
  const metros = state.location.accuracy;
  locStatus.textContent = !metros
    ? state.location.label
    : metros > 200
      ? `${state.location.label} · o celular mandou um ponto aproximado, com erro de até ${metros} m. Ative a localização precisa do navegador e toque em atualizar.`
      : `${state.location.label} · precisão ${metros} m`;
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
    pending.textContent = "Procurando o mais perto…";
    thread.append(pending);
  }
  thread.scrollTop = thread.scrollHeight;
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
  const titleWrap = document.createElement("div");
  titleWrap.className = "card-title";
  const title = document.createElement("h3");
  title.textContent = card.name;
  titleWrap.append(title);
  header.append(titleWrap);
  if (card.distanceMeters != null) {
    const dist = document.createElement("p");
    dist.className = "distancia";
    dist.textContent = formatarDistancia(card.distanceMeters);
    header.append(dist);
  }
  article.append(header);
  const chips = document.createElement("div");
  chips.className = "chips";
  if (card.commerceType) {
    const tipo = document.createElement("p");
    tipo.className = "tipo";
    tipo.textContent = card.commerceType;
    chips.append(tipo);
  }
  chips.append(badge(card));
  article.append(chips);
  if (card.sells) {
    article.append(linha("oferta", `Costuma ter ${card.sells}.`));
  }
  if (card.address) article.append(linha("addr", card.address));
  if (card.snippet) article.append(linha("snippet", card.snippet));
  if (card.hours) article.append(linha("meta", card.hours));
  const actions = document.createElement("div");
  actions.className = "actions";
  if (card.phone) {
    const tel = linkAcao(`tel:${card.phone.replace(/\s/g, "")}`, card.phone);
    actions.append(tel);
  }
  if (card.lat != null && card.lon != null) {
    const rota = linkAcao(`https://www.google.com/maps/dir/?api=1&destination=${card.lat},${card.lon}`, "Como chegar", true);
    rota.classList.add("primaria");
    actions.append(rota);
  }
  if (card.instagram) {
    actions.append(linkAcao(card.instagram, "Instagram", true));
  }
  if (card.url) {
    const rotulo = card.kind === "link" ? "Abrir" : card.url.includes("google.com/maps") ? "Maps" : "Mapa";
    actions.append(linkAcao(card.url, rotulo, true));
  }
  const temRota = card.lat != null && card.lon != null;
  const urlEhMaps = String(card.url || "").includes("google.com/maps");
  if (card.kind !== "link" && temRota && !urlEhMaps) {
    actions.append(linkAcao(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${card.name} ${card.lat},${card.lon}`)}`,
      "Maps",
      true,
    ));
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

function linkAcao(href, text, externo = false) {
  const link = document.createElement("a");
  link.className = "acao";
  link.href = href;
  link.textContent = text;
  if (externo) {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  return link;
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
