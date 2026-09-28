# 1. Record architecture decisions

Date: 2026-09-28 · Status: accepted

## Context
Judges assess engineering quality and architecture (25%) and fidelity to the Day 5 design (10%). We need a lightweight way to show why the system looks the way it does.

## Decision
We keep short ADRs in `docs/adr/`, numbered, one decision each. Each ADR records context, the decision, and its consequences. Superseded ADRs stay in place, marked as superseded.

## Consequences
Every significant change (stack, data model, scope cut) gets an ADR in the same PR.
