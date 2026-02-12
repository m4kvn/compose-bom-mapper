const API_URL = "/api/compose-bom-data";

const state = {
  bomVersions: [],
  mapping: {},
  libraries: [],
  sourceType: "",
};

const loadBtn = document.querySelector("#loadBtn");
const compareBtn = document.querySelector("#compareBtn");
const fromBom = document.querySelector("#fromBom");
const toBom = document.querySelector("#toBom");
const onlyChanged = document.querySelector("#onlyChanged");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const resultBody = document.querySelector("#resultBody");

loadBtn.addEventListener("click", loadData);
compareBtn.addEventListener("click", renderComparison);
onlyChanged.addEventListener("change", renderComparison);

async function loadData() {
  setStatus("データ取得中...");
  loadBtn.disabled = true;
  compareBtn.disabled = true;
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    state.bomVersions = data.bomVersions || [];
    state.mapping = data.mapping || {};
    state.libraries = data.libraries || [];
    state.sourceType = data.source || "unknown";
    if (state.bomVersions.length < 2 || state.libraries.length === 0) {
      throw new Error("サーバーから有効なデータを取得できませんでした");
    }
    hydrateSelectors();
    renderComparison();
    setStatus(`取得成功: ${state.bomVersions.length}個のBOM / source=${state.sourceType}`);
    compareBtn.disabled = false;
  } catch (err) {
    setStatus(`取得失敗: ${err?.message || "不明なエラー"}`, true);
  } finally {
    loadBtn.disabled = false;
  }
}

function hydrateSelectors() {
  const versions = [...state.bomVersions].sort().reverse();
  const optionsHtml = versions
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join("");

  fromBom.innerHTML = optionsHtml;
  toBom.innerHTML = optionsHtml;

  if (versions.length >= 2) {
    toBom.value = versions[0];
    fromBom.value = versions[1];
  }
}

function renderComparison() {
  if (state.bomVersions.length === 0) return;
  const from = fromBom.value;
  const to = toBom.value;
  const showOnlyChanged = onlyChanged.checked;

  const rows = [];
  let changedCount = 0;

  for (const lib of state.libraries) {
    const fromVer = state.mapping[from]?.[lib] ?? "-";
    const toVer = state.mapping[to]?.[lib] ?? "-";
    const changed = fromVer !== toVer;
    if (showOnlyChanged && !changed) continue;
    if (changed) changedCount += 1;
    rows.push({ lib, fromVer, toVer, changed });
  }

  resultBody.innerHTML = rows
    .map(
      (row) => `
      <tr class="${row.changed ? "library-row-changed" : ""}">
        <td><code>${escapeHtml(row.lib)}</code></td>
        <td><code>${escapeHtml(row.fromVer)}</code></td>
        <td><code>${escapeHtml(row.toVer)}</code></td>
        <td class="${row.changed ? "status-changed" : "status-same"}">${row.changed ? "変更あり" : "変更なし"}</td>
      </tr>`
    )
    .join("");

  summaryEl.textContent = `${from} -> ${to} | 差分 ${changedCount}件 / 表示 ${rows.length}件`;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b91c1c" : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadData();
