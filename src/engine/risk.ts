import type { ClinicalContext, DiagnosisResult, Finding, RiskTier } from "../types.ts";

/**
 * Umbrales de intervención por FRAX.
 *
 * PENDIENTE DE CALIBRACIÓN: la GPC colombiana 2026 define umbrales de evaluación
 * e intervención dependientes de la edad (figura 1 de la guía). Esta tabla debe
 * cargarse desde la guía antes del uso clínico. Hasta entonces el motor NO
 * clasifica por FRAX salvo con los cortes de "muy alto riesgo" de AACE, que sí
 * son valores fijos publicados.
 */
export interface FraxThresholdTable {
  /** Umbral de intervención para fractura osteoporótica mayor, por edad. */
  majorByAge: Array<{ ageFrom: number; ageTo: number; thresholdPct: number }>;
  hipThresholdPct: number;
  source: string;
}

export const COLOMBIA_THRESHOLDS_PLACEHOLDER: FraxThresholdTable | null = null;

/** Cortes fijos de muy alto riesgo (AACE/ACE 2020). */
const VERY_HIGH_FRAX_MAJOR = 30;
const VERY_HIGH_FRAX_HIP = 4.5;

export function stratifyRisk(
  diagnosis: DiagnosisResult,
  ctx: ClinicalContext,
  age: number | null,
  thresholds: FraxThresholdTable | null = COLOMBIA_THRESHOLDS_PLACEHOLDER,
): { tier: RiskTier; drivers: string[]; findings: Finding[] } {
  const drivers: string[] = [];
  const findings: Finding[] = [];
  const fx = ctx.fragilityFracture;
  const t = diagnosis.scoreUsed === "T" ? diagnosis.decidingValue : null;

  // ---- Muy alto riesgo ----
  if (fx.present && fx.monthsSinceMostRecent !== null && fx.monthsSinceMostRecent < 12) {
    drivers.push("Fractura por fragilidad en los últimos 12 meses (riesgo inminente)");
  }
  if (fx.whileOnTherapy) {
    drivers.push("Fractura ocurrida durante tratamiento antiosteoporótico");
  }
  if (fx.count >= 2) {
    drivers.push("Múltiples fracturas por fragilidad");
  }
  if (fx.present && ctx.glucocorticoids.current) {
    drivers.push("Fractura en paciente con glucocorticoides sistémicos");
  }
  if (t !== null && t <= -3.0) {
    drivers.push(`T-score ≤ -3.0 (${t.toFixed(1)})`);
  }
  if (ctx.fallsLastYear !== null && ctx.fallsLastYear >= 2) {
    drivers.push("Caídas de repetición en el último año");
  }
  if (ctx.frax?.majorOsteoporoticPct != null && ctx.frax.majorOsteoporoticPct > VERY_HIGH_FRAX_MAJOR) {
    drivers.push(`FRAX fractura mayor ${ctx.frax.majorOsteoporoticPct}% (> ${VERY_HIGH_FRAX_MAJOR}%)`);
  }
  if (ctx.frax?.hipPct != null && ctx.frax.hipPct > VERY_HIGH_FRAX_HIP) {
    drivers.push(`FRAX cadera ${ctx.frax.hipPct}% (> ${VERY_HIGH_FRAX_HIP}%)`);
  }

  const veryHigh = drivers.length > 0;
  if (veryHigh) {
    return { tier: "muy_alto", drivers, findings };
  }

  // ---- Alto riesgo ----
  if (diagnosis.category === "osteoporosis" || diagnosis.category === "osteoporosis_clinica") {
    drivers.push(
      diagnosis.category === "osteoporosis_clinica"
        ? "Fractura por fragilidad de cadera o vértebra"
        : `Osteoporosis densitométrica (T-score ${t?.toFixed(1) ?? "n/d"})`,
    );
    return { tier: "alto", drivers, findings };
  }
  if (fx.present) {
    drivers.push("Fractura por fragilidad previa en sitio no central");
    return { tier: "alto", drivers, findings };
  }
  if (
    ctx.glucocorticoids.current &&
    (ctx.glucocorticoids.prednisoloneEqMgDay ?? 0) >= 7.5 &&
    (ctx.glucocorticoids.monthsOfUse ?? 0) >= 3
  ) {
    drivers.push("Glucocorticoides ≥7.5 mg/día de prednisolona por ≥3 meses");
    return { tier: "alto", drivers, findings };
  }

  // ---- FRAX contra umbral poblacional ----
  if (ctx.frax?.majorOsteoporoticPct != null) {
    if (thresholds === null) {
      findings.push({
        code: "RISK_THRESHOLDS_NOT_LOADED",
        severity: "warning",
        message:
          "No se han cargado los umbrales de intervención de la GPC colombiana. El FRAX ingresado no se pudo comparar automáticamente; ubique el valor manualmente en el nomograma de la guía.",
        source: "GPC osteoporosis Colombia 2026, figura 1",
      });
      return { tier: "indeterminado", drivers, findings };
    }
    const band = thresholds.majorByAge.find(
      (b) => age === null || (age >= b.ageFrom && age <= b.ageTo),
    );
    if (band && ctx.frax.majorOsteoporoticPct >= band.thresholdPct) {
      drivers.push(
        `FRAX fractura mayor ${ctx.frax.majorOsteoporoticPct}% por encima del umbral de intervención colombiano (${band.thresholdPct}%)`,
      );
      return { tier: "alto", drivers, findings };
    }
  } else if (
    diagnosis.category === "masa_osea_baja" ||
    diagnosis.category === "por_debajo_esperado_para_edad"
  ) {
    findings.push({
      code: "RISK_FRAX_MISSING",
      severity: "warning",
      message:
        "Masa ósea baja sin FRAX. La decisión terapéutica en este rango depende del riesgo absoluto: calcule FRAX en la herramienta oficial (modelo Colombia), preferiblemente con el T-score de cuello femoral, e ingréselo.",
      source: "GPC osteoporosis Colombia 2026 — puntos de buena práctica 3 y 4",
    });
    return { tier: "indeterminado", drivers, findings };
  }

  drivers.push("Sin criterios de alto riesgo identificados");
  return { tier: "bajo_moderado", drivers, findings };
}
