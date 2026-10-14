# Preflight — Concept

**Preflight** is an open-source ATO readiness tracker for federal contractors.

## The problem

Every federal contractor going through authorization drowns in the same work: mapping NIST 800-53 controls to evidence, chasing artifacts across teams, tracking POA&Ms in spreadsheets, and assembling the SSP by hand. eMASS is a data-entry swamp, not a readiness tool. Small and mid-size contractors have nothing purpose-built — it's SharePoint, spreadsheets, and expensive consultant hours.

## What it does

A control catalog with NIST 800-53 Rev. 5 baselines (low/mod/high) in plain language. You attach evidence artifacts — scan reports, config exports, policy docs — to controls and watch coverage climb per family. A POA&M tracker holds findings with severity, milestones, and residual risk. A readiness dashboard rolls it up: percent of controls satisfied, open findings by severity, blockers. When you're ready, it exports an SSP skeleton generated from your mapped data. Evidence lives in a local-first vault with hashing for integrity.

## Who it's for

Small and mid-size federal contractors, ISSOs, and system owners doing the actual prep work before anything touches eMASS.

## Why others would build on it

The valuable parts are data, not code: control interpretations, DHS/DoD/FedRAMP overlay templates, and baseline mappings — all community-maintainable packs. A plugin model for evidence collectors (point it at AWS Config or Prowler and findings land on the right controls automatically) gives contributors an obvious on-ramp.

## Architecture

TypeScript single-file frontend with local-first IndexedDB; the control catalog is generated from NIST's OSCAL content and bundled into the page. No server required for the core workflow. A small Python service for ingesting scanner outputs is on the roadmap. See `src/model.ts` for the data model.

## Roadmap

1. ~~Single-file UI: control browser, evidence attach, coverage dashboard~~ (done)
2. ~~POA&M tracker UI~~ (done)
3. ~~SSP skeleton export~~ (done: Markdown and OSCAL)
4. ~~Evidence collectors: AWS Config / Prowler findings mapped to controls~~ (done: Prowler and Security Hub import)
5. Community data packs: DHS / DoD / FedRAMP overlays, control interpretations
