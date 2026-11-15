# 🛡️ PR Sentinel

**Un revisor de Pull Requests con IA en el que sí se puede confiar dentro del CI.** Publica un único comentario por PR con nivel de riesgo y hallazgos que citan líneas reales del diff, enmascara secretos antes de enviar nada a un tercero, resiste prompt injection escondido en el código revisado y trae una suite de evaluación para medirlo en vez de adivinar.

> 🇬🇧 [Read in English](README.md)

## Qué lo diferencia

- **Verificación de líneas (grounding):** cada hallazgo se contrasta con el diff parseado. Los archivos inventados se descartan y los números de línea falsos se eliminan.
- **Salida estructurada:** JSON validado con Zod y un reintento de *reparación* que le muestra al modelo su propio error de validación.
- **Redacción de secretos antes del prompt:** claves AWS/GitHub/Slack/LLM, JWT, llaves privadas y asignaciones tipo `password = "..."`, manteniendo la numeración de líneas.
- **Resistencia a prompt injection:** el diff, el título y la descripción se tratan como datos no confiables y los intentos de manipulación se reportan como hallazgo de seguridad.
- **Un solo comentario por PR**, editado en cada push. Los tickets de Jira y los comentarios en línea son **idempotentes** (el estado va en marcadores ocultos del comentario, sin base de datos).
- **Suite de evaluación incluida:** diffs con bugs conocidos, un caso limpio para medir falsos positivos y un caso de inyección.
- **Control de costos:** límite de tamaño del diff, globs a ignorar, tokens en cada reporte y estimación opcional en USD.

## Inicio rápido

1. Guarda `ANTHROPIC_API_KEY` como secreto del repositorio.
2. Crea `.github/workflows/pr-sentinel.yml`:

```yaml
name: PR Sentinel
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Elmersont/pr-sentinel@v0.1.0
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

3. (Opcional) agrega un `.ai-review.yml` en la raíz. Mira [`.ai-review.yml`](.ai-review.yml) para ver todas las opciones, incluido `language: es` para recibir los hallazgos en español.

> **PRs desde forks:** GitHub no entrega secretos a los workflows disparados por forks, así que la Action avisa y omite la revisión en lugar de fallar. No uses `pull_request_target` para esto.

## Integraciones

- **Jira:** un ticket por hallazgo con severidad mínima configurable (`jira_base_url`, `jira_email`, `jira_api_token`).
- **Microsoft Teams y Slack:** aviso por webhook cuando el riesgo del PR alcanza el umbral (`teams_webhook_url`, `slack_webhook_url`).
- **`fail_on`:** hace fallar el check si hay hallazgos desde cierta severidad.

## Evaluación

```bash
ANTHROPIC_API_KEY=... npm run eval       # modelo real
npm run eval -- --provider oracle        # sanidad del harness: debe dar 100%
npm run eval -- --provider silent        # sanidad del harness: debe dar 0% de recall
```

Los resultados dependen del modelo, por eso no hay cifras fijas en este README. El harness se valida sin conexión en el CI.

## Desarrollo

```bash
npm ci
npm run typecheck && npm test
npm run build && npm run e2e
```

## Limitaciones

- Revisa solo el **diff**, sin contexto de todo el repositorio.
- La redacción de secretos usa expresiones regulares y es de mejor esfuerzo.
- Las revisiones con LLM tienen falsos positivos y negativos: úsalo como primera pasada, no como único filtro.

## Licencia

MIT © Elmerson Torres Deza
