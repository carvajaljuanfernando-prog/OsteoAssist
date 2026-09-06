import React from "react";

/* ------------------------------------------------------------------ *
 * Panel de contexto clínico
 *
 * Todo lo que el reporte de densitometría NO contiene y sin lo cual las
 * reglas de riesgo y tratamiento no pueden activarse. Cada campo aquí
 * enciende o apaga una regla concreta del motor; el texto de ayuda dice
 * cuál, para que el médico entienda por qué se le pregunta.
 * ------------------------------------------------------------------ */

export const EMPTY_CONTEXT = {
  menopausalStatus: "posmenopausica",
  fragilityFracture: { present: false, sites: [], monthsSinceMostRecent: null, whileOnTherapy: false, count: 0 },
  glucocorticoids: { current: false, prednisoloneEqMgDay: null, monthsOfUse: null },
  fallsLastYear: 0,
  eGFR: null,
  serumCalciumCorrected: null,
  vitaminD25OH: null,
  recentMiOrStroke: false,
  upperGiContraindication: false,
  dentalEvaluationDone: false,
  currentTherapy: "ninguna",
  planningDiscontinuation: false,
  frax: null,
  lscBySite: null,
};

const FRACTURE_SITES = [
  { id: "cadera", label: "Cadera" },
  { id: "vertebral", label: "Vertebral" },
  { id: "humero_proximal", label: "Húmero proximal" },
  { id: "pelvis", label: "Pelvis" },
  { id: "antebrazo_distal", label: "Antebrazo distal" },
  { id: "otra", label: "Otra" },
];

const THERAPIES = [
  { id: "ninguna", label: "Ninguna" },
  { id: "bifosfonato_oral", label: "Bifosfonato oral" },
  { id: "bifosfonato_iv", label: "Bifosfonato intravenoso" },
  { id: "denosumab", label: "Denosumab" },
  { id: "teriparatida", label: "Teriparatida" },
  { id: "abaloparatida", label: "Abaloparatida" },
  { id: "romosozumab", label: "Romosozumab" },
  { id: "otro", label: "Otro" },
];

const MENOPAUSE = [
  { id: "posmenopausica", label: "Posmenopáusica" },
  { id: "perimenopausica", label: "Perimenopáusica" },
  { id: "premenopausica", label: "Premenopáusica" },
  { id: "no_aplica", label: "No aplica" },
];

function Row({ label, hint, children }) {
  return (
    <div className="py-3 border-b border-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-52 shrink-0 text-sm text-slate-700">{label}</span>
        <div className="flex-1 min-w-[12rem]">{children}</div>
      </div>
      {hint && <p className="mt-1 ml-0 sm:ml-[13.75rem] text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Num({ value, onChange, unit, placeholder }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-28 tabular-nums bg-transparent border-b border-slate-300 focus:border-sky-600 outline-none py-0.5"
      />
      {unit && <span className="text-xs text-slate-500">{unit}</span>}
    </span>
  );
}

function Choice({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`text-xs px-2.5 py-1 rounded border ${
            value === o.id
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 text-slate-700 hover:bg-slate-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-slate-900" />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

export default function ClinicalContextPanel({ ctx, setCtx, sex }) {
  const set = (patch) => setCtx({ ...ctx, ...patch });
  const setFx = (patch) => set({ fragilityFracture: { ...ctx.fragilityFracture, ...patch } });
  const setGc = (patch) => set({ glucocorticoids: { ...ctx.glucocorticoids, ...patch } });

  const toggleSite = (id) => {
    const has = ctx.fragilityFracture.sites.includes(id);
    const sites = has
      ? ctx.fragilityFracture.sites.filter((s) => s !== id)
      : [...ctx.fragilityFracture.sites, id];
    setFx({ sites, present: sites.length > 0 || ctx.fragilityFracture.present });
  };

  const missing = [];
  if (ctx.eGFR === null) missing.push("depuración");
  if (ctx.vitaminD25OH === null) missing.push("vitamina D");
  if (ctx.serumCalciumCorrected === null) missing.push("calcio corregido");

  return (
    <section>
      <h3 className="text-base font-medium text-slate-900 pt-6 pb-1">Contexto clínico</h3>
      <p className="text-sm text-slate-600 mb-2">
        Estos datos no están en el reporte y son los que activan las reglas de riesgo y tratamiento.
      </p>

      {missing.length > 0 && (
        <div className="mb-3 border-l-2 border-slate-400 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Sin {missing.join(", ")} el motor no puede aplicar los bloqueos de seguridad de los fármacos.
        </div>
      )}

      {sex === "F" && (
        <Row label="Estado menopáusico"
          hint="Decide si se clasifica con T-score o con Z-score.">
          <Choice options={MENOPAUSE} value={ctx.menopausalStatus}
            onChange={(v) => set({ menopausalStatus: v })} />
        </Row>
      )}

      <Row label="Fractura por fragilidad"
        hint="De baja energía, a partir de los 40 años. Cadera o vértebra definen osteoporosis clínica aunque el T-score sea normal.">
        <div className="space-y-2">
          <Toggle checked={ctx.fragilityFracture.present}
            onChange={(v) => setFx({ present: v, sites: v ? ctx.fragilityFracture.sites : [], count: v ? Math.max(1, ctx.fragilityFracture.count) : 0 })}
            label="Ha tenido al menos una" />
          {ctx.fragilityFracture.present && (
            <div className="pl-6 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {FRACTURE_SITES.map((s) => (
                  <button key={s.id} onClick={() => toggleSite(s.id)}
                    className={`text-xs px-2.5 py-1 rounded border ${
                      ctx.fragilityFracture.sites.includes(s.id)
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-sm text-slate-600">Número total</span>
                <Num value={ctx.fragilityFracture.count} onChange={(v) => setFx({ count: v ?? 0 })} />
                <span className="text-sm text-slate-600">Meses desde la última</span>
                <Num value={ctx.fragilityFracture.monthsSinceMostRecent}
                  onChange={(v) => setFx({ monthsSinceMostRecent: v })} unit="meses" />
              </div>
              <Toggle checked={ctx.fragilityFracture.whileOnTherapy}
                onChange={(v) => setFx({ whileOnTherapy: v })}
                label="Ocurrió durante tratamiento antiosteoporótico" />
            </div>
          )}
        </div>
      </Row>

      <Row label="Glucocorticoides"
        hint="≥7.5 mg/día de prednisolona por ≥3 meses clasifica como alto riesgo por sí solo.">
        <div className="space-y-2">
          <Toggle checked={ctx.glucocorticoids.current}
            onChange={(v) => setGc({ current: v, prednisoloneEqMgDay: v ? ctx.glucocorticoids.prednisoloneEqMgDay : null, monthsOfUse: v ? ctx.glucocorticoids.monthsOfUse : null })}
            label="En uso actual" />
          {ctx.glucocorticoids.current && (
            <div className="pl-6 flex flex-wrap items-center gap-4">
              <span className="text-sm text-slate-600">Equivalente prednisolona</span>
              <Num value={ctx.glucocorticoids.prednisoloneEqMgDay}
                onChange={(v) => setGc({ prednisoloneEqMgDay: v })} unit="mg/día" />
              <span className="text-sm text-slate-600">Duración</span>
              <Num value={ctx.glucocorticoids.monthsOfUse}
                onChange={(v) => setGc({ monthsOfUse: v })} unit="meses" />
            </div>
          )}
        </div>
      </Row>

      <Row label="Caídas en el último año"
        hint="Dos o más clasifican como muy alto riesgo.">
        <Num value={ctx.fallsLastYear} onChange={(v) => set({ fallsLastYear: v })} />
      </Row>

      <Row label="Depuración de creatinina"
        hint="Por debajo de 35 mL/min los bifosfonatos quedan bloqueados.">
        <Num value={ctx.eGFR} onChange={(v) => set({ eGFR: v })} unit="mL/min" placeholder="—" />
      </Row>

      <Row label="Calcio corregido"
        hint="Por debajo de 8.5 mg/dL se bloquea denosumab hasta corregir.">
        <Num value={ctx.serumCalciumCorrected}
          onChange={(v) => set({ serumCalciumCorrected: v })} unit="mg/dL" placeholder="—" />
      </Row>

      <Row label="25-OH vitamina D"
        hint="Por debajo de 30 ng/mL hay que repletar antes de iniciar un antirresortivo potente.">
        <Num value={ctx.vitaminD25OH} onChange={(v) => set({ vitaminD25OH: v })} unit="ng/mL" placeholder="—" />
      </Row>

      <Row label="Antecedentes que bloquean fármacos">
        <div className="space-y-1.5">
          <Toggle checked={ctx.recentMiOrStroke} onChange={(v) => set({ recentMiOrStroke: v })}
            label="Infarto o ataque cerebrovascular en los últimos 12 meses" />
          <Toggle checked={ctx.upperGiContraindication} onChange={(v) => set({ upperGiContraindication: v })}
            label="Patología esofágica o no puede permanecer erguido 30 minutos" />
          <Toggle checked={ctx.dentalEvaluationDone} onChange={(v) => set({ dentalEvaluationDone: v })}
            label="Evaluación odontológica ya realizada" />
        </div>
      </Row>

      <Row label="Tratamiento actual"
        hint="Suspender denosumab sin antirresortivo de relevo produce fracturas vertebrales por rebote.">
        <div className="space-y-2">
          <Choice options={THERAPIES} value={ctx.currentTherapy}
            onChange={(v) => set({ currentTherapy: v, planningDiscontinuation: v === "ninguna" ? false : ctx.planningDiscontinuation })} />
          {ctx.currentTherapy !== "ninguna" && (
            <Toggle checked={ctx.planningDiscontinuation}
              onChange={(v) => set({ planningDiscontinuation: v })}
              label="Se está considerando suspenderlo" />
          )}
        </div>
      </Row>

      <Row label="FRAX"
        hint="Calculado en la herramienta oficial con el modelo Colombia. No se integra el cálculo por licencia.">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-slate-600">Fractura mayor</span>
          <Num value={ctx.frax?.majorOsteoporoticPct ?? null}
            onChange={(v) => set({ frax: { ...(ctx.frax ?? { hipPct: null, withBmd: true }), majorOsteoporoticPct: v } })}
            unit="%" />
          <span className="text-sm text-slate-600">Cadera</span>
          <Num value={ctx.frax?.hipPct ?? null}
            onChange={(v) => set({ frax: { ...(ctx.frax ?? { majorOsteoporoticPct: null, withBmd: true }), hipPct: v } })}
            unit="%" />
        </div>
      </Row>

      <Row label="LSC de la unidad"
        hint="Least Significant Change del estudio de precisión. Sin él, ningún cambio entre estudios es interpretable.">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-slate-600">Cuello femoral</span>
          <Num value={ctx.lscBySite?.cuello_femoral ?? null}
            onChange={(v) => set({ lscBySite: v === null ? null : { ...(ctx.lscBySite ?? {}), cuello_femoral: v } })}
            unit="g/cm²" />
          <span className="text-sm text-slate-600">Columna lumbar</span>
          <Num value={ctx.lscBySite?.columna_lumbar ?? null}
            onChange={(v) => set({ lscBySite: v === null ? null : { ...(ctx.lscBySite ?? {}), columna_lumbar: v } })}
            unit="g/cm²" />
        </div>
      </Row>
    </section>
  );
}
