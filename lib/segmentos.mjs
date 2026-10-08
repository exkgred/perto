function fold(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

const SEGMENTOS = [
  {
    id: "padaria",
    rotulo: "padaria",
    google: ["bakery", "cake_shop", "bagel_shop"],
    osm: [["shop", "bakery"]],
    busca: "padaria",
    nomes: /padaria|panific/,
    encontra: "pão, lanche, frios e algum alimento",
    foco: /padaria|panific|\bpao\b|paozinho/,
    tambem: /lanche|\bcafe\b|bolo|salgado|frios/,
  },
  {
    id: "adega",
    rotulo: "adega",
    google: ["liquor_store"],
    osm: [["shop", "alcohol"], ["shop", "beverages"], ["shop", "wine"]],
    busca: "adega distribuidora de bebidas",
    nomes: /adega|distribuidora/,
    encontra: "bebida e, em muitas, cigarro e gelo",
    foco: /adega|distribuidora|vinho|cerveja|bebida|cigarro|cachaca|whisky|vodka|gelo|chopp|chope/,
    tambem: /refrigerante|energet|agua mineral/,
  },
  {
    id: "mercado",
    rotulo: "mercado",
    google: ["supermarket", "grocery_store", "hypermarket", "discount_supermarket", "market"],
    osm: [["shop", "supermarket"], ["shop", "general"]],
    busca: "mercado",
    nomes: /mercado|supermerc|hipermerc/,
    encontra: "alimento, bebida, higiene e item de casa",
    foco: /mercado|supermerc|alimento|comida|arroz|feijao|\bleite\b|acucar|miojo|macarrao/,
    tambem: /\bpao\b|bebida|vinho|cerveja|cigarro|refrigerante|\bagua\b|higiene|salgad/,
  },
  {
    id: "conveniencia",
    rotulo: "conveniência",
    google: ["convenience_store"],
    osm: [["shop", "convenience"], ["shop", "kiosk"], ["shop", "tobacco"]],
    busca: "conveniência",
    nomes: /conveni/,
    encontra: "bebida, cigarro, lanche, pão e item pequeno de mercado",
    foco: /conveni/,
    tambem: /\bpao\b|bebida|vinho|cerveja|cigarro|lanche|salgad|\bleite\b|pilha|refrigerante|\bagua\b|gelo/,
  },
  {
    id: "posto",
    rotulo: "posto",
    google: ["gas_station"],
    osm: [["amenity", "fuel"]],
    busca: "posto de combustível",
    nomes: /\bposto\b|gasolina/,
    encontra: "combustível, bebida, cigarro, lanche e algum alimento",
    foco: /combust|gasolina|\bposto\b/,
    tambem: /\bpao\b|alimento|lanche|bebida|vinho|cerveja|refrigerante|cigarro|\bagua\b|\bleite\b|salgad|pilha|gelo/,
  },
  {
    id: "farmacia",
    rotulo: "farmácia",
    google: ["pharmacy", "drugstore"],
    osm: [["amenity", "pharmacy"], ["shop", "chemist"]],
    busca: "farmácia",
    nomes: /farmac|drogaria/,
    encontra: "remédio e item de higiene",
    foco: /farmac|drogaria|remedio|medicament/,
    tambem: /higiene|fralda/,
  },
  {
    id: "acougue",
    rotulo: "açougue",
    google: ["butcher_shop"],
    osm: [["shop", "butcher"]],
    busca: "açougue",
    nomes: /acougue|aougue/,
    encontra: "carne",
    foco: /acougue|carne|linguica|frango/,
    tambem: /$^/,
  },
  {
    id: "hortifruti",
    rotulo: "hortifruti",
    google: ["farmers_market"],
    osm: [["shop", "greengrocer"]],
    busca: "hortifruti",
    nomes: /hortifruti|sacolao|verdureir/,
    encontra: "fruta, verdura e legume",
    foco: /hortifruti|sacolao|fruta|verdura|legume/,
    tambem: /$^/,
  },
  {
    id: "borracharia",
    rotulo: "borracharia",
    google: ["tire_shop"],
    osm: [["shop", "tyres"]],
    busca: "borracharia",
    nomes: /borrach/,
    encontra: "pneu e reparo",
    foco: /borrach|\bpneu\b/,
    tambem: /$^/,
  },
  {
    id: "oficina",
    rotulo: "oficina",
    google: ["car_repair"],
    osm: [["shop", "car_repair"], ["amenity", "car_repair"]],
    busca: "oficina mecânica",
    nomes: /oficina|mecanica/,
    encontra: "serviço de carro e autopeça",
    foco: /oficina|mecanica|autopeca|funilar/,
    tambem: /$^/,
  },
  {
    id: "pet",
    rotulo: "pet shop",
    google: ["pet_store"],
    osm: [["shop", "pet"]],
    busca: "pet shop",
    nomes: /pet\s?shop|petshop/,
    encontra: "ração e acessório de animal",
    foco: /pet\s?shop|petshop|racao/,
    tambem: /$^/,
  },
  {
    id: "ferragem",
    rotulo: "ferragem",
    google: ["hardware_store", "building_materials_store"],
    osm: [["shop", "hardware"], ["shop", "doityourself"]],
    busca: "loja de material de construção",
    nomes: /ferragem|material de construc/,
    encontra: "ferramenta e material de obra",
    foco: /ferragem|parafuso|cimento|material de construc|ferramenta/,
    tambem: /$^/,
  },
];

const POR_GOOGLE = new Map(SEGMENTOS.flatMap((segmento) => segmento.google.map((type) => [type, segmento])));
const POR_OSM = new Map(SEGMENTOS.flatMap((segmento) => segmento.osm.map(([key, value]) => [`${key}=${value}`, segmento])));

export function segmentosDoPedido(consulta) {
  const text = fold(consulta);
  const foco = SEGMENTOS.filter((segmento) => segmento.foco.test(text));
  const tambem = SEGMENTOS.filter((segmento) => !foco.includes(segmento) && segmento.tambem.test(text));
  return [...foco, ...tambem].slice(0, 5);
}

export function perfilComercio(type, displayName, name) {
  const byType = POR_GOOGLE.get(type);
  const byName = SEGMENTOS.find((segmento) => segmento.nomes.test(fold(name)));
  const segmento = byType || byName || null;
  if (!segmento && !displayName) return { commerceType: null, sells: null };
  return {
    commerceType: displayName || segmento?.rotulo || null,
    sells: segmento?.encontra || null,
  };
}

export function perfilOsm(tags, name) {
  const shop = tags?.shop ? POR_OSM.get(`shop=${tags.shop}`) : null;
  const amenity = tags?.amenity ? POR_OSM.get(`amenity=${tags.amenity}`) : null;
  const segmento = shop || amenity || SEGMENTOS.find((item) => item.nomes.test(fold(name))) || null;
  if (!segmento) return { commerceType: null, sells: null };
  return { commerceType: segmento.rotulo, sells: segmento.encontra };
}
