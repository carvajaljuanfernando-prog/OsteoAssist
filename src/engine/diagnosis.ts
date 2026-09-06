import type {
  ClinicalContext,
  DiagnosisResult,
  DxaExtraction,
  Finding,
  SiteId,
} from "../types.ts";
import type { LumbarValidation } from "./lumbar.ts";

/** Sitios aceptados para diagnóstico densitométrico en adultos. */
const DIAGNOSTIC_SITES: SiteId[] = ["columna_lumbar", "cuello_femoral", "cadera_total", "radio_33"];

/** Sitios que el equipo imprime pero que NO se usan para diagnosticar. */
const NON_DIAGNOSTIC: SiteId[] = ["trocanter", "ward", "radio_ultradistal", "cuerpo_total"];

/**
 * ¿Se usa T-score o Z-score?
 * T-score: mujeres posmenopáusicas y hombres ≥50 años.
 * Z-score: mujeres premenopáusicas, hombres <50 años, población pediátrica.
 */
export function selectScore(
  age: number | null,
  sex: "F" | "M" | null,
  menopausalStatus: ClinicalContext["menopausalStatus"],
): "T" | "Z" | null {
  if (sex === null) return null;
  if (sex === "F") {
    if (menopausalStatus === "posmenopausica") return "T";
    if (menopausalStatus === "premenopausica" || menopausalStatus === "perimenopausica") return "Z";
    return age !== null && age >= 50 ? "T" : "Z";
  }
  if (age === null) return null;
  return age >= 50 ? "T" : "Z";
}

export function classify(
  extraction: DxaExtraction,
  ctx: ClinicalContext,
  lumbar: LumbarValidation,
): { diagnosis: DiagnosisResult; findings: Finding[] } {
  const findings: Finding[] = [];
  const scoreUsed = selectScore(extraction.patient.age, extraction.patient.sex, ctx.menopausalStatus);

  const excludedSites: Array<{ site: SiteId; reason: string }> = [];
  for (const m of extraction.measurements) {
    if (NON_DIAGNOSTIC.includes(m.site)) {
      excludedSites.push({
        site: m.site,
        reason: "Sitio no válido para el diagnóstico densitométrico",
      });
    }
  }

  const valid: Array<{ site: SiteId; tScore: number | null; zScore: number | null }> = [];
  for (const site of DIAGNOSTIC_SITES) {
    const m = extraction.measurements.find((x) => x.site === site);
    if (!m) continue;
    if (site === "columna_lumbar" && !lumbar.usable) {
      excludedSites.push({
        site,
        reason: "Columna lumbar no evaluable tras aplicar los criterios de exclusión de la ISCD",
      });
      continue;
    }
    if (site === "columna_lumbar" && lumbar.unverified) {
      valid.push({ site, tScore: m.tScore, zScore: m.zScore });
      continue;
    }
    if (site === "columna_lumbar" && lumbar.requiresReanalysis) {
      excludedSites.push({
        site,
        reason:
          "Valor agregado no válido hasta que se recalcule sobre las vértebras incluidas. Se excluye del diagnóstico automático.",
      });
      continue;
    }
    if (m.artifact) {
      excludedSites.push({ site, reason: `Artefacto: ${m.artifactNote ?? "señalado en el reporte"}` });
      continue;
    }
    valid.push({ site, tScore: m.tScore, zScore: m.zScore });
  }

  // Fractura por fragilidad de cadera o vértebra: diagnóstico clínico, sin importar el T-score.
  const clinicalFx =
    ctx.fragilityFracture.present &&
    ctx.fragilityFracture.sites.some((s) => s === "cadera" || s === "vertebral");

  if (scoreUsed === null) {
    findings.push({
      code: "DX_SCORE_UNDETERMINED",
      severity: "critical",
      message:
        "Faltan edad, sexo o estado menopáusico. No es posible decidir entre T-score y Z-score; complete estos campos antes de continuar.",
      source: "ISCD — selección del score de referencia",
    });
    return {
      diagnosis: {
        category: "no_clasificable",
        scoreUsed: "T",
        decidingSite: null,
        decidingValue: null,
        validSites: valid,
        excludedSites,
        narrative: "Clasificación no posible por datos demográficos incompletos.",
      },
      findings,
    };
  }

  const key = scoreUsed === "T" ? "tScore" : "zScore";
  const withValue = valid.filter((v) => v[key] !== null);

  if (withValue.length === 0) {
    findings.push({
      code: "DX_NO_VALID_SITE",
      severity: "critical",
      message:
        "Ningún sitio diagnóstico quedó disponible. Considere repetir el estudio o medir el radio 33% del antebrazo no dominante.",
      source: "ISCD — sitios diagnósticos válidos",
    });
  }

  // Se diagnostica con el valor MÁS BAJO entre los sitios válidos, no con el promedio.
  let decidingSite: SiteId | null = null;
  let decidingValue: number | null = null;
  for (const v of withValue) {
    const val = v[key]!;
    if (decidingValue === null || val < decidingValue) {
      decidingValue = val;
      decidingSite = v.site;
    }
  }

  let category: DiagnosisResult["category"] = "no_clasificable";
  let narrative = "";

  if (scoreUsed === "T") {
    if (clinicalFx) {
      category = "osteoporosis_clinica";
      narrative =
        "Osteoporosis establecida por fractura por fragilidad de cadera o vértebra, independientemente del valor de la densitometría.";
    } else if (decidingValue === null) {
      narrative = "Sin sitio válido para clasificar.";
    } else if (decidingValue <= -2.5) {
      category = "osteoporosis";
      narrative = `Osteoporosis densitométrica: T-score ${decidingValue.toFixed(1)} en ${labelOf(decidingSite!)}.`;
    } else if (decidingValue < -1.0) {
      category = "masa_osea_baja";
      narrative = `Masa ósea baja (osteopenia): T-score ${decidingValue.toFixed(1)} en ${labelOf(decidingSite!)}.`;
    } else {
      category = "normal";
      narrative = `Densidad mineral ósea normal: T-score ${decidingValue.toFixed(1)} en ${labelOf(decidingSite!)}.`;
    }

    if (category === "masa_osea_baja" || category === "normal") {
      findings.push({
        code: "DX_TSCORE_NOT_EXCLUSIONARY",
        severity: "info",
        message:
          "Un T-score por encima de -2.5 no descarta alto riesgo de fractura: la mayoría de las fracturas por fragilidad ocurren en rango de osteopenia. Evalúe el riesgo absoluto con FRAX.",
        source: "GPC osteoporosis Colombia 2026 / NOGG 2024",
      });
    }
  } else {
    if (decidingValue === null) {
      narrative = "Sin sitio válido para clasificar.";
    } else if (decidingValue <= -2.0) {
      category = "por_debajo_esperado_para_edad";
      narrative = `Z-score ${decidingValue.toFixed(1)} en ${labelOf(decidingSite!)}: por debajo del rango esperado para la edad.`;
      findings.push({
        code: "DX_Z_BELOW_EXPECTED",
        severity: "warning",
        message:
          "Z-score ≤ -2.0. Está indicado el estudio de causas secundarias de baja masa ósea antes de considerar cualquier tratamiento.",
        source: "ISCD — interpretación del Z-score",
      });
    } else {
      category = "dentro_de_lo_esperado_para_edad";
      narrative = `Z-score ${decidingValue.toFixed(1)} en ${labelOf(decidingSite!)}: dentro del rango esperado para la edad.`;
    }
    findings.push({
      code: "DX_NO_OSTEOPOROSIS_LABEL",
      severity: "info",
      message:
        "En mujeres premenopáusicas y hombres menores de 50 años no debe emitirse un diagnóstico de osteoporosis basado únicamente en la densitometría.",
      source: "ISCD — no usar criterios de la OMS en población joven",
    });

    if (clinicalFx) {
      category = "osteoporosis_clinica";
      narrative +=
        " Existe fractura por fragilidad, lo que configura enfermedad ósea clínica y obliga a estudio etiológico.";
    }
  }

  return {
    diagnosis: {
      category,
      scoreUsed,
      decidingSite,
      decidingValue,
      validSites: valid,
      excludedSites,
      narrative,
    },
    findings,
  };
}

function labelOf(site: SiteId): string {
  const map: Partial<Record<SiteId, string>> = {
    columna_lumbar: "columna lumbar",
    cuello_femoral: "cuello femoral",
    cadera_total: "cadera total",
    radio_33: "radio 33%",
  };
  return map[site] ?? site;
}
