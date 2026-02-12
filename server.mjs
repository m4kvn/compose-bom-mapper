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

const MAVEN_GAV_API =
  "https://search.maven.org/solrsearch/select?q=g:%22androidx.compose%22%20AND%20a:%22compose-bom%22&core=gav&rows=300&wt=json";
const GOOGLE_MAVEN_BASE = "https://dl.google.com/dl/android/maven2";
const MAVEN_POM_URL = (version) =>
  `${GOOGLE_MAVEN_BASE}/androidx/compose/compose-bom/${version}/compose-bom-${version}.pom`;
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
  return "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function loadComposeBomData() {
  for (const url of SOURCE_URLS) {
    try {
      const text = await fetchText(url);
      const parsed = parseMarkdownMatrix(text) || parseFlatPageText(text);
      if (parsed && parsed.bomVersions.length >= 2 && parsed.libraries.length > 0) {
        return { source: "url", ...parsed };
      }
    } catch {
      // continue
    }
  }
  return loadFromMaven();
}

async function loadFromMaven() {
  const gav = await fetchJson(MAVEN_GAV_API).catch(() => null);
  let versions = unique(
    (gav?.response?.docs || [])
      .map((doc) => String(doc?.v || ""))
      .filter((v) => BOM_VERSION_RE.test(v))
  )
    .sort()
    .reverse();

  if (versions.length < 2) {
    versions = await loadVersionsFromMavenMetadata();
  }

  if (versions.length < 2) {
    throw new Error("BOM一覧を取得できませんでした（Google Maven / Maven API）");
  }

  const targets = versions.slice(0, 40);
  const mapping = Object.fromEntries(targets.map((v) => [v, {}]));
  const libraries = new Set();

  for (const version of targets) {
    const xml = await fetchText(MAVEN_POM_URL(version));
    const deps = parseBomPomXml(xml);
    mapping[version] = deps;
    Object.keys(deps).forEach((k) => libraries.add(k));
  }

  return {
    source: "maven",
    bomVersions: targets,
    mapping,
    libraries: [...libraries].sort(),
  };
}

async function loadVersionsFromMavenMetadata() {
  const xml = await fetchText(
    `${GOOGLE_MAVEN_BASE}/androidx/compose/compose-bom/maven-metadata.xml`
  );
  const versions = unique(
    (xml.match(/<version>\s*([^<]+?)\s*<\/version>/g) || [])
      .map((line) => line.replace(/<\/?version>/g, "").trim())
      .filter((v) => BOM_VERSION_RE.test(v))
  )
    .sort()
    .reverse();
  return versions;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function parseMarkdownMatrix(raw) {
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.includes("|") && /Library|ライブラリ/i.test(line));
  if (headerIndex === -1) return null;

  const headerCells = splitMarkdownRow(lines[headerIndex]);
  const bomVersions = headerCells.filter((c) => BOM_VERSION_RE.test(c));
  if (bomVersions.length < 2) return null;

  const mapping = Object.fromEntries(bomVersions.map((v) => [v, {}]));
  const libraries = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (!lines[i].includes("|")) continue;
    const cells = splitMarkdownRow(lines[i]);
    const artifact = cells[0]?.trim() || "";
    if (!/^androidx\.compose\.[\w.-]+:[\w.-]+$/.test(artifact)) continue;
    libraries.push(artifact);
    for (let j = 0; j < bomVersions.length; j += 1) {
      const version = cells[j + 1]?.trim() || "";
      if (isVersionString(version)) mapping[bomVersions[j]][artifact] = version;
    }
  }
  if (libraries.length === 0) return null;
  return { bomVersions, mapping, libraries: unique(libraries) };
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
  return { bomVersions, mapping, libraries: unique(libraries) };
}

function parseBomPomXml(xml) {
  const deps = {};
  const depBlocks = xml.match(/<dependency>[\s\S]*?<\/dependency>/g) || [];
  for (const block of depBlocks) {
    const groupId = extractTag(block, "groupId");
    const artifactId = extractTag(block, "artifactId");
    const version = extractTag(block, "version");
    if (!groupId || !artifactId || !version) continue;
    if (!groupId.startsWith("androidx.compose")) continue;
    deps[`${groupId}:${artifactId}`] = version;
  }
  return deps;
}

function extractTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function splitMarkdownRow(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isVersionString(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function unique(list) {
  return [...new Set(list)];
}
