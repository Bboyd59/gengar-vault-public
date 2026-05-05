const state = {
  cards: [],
  filter: "all",
  search: "",
  owned: new Set(JSON.parse(localStorage.getItem("gengarVaultOwned") || "[]")),
  notes: JSON.parse(localStorage.getItem("gengarVaultNotes") || "{}"),
};

const els = {
  mainGrid: document.querySelector("#main-grid"),
  extrasGrid: document.querySelector("#extras-grid"),
  template: document.querySelector("#card-template"),
  progressCount: document.querySelector("#progress-count"),
  progressBar: document.querySelector("#progress-bar"),
  progressCopy: document.querySelector("#progress-copy"),
  meter: document.querySelector(".meter"),
  search: document.querySelector("#search"),
  tabs: document.querySelectorAll(".tab"),
};

function save() {
  localStorage.setItem("gengarVaultOwned", JSON.stringify([...state.owned]));
  localStorage.setItem("gengarVaultNotes", JSON.stringify(state.notes));
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

function metaRow(term, value) {
  if (!value) return "";
  return `<dt>${term}</dt><dd>${value}</dd>`;
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

  const checkbox = node.querySelector("input");
  checkbox.checked = owned;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.owned.add(id);
    else state.owned.delete(id);
    save();
    render();
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
  render();
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

document.querySelector('[data-action="reset-progress"]').addEventListener("click", () => {
  if (!confirm("Reset your owned cards and notes on this browser?")) return;
  state.owned.clear();
  state.notes = {};
  save();
  render();
});

init();
