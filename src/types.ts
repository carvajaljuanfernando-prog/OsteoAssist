/**
 * OsteoAssist — tipos de dominio
 *
 * Separación fundamental del diseño:
 *   - `DxaExtraction` es lo que el modelo de visión LEE del reporte. Sin interpretación.
 *   - `DxaAnalysis` es lo que el motor determinista DECIDE. Sin LLM.
 */

export type Sex = "F" | "M";

export type MenopausalStatus =
  | "premenopausica"
  | "perimenopausica"
  | "posmenopausica"
  | "no_aplica";

/** Sitios reportados por el densitómetro. */
export type SiteId =
  | "L1" | "L2" | "L3" | "L4"
  | "columna_lumbar"      // valor agregado que imprime el equipo (p.ej. L1-L4)
  | "cuello_femoral"
  | "cadera_total"
  | "trocanter"           // NO diagnóstico
  | "ward"                // NO diagnóstico
  | "radio_33"
  | "radio_ultradistal"   // NO diagnóstico
  | "cuerpo_total";       // NO diagnóstico en adultos

/** Medición cruda tal como aparece impresa. */
export interface SiteMeasurement {
  site: SiteId;
  /** g/cm². `null` si el reporte no lo imprime. */
  bmd: number | null;
  tScore: number | null;
  zScore: number | null;
  /** Rango de vértebras que el equipo usó para el valor agregado, p.ej. "L1-L4". */
  range?: string | null;
  /**
   * Artefacto o alteración estructural focal señalada en el reporte o por el médico
   * (osteosíntesis, fractura, cambio degenerativo severo, vertebroplastia, etc.).
   */
  artifact?: boolean;
  artifactNote?: string | null;
}

export interface PriorStudy {
  date: string | null;          // ISO
  sameScanner: boolean | null;  // comparabilidad
  measurements: SiteMeasurement[];
}

/** Salida estricta del modelo de visión. Todo campo ausente = null, nunca inventado. */
export interface DxaExtraction {
  patient: {
    name: string | null;
    documentId: string | null;
    birthDate: string | null;
    age: number | null;
    sex: Sex | null;
    weightKg: number | null;
    heightCm: number | null;
  };
  study: {
    date: string | null;
    manufacturer: string | null;   // Hologic, GE Lunar, Norland...
    model: string | null;
    facility: string | null;
    referenceDatabase: string | null;
  };
  measurements: SiteMeasurement[];
  tbs: { value: number | null; category: string | null } | null;
  vfa: { performed: boolean; fracturesDescribed: string | null } | null;
  priorStudy: PriorStudy | null;
  /** Texto de conclusión impreso en el reporte, verbatim. Nunca reescrito. */
  reportImpression: string | null;
  /** Campos que el modelo no pudo leer con confianza. Fuerza revisión humana. */
  lowConfidenceFields: string[];
}

/** Datos que aporta el médico y que el reporte no contiene. */
export interface ClinicalContext {
  menopausalStatus: MenopausalStatus;
  /** Fractura por fragilidad previa (baja energía, ≥40 años). */
  fragilityFracture: {
    present: boolean;
    sites: Array<"cadera" | "vertebral" | "humero_proximal" | "pelvis" | "antebrazo_distal" | "otra">;
    /** Meses transcurridos desde la más reciente. <12 = fractura reciente. */
    monthsSinceMostRecent: number | null;
    /** Fractura ocurrida durante tratamiento antiosteoporótico. */
    whileOnTherapy: boolean;
    count: number;
  };
  glucocorticoids: {
    current: boolean;
    prednisoloneEqMgDay: number | null;
    monthsOfUse: number | null;
  };
  fallsLastYear: number | null;
  eGFR: number | null;                 // mL/min/1.73m²
  serumCalciumCorrected: number | null;// mg/dL
  vitaminD25OH: number | null;         // ng/mL
  /** Cardiovascular en los últimos 12 meses: contraindica romosozumab. */
  recentMiOrStroke: boolean;
  /** Trastorno esofágico o imposibilidad de permanecer erguido 30 min. */
  upperGiContraindication: boolean;
  dentalEvaluationDone: boolean;
  currentTherapy:
    | "ninguna"
    | "bifosfonato_oral"
    | "bifosfonato_iv"
    | "denosumab"
    | "teriparatida"
    | "abaloparatida"
    | "romosozumab"
    | "otro";
  /** Se planea suspender el fármaco actual. Dispara la alerta de denosumab. */
  planningDiscontinuation: boolean;
  /** FRAX calculado MANUALMENTE en la herramienta oficial (modelo Colombia). */
  frax: { majorOsteoporoticPct: number | null; hipPct: number | null; withBmd: boolean } | null;
  /** Least Significant Change de la unidad, en g/cm², por sitio. Sin esto no hay seguimiento. */
  lscBySite: Partial<Record<SiteId, number>> | null;
}

export type Severity = "info" | "warning" | "critical";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  /** Referencia normativa que sustenta la regla. */
  source: string;
}

export type DiagnosticCategory =
  | "normal"
  | "masa_osea_baja"
  | "osteoporosis"
  | "osteoporosis_clinica"
  | "por_debajo_esperado_para_edad"
  | "dentro_de_lo_esperado_para_edad"
  | "no_clasificable";

export type RiskTier = "bajo_moderado" | "alto" | "muy_alto" | "indeterminado";

export interface DiagnosisResult {
  category: DiagnosticCategory;
  scoreUsed: "T" | "Z";
  /** Sitio que determinó el diagnóstico (el menor válido). */
  decidingSite: SiteId | null;
  decidingValue: number | null;
  validSites: Array<{ site: SiteId; tScore: number | null; zScore: number | null }>;
  excludedSites: Array<{ site: SiteId; reason: string }>;
  narrative: string;
}

export interface TreatmentRecommendation {
  tier: RiskTier;
  firstLine: string[];
  alternatives: string[];
  /** Bloqueos absolutos. Se muestran antes que cualquier recomendación. */
  blockers: Finding[];
  prerequisites: string[];
  sequencing: string[];
  nonPharmacologic: string[];
}

export interface DxaAnalysis {
  lumbar: {
    usable: boolean;
    unverified: boolean;
    includedVertebrae: SiteId[];
    excludedVertebrae: Array<{ site: SiteId; reason: string }>;
    requiresReanalysis: boolean;
    meanTScoreOfIncluded: number | null;
  };
  diagnosis: DiagnosisResult;
  risk: { tier: RiskTier; drivers: string[] };
  treatment: TreatmentRecommendation;
  secondaryWorkup: { indicated: boolean; reason: string | null; panel: string[] };
  monitoring: {
    suggestedIntervalMonths: number | null;
    comparisonInterpretable: boolean;
    comparisonNote: string;
    siteChanges: Array<{ site: SiteId; deltaBmd: number; lsc: number; significant: boolean }>;
  };
  findings: Finding[];
  /** Bloquea la generación de informes hasta que el médico resuelva. */
  requiresPhysicianReview: boolean;
}
