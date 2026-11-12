---
id: SCHED-4515
title: Ack moves into the incident panel
status: done
plan: R2 (changed), R1 kept
source: product's answer to the step-1 report, 2026-11-12 ~10:51 UTC
---

Step-1 recording (00:19): on-call aimed at INC-9576's Ack, INC-4421 landed at the top as they clicked, and the
board acked INC-4421. Product's decision: "New incidents stay live at the top. Ack leaves the row: a row opens its
incident panel, and Ack lives there."

- Clicking a row (or Enter/Space on it) opens the incident panel (`data-testid="incident-panel"`), which names the
  incident id. The panel stays on that incident while the list moves.
- The panel's Ack (`data-testid="panel-ack"`) calls `api.ack(id)` for the incident the panel names; the row then
  shows the acked mark (`data-testid="acked"`).
- Rows lose their Ack button (`data-testid="ack"` retired). New incidents still go in live at the top (R1).

Acceptance: a click that lands on a moved row opens the wrong panel and acks nothing; picking the intended row and
pressing the panel's Ack acks the intended incident.
