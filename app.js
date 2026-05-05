const STORAGE_KEYS = {
  owned: "gengarVaultOwned",
  notes: "gengarVaultNotes",
};

function loadJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Some private browsers block storage. The sync link still works.
  }
}

function decodeVaultPayload(value) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(escape(atob(value)));
    const parsed = JSON.parse(decoded);
    return {
      owned: Array.isArray(parsed.owned) ? parsed.owned.map(String) : [],
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      savedAt: parsed.savedAt || null,
    };
  } catch {
    return null;
  }
}

function encodeVaultPayload() {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    owned: [...state.owned],
    notes: state.notes,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function payloadFromUrl() {
  const hash = window.location.hash || "";
  const query = hash.startsWith("#vault=") ? hash.slice("#vault=".length) : new URLSearchParams(window.location.search).get("vault");
  return decodeVaultPayload(query);
}

const urlPayload = payloadFromUrl();

const state = {
  cards: [],
  filter: "all",
  search: "",
  prices: {},
  owned: new Set(urlPayload?.owned || loadJson(STORAGE_KEYS.owned, [])),
  notes: urlPayload?.notes || loadJson(STORAGE_KEYS.notes, {}),
  syncMode: Boolean(urlPayload),
};

const els = {
  mainGrid: document.querySelector("#main-grid"),
  extrasGrid: document.querySelector("#extras-grid"),
  template: document.querySelector("#card-template"),
  progressCount: document.querySelector("#progress-count"),
  progressBar: document.querySelector("#progress-bar"),
  progressCopy: document.querySelector("#progress-copy"),
  priceStatus: document.querySelector("#price-status"),
  syncStatus: document.querySelector("#sync-status"),
  backupInput: document.querySelector("#backup-input"),
  meter: document.querySelector(".meter"),
  search: document.querySelector("#search"),
  tabs: document.querySelectorAll(".tab"),
};

function save() {
  writeJson(STORAGE_KEYS.owned, [...state.owned]);
  writeJson(STORAGE_KEYS.notes, state.notes);
  if (state.syncMode) updateUrlVault();
  updateSyncStatus();
}

function currentVaultUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("vault");
  url.hash = `vault=${encodeVaultPayload()}`;
  return url.toString();
}

function updateUrlVault() {
  window.history.replaceState(null, "", currentVaultUrl());
}

function updateSyncStatus(message) {
  if (!els.syncStatus) return;
  if (message) {
    els.syncStatus.textContent = message;
    return;
  }
  els.syncStatus.textContent = state.syncMode
    ? "Sync-link mode is on. This page URL updates as you check cards, so copy it anytime to continue on another device."
    : "Progress saves on this device. Copy a sync link to open the same vault on your phone or computer.";
}

async function copySyncLink() {
  state.syncMode = true;
  save();
  const link = currentVaultUrl();
  try {
    await navigator.clipboard.writeText(link);
    updateSyncStatus("Sync link copied. Open that link on your phone or computer to load the same owned cards and notes.");
  } catch {
    window.prompt("Copy this sync link:", link);
    updateSyncStatus("Copy the sync link from the prompt, then open it on your other device.");
  }
}

function downloadBackup() {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    owned: [...state.owned],
    notes: state.notes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "gengar-vault-backup.json";
  link.click();
  URL.revokeObjectURL(link.href);
  updateSyncStatus("Backup downloaded. You can import it on another device if the sync link is not convenient.");
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function matches(card) {
  const owned = state.owned.has(String(card.id));
  if (state.filter === "owned" && !owned) return false;
  if (state.filter === "missing" && owned) return false;
  if (!state.search) return true;
  const haystack = [
    card.name,
    card.setName,
    card.cardNumber,
    card.rarity,
    card.artist,
    card.subtype,
    state.notes[card.id],
  ].map(normalize).join(" ");
  return haystack.includes(normalize(state.search));
}

function updateProgress() {
  const mainIds = state.cards.filter((card) => card.category === "main").map((card) => String(card.id));
  const ownedMain = mainIds.filter((id) => state.owned.has(id)).length;
  const total = mainIds.length;
  const pct = total ? Math.round((ownedMain / total) * 100) : 0;
  els.progressCount.textContent = `${ownedMain} / ${total}`;
  els.progressBar.style.width = `${pct}%`;
  els.meter.setAttribute("aria-valuenow", ownedMain);
  els.meter.setAttribute("aria-valuemax", total);
  els.progressCopy.textContent =
    pct === 100
      ? "Master set complete. The vault is sealed."
      : `${pct}% complete. ${total - ownedMain} main-set cards still missing.`;
}

function restoreScroll(left, top) {
  const previous = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(left, top);
  document.documentElement.style.scrollBehavior = previous;
}

function updateTileVisibility(id) {
  const tile = document.querySelector(`[data-card-id="${CSS.escape(String(id))}"]`);
  if (!tile) return;
  const card = state.cards.find((item) => String(item.id) === String(id));
  tile.classList.toggle("hidden", !matches(card));
}

function metaRow(term, value) {
  if (!value) return "";
  return `<dt>${term}</dt><dd>${value}</dd>`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function labelVariant(key) {
  return String(key || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .replace("1st Edition", "1st Edition");
}

function preferredPrice(card, tcgplayer) {
  const prices = tcgplayer?.prices || {};
  const keys = Object.keys(prices);
  if (!keys.length) return null;

  const reversePreferred = normalize(card.subtype).includes("reverse");
  const holoPreferred = /holo|ex|gx|vmax| v$|ultra|secret|rainbow|promo|prime|lv\.x/i.test(
    `${card.name} ${card.rarity || ""}`
  );
  const priority = reversePreferred
    ? ["reverseHolofoil", "holofoil", "normal"]
    : holoPreferred
      ? ["holofoil", "normal", "reverseHolofoil"]
      : ["normal", "holofoil", "reverseHolofoil"];

  const ordered = [...priority, ...keys.filter((key) => !priority.includes(key))];
  for (const key of ordered) {
    const price = prices[key];
    if (price?.market) return { key, ...price, updatedAt: tcgplayer.updatedAt, url: tcgplayer.url };
  }
  for (const key of ordered) {
    const price = prices[key];
    const fallback = price?.mid || price?.low || price?.directLow || price?.high;
    if (fallback) return { key, market: fallback, fallback: true, ...price, updatedAt: tcgplayer.updatedAt, url: tcgplayer.url };
  }
  return null;
}

function applyPriceToTile(id) {
  const tile = document.querySelector(`[data-card-id="${CSS.escape(String(id))}"]`);
  if (!tile) return;
  const box = tile.querySelector("[data-price-box]");
  applyPriceToBox(id, box);
}

function applyPriceToBox(id, box) {
  const price = state.prices[id];
  if (!box) return;

  if (price?.market) {
    box.classList.remove("pending", "missing");
    box.innerHTML = `
      <span class="price-label">${labelVariant(price.key)} market</span>
      <strong>${formatCurrency(price.market)}</strong>
      <small>${price.fallback ? "Fallback from available TCGplayer price" : "TCGplayer market"} · Updated ${price.updatedAt || "recently"}</small>
      ${price.url ? `<a href="${price.url}" target="_blank" rel="noreferrer">View price source</a>` : ""}
    `;
  } else {
    box.classList.remove("pending");
    box.classList.add("missing");
    box.innerHTML = `
      <span class="price-label">Market price</span>
      <strong>Not available</strong>
      <small>No live TCGplayer market price found for this entry.</small>
    `;
  }
}

async function loadMarketPrices() {
  const apiCards = state.cards.filter((card) => card.apiId);
  if (!apiCards.length) return;
  const byApiId = new Map(apiCards.map((card) => [card.apiId, card]));
  const chunks = [];
  for (let i = 0; i < apiCards.length; i += 20) chunks.push(apiCards.slice(i, i + 20));

  let priced = 0;
  for (const chunk of chunks) {
    const query = chunk.map((card) => `id:${card.apiId}`).join(" OR ");
    const params = new URLSearchParams({
      q: query,
      select: "id,tcgplayer",
      pageSize: String(chunk.length),
    });
    try {
      const response = await fetch(`https://api.pokemontcg.io/v2/cards?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      for (const apiCard of payload.data || []) {
        const localCard = byApiId.get(apiCard.id);
        if (!localCard) continue;
        const price = preferredPrice(localCard, apiCard.tcgplayer);
        if (price?.market) priced += 1;
        state.prices[localCard.id] = price || null;
        applyPriceToTile(localCard.id);
      }
    } catch (error) {
      console.warn("Market price refresh failed", error);
      for (const card of chunk) {
        state.prices[card.id] = null;
        applyPriceToTile(card.id);
      }
    }
    els.priceStatus.textContent = `Market prices refreshed for ${priced} cards. Data updates when you reopen the page.`;
  }
}

function renderCard(card, displayIndex) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const id = String(card.id);
  const owned = state.owned.has(id);
  node.dataset.cardId = id;
  node.classList.toggle("owned", owned);

  const media = node.querySelector(".card-media");
  if (card.imageUrl) {
    const img = document.createElement("img");
    img.src = card.imageUrl;
    img.alt = `${card.name} ${card.setName} ${card.cardNumber}`;
    img.loading = "lazy";
    media.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = "Image pending · no confirmed English physical print";
    media.appendChild(placeholder);
  }

  node.querySelector(".card-index").textContent = card.category === "main" ? `#${displayIndex}` : "Extra";
  node.querySelector(".source-pill").textContent = card.imageUrl ? `IMG · ${card.imageSource || "source"}` : "Image pending";
  node.querySelector("h3").textContent = card.name;
  node.querySelector(".set-line").textContent = `${card.setName} · ${card.cardNumber}`;
  node.querySelector(".meta").innerHTML = [
    metaRow("Rarity", card.rarity),
    metaRow("Artist", card.artist),
    metaRow("Released", card.releaseDate),
    metaRow("Note", card.subtype),
  ].join("");
  node.querySelector("[data-price-box]").classList.add("pending");
  if (Object.prototype.hasOwnProperty.call(state.prices, id)) applyPriceToBox(id, node.querySelector("[data-price-box]"));

  const checkbox = node.querySelector("input");
  checkbox.checked = owned;
  checkbox.addEventListener("change", () => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    if (checkbox.checked) state.owned.add(id);
    else state.owned.delete(id);
    save();
    node.classList.toggle("owned", checkbox.checked);
    updateProgress();
    if (state.filter !== "all") updateTileVisibility(id);
    checkbox.blur();
    requestAnimationFrame(() => restoreScroll(scrollX, scrollY));
    setTimeout(() => restoreScroll(scrollX, scrollY), 16);
    setTimeout(() => restoreScroll(scrollX, scrollY), 40);
    setTimeout(() => restoreScroll(scrollX, scrollY), 80);
  });

  const textarea = node.querySelector("textarea");
  textarea.value = state.notes[id] || "";
  textarea.addEventListener("input", () => {
    state.notes[id] = textarea.value;
    save();
  });

  return node;
}

function render() {
  els.mainGrid.replaceChildren();
  els.extrasGrid.replaceChildren();
  const main = state.cards.filter((card) => card.category === "main");
  const extras = state.cards.filter((card) => card.category === "extra");

  main.filter(matches).forEach((card, index) => els.mainGrid.appendChild(renderCard(card, card.id || index + 1)));
  extras.filter(matches).forEach((card) => els.extrasGrid.appendChild(renderCard(card, "Extra")));

  updateProgress();
}

async function init() {
  const response = await fetch("./seed-data.json");
  const data = await response.json();
  state.cards = [...data.main, ...data.extras];
  if (urlPayload) {
    writeJson(STORAGE_KEYS.owned, [...state.owned]);
    writeJson(STORAGE_KEYS.notes, state.notes);
  }
  render();
  updateSyncStatus(urlPayload ? "Loaded progress from your sync link and saved it on this device." : undefined);
  loadMarketPrices();
}

els.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.filter = tab.dataset.filter;
    els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
    render();
  });
});

document.querySelector('[data-action="scroll-checklist"]').addEventListener("click", () => {
  document.querySelector("#checklist").scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll('[data-action="copy-sync-link"]').forEach((button) => {
  button.addEventListener("click", copySyncLink);
});

document.querySelector('[data-action="download-backup"]').addEventListener("click", downloadBackup);

els.backupInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    state.owned = new Set(Array.isArray(payload.owned) ? payload.owned.map(String) : []);
    state.notes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
    state.syncMode = true;
    save();
    render();
    updateSyncStatus("Backup imported. This browser is now saved and the page URL is updated for syncing.");
  } catch {
    updateSyncStatus("That backup file could not be read. Try exporting a fresh backup from Gengar Vault.");
  } finally {
    event.target.value = "";
  }
});

document.querySelector('[data-action="reset-progress"]').addEventListener("click", () => {
  if (!confirm("Reset your owned cards and notes on this browser?")) return;
  state.owned.clear();
  state.notes = {};
  save();
  render();
});

init();
