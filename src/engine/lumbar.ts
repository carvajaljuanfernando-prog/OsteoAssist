import type { DxaExtraction, Finding, SiteId, SiteMeasurement } from "../types.ts";

const VERTEBRAE: SiteId[] = ["L1", "L2", "L3", "L4"];

export interface LumbarValidation {
  usable: boolean;
  /**
   * El reporte no discrimina L1-L4, por lo que no fue posible aplicar la regla
   * de exclusión. El valor agregado se usa, pero el informe queda bloqueado
   * hasta que el médico confirme la imagen.
   */
  unverified: boolean;
  includedVertebrae: SiteId[];
  excludedVertebrae: Array<{ site: SiteId; reason: string }>;
  /**
   * true cuando hubo exclusiones: el valor agregado impreso por el equipo ya no
   * corresponde a las vértebras incluidas y debe recalcularse en la estación de
   * trabajo del densitómetro. El motor NO fabrica una DMO agregada.
   */
  requiresReanalysis: boolean;
  meanTScoreOfIncluded: number | null;
  findings: Finding[];
}

/**
 * Validación de columna lumbar según las posiciones oficiales de la ISCD.
 *
 *  - Se usa L1-L4.
 *  - Se excluyen vértebras con alteración estructural focal o artefacto.
 *  - Se excluye una vértebra cuyo T-score difiera >1.0 DE de la adyacente.
 *  - Se requieren ≥2 vértebras evaluables; con menos, la columna no es diagnóstica.
 *  - Nunca se diagnostica con una sola vértebra.
 */
export function validateLumbarSpine(extraction: DxaExtraction): LumbarValidation {
  const findings: Finding[] = [];
  const byId = new Map<SiteId, SiteMeasurement>();
  for (const m of extraction.measurements) {
    if (VERTEBRAE.includes(m.site)) byId.set(m.site, m);
  }

  const present = VERTEBRAE.filter((v) => byId.has(v));
  const excluded: Array<{ site: SiteId; reason: string }> = [];

  // Señal clínica independiente de las vértebras individuales: un T-score lumbar
  // muy superior al femoral sugiere elevación espuria por artrosis, escoliosis o
  // calcificación aórtica. Se evalúa siempre, incluso sin detalle vertebral.
  const femoral = extraction.measurements.find(
    (m) => m.site === "cuello_femoral" || m.site === "cadera_total",
  );
  const lumbarAgg = extraction.measurements.find((m) => m.site === "columna_lumbar");
  if (
    femoral?.tScore != null &&
    lumbarAgg?.tScore != null &&
    lumbarAgg.tScore - femoral.tScore > 2.0
  ) {
    findings.push({
      code: "LUM_DISCORDANCE_SUSPECT",
      severity: "warning",
      message: `La columna lumbar está más de 2 DE por encima del fémur (${lumbarAgg.tScore.toFixed(1)} vs ${femoral.tScore.toFixed(1)}). Sospeche elevación espuria por cambios degenerativos, escoliosis, calcificación aórtica o material quirúrgico. Verifique la imagen antes de aceptar el valor lumbar.`,
      source: "ISCD — discordancia entre sitios",
    });
  }

  if (present.length === 0) {
    const hasAggregate = lumbarAgg?.tScore != null || lumbarAgg?.zScore != null;
    findings.push({
      code: "LUM_NO_VERTEBRAL_DATA",
      severity: "critical",
      message: hasAggregate
        ? "El reporte no discrimina L1 a L4, por lo que no fue posible aplicar la regla de exclusión de la ISCD. El valor agregado se usa de forma provisional: confirme sobre la imagen que no hay vértebras con artefacto, fractura o cambio degenerativo antes de emitir el informe."
        : "No hay datos de columna lumbar utilizables. Base la clasificación en cadera o radio 33%.",
      source: "ISCD Official Positions (Adult) — análisis de columna lumbar",
    });
    return {
      usable: hasAggregate,
      unverified: hasAggregate,
      includedVertebrae: [],
      excludedVertebrae: [],
      requiresReanalysis: false,
      meanTScoreOfIncluded: null,
      findings,
    };
  }

  // Paso 1 — exclusión por artefacto o alteración estructural focal.
  let candidates = present.filter((v) => {
    const m = byId.get(v)!;
    if (m.artifact) {
      excluded.push({
        site: v,
        reason: `Artefacto o alteración estructural: ${m.artifactNote ?? "señalado en el reporte"}`,
      });
      return false;
    }
    if (m.tScore === null) {
      excluded.push({ site: v, reason: "T-score no disponible en el reporte" });
      return false;
    }
    return true;
  });

  // Paso 2 — exclusión por diferencia >1.0 DE respecto a una vértebra adyacente.
  // Se retira la vértebra discordante, no la vecina: la que se aparta del patrón
  // del resto de la columna es la sospechosa.
  let changed = true;
  while (changed && candidates.length >= 2) {
    changed = false;
    for (let i = 0; i < candidates.length - 1; i++) {
      const a = candidates[i];
      const b = candidates[i + 1];
      const ta = byId.get(a)!.tScore!;
      const tb = byId.get(b)!.tScore!;
      if (Math.abs(ta - tb) > 1.0) {
        const rest = candidates.filter((v) => v !== a && v !== b);
        const restMean =
          rest.length > 0
            ? rest.reduce((s, v) => s + byId.get(v)!.tScore!, 0) / rest.length
            : null;

        // La vértebra que más se aleja del resto es la que se excluye. Si no hay
        // resto con el cual comparar, se excluye la de T-score más alto, que es
        // la que típicamente está artificialmente elevada por cambio degenerativo.
        let drop: SiteId;
        if (restMean !== null) {
          drop = Math.abs(ta - restMean) >= Math.abs(tb - restMean) ? a : b;
        } else {
          drop = ta > tb ? a : b;
        }
        const other = drop === a ? b : a;
        excluded.push({
          site: drop,
          reason: `T-score difiere en más de 1.0 DE respecto a ${other} (${byId.get(drop)!.tScore!.toFixed(1)} vs ${byId.get(other)!.tScore!.toFixed(1)})`,
        });
        candidates = candidates.filter((v) => v !== drop);
        changed = true;
        break;
      }
    }
  }

  const usable = candidates.length >= 2;
  const requiresReanalysis = usable && candidates.length < present.length;

  if (!usable) {
    findings.push({
      code: "LUM_NOT_DIAGNOSTIC",
      severity: "critical",
      message:
        candidates.length === 1
          ? "Queda una sola vértebra evaluable. La columna lumbar NO puede usarse para el diagnóstico: base la clasificación en cadera total, cuello femoral o radio 33%."
          : "No quedan vértebras evaluables. La columna lumbar NO puede usarse para el diagnóstico.",
      source: "ISCD — se requieren al menos dos vértebras evaluables",
    });
  }

  if (requiresReanalysis) {
    findings.push({
      code: "LUM_REANALYSIS_REQUIRED",
      severity: "warning",
      message: `Se excluyeron vértebras (${excluded.map((e) => e.site).join(", ")}). El valor agregado impreso por el equipo ya no es válido: solicite el recálculo de la DMO sobre ${candidates.join("-")} en la estación de trabajo del densitómetro. Esta herramienta no estima ese valor.`,
      source: "ISCD — reanálisis tras exclusión de vértebras",
    });
  }

  const meanTScoreOfIncluded = usable
    ? candidates.reduce((s, v) => s + byId.get(v)!.tScore!, 0) / candidates.length
    : null;

  return {
    usable,
    unverified: false,
    includedVertebrae: candidates,
    excludedVertebrae: excluded,
    requiresReanalysis,
    meanTScoreOfIncluded,
    findings,
  };
}
