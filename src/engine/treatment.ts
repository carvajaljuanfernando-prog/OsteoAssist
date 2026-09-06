import type {
  ClinicalContext,
  DiagnosisResult,
  Finding,
  RiskTier,
  TreatmentRecommendation,
} from "../types.ts";

/**
 * Motor de sugerencia terapéutica.
 *
 * Orden de evaluación deliberado: primero los BLOQUEOS, después las opciones.
 * Un fármaco bloqueado nunca aparece en firstLine ni en alternatives, aunque
 * el nivel de riesgo lo indicaría. La interfaz debe mostrar los bloqueos
 * arriba de todo y no permitir colapsarlos.
 */
export function recommendTreatment(
  tier: RiskTier,
  diagnosis: DiagnosisResult,
  ctx: ClinicalContext,
): { treatment: TreatmentRecommendation; findings: Finding[] } {
  const findings: Finding[] = [];
  const blockers: Finding[] = [];
  const blocked = new Set<string>();

  // ---------- ALERTA MÁXIMA: suspensión de denosumab ----------
  if (ctx.currentTherapy === "denosumab" && ctx.planningDiscontinuation) {
    const alert: Finding = {
      code: "TX_DENOSUMAB_DISCONTINUATION",
      severity: "critical",
      message:
        "NO suspenda denosumab sin iniciar un antirresortivo de continuación. La suspensión sin relevo produce pérdida acelerada de masa ósea y fracturas vertebrales múltiples por rebote. Programe bifosfonato (habitualmente zoledronato) a los 6 meses de la última dosis.",
      source: "Consenso internacional sobre discontinuación de denosumab",
    };
    blockers.push(alert);
    findings.push(alert);
  }

  // ---------- Bloqueos por función renal ----------
  if (ctx.eGFR !== null && ctx.eGFR < 35) {
    blocked.add("bifosfonato_oral");
    blocked.add("bifosfonato_iv");
    blockers.push({
      code: "TX_BLOCK_BISPHOSPHONATE_CKD",
      severity: "critical",
      message: `Depuración estimada ${ctx.eGFR} mL/min: los bifosfonatos están contraindicados por debajo de 35 mL/min. Antes de escoger alternativa, descarte osteodistrofia renal y considere interconsulta a nefrología.`,
      source: "Ficha técnica de alendronato, risedronato y zoledronato",
    });
    findings.push({
      code: "TX_CKD_DENOSUMAB_CAUTION",
      severity: "warning",
      message:
        "En enfermedad renal avanzada, denosumab no requiere ajuste de dosis pero el riesgo de hipocalcemia grave es sustancialmente mayor. Corrija calcio y vitamina D, y vigile calcemia en la primera y segunda semana tras la dosis.",
      source: "Advertencia de seguridad sobre denosumab en ERC",
    });
  }

  // ---------- Bloqueos gastrointestinales ----------
  if (ctx.upperGiContraindication) {
    blocked.add("bifosfonato_oral");
    blockers.push({
      code: "TX_BLOCK_ORAL_BP",
      severity: "critical",
      message:
        "Trastorno esofágico o imposibilidad de permanecer erguido 30 minutos: no use bifosfonatos orales. Considere la vía intravenosa si la función renal lo permite.",
      source: "Contraindicaciones de bifosfonatos orales",
    });
  }

  // ---------- Bloqueo cardiovascular de romosozumab ----------
  if (ctx.recentMiOrStroke) {
    blocked.add("romosozumab");
    blockers.push({
      code: "TX_BLOCK_ROMOSOZUMAB_CV",
      severity: "critical",
      message:
        "Infarto de miocardio o ataque cerebrovascular en los últimos 12 meses: romosozumab está contraindicado.",
      source: "Advertencia en recuadro de romosozumab",
    });
  }

  // ---------- Prerrequisitos ----------
  const prerequisites: string[] = [];
  if (ctx.vitaminD25OH === null) {
    prerequisites.push("Solicitar 25-OH vitamina D antes de iniciar tratamiento.");
  } else if (ctx.vitaminD25OH < 30) {
    prerequisites.push(
      `Corregir la deficiencia de vitamina D (25-OH ${ctx.vitaminD25OH} ng/mL) ANTES de iniciar antirresortivo, especialmente denosumab o zoledronato.`,
    );
    findings.push({
      code: "TX_VITD_DEFICIENT",
      severity: "critical",
      message:
        "Iniciar un antirresortivo potente con vitamina D baja expone a hipocalcemia sintomática. Repletar primero.",
      source: "GPC osteoporosis Colombia 2026 — tratamiento no farmacológico",
    });
  }
  if (ctx.serumCalciumCorrected !== null && ctx.serumCalciumCorrected < 8.5) {
    prerequisites.push("Corregir la hipocalcemia antes de cualquier antirresortivo.");
    blocked.add("denosumab");
    blockers.push({
      code: "TX_BLOCK_HYPOCALCEMIA",
      severity: "critical",
      message: `Calcio corregido ${ctx.serumCalciumCorrected} mg/dL. La hipocalcemia no corregida es contraindicación absoluta para denosumab y zoledronato.`,
      source: "Contraindicaciones de denosumab",
    });
  }
  if (!ctx.dentalEvaluationDone) {
    prerequisites.push(
      "Evaluación odontológica previa y resolución de focos sépticos; los procedimientos invasivos deben completarse antes de iniciar.",
    );
  }
  prerequisites.push("Aporte de calcio dietario 1000–1200 mg/día; suplementar solo el déficit.");

  // ---------- Selección por nivel de riesgo ----------
  let firstLine: string[] = [];
  let alternatives: string[] = [];
  const sequencing: string[] = [];

  if (tier === "muy_alto") {
    firstLine = ["Osteoformador de inicio: teriparatida, abaloparatida o romosozumab"];
    alternatives = ["Zoledronato o denosumab si el osteoformador no está disponible o accesible"];
    sequencing.push(
      "Todo osteoformador debe seguirse de un antirresortivo al terminar el curso; sin el relevo, la ganancia de masa ósea se pierde.",
      "Teriparatida y abaloparatida: duración máxima habitual de 24 meses.",
      "Romosozumab: 12 meses, seguido de antirresortivo.",
    );
    findings.push({
      code: "TX_ANABOLIC_FIRST",
      severity: "info",
      message:
        "En muy alto riesgo, iniciar con osteoformador y continuar con antirresortivo reduce fracturas más que la secuencia inversa.",
      source: "AACE/ACE 2020; GPC osteoporosis Colombia 2026",
    });
  } else if (tier === "alto") {
    firstLine = ["Bifosfonato: alendronato o risedronato oral, o zoledronato intravenoso"];
    alternatives = [
      "Denosumab",
      "Terapia hormonal en mujeres posmenopáusicas jóvenes con alto riesgo de fractura y bajo riesgo de eventos adversos",
    ];
    sequencing.push(
      "Reevaluar a los 3–5 años de bifosfonato para decidir continuación o vacaciones terapéuticas; el zoledronato admite pausa tras 3 años en riesgo no muy alto.",
      "Denosumab no admite vacaciones terapéuticas: es de continuación indefinida o con relevo planificado.",
    );
    findings.push({
      code: "TX_BISPHOSPHONATE_FIRST",
      severity: "info",
      message:
        "Los bifosfonatos son la primera línea en osteoporosis primaria de alto riesgo, con denosumab como alternativa.",
      source: "ACP Living Guideline 2023",
    });
  } else if (tier === "bajo_moderado") {
    firstLine = ["Sin indicación de tratamiento farmacológico en este momento"];
    alternatives = [];
    sequencing.push("Reevaluación clínica y densitométrica según el intervalo sugerido.");
  } else {
    firstLine = ["Decisión pendiente del cálculo de riesgo absoluto"];
    alternatives = [];
    sequencing.push(
      "Complete el FRAX en la herramienta oficial y ubíquelo en el umbral de intervención de la guía colombiana.",
    );
  }

  // Retirar de las listas todo lo bloqueado.
  const filterBlocked = (items: string[]) =>
    items.filter((item) => {
      const lower = item.toLowerCase();
      if (blocked.has("bifosfonato_oral") && blocked.has("bifosfonato_iv") && lower.includes("bifosfonato"))
        return false;
      if (blocked.has("bifosfonato_oral") && !blocked.has("bifosfonato_iv") && lower.includes("oral"))
        return false;
      if (blocked.has("romosozumab") && lower.includes("romosozumab")) return false;
      if (blocked.has("denosumab") && lower.includes("denosumab")) return false;
      return true;
    });

  firstLine = filterBlocked(firstLine);
  alternatives = filterBlocked(alternatives);

  if (firstLine.length === 0 && tier !== "bajo_moderado") {
    firstLine = [
      "Ninguna opción estándar queda disponible tras aplicar las contraindicaciones. Se requiere valoración por endocrinología o reumatología.",
    ];
  }

  const nonPharmacologic = [
    "Ejercicio de resistencia progresiva y entrenamiento de equilibrio, supervisado.",
    "Programa de prevención de caídas: revisión de fármacos sedantes, agudeza visual, calzado, iluminación y superficies del hogar.",
    "Suspensión del tabaco y consumo de alcohol dentro de límites de bajo riesgo.",
    "Aporte proteico adecuado y mantenimiento de un peso corporal saludable.",
  ];

  return {
    treatment: { tier, firstLine, alternatives, blockers, prerequisites, sequencing, nonPharmacologic },
    findings,
  };
}
