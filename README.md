# Preflight

Open-source ATO readiness tracker for federal contractors. Map NIST 800-53 controls to evidence, track POA&Ms, score readiness, and generate SSP skeletons — before anything touches eMASS.

> **Status:** early scaffold. The data model (`src/model.ts`), the 20 NIST control families, and a sample control set are in place. The UI and evidence ingestion are on the roadmap below.

## The problem

Every federal contractor going through authorization drowns in the same work: mapping NIST 800-53 controls to evidence, chasing artifacts across teams, tracking POA&Ms in spreadsheets, and assembling the System Security Plan by hand. eMASS is a data-entry swamp, not a readiness tool. Small and mid-size contractors have nothing purpose-built.

## What it will do

- **Control catalog** — NIST 800-53 Rev. 5 baselines (low / moderate / high) in plain language
- **Evidence mapping** — attach artifacts (scan reports, config exports, policy docs) to controls; track coverage per family
- **POA&M tracker** — findings with severity, milestones, scheduled completion dates, residual risk
- **Readiness scoring** — roll-up dashboard: percent of controls satisfied, open findings by severity, blockers
- **SSP export** — generate a draft System Security Plan from your mapped data
- **Evidence vault** — local-first storage with SHA-256 integrity hashing

## Data model

See `src/model.ts`: `Control`, `ControlFamily`, `EvidenceArtifact`, `PoamItem`, `ControlAssessment`, `ReadinessSummary`.

Control rows in `src/data/` are **sample/illustrative data**. For production, import the authoritative catalog from NIST OSCAL content: https://github.com/usnistgov/oscal-content

## Tech

TypeScript with a local-first design (IndexedDB), plus a small Python service for ingesting scanner outputs (roadmap). No server required for the core workflow.

## Build

```sh
npm install
npm run check   # type-check with tsc
```

## Roadmap

1. Single-file UI: control browser, evidence attach, coverage dashboard
2. POA&M tracker UI
3. SSP skeleton export
4. Evidence collectors: AWS Config / Prowler findings mapped to controls
5. Community data packs: DHS / DoD / FedRAMP overlays, control interpretations

## Contributing

The highest-value contributions are data, not code: control interpretations, overlay templates, and baseline mappings as versioned data packs. See `docs/CONCEPT.md` for the full concept.

## License

TBD — MIT recommended for maximum reuse.
