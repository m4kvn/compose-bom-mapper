import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5173);

const SOURCE_URLS = [
  "https://developer.android.com/develop/ui/compose/bom/bom-mapping.md.txt?hl=ja",
  "https://developer.android.com/develop/ui/compose/bom/bom-mapping.md.txt",
  "https://r.jina.ai/http://developer.android.com/develop/ui/compose/bom/bom-mapping.md.txt?hl=ja",
  "https://r.jina.ai/http://developer.android.com/develop/ui/compose/bom/bom-mapping",
];

const BOM_VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(?:[-.][0-9A-Za-z][0-9A-Za-z.-]*)?$/;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/compose-bom-data") {
      const data = await loadComposeBomData();
      sendJson(res, 200, data);
      return;
    }

    const filePath = resolveStaticPath(url.pathname);
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": contentTypeByExt(ext) });
    res.end(content);
  } catch (err) {
    sendJson(res, 500, { error: err?.message || "Internal Server Error" });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running: http://localhost:${PORT}`);
});

function resolveStaticPath(pathname) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const unsafe = path.normalize(normalized).replace(/^(\.\.[/\\])+/, "");
  return path.join(__dirname, unsafe);
}

function contentTypeByExt(ext) {
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function loadComposeBomData() {
  const errors = [];
  for (const url of SOURCE_URLS) {
    try {
      const text = await fetchText(url);
      const parsed =
        parseMarkdownMatrix(text) ||
        parseSelectionOrderedRows(text) ||
        parseFlatPageText(text);
      if (parsed && parsed.bomVersions.length >= 2 && parsed.libraries.length > 0) {
        return { source: "url", ...parsed };
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[compose-bom] URL parse failed (valid BOM mapping not found): ${url}`
      );
      errors.push(`parse failed: ${url}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[compose-bom] URL fetch failed: ${url} :: ${err?.message || "unknown error"}`
      );
      errors.push(`fetch failed: ${url}`);
    }
  }
  throw new Error(
    `指定されたURLからBOMデータを取得できませんでした (${errors.length}件失敗)`
  );
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function parseMarkdownMatrix(raw) {
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    if (!line.includes("|")) return false;
    const cells = splitMarkdownRow(line);
    const versions = cells.map(extractBomVersion).filter(Boolean);
    return versions.length >= 2;
  });
  if (headerIndex === -1) return null;

  const headerCells = splitMarkdownRow(lines[headerIndex]).map(normalizeMarkdownCell);
  const bomVersions = unique(headerCells.map(extractBomVersion).filter(Boolean));
  if (bomVersions.length < 2) return null;

  const mapping = Object.fromEntries(bomVersions.map((v) => [v, {}]));
  const libraries = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (!lines[i].includes("|")) continue;
    const cells = splitMarkdownRow(lines[i]).map(normalizeMarkdownCell);
    const artifact = cells[0] || "";
    if (!/^androidx\.compose\.[\w.-]+:[\w.-]+$/.test(artifact)) continue;
    libraries.push(artifact);
    for (let j = 0; j < bomVersions.length; j += 1) {
      const version = normalizeMarkdownCell(cells[j + 1] || "");
      if (isVersionString(version)) mapping[bomVersions[j]][artifact] = version;
    }
  }
  if (libraries.length === 0) return null;
  return { bomVersions, mapping, libraries: unique(libraries), releaseNotes: {} };
}

function parseFlatPageText(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bomVersions = unique(
    (raw.match(/\b\d{4}\.\d{2}\.\d{2}(?:[-.][0-9A-Za-z][0-9A-Za-z.-]*)?\b/g) || [])
      .filter((v) => BOM_VERSION_RE.test(v))
  );
  if (bomVersions.length < 2) return null;

  const mapping = Object.fromEntries(bomVersions.map((v) => [v, {}]));
  const libraries = [];
  let currentArtifact = "";
  let versions = [];

  for (const line of lines) {
    if (/^androidx\.compose\.[\w.-]+:[\w.-]+$/.test(line)) {
      currentArtifact = line;
      versions = [];
      continue;
    }
    if (!currentArtifact) continue;
    if (isVersionString(line)) {
      versions.push(line);
      if (versions.length === bomVersions.length) {
        libraries.push(currentArtifact);
        for (let i = 0; i < bomVersions.length; i += 1) {
          mapping[bomVersions[i]][currentArtifact] = versions[i];
        }
        currentArtifact = "";
        versions = [];
      }
    }
  }
  if (libraries.length === 0) return null;
  return { bomVersions, mapping, libraries: unique(libraries), releaseNotes: {} };
}

function parseSelectionOrderedRows(raw) {
  const lines = raw.split(/\r?\n/);
  const selectionLine = lines.find((line) => /Make a selection/i.test(line));
  if (!selectionLine) return null;

  const bomVersions = unique(
    (selectionLine.match(/\b\d{4}\.\d{2}\.\d{2}(?:[-.][0-9A-Za-z][0-9A-Za-z.-]*)?\b/g) || [])
      .filter((v) => BOM_VERSION_RE.test(v))
  );
  if (bomVersions.length < 2) return null;

  const mapping = Object.fromEntries(bomVersions.map((v) => [v, {}]));
  const byLibrary = new Map();
  const releaseNotes = {};

  for (const line of lines) {
    if (!line.includes("|")) continue;
    const rawCells = splitMarkdownRow(line);
    const artifact = normalizeMarkdownCell(rawCells[0] || "");
    const version = normalizeMarkdownCell(rawCells[1] || "");
    const releaseNoteCell = rawCells[2] || "";
    if (!/^androidx\.compose\.[\w.-]+:[\w.-]+$/.test(artifact)) continue;
    if (!isVersionString(version)) continue;
    if (!byLibrary.has(artifact)) byLibrary.set(artifact, []);
    byLibrary.get(artifact).push(version);
    const releaseNote = extractMarkdownLink(releaseNoteCell);
    if (releaseNote) {
      if (!releaseNotes[artifact]) releaseNotes[artifact] = {};
      releaseNotes[artifact][version] = releaseNote;
    }
  }

  if (byLibrary.size === 0) return null;

  const libraries = [];
  for (const [artifact, versions] of byLibrary) {
    if (versions.length < 2 || versions.length > bomVersions.length) continue;
    libraries.push(artifact);
    for (let i = 0; i < versions.length; i += 1) {
      mapping[bomVersions[i]][artifact] = versions[i];
    }
  }

  if (libraries.length === 0) return null;
  return { bomVersions, mapping, libraries: unique(libraries), releaseNotes };
}

function splitMarkdownRow(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function normalizeMarkdownCell(value) {
  return String(value)
    .trim()
    .replace(/^\[(.+?)\]\(.+\)$/, "$1")
    .replace(/^`(.+)`$/, "$1")
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractBomVersion(value) {
  const normalized = normalizeMarkdownCell(value);
  const m = normalized.match(/\d{4}\.\d{2}\.\d{2}(?:[-.][0-9A-Za-z][0-9A-Za-z.-]*)?/);
  const v = m ? m[0] : "";
  return BOM_VERSION_RE.test(v) ? v : "";
}

function isVersionString(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function unique(list) {
  return [...new Set(list)];
}

function extractMarkdownLink(value) {
  const raw = String(value).trim();
  if (!raw) return null;

  const markdownLink = raw.match(/^\[(.+?)\]\((https?:\/\/[^\s)]+)\)$/);
  if (markdownLink) {
    return { label: markdownLink[1].trim(), url: markdownLink[2].trim() };
  }

  const plainUrl = raw.match(/^(https?:\/\/\S+)$/);
  if (plainUrl) {
    return { label: plainUrl[1], url: plainUrl[1] };
  }

  return null;
}
