import type {
  ClinicalContext,
  DiagnosisResult,
  DxaAnalysis,
  DxaExtraction,
  Finding,
  RiskTier,
  SiteId,
} from "../types.ts";

/**
 * Seguimiento densitométrico.
 *
 * Principio no negociable: sin el LSC (Least Significant Change) propio de la
 * unidad, obtenido de un estudio de precisión, NINGÚN cambio entre estudios es
 * interpretable. La herramienta prefiere decir "no interpretable" a producir un
 * porcentaje que parezca informativo y no lo sea.
 */
export function evaluateMonitoring(
  extraction: DxaExtraction,
  ctx: ClinicalContext,
  tier: RiskTier,
): { monitoring: DxaAnalysis["monitoring"]; findings: Finding[] } {
  const findings: Finding[] = [];
  const siteChanges: DxaAnalysis["monitoring"]["siteChanges"] = [];

  const prior = extraction.priorStudy;
  let comparisonInterpretable = false;
  let comparisonNote = "No hay estudio previo disponible para comparación.";

  if (prior && prior.measurements.length > 0) {
    if (prior.sameScanner === false) {
      comparisonNote =
        "El estudio previo se realizó en un equipo diferente. La comparación directa no es válida sin calibración cruzada entre equipos; interprete solo como tendencia clínica.";
      findings.push({
        code: "MON_DIFFERENT_SCANNER",
        severity: "warning",
        message: comparisonNote,
        source: "ISCD — comparación seriada en el mismo densitómetro",
      });
    } else if (!ctx.lscBySite || Object.keys(ctx.lscBySite).length === 0) {
      comparisonNote =
        "No se ha registrado el LSC de la unidad. El cambio entre estudios NO es interpretable: cualquier diferencia puede corresponder a error de precisión. Realice un estudio de precisión in situ y cargue el LSC por sitio.";
      findings.push({
        code: "MON_NO_LSC",
        severity: "critical",
        message: comparisonNote,
        source: "ISCD — solo se reporta como significativo el cambio que supera el LSC",
      });
    } else {
      comparisonInterpretable = true;
      for (const cur of extraction.measurements) {
        const prev = prior.measurements.find((p) => p.site === cur.site);
        const lsc = ctx.lscBySite[cur.site as SiteId];
        if (!prev || cur.bmd === null || prev.bmd === null || lsc === undefined) continue;
        const delta = Number((cur.bmd - prev.bmd).toFixed(4));
        siteChanges.push({
          site: cur.site,
          deltaBmd: delta,
          lsc,
          significant: Math.abs(delta) >= lsc,
        });
      }
      const anySignificantLoss = siteChanges.some((c) => c.significant && c.deltaBmd < 0);
      comparisonNote = anySignificantLoss
        ? "Se documenta pérdida significativa de densidad mineral ósea (cambio superior al LSC). Verifique adherencia, absorción, aporte de calcio y vitamina D, y descarte causa secundaria antes de cambiar el fármaco."
        : "Los cambios observados no superan el LSC de la unidad; se consideran estables.";
      if (anySignificantLoss) {
        findings.push({
          code: "MON_SIGNIFICANT_LOSS",
          severity: "warning",
          message: comparisonNote,
          source: "ISCD — seguimiento de DMO",
        });
      }
    }
  }

  let suggestedIntervalMonths: number | null;
  if (ctx.currentTherapy !== "ninguna" || tier === "muy_alto" || tier === "alto") {
    suggestedIntervalMonths = 12;
  } else if (tier === "bajo_moderado") {
    suggestedIntervalMonths = 24;
  } else {
    suggestedIntervalMonths = null;
  }

  findings.push({
    code: "MON_SAME_SCANNER",
    severity: "info",
    message:
      "El control debe realizarse en el mismo equipo y con la misma técnica de posicionamiento para que la comparación sea válida.",
    source: "ISCD — seguimiento de DMO",
  });

  return {
    monitoring: { suggestedIntervalMonths, comparisonInterpretable, comparisonNote, siteChanges },
    findings,
  };
}

/**
 * Estudio de causas secundarias. Se indica ante Z-score bajo, osteoporosis en
 * varones o mujeres premenopáusicas, fractura desproporcionada al T-score, o
 * pérdida bajo tratamiento.
 */
export function secondaryWorkup(
  diagnosis: DiagnosisResult,
  extraction: DxaExtraction,
  ctx: ClinicalContext,
): DxaAnalysis["secondaryWorkup"] {
  const reasons: string[] = [];
  const age = extraction.patient.age;
  const sex = extraction.patient.sex;

  if (diagnosis.category === "por_debajo_esperado_para_edad") {
    reasons.push("Z-score ≤ -2.0");
  }
  if (sex === "M" && (diagnosis.category === "osteoporosis" || diagnosis.category === "osteoporosis_clinica")) {
    reasons.push("Osteoporosis en varón");
  }
  if (sex === "F" && age !== null && age < 50 && diagnosis.category !== "normal") {
    reasons.push("Baja masa ósea en mujer menor de 50 años");
  }
  if (ctx.fragilityFracture.whileOnTherapy) {
    reasons.push("Fractura durante tratamiento");
  }
  if (ctx.glucocorticoids.current) {
    reasons.push("Uso actual de glucocorticoides");
  }

  const panel = [
    "Hemograma completo",
    "Calcio sérico y albúmina (calcio corregido), fósforo",
    "Creatinina con tasa de filtración glomerular estimada",
    "Fosfatasa alcalina",
    "25-OH vitamina D",
    "Hormona paratiroidea intacta",
    "TSH",
    "Calcio en orina de 24 horas con creatinuria",
    "Testosterona total en varones",
    "Electroforesis de proteínas séricas si hay sospecha de gammapatía",
    "Anticuerpos de enfermedad celíaca si hay sospecha clínica",
    "Tamizaje de hipercortisolismo si hay rasgos clínicos sugestivos",
  ];

  return {
    indicated: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    panel,
  };
}
