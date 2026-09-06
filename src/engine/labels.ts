import type { DiagnosticCategory, RiskTier, SiteId } from "../types.ts";

export const SITE_LABEL: Record<SiteId, string> = {
  L1: "L1", L2: "L2", L3: "L3", L4: "L4",
  columna_lumbar: "Columna lumbar",
  cuello_femoral: "Cuello femoral",
  cadera_total: "Cadera total",
  trocanter: "Trocánter",
  ward: "Triángulo de Ward",
  radio_33: "Radio 33%",
  radio_ultradistal: "Radio ultradistal",
  cuerpo_total: "Cuerpo total",
};

export const CATEGORY_LABEL: Record<DiagnosticCategory, string> = {
  normal: "Densidad mineral ósea normal",
  masa_osea_baja: "Masa ósea baja (osteopenia)",
  osteoporosis: "Osteoporosis",
  osteoporosis_clinica: "Osteoporosis clínica establecida",
  por_debajo_esperado_para_edad: "Por debajo de lo esperado para la edad",
  dentro_de_lo_esperado_para_edad: "Dentro de lo esperado para la edad",
  no_clasificable: "No clasificable",
};

export const TIER_LABEL: Record<RiskTier, string> = {
  bajo_moderado: "Riesgo bajo o moderado",
  alto: "Alto riesgo",
  muy_alto: "Muy alto riesgo",
  indeterminado: "Riesgo indeterminado",
};
