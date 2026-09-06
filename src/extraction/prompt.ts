/**
 * Prompt de extracción por visión.
 *
 * Regla de oro: el modelo TRANSCRIBE, no interpreta. Ninguna clasificación
 * diagnóstica, ningún cálculo, ninguna sugerencia. Si un dato no está impreso,
 * devuelve null. Inventar un valor aquí contamina todo el motor aguas abajo.
 */

export const EXTRACTION_SYSTEM_PROMPT = `Eres un transcriptor de reportes de densitometría ósea (DXA). Tu única tarea es leer la imagen o PDF y extraer los datos IMPRESOS en el documento, sin interpretarlos.

REGLAS ABSOLUTAS:
1. NUNCA calcules, infieras ni completes un valor que no esté impreso. Si no aparece, devuelve null.
2. NUNCA emitas un diagnóstico, clasificación de riesgo ni recomendación. Eso lo hace otro componente.
3. NUNCA conviertas unidades. Transcribe la DMO en g/cm² tal como aparece; si el equipo usa otra unidad, indícalo en lowConfidenceFields.
4. Respeta el signo de los T-score y Z-score. Un "-2,5" es -2.5. La coma decimal latina se convierte a punto: "0,842" es 0.842.
5. Si un número está borroso, cortado, tapado o es ambiguo, transcribe tu mejor lectura Y agrega la ruta del campo a lowConfidenceFields.
6. El campo reportImpression se copia VERBATIM, sin corregir ortografía ni resumir. Si no hay conclusión impresa, null.

QUÉ BUSCAR:
- Tabla de columna lumbar: extrae CADA vértebra por separado (L1, L2, L3, L4) con su DMO, T-score y Z-score, además de la fila agregada (L1-L4, L2-L4 u otra) como site "columna_lumbar" con su "range".
- Tabla de fémur: cuello femoral, cadera total, trocánter, triángulo de Ward. Transcribe todos, aunque algunos no sean diagnósticos.
- Radio: distingue radio 33% (también llamado 1/3 radio) de radio ultradistal.
- TBS (Trabecular Bone Score) si el reporte lo incluye.
- VFA / morfometría vertebral: si se realizó y qué describe.
- Estudio previo: si el reporte muestra comparación, extrae las mediciones previas y su fecha en priorStudy. Indica sameScanner solo si el documento lo afirma explícitamente; si no lo dice, null.
- Fabricante y modelo del equipo, y la base de datos de referencia (NHANES, etc.) si aparecen.

ARTEFACTOS:
Marca artifact=true en una vértebra o sitio SOLO si el reporte lo señala explícitamente (osteosíntesis, cemento, fractura, escoliosis severa, cambios degenerativos marcados, prótesis, clips, contraste). Escribe la descripción textual en artifactNote. No infieras artefactos a partir de la imagen si el reporte no los menciona; el médico los confirmará después.

Devuelve el resultado llamando a la herramienta extract_dxa_report. No escribas texto fuera de la herramienta.`;

/**
 * Esquema para tool use. Todos los campos son requeridos y nullable:
 * obliga al modelo a pronunciarse sobre cada dato en vez de omitirlo en silencio.
 */
export const EXTRACTION_TOOL = {
  name: "extract_dxa_report",
  description:
    "Registra los datos transcritos literalmente de un reporte de densitometría ósea (DXA).",
  input_schema: {
    type: "object",
    properties: {
      patient: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          documentId: { type: ["string", "null"] },
          birthDate: { type: ["string", "null"], description: "ISO 8601 YYYY-MM-DD" },
          age: { type: ["number", "null"] },
          sex: { type: ["string", "null"], enum: ["F", "M", null] },
          weightKg: { type: ["number", "null"] },
          heightCm: { type: ["number", "null"] },
        },
        required: ["name", "documentId", "birthDate", "age", "sex", "weightKg", "heightCm"],
      },
      study: {
        type: "object",
        properties: {
          date: { type: ["string", "null"], description: "ISO 8601 YYYY-MM-DD" },
          manufacturer: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          facility: { type: ["string", "null"] },
          referenceDatabase: { type: ["string", "null"] },
        },
        required: ["date", "manufacturer", "model", "facility", "referenceDatabase"],
      },
      measurements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            site: {
              type: "string",
              enum: [
                "L1", "L2", "L3", "L4", "columna_lumbar",
                "cuello_femoral", "cadera_total", "trocanter", "ward",
                "radio_33", "radio_ultradistal", "cuerpo_total",
              ],
            },
            bmd: { type: ["number", "null"], description: "g/cm²" },
            tScore: { type: ["number", "null"] },
            zScore: { type: ["number", "null"] },
            range: { type: ["string", "null"], description: 'p.ej. "L1-L4"' },
            artifact: { type: "boolean" },
            artifactNote: { type: ["string", "null"] },
          },
          required: ["site", "bmd", "tScore", "zScore", "range", "artifact", "artifactNote"],
        },
      },
      tbs: {
        type: ["object", "null"],
        properties: {
          value: { type: ["number", "null"] },
          category: { type: ["string", "null"] },
        },
        required: ["value", "category"],
      },
      vfa: {
        type: ["object", "null"],
        properties: {
          performed: { type: "boolean" },
          fracturesDescribed: { type: ["string", "null"] },
        },
        required: ["performed", "fracturesDescribed"],
      },
      priorStudy: {
        type: ["object", "null"],
        properties: {
          date: { type: ["string", "null"] },
          sameScanner: { type: ["boolean", "null"] },
          measurements: { type: "array", items: { type: "object" } },
        },
        required: ["date", "sameScanner", "measurements"],
      },
      reportImpression: { type: ["string", "null"] },
      lowConfidenceFields: {
        type: "array",
        items: { type: "string" },
        description: 'Rutas tipo "measurements[2].tScore" con lectura dudosa.',
      },
    },
    required: [
      "patient", "study", "measurements", "tbs", "vfa",
      "priorStudy", "reportImpression", "lowConfidenceFields",
    ],
  },
} as const;
