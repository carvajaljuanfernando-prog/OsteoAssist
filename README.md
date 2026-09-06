# OsteoAssist

Lectura, interpretación e informe de densitometría ósea (DXA) para uso médico.

## Cómo correrlo

Requiere Node 22 o superior.

```bash
npm install

cp .env.example .env      # y complete su clave de la API de Anthropic

npm run server            # backend, puerto 8787
npm run dev               # frontend, puerto 5173  (en otra terminal)
```

Abra `http://localhost:5173`. La pantalla arranca con un reporte de ejemplo para probar el flujo sin gastar llamadas a la API.

Otros comandos:

```bash
npm test          # 19 pruebas clínicas del motor
npm run build     # compila a dist/
```

## Por qué necesita un backend

La app llama a la API de Anthropic para leer la foto del reporte. Esa llamada requiere una API key, y una key en el navegador es una key robada: cualquiera la ve en el inspector.

Por eso `server/index.js` existe. Guarda la clave como variable de entorno, recibe la imagen, llama a la API y devuelve el JSON. No almacena nada: la imagen se procesa en memoria y se descarta.

**Consecuencia práctica: esto no puede desplegarse en GitHub Pages.** Pages solo sirve archivos estáticos y no puede guardar un secreto. El código va a GitHub; el despliegue va a un host con backend.

## Despliegue

En producción el servidor sirve también la interfaz compilada, así que **basta un solo servicio**.

### Railway

1. Suba el repositorio a GitHub.
2. En Railway: New Project → Deploy from GitHub repo.
3. Variables → agregue `ANTHROPIC_API_KEY`.
4. Settings → Networking → Generate Domain.
5. Variables → agregue `ALLOWED_ORIGIN` con ese dominio.

`railway.json` ya fija el build (`npm run build`) y el arranque (`npm start`). Railway inyecta `PORT`; el servidor lo respeta y escucha en `0.0.0.0`. `.nvmrc` fija Node 22, necesario porque el servidor importa TypeScript directamente.

No requiere base de datos: la aplicación no almacena nada.

Costo: Railway ya no tiene plan gratuito permanente. Las cuentas nuevas reciben un crédito único de 5 USD por 30 días; después, el plan Hobby cuesta 5 USD al mes con 5 USD de consumo incluido. Una aplicación de este tamaño, sin base de datos y con tráfico de consultorio, se mantiene dentro de ese crédito. Verifique las tarifas vigentes antes de presupuestar.

### Render

Misma idea, un Web Service: build `npm install && npm run build`, arranque `npm start`, y las mismas dos variables.

## Arquitectura

El modelo de lenguaje **transcribe**. El código **decide**.

| Etapa | Componente | Determinista |
|---|---|---|
| Extracción | Claude vision + `extract_dxa_report` | No |
| Verificación | Médico, en pantalla | — |
| Análisis | `analyzeDxa()` en TypeScript | Sí |
| Redacción del informe del paciente | Claude, con la clasificación ya fijada | No |

Ninguna clasificación diagnóstica, estratificación de riesgo ni sugerencia terapéutica sale de un modelo generativo. Todo eso vive en `src/engine/`, es reproducible y está cubierto por pruebas.

```
index.html
vite.config.js
server/index.js             Backend: guarda la clave, proxea la extracción
src/
  main.jsx
  types.ts                  Tipos de dominio (contrato entre capas)
  extraction/prompt.ts      Prompt de visión + esquema de tool use
  engine/
    lumbar.ts               Validación ISCD de columna lumbar
    diagnosis.ts            Selección T/Z y clasificación OMS
    risk.ts                 Estratificación de riesgo
    treatment.ts            Sugerencia terapéutica y bloqueos duros
    monitoring.ts           LSC, seguimiento y causas secundarias
    labels.ts               Etiquetas para la interfaz
    index.ts                analyzeDxa() — punto de entrada
  ui/
    VerificationScreen.jsx  Pantalla de verificación
    ClinicalContextPanel.jsx Contexto clínico que activa las reglas
tests/engine.test.ts        19 casos clínicos
```

Vite compila el TypeScript directamente, así que la interfaz importa el mismo motor que ejecutan las pruebas. No hay copia paralela que pueda divergir.

## Pantalla de verificación

- **Carga y lectura**: al subir la foto o el PDF, el archivo va al backend, se extrae y los campos se llenan solos. Si la lectura falla, la pantalla lo dice y permite transcribir a mano sobre el reporte cargado.
- Cargar un reporte nuevo **borra toda verificación previa**: confirmar los datos de un estudio y luego cambiar el estudio dejaría marcado como verificado algo que nadie revisó.
- Confirmación **por bloques** (paciente, estudio, columna, fémur, otros sitios, contexto clínico). Los campos que el extractor marcó como dudosos quedan fuera de la confirmación de bloque y exigen toque individual.
- **Marcado de artefactos por vértebra** mediante lista de causas: es el aporte clínico que el lector automático no puede dar.
- **Recálculo en vivo**: al marcar una vértebra, el diagnóstico y la estratificación cambian de inmediato.
- **Puerta dura**: el botón de informes permanece deshabilitado mientras falte verificar un bloque o resolver un campo dudoso.

El panel de contexto clínico recoge lo que el reporte no trae y sin lo cual las reglas de tratamiento no se activan: fractura por fragilidad, glucocorticoides, caídas, depuración, calcio, vitamina D, terapia actual, FRAX y LSC. Cada campo indica qué regla enciende.

## Reglas implementadas

**Columna lumbar (ISCD)**
- Se usa L1–L4.
- Se excluyen vértebras con artefacto o alteración estructural focal.
- Se excluye la vértebra cuyo T-score difiera más de 1.0 DE de la adyacente; se retira la que más se aparta del resto de la columna.
- Se exigen al menos dos vértebras evaluables; con una sola, la columna no es diagnóstica.
- Tras cualquier exclusión, el valor agregado impreso deja de ser válido y se solicita recálculo en la estación de trabajo. **El motor no estima ese valor.**
- Si el reporte no discrimina L1–L4, el agregado se usa de forma provisional pero el informe queda bloqueado hasta la confirmación del médico sobre la imagen.
- Alerta de discordancia cuando la columna supera al fémur en más de 2 DE.

**Diagnóstico**
- T-score en mujeres posmenopáusicas y hombres ≥50 años; Z-score en premenopáusicas, hombres <50 y pediatría.
- Sitios diagnósticos: columna lumbar, cuello femoral, cadera total, radio 33%. Trocánter, Ward, radio ultradistal y cuerpo total quedan excluidos.
- Se clasifica con el valor **más bajo** entre sitios válidos, nunca con el promedio.
- Fractura por fragilidad de cadera o vértebra define osteoporosis clínica con independencia del T-score.
- En población joven no se emite rótulo de osteoporosis por densitometría aislada.

**Riesgo y tratamiento**
- Muy alto riesgo: fractura en los últimos 12 meses, fractura bajo tratamiento, fracturas múltiples, fractura con glucocorticoides, T ≤ −3.0, caídas de repetición, FRAX mayor >30% o cadera >4.5%.
- Muy alto riesgo → osteoformador de inicio con antirresortivo de continuación obligatorio.
- Alto riesgo → bifosfonato de primera línea, denosumab como alternativa.
- Bloqueos absolutos codificados: eGFR <35 excluye bifosfonatos; patología esofágica excluye la vía oral; evento cardiovascular en 12 meses excluye romosozumab; hipocalcemia no corregida excluye denosumab.
- **Alerta crítica de suspensión de denosumab** sin antirresortivo de relevo.
- Prerrequisitos forzados: 25-OH vitamina D, calcio corregido, evaluación odontológica.

**Seguimiento**
- Sin LSC de la unidad, ningún cambio entre estudios se declara interpretable.
- Equipo distinto entre estudios invalida la comparación directa.

## Pendientes antes del uso clínico

1. **Umbrales FRAX colombianos.** `COLOMBIA_THRESHOLDS_PLACEHOLDER` en `risk.ts` está en `null` a propósito. Debe cargarse la tabla de umbrales de intervención por edad de la figura 1 de la GPC colombiana 2026. Mientras esté vacío, el motor devuelve `indeterminado` en lugar de inventar un corte.
2. **Licencia FRAX.** El cálculo no se integra: el médico ingresa el resultado obtenido en la herramienta oficial. Integrarlo requiere acuerdo con la Universidad de Sheffield.
3. **Set de validación de extracción.** 30–50 reportes anonimizados de los equipos que circulan en Santander, con medición de exactitud campo por campo antes de confiar en la lectura automática.
4. **Revisión por especialistas.** La sección "Reglas implementadas" es el documento a revisar con reumatología y endocrinología. Cada regla tiene su `source` en el código.
5. **Generador de informes.** Falta el informe médico y el del paciente.

## Nota médico-legal

Herramienta de apoyo a la decisión clínica. No reemplaza el juicio médico ni la lectura del densitometrista. La verificación humana de los datos extraídos es obligatoria y no puede omitirse. Procesamiento efímero, sin almacenamiento de imágenes ni identificadores en servidor (Ley 1581/2012).
