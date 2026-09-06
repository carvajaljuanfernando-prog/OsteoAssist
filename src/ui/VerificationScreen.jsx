import React, { useState, useMemo, useRef } from "react";
import { analyzeDxa } from "../engine/index.ts";
import { SITE_LABEL, CATEGORY_LABEL, TIER_LABEL } from "../engine/labels.ts";
import ClinicalContextPanel, { EMPTY_CONTEXT } from "./ClinicalContextPanel.jsx";

/* ------------------------------------------------------------------ *
 * OsteoAssist — pantalla de verificación
 *
 * El médico coteja la imagen del reporte contra lo que leyó el extractor,
 * marca artefactos por vértebra y confirma por bloques. El análisis se
 * recalcula en vivo. Sin verificación completa no se emiten informes.
 * ------------------------------------------------------------------ */

const DEMO_EXTRACTION = {
  patient: { name: "Paciente de ejemplo", documentId: "63.5xx.xxx", birthDate: null, age: 68, sex: "F", weightKg: 62, heightCm: 156 },
  study: { date: "2026-07-01", manufacturer: "Hologic", model: "Horizon A", facility: "Centro Médico", referenceDatabase: "NHANES" },
  measurements: [
    { site: "L1", bmd: 0.792, tScore: -2.6, zScore: -0.9, range: null, artifact: false, artifactNote: null },
    { site: "L2", bmd: 0.814, tScore: -2.5, zScore: -0.8, range: null, artifact: false, artifactNote: null },
    { site: "L3", bmd: 1.052, tScore: -0.6, zScore: 1.1, range: null, artifact: false, artifactNote: null },
    { site: "L4", bmd: 0.803, tScore: -2.5, zScore: -0.8, range: null, artifact: false, artifactNote: null },
    { site: "columna_lumbar", bmd: 0.865, tScore: -1.9, zScore: -0.3, range: "L1-L4", artifact: false, artifactNote: null },
    { site: "cuello_femoral", bmd: 0.601, tScore: -2.4, zScore: -0.6, range: null, artifact: false, artifactNote: null },
    { site: "cadera_total", bmd: 0.724, tScore: -2.0, zScore: -0.2, range: null, artifact: false, artifactNote: null },
    { site: "trocanter", bmd: 0.551, tScore: -2.1, zScore: -0.4, range: null, artifact: false, artifactNote: null },
  ],
  tbs: null, vfa: null, priorStudy: null,
  reportImpression: "Osteopenia lumbar. Cuello femoral en rango de osteopenia.",
  lowConfidenceFields: ["measurements[2].tScore", "patient.documentId"],
};

const VERTEBRAE = ["L1", "L2", "L3", "L4"];
const ARTIFACT_REASONS = [
  "Cambio degenerativo / artrosis facetaria",
  "Fractura vertebral",
  "Osteosíntesis o cemento",
  "Escoliosis con rotación",
  "Calcificación aórtica superpuesta",
  "Otra alteración estructural focal",
];

const BLOCKS = [
  { id: "paciente", label: "Datos del paciente" },
  { id: "estudio", label: "Datos del estudio" },
  { id: "lumbar", label: "Columna lumbar" },
  { id: "femur", label: "Fémur" },
  { id: "otros", label: "Otros sitios" },
  { id: "clinico", label: "Contexto clínico" },
];

function fmt(v, digits = 1) {
  return v === null || v === undefined ? "—" : Number(v).toFixed(digits);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("No fue posible leer el archivo."));
    r.readAsDataURL(file);
  });
}

/** Envía el archivo al backend, que guarda la clave y llama a la API. */
async function extractFromFile(file) {
  const data = await fileToBase64(file);
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaType: file.type, data }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "La lectura falló.");
  return body;
}

/* ---------------------------- campos ---------------------------- */

function Field({ label, value, unit, suspect, verified, onChange, onVerify, numeric = true }) {
  return (
    <div className={`flex items-baseline gap-3 py-2 border-b ${suspect && !verified ? "border-amber-400" : "border-slate-200"}`}>
      <span className="w-40 shrink-0 text-sm text-slate-600">{label}</span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={`flex-1 min-w-0 bg-transparent text-slate-900 outline-none border-b border-transparent focus:border-sky-600 ${
          numeric ? "tabular-nums font-medium" : ""
        }`}
      />
      {unit && <span className="text-xs text-slate-500 shrink-0">{unit}</span>}
      {suspect && (
        <button
          onClick={onVerify}
          className={`shrink-0 text-xs px-2 py-1 rounded border ${
            verified
              ? "border-emerald-700 text-emerald-800 bg-emerald-50"
              : "border-amber-500 text-amber-800 bg-amber-50 hover:bg-amber-100"
          }`}
        >
          {verified ? "Leído correcto" : "Lectura dudosa — revisar"}
        </button>
      )}
    </div>
  );
}

/* ------------------------- imagen del reporte ------------------------- */

function ReportPane({ imageUrl, onPick, zoom, setZoom, status, error, onRetryManual }) {
  const inputRef = useRef(null);
  const busy = status === "reading";
  return (
    <div className="border border-slate-300 bg-slate-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-300 bg-white">
        <span className="text-sm font-medium text-slate-800">Reporte original</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            className="px-2 text-slate-600 border border-slate-300 rounded" aria-label="Alejar">−</button>
          <span className="text-xs tabular-nums text-slate-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            className="px-2 text-slate-600 border border-slate-300 rounded" aria-label="Acercar">+</button>
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className={`text-xs px-2 py-1 border rounded ${
              busy ? "border-slate-200 text-slate-400 cursor-wait"
                   : "border-slate-400 text-slate-700 hover:bg-slate-100"}`}>
            {busy ? "Leyendo…" : "Cargar reporte"}
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      <div className="h-[26rem] overflow-auto bg-slate-100 flex items-start justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="Reporte de densitometría"
            style={{ width: `${zoom * 100}%` }} className="block" />
        ) : (
          <div className="text-center px-6 py-16 text-slate-500 text-sm max-w-xs">
            Cargue la foto o el PDF del reporte. Se leerá automáticamente y usted verifica
            cada valor contra el original.
            <div className="mt-3 text-xs text-slate-400">
              Mientras tanto se muestran datos de ejemplo para probar el flujo.
            </div>
          </div>
        )}
      </div>
      {busy && (
        <div className="px-3 py-2 border-t border-slate-300 bg-sky-50 text-sm text-sky-900">
          Leyendo el reporte. No cierre la pantalla.
        </div>
      )}
      {error && (
        <div className="px-3 py-2 border-t border-red-300 bg-red-50">
          <div className="text-sm text-red-900">{error}</div>
          <button onClick={onRetryManual}
            className="mt-1 text-xs underline text-red-900">
            Continuar y transcribir manualmente
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ app ------------------------------ */

export default function VerificationScreen() {
  const [extraction, setExtraction] = useState(DEMO_EXTRACTION);
  const [ctx, setCtx] = useState(EMPTY_CONTEXT);
  const [verifiedBlocks, setVerifiedBlocks] = useState({});
  const [verifiedFields, setVerifiedFields] = useState({});
  const [imageUrl, setImageUrl] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  /**
   * Carga y lectura. Un archivo nuevo invalida toda verificación previa:
   * confirmar los datos de un reporte y luego cambiar el reporte dejaría
   * marcado como verificado algo que nadie revisó.
   */
  const handleFile = async (file) => {
    setImageUrl(URL.createObjectURL(file));
    setVerifiedBlocks({});
    setVerifiedFields({});
    setError(null);
    setStatus("reading");
    try {
      const data = await extractFromFile(file);
      setExtraction(data);
      setStatus("done");
    } catch (e) {
      setError(`${e.message} Puede transcribir los valores a mano sobre el reporte cargado.`);
      setStatus("error");
    }
  };

  const analysis = useMemo(() => analyzeDxa(extraction, ctx), [extraction, ctx]);

  const suspect = (path) => extraction.lowConfidenceFields.includes(path);

  const setPatient = (k, v) =>
    setExtraction((e) => ({ ...e, patient: { ...e.patient, [k]: v === "" ? null : isNaN(Number(v)) ? v : Number(v) } }));
  const setStudy = (k, v) =>
    setExtraction((e) => ({ ...e, study: { ...e.study, [k]: v === "" ? null : v } }));

  const setMeasurement = (site, k, v) =>
    setExtraction((e) => ({
      ...e,
      measurements: e.measurements.map((m) =>
        m.site === site ? { ...m, [k]: v === "" ? null : Number(v) } : m),
    }));

  const toggleArtifact = (site, note) =>
    setExtraction((e) => ({
      ...e,
      measurements: e.measurements.map((m) =>
        m.site === site
          ? { ...m, artifact: note !== "", artifactNote: note === "" ? null : note }
          : m),
    }));

  const allSuspectResolved = extraction.lowConfidenceFields.every((f) => verifiedFields[f]);
  const allBlocksVerified = BLOCKS.every((b) => verifiedBlocks[b.id]);
  const gateOpen = allBlocksVerified && allSuspectResolved;
  const doneCount = BLOCKS.filter((b) => verifiedBlocks[b.id]).length;

  const criticals = analysis.findings.filter((f) => f.severity === "critical");
  const warnings = analysis.findings.filter((f) => f.severity === "warning");

  const measure = (s) => extraction.measurements.find((m) => m.site === s);

  const BlockHeader = ({ id, label, children, hideLabel = false }) => (
    <div className="flex items-center justify-between pt-6 pb-2">
      <h3 className={`text-base font-medium text-slate-900 ${hideLabel ? "sr-only" : ""}`}>{label}</h3>
      <div className="flex items-center gap-2">
        {children}
        <button
          onClick={() => setVerifiedBlocks((v) => ({ ...v, [id]: !v[id] }))}
          className={`text-xs px-3 py-1.5 rounded border ${
            verifiedBlocks[id]
              ? "border-emerald-700 bg-emerald-700 text-white"
              : "border-slate-400 text-slate-700 hover:bg-slate-100"
          }`}
        >
          {verifiedBlocks[id] ? "Verificado" : "Confirmar bloque"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* barra de estado */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-300">
        <div className="max-w-6xl mx-auto px-5 py-3 flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <div className="text-sm font-medium">Verificación del reporte</div>
            <div className="text-xs text-slate-600">
              {extraction.patient.name} · {extraction.patient.age} años ·{" "}
              {extraction.patient.sex === "F" ? "mujer" : "hombre"} · {extraction.study.manufacturer} {extraction.study.model}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {BLOCKS.map((b) => (
              <span key={b.id} title={b.label}
                className={`h-1.5 w-8 rounded-full ${verifiedBlocks[b.id] ? "bg-emerald-600" : "bg-slate-300"}`} />
            ))}
            <span className="text-xs tabular-nums text-slate-600 ml-1">{doneCount}/{BLOCKS.length}</span>
          </div>
          <button
            disabled={!gateOpen}
            className={`text-sm px-4 py-2 rounded ${
              gateOpen
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            Generar informes
          </button>
        </div>
        {!gateOpen && (
          <div className="bg-amber-50 border-t border-amber-300 px-5 py-1.5 text-xs text-amber-900">
            {!allSuspectResolved
              ? "Hay campos que el lector marcó como dudosos. Revíselos contra la imagen antes de continuar."
              : "Confirme todos los bloques para habilitar los informes."}
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-5 pb-16 grid lg:grid-cols-2 gap-8">
        {/* columna izquierda: imagen */}
        <div className="lg:sticky lg:top-28 lg:self-start pt-6">
          <ReportPane imageUrl={imageUrl} onPick={handleFile} zoom={zoom} setZoom={setZoom}
            status={status} error={error} onRetryManual={() => { setError(null); setStatus("idle"); }} />

          {/* resultado en vivo */}
          <section className="mt-5 border border-slate-300">
            <div className="px-4 py-2 border-b border-slate-300 bg-slate-50 text-sm font-medium">
              Análisis en vivo
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-600">Clasificación</div>
              <div className="text-lg font-medium">{CATEGORY_LABEL[analysis.diagnosis.category]}</div>
              <div className="text-sm text-slate-700 mt-1">
                {analysis.diagnosis.decidingSite
                  ? <>Determinado por {SITE_LABEL[analysis.diagnosis.decidingSite].toLowerCase()},{" "}
                      {analysis.diagnosis.scoreUsed}-score{" "}
                      <span className="tabular-nums font-medium">{fmt(analysis.diagnosis.decidingValue)}</span></>
                  : "Sin sitio válido para clasificar."}
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="text-xs text-slate-600">Estratificación</div>
                <div className="font-medium">{TIER_LABEL[analysis.risk.tier]}</div>
                <ul className="mt-1 text-sm text-slate-700 list-disc pl-4">
                  {analysis.risk.drivers.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>

              {analysis.lumbar.excludedVertebrae.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200 text-sm">
                  <div className="text-xs text-slate-600">Vértebras excluidas</div>
                  {analysis.lumbar.excludedVertebrae.map((e) => (
                    <div key={e.site} className="mt-1">
                      <span className="font-medium">{e.site}</span>{" "}
                      <span className="text-slate-700">— {e.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* hallazgos */}
          {(criticals.length > 0 || warnings.length > 0) && (
            <section className="mt-5 space-y-2">
              {criticals.map((f) => (
                <div key={f.code} className="border-l-2 border-red-700 bg-red-50 px-3 py-2">
                  <div className="text-sm text-red-900">{f.message}</div>
                  <div className="text-xs text-red-800 mt-1">{f.source}</div>
                </div>
              ))}
              {warnings.map((f) => (
                <div key={f.code} className="border-l-2 border-amber-600 bg-amber-50 px-3 py-2">
                  <div className="text-sm text-amber-900">{f.message}</div>
                  <div className="text-xs text-amber-800 mt-1">{f.source}</div>
                </div>
              ))}
            </section>
          )}
        </div>

        {/* columna derecha: campos */}
        <div>
          <BlockHeader id="paciente" label="Datos del paciente" />
          <Field label="Nombre" value={extraction.patient.name} numeric={false}
            onChange={(v) => setPatient("name", v)} />
          <Field label="Documento" value={extraction.patient.documentId} numeric={false}
            suspect={suspect("patient.documentId")} verified={verifiedFields["patient.documentId"]}
            onVerify={() => setVerifiedFields((f) => ({ ...f, "patient.documentId": true }))}
            onChange={(v) => setPatient("documentId", v)} />
          <Field label="Edad" value={extraction.patient.age} unit="años"
            onChange={(v) => setPatient("age", v)} />
          <Field label="Peso" value={extraction.patient.weightKg} unit="kg"
            onChange={(v) => setPatient("weightKg", v)} />
          <Field label="Talla" value={extraction.patient.heightCm} unit="cm"
            onChange={(v) => setPatient("heightCm", v)} />

          <BlockHeader id="estudio" label="Datos del estudio" />
          <Field label="Fecha" value={extraction.study.date} numeric={false}
            onChange={(v) => setStudy("date", v)} />
          <Field label="Equipo" value={extraction.study.manufacturer} numeric={false}
            onChange={(v) => setStudy("manufacturer", v)} />
          <Field label="Modelo" value={extraction.study.model} numeric={false}
            onChange={(v) => setStudy("model", v)} />
          <Field label="Base de referencia" value={extraction.study.referenceDatabase} numeric={false}
            onChange={(v) => setStudy("referenceDatabase", v)} />

          <BlockHeader id="lumbar" label="Columna lumbar" />
          <p className="text-sm text-slate-600 -mt-1 mb-2">
            Marque sobre la imagen qué vértebras tienen artefacto o alteración estructural.
            Es el dato que el lector automático no puede aportar y el que más cambia el resultado.
          </p>
          <div className="border border-slate-300">
            <div className="grid grid-cols-[3rem_1fr_1fr_1fr] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-300 text-xs text-slate-600">
              <span>Sitio</span><span>DMO g/cm²</span><span>T-score</span><span>Z-score</span>
            </div>
            {VERTEBRAE.map((v) => {
              const m = measure(v);
              if (!m) return null;
              const excluded = analysis.lumbar.excludedVertebrae.some((e) => e.site === v);
              const path = `measurements[${extraction.measurements.findIndex((x) => x.site === v)}].tScore`;
              return (
                <div key={v} className={`border-b border-slate-200 ${excluded ? "bg-slate-100" : ""}`}>
                  <div className="grid grid-cols-[3rem_1fr_1fr_1fr] gap-2 px-3 py-2 items-center">
                    <span className={`text-sm font-medium ${excluded ? "text-slate-500 line-through" : ""}`}>{v}</span>
                    <input value={m.bmd ?? ""} onChange={(e) => setMeasurement(v, "bmd", e.target.value)}
                      className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
                    <input value={m.tScore ?? ""} onChange={(e) => setMeasurement(v, "tScore", e.target.value)}
                      className={`bg-transparent tabular-nums text-sm font-medium outline-none border-b focus:border-sky-600 ${
                        suspect(path) && !verifiedFields[path] ? "border-amber-400" : "border-transparent"}`} />
                    <input value={m.zScore ?? ""} onChange={(e) => setMeasurement(v, "zScore", e.target.value)}
                      className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
                  </div>
                  <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
                    <select
                      value={m.artifactNote ?? ""}
                      onChange={(e) => toggleArtifact(v, e.target.value)}
                      className="text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700 max-w-full"
                    >
                      <option value="">Sin artefacto</option>
                      {ARTIFACT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {suspect(path) && (
                      <button onClick={() => setVerifiedFields((f) => ({ ...f, [path]: true }))}
                        className={`text-xs px-2 py-1 rounded border ${
                          verifiedFields[path]
                            ? "border-emerald-700 text-emerald-800 bg-emerald-50"
                            : "border-amber-500 text-amber-800 bg-amber-50 hover:bg-amber-100"}`}>
                        {verifiedFields[path] ? "T-score confirmado" : "T-score dudoso — confirmar"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-[3rem_1fr_1fr_1fr] gap-2 px-3 py-2 items-center bg-slate-50">
              <span className="text-xs text-slate-600">{measure("columna_lumbar")?.range ?? "L1-L4"}</span>
              <span className="tabular-nums text-sm">{fmt(measure("columna_lumbar")?.bmd, 3)}</span>
              <span className="tabular-nums text-sm font-medium">{fmt(measure("columna_lumbar")?.tScore)}</span>
              <span className="tabular-nums text-sm">{fmt(measure("columna_lumbar")?.zScore)}</span>
            </div>
          </div>
          {analysis.lumbar.requiresReanalysis && (
            <p className="mt-2 text-sm text-amber-900 bg-amber-50 border-l-2 border-amber-600 px-3 py-2">
              El agregado impreso ya no corresponde a las vértebras incluidas. Solicite el recálculo sobre{" "}
              {analysis.lumbar.includedVertebrae.join("-")} en la estación del densitómetro; la herramienta no lo estima.
            </p>
          )}

          <BlockHeader id="femur" label="Fémur" />
          {["cuello_femoral", "cadera_total"].map((s) => {
            const m = measure(s);
            if (!m) return null;
            return (
              <div key={s} className="grid grid-cols-[10rem_1fr_1fr_1fr] gap-2 py-2 border-b border-slate-200 items-center">
                <span className="text-sm text-slate-600">{SITE_LABEL[s]}</span>
                <input value={m.bmd ?? ""} onChange={(e) => setMeasurement(s, "bmd", e.target.value)}
                  className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
                <input value={m.tScore ?? ""} onChange={(e) => setMeasurement(s, "tScore", e.target.value)}
                  className="bg-transparent tabular-nums text-sm font-medium outline-none border-b border-transparent focus:border-sky-600" />
                <input value={m.zScore ?? ""} onChange={(e) => setMeasurement(s, "zScore", e.target.value)}
                  className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
              </div>
            );
          })}

          <BlockHeader id="otros" label="Otros sitios" />
          <p className="text-sm text-slate-600 -mt-1 mb-2">
            Trocánter, Ward, radio ultradistal y cuerpo total se transcriben pero no se usan para clasificar.
          </p>
          {extraction.measurements
            .filter((m) => ["trocanter", "ward", "radio_ultradistal", "radio_33", "cuerpo_total"].includes(m.site))
            .map((m) => (
              <div key={m.site} className="grid grid-cols-[10rem_1fr_1fr_1fr] gap-2 py-2 border-b border-slate-200 items-center">
                <span className="text-sm text-slate-600">{SITE_LABEL[m.site]}</span>
                <input value={m.bmd ?? ""} onChange={(e) => setMeasurement(m.site, "bmd", e.target.value)}
                  className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
                <input value={m.tScore ?? ""} onChange={(e) => setMeasurement(m.site, "tScore", e.target.value)}
                  className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
                <input value={m.zScore ?? ""} onChange={(e) => setMeasurement(m.site, "zScore", e.target.value)}
                  className="bg-transparent tabular-nums text-sm outline-none border-b border-transparent focus:border-sky-600" />
              </div>
            ))}

          <BlockHeader id="clinico" label="Contexto clínico" hideLabel />
          <ClinicalContextPanel ctx={ctx} setCtx={setCtx} sex={extraction.patient.sex} />

          <div className="mt-6 pt-4 border-t border-slate-300">
            <div className="text-xs text-slate-600">Conclusión impresa en el reporte original</div>
            <p className="text-sm text-slate-800 mt-1">{extraction.reportImpression ?? "—"}</p>
          </div>

          <p className="mt-8 text-xs text-slate-500 leading-relaxed">
            Herramienta de apoyo a la decisión clínica. No reemplaza el juicio médico ni la lectura del
            densitometrista. La verificación de los datos extraídos es obligatoria.
          </p>
        </div>
      </main>
    </div>
  );
}
