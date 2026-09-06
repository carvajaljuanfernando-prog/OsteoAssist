import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDxa } from "../src/engine/index.ts";
import { validateLumbarSpine } from "../src/engine/lumbar.ts";
import type { ClinicalContext, DxaExtraction, SiteMeasurement } from "../src/types.ts";

function site(s: SiteMeasurement["site"], bmd: number | null, t: number | null, z: number | null, artifact = false): SiteMeasurement {
  return { site: s, bmd, tScore: t, zScore: z, range: null, artifact, artifactNote: null };
}

function baseExtraction(measurements: SiteMeasurement[], patient: Partial<DxaExtraction["patient"]> = {}): DxaExtraction {
  return {
    patient: { name: "Prueba", documentId: null, birthDate: null, age: 68, sex: "F", weightKg: 62, heightCm: 156, ...patient },
    study: { date: "2026-07-01", manufacturer: "Hologic", model: "Horizon", facility: null, referenceDatabase: "NHANES" },
    measurements,
    tbs: null,
    vfa: null,
    priorStudy: null,
    reportImpression: null,
    lowConfidenceFields: [],
  };
}

function baseContext(overrides: Partial<ClinicalContext> = {}): ClinicalContext {
  return {
    menopausalStatus: "posmenopausica",
    fragilityFracture: { present: false, sites: [], monthsSinceMostRecent: null, whileOnTherapy: false, count: 0 },
    glucocorticoids: { current: false, prednisoloneEqMgDay: null, monthsOfUse: null },
    fallsLastYear: 0,
    eGFR: 85,
    serumCalciumCorrected: 9.4,
    vitaminD25OH: 38,
    recentMiOrStroke: false,
    upperGiContraindication: false,
    dentalEvaluationDone: true,
    currentTherapy: "ninguna",
    planningDiscontinuation: false,
    frax: null,
    lscBySite: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validación de columna lumbar
// ---------------------------------------------------------------------------

test("excluye la vértebra discordante por regla de >1.0 DE", () => {
  const ex = baseExtraction([
    site("L1", 0.79, -2.6, -0.9),
    site("L2", 0.81, -2.5, -0.8),
    site("L3", 1.05, -0.6, 1.1), // artrosis: elevada de forma espuria
    site("L4", 0.80, -2.5, -0.8),
  ]);
  const r = validateLumbarSpine(ex);
  assert.deepEqual(r.includedVertebrae, ["L1", "L2", "L4"]);
  assert.equal(r.excludedVertebrae[0].site, "L3");
  assert.equal(r.requiresReanalysis, true);
  assert.equal(r.usable, true);
});

test("columna no diagnóstica cuando queda una sola vértebra evaluable", () => {
  const ex = baseExtraction([
    site("L1", 0.70, -3.4, -1.5, true),
    site("L2", 0.72, -3.2, -1.4, true),
    site("L3", 0.74, -3.0, -1.3, true),
    site("L4", 0.75, -2.9, -1.2),
  ]);
  const r = validateLumbarSpine(ex);
  assert.equal(r.usable, false);
  assert.ok(r.findings.some((f) => f.code === "LUM_NOT_DIAGNOSTIC" && f.severity === "critical"));
});

test("detecta discordancia lumbar-femoral sospechosa de artrosis", () => {
  const ex = baseExtraction([
    site("columna_lumbar", 1.10, 0.4, 1.6),
    site("cuello_femoral", 0.58, -2.7, -0.7),
  ]);
  const r = validateLumbarSpine(ex);
  assert.ok(r.findings.some((f) => f.code === "LUM_DISCORDANCE_SUSPECT"));
});

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

test("diagnostica con el sitio más bajo, no con el promedio", () => {
  const ex = baseExtraction([
    site("columna_lumbar", 0.95, -1.2, 0.3),
    site("cuello_femoral", 0.60, -2.6, -0.6),
    site("cadera_total", 0.72, -2.0, -0.2),
  ]);
  const a = analyzeDxa(ex, baseContext());
  assert.equal(a.diagnosis.category, "osteoporosis");
  assert.equal(a.diagnosis.decidingSite, "cuello_femoral");
});

test("ignora trocánter y triángulo de Ward para el diagnóstico", () => {
  const ex = baseExtraction([
    site("cuello_femoral", 0.68, -1.8, 0.1),
    site("ward", 0.42, -3.6, -1.4),
    site("trocanter", 0.55, -2.9, -1.0),
  ]);
  const a = analyzeDxa(ex, baseContext());
  assert.equal(a.diagnosis.category, "masa_osea_baja");
  assert.equal(a.diagnosis.decidingSite, "cuello_femoral");
  assert.ok(a.diagnosis.excludedSites.some((e) => e.site === "ward"));
});

test("usa Z-score en mujer premenopáusica y no rotula osteoporosis", () => {
  const ex = baseExtraction(
    [site("columna_lumbar", 0.78, -2.8, -2.4), site("cuello_femoral", 0.66, -2.1, -1.9)],
    { age: 34 },
  );
  const a = analyzeDxa(ex, baseContext({ menopausalStatus: "premenopausica" }));
  assert.equal(a.diagnosis.scoreUsed, "Z");
  assert.equal(a.diagnosis.category, "por_debajo_esperado_para_edad");
  assert.ok(a.findings.some((f) => f.code === "DX_NO_OSTEOPOROSIS_LABEL"));
  assert.equal(a.secondaryWorkup.indicated, true);
});

test("fractura vertebral por fragilidad define osteoporosis clínica con T-score normal", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.78, -0.4, 0.9), site("cadera_total", 0.92, -0.2, 1.0)]);
  const a = analyzeDxa(
    ex,
    baseContext({
      fragilityFracture: { present: true, sites: ["vertebral"], monthsSinceMostRecent: 30, whileOnTherapy: false, count: 1 },
    }),
  );
  assert.equal(a.diagnosis.category, "osteoporosis_clinica");
  assert.equal(a.risk.tier, "alto");
});

// ---------------------------------------------------------------------------
// Riesgo y tratamiento
// ---------------------------------------------------------------------------

test("fractura reciente clasifica como muy alto riesgo y sugiere osteoformador", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.55, -2.8, -1.1)]);
  const a = analyzeDxa(
    ex,
    baseContext({
      fragilityFracture: { present: true, sites: ["cadera"], monthsSinceMostRecent: 4, whileOnTherapy: false, count: 1 },
    }),
  );
  assert.equal(a.risk.tier, "muy_alto");
  assert.ok(a.treatment.firstLine.join(" ").toLowerCase().includes("osteoformador"));
  assert.ok(a.treatment.sequencing.some((s) => s.includes("antirresortivo")));
});

test("bifosfonato es primera línea en alto riesgo", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.58, -2.6, -0.8)]);
  const a = analyzeDxa(ex, baseContext());
  assert.equal(a.risk.tier, "alto");
  assert.ok(a.treatment.firstLine.join(" ").toLowerCase().includes("bifosfonato"));
});

test("depuración <35 bloquea bifosfonatos y no los ofrece", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.58, -2.6, -0.8)]);
  const a = analyzeDxa(ex, baseContext({ eGFR: 24 }));
  assert.ok(a.treatment.blockers.some((b) => b.code === "TX_BLOCK_BISPHOSPHONATE_CKD"));
  assert.equal(a.treatment.firstLine.join(" ").toLowerCase().includes("bifosfonato"), false);
});

test("romosozumab se retira tras evento cardiovascular reciente", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.48, -3.4, -1.6)]);
  const a = analyzeDxa(ex, baseContext({ recentMiOrStroke: true }));
  assert.equal(a.risk.tier, "muy_alto");
  assert.ok(a.treatment.blockers.some((b) => b.code === "TX_BLOCK_ROMOSOZUMAB_CV"));
});

test("suspensión de denosumab dispara alerta crítica", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.62, -2.3, -0.5)]);
  const a = analyzeDxa(ex, baseContext({ currentTherapy: "denosumab", planningDiscontinuation: true }));
  const alert = a.treatment.blockers.find((b) => b.code === "TX_DENOSUMAB_DISCONTINUATION");
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.equal(a.requiresPhysicianReview, true);
});

test("vitamina D baja exige repleción antes del antirresortivo", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.58, -2.6, -0.8)]);
  const a = analyzeDxa(ex, baseContext({ vitaminD25OH: 14 }));
  assert.ok(a.findings.some((f) => f.code === "TX_VITD_DEFICIENT" && f.severity === "critical"));
  assert.ok(a.treatment.prerequisites.some((p) => p.includes("vitamina D")));
});

// ---------------------------------------------------------------------------
// Seguimiento
// ---------------------------------------------------------------------------

test("sin LSC el cambio entre estudios no es interpretable", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.62, -2.3, -0.5)]);
  ex.priorStudy = { date: "2024-06-01", sameScanner: true, measurements: [site("cuello_femoral", 0.66, -2.0, -0.3)] };
  const a = analyzeDxa(ex, baseContext());
  assert.equal(a.monitoring.comparisonInterpretable, false);
  assert.ok(a.findings.some((f) => f.code === "MON_NO_LSC" && f.severity === "critical"));
});

test("con LSC identifica pérdida significativa", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.60, -2.5, -0.7)]);
  ex.priorStudy = { date: "2024-06-01", sameScanner: true, measurements: [site("cuello_femoral", 0.66, -2.0, -0.3)] };
  const a = analyzeDxa(ex, baseContext({ lscBySite: { cuello_femoral: 0.03 } }));
  assert.equal(a.monitoring.comparisonInterpretable, true);
  assert.equal(a.monitoring.siteChanges[0].significant, true);
  assert.ok(a.findings.some((f) => f.code === "MON_SIGNIFICANT_LOSS"));
});

test("cambio por debajo del LSC se reporta como estable", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.649, -2.1, -0.4)]);
  ex.priorStudy = { date: "2024-06-01", sameScanner: true, measurements: [site("cuello_femoral", 0.66, -2.0, -0.3)] };
  const a = analyzeDxa(ex, baseContext({ lscBySite: { cuello_femoral: 0.03 } }));
  assert.equal(a.monitoring.siteChanges[0].significant, false);
});

// ---------------------------------------------------------------------------
// Puertas de seguridad
// ---------------------------------------------------------------------------

test("campos de baja confianza bloquean la emisión automática", () => {
  const ex = baseExtraction([site("cuello_femoral", 0.58, -2.6, -0.8)]);
  ex.lowConfidenceFields = ["measurements[0].tScore"];
  const a = analyzeDxa(ex, baseContext());
  assert.equal(a.requiresPhysicianReview, true);
});

test("motor determinista: dos corridas idénticas producen el mismo resultado", () => {
  const ex = baseExtraction([site("columna_lumbar", 0.82, -2.2, -0.4), site("cuello_femoral", 0.58, -2.6, -0.8)]);
  const a = JSON.stringify(analyzeDxa(ex, baseContext()));
  const b = JSON.stringify(analyzeDxa(ex, baseContext()));
  assert.equal(a, b);
});

test("columna sin detalle vertebral se usa pero bloquea el informe automático", () => {
  const ex = baseExtraction([
    site("columna_lumbar", 0.80, -2.6, -0.6),
    site("cuello_femoral", 0.66, -2.0, -0.3),
  ]);
  const a = analyzeDxa(ex, baseContext());
  assert.equal(a.lumbar.unverified, true);
  assert.equal(a.diagnosis.decidingSite, "columna_lumbar");
  assert.equal(a.requiresPhysicianReview, true);
  assert.ok(a.findings.some((f) => f.code === "LUM_NO_VERTEBRAL_DATA" && f.severity === "critical"));
});
