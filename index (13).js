/**
 * Backend mínimo de OsteoAssist.
 *
 * Existe por una sola razón: la API key de Anthropic no puede vivir en el
 * navegador. Cualquiera abriría el inspector y la tomaría. Este servidor la
 * guarda como variable de entorno y expone un único endpoint que recibe la
 * imagen, llama a la API y devuelve el JSON extraído.
 *
 * No almacena nada. La imagen se procesa en memoria y se descarta.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_TOOL } from "../src/extraction/prompt.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.OSTEO_MODEL || "claude-sonnet-4-6";
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Sin clave, el servidor arranca igual y sirve la interfaz: el motor de reglas
 * funciona sin llamar a la API, y así se puede desplegar y revisar la
 * herramienta antes de tener la clave. Solo la lectura de archivos queda
 * deshabilitada, con un mensaje que lo explica.
 */
if (!API_KEY) {
  console.warn(
    "ANTHROPIC_API_KEY no está configurada. La interfaz funciona y el motor de " +
      "reglas también; la lectura automática de reportes queda deshabilitada hasta " +
      "que se agregue la variable de entorno.",
  );
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("El archivo supera el tamaño máximo permitido.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

/**
 * Sirve la interfaz compilada. Permite desplegar todo como un solo servicio;
 * en desarrollo no se usa, porque Vite sirve el frontend por su cuenta.
 */
async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const candidate = normalize(join(DIST, urlPath));
  if (!candidate.startsWith(DIST)) {
    res.writeHead(403).end("Acceso denegado");
    return true;
  }

  let filePath = candidate;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(DIST, "index.html"); // enrutamiento del lado del cliente
  }

  try {
    const body = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (!req.url.startsWith("/api/")) {
    if (req.method === "GET" && (await serveStatic(req, res))) return;
    return json(res, 404, { error: "Ruta no encontrada." });
  }

  if (req.method !== "POST" || !req.url.startsWith("/api/extract")) {
    return json(res, 404, { error: "Ruta no encontrada." });
  }

  if (!API_KEY) {
    return json(res, 503, {
      error:
        "La lectura automática no está configurada en este servidor. Puede transcribir " +
        "los valores manualmente sobre el reporte cargado.",
    });
  }

  try {
    const { mediaType, data } = await readBody(req);
    if (!data || !mediaType) {
      return json(res, 400, { error: "Se requiere el archivo del reporte." });
    }

    const isPdf = mediaType === "application/pdf";
    const content = [
      isPdf
        ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data } },
      { type: "text", text: "Transcribe este reporte de densitometría." },
    ];

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: EXTRACTION_SYSTEM_PROMPT,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: "tool", name: "extract_dxa_report" },
        messages: [{ role: "user", content }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Error de la API:", upstream.status, detail.slice(0, 500));
      return json(res, 502, { error: "No fue posible leer el reporte. Intente de nuevo o transcriba manualmente." });
    }

    const result = await upstream.json();
    const block = result.content?.find((c) => c.type === "tool_use");
    if (!block) {
      return json(res, 502, { error: "La lectura no devolvió datos estructurados. Transcriba manualmente." });
    }

    return json(res, 200, block.input);
  } catch (err) {
    console.error(err);
    return json(res, 400, { error: err.message || "Solicitud inválida." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OsteoAssist escuchando en el puerto ${PORT}`);
});
