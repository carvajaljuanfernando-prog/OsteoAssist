import type { ClinicalContext, DxaAnalysis, DxaExtraction, Finding } from "../types.ts";
import { validateLumbarSpine } from "./lumbar.ts";
import { classify } from "./diagnosis.ts";
import { stratifyRisk, type FraxThresholdTable } from "./risk.ts";
import { recommendTreatment } from "./treatment.ts";
import { evaluateMonitoring, secondaryWorkup } from "./monitoring.ts";

export * from "./lumbar.ts";
export * from "./diagnosis.ts";
export * from "./risk.ts";
export * from "./treatment.ts";
export * from "./monitoring.ts";

/**
 * Punto de entrada del motor. Determinista: el mismo par (extraction, ctx)
 * produce siempre exactamente la misma salida. Ningún LLM participa aquí.
 */
export function analyzeDxa(
  extraction: DxaExtraction,
  ctx: ClinicalContext,
  thresholds: FraxThresholdTable | null = null,
): DxaAnalysis {
  const findings: Finding[] = [];

  const lumbar = validateLumbarSpine(extraction);
  findings.push(...lumbar.findings);

  const { diagnosis, findings: dxFindings } = classify(extraction, ctx, lumbar);
  findings.push(...dxFindings);

  const risk = stratifyRisk(diagnosis, ctx, extraction.patient.age, thresholds);
  findings.push(...risk.findings);

  const { treatment, findings: txFindings } = recommendTreatment(risk.tier, diagnosis, ctx);
  findings.push(...txFindings);

  const { monitoring, findings: monFindings } = evaluateMonitoring(extraction, ctx, risk.tier);
  findings.push(...monFindings);

  const workup = secondaryWorkup(diagnosis, extraction, ctx);

  if (extraction.lowConfidenceFields.length > 0) {
    findings.push({
      code: "EXT_LOW_CONFIDENCE",
      severity: "critical",
      message: `Campos de lectura dudosa que requieren verificación manual: ${extraction.lowConfidenceFields.join(", ")}.`,
      source: "Extracción por visión",
    });
  }

  const requiresPhysicianReview = findings.some((f) => f.severity === "critical");

  return {
    lumbar: {
      usable: lumbar.usable,
      unverified: lumbar.unverified,
      includedVertebrae: lumbar.includedVertebrae,
      excludedVertebrae: lumbar.excludedVertebrae,
      requiresReanalysis: lumbar.requiresReanalysis,
      meanTScoreOfIncluded: lumbar.meanTScoreOfIncluded,
    },
    diagnosis,
    risk: { tier: risk.tier, drivers: risk.drivers },
    treatment,
    secondaryWorkup: workup,
    monitoring,
    findings,
    requiresPhysicianReview,
  };
}
