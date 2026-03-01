# Chapter 3: Measurement and Expectation Gaps

> Source: [Perforce State of DevOps 2026 — Chapter 3](https://www.perforce.com/resources/state-of-devops/chapter-3)

---

## AI Confidence vs. Audit Reality

**The AI confidence gap is real, and it is risky.**

Organizations are optimistic about AI — and that optimism is understandable. But the data reveals a dangerous mismatch: **confidence is outpacing verification.**

### AI Confidence vs. Actual Embedded AI

| Measurement | Share |
|---|---|
| Confident in AI outputs | **77%** |
| Have AI deeply embedded across multiple SDLC stages | **38%** |
| Use AI commonly, but inconsistently | **38%** |

> High confidence + uneven adoption = risk.

Many organizations believe AI is working without having the delivery consistency, governance clarity, and auditability required to **prove** it is working safely and repeatably.

---

## Auditability is the Missing Layer

When AI is embedded across delivery, measurement cannot stop at outcomes ("we shipped faster"). Organizations also need **system evidence**: what changed, why it changed, who approved it, what controls were applied, and what signals were produced.

### Audit Trail Maturity

| Audit Trail State | Share |
|---|---|
| **Fully automated** audit trails | **39%** |
| Only mostly or partially automated | **59%** |
| Still manual | 2% |

> **Without automated audit trails, measurement becomes expensive and inconsistent. Compliance reporting becomes reactive. Incident learning becomes harder. Confidence substitutes for validation.**

Only **39%** of organizations have the automated audit infrastructure needed to verify AI outputs consistently. The **61% majority** operate with incomplete or manual audit processes — a critical vulnerability in regulated industries.

---

## Teams Measure What They Want, Not What They Can Trust

Most organizations focus on outcome KPIs — and these are the right metrics. The problem is that **outcomes-only measurement can create a false sense of maturity** when the delivery system is unstable.

### Top Measured KPIs Across All Organizations

| KPI | Share Measuring It |
|---|---|
| Operational efficiency | **57%** |
| Productivity ROI | **49%** |
| Developer experience | **47%** |
| Governance / risk reduction | **35%** |

### Why Outcome KPIs Alone Are Insufficient

If workflows vary → governance varies → KPI definitions and data sources vary → leadership cannot reliably compare performance across teams or determine which practices are producing results.

**Measurement coherence increases with maturity:**
- High-maturity organizations have standardized workflows, deeper automation, mature IDPs, and clear governance — conditions that produce **consistent signal**.
- Low-maturity organizations have partial automation and team-dependent practices — **inconsistent signals** result.

---

## The Risk

> **The risk is not that organizations use AI. The risk is that they trust AI faster than they can verify it** because governance and auditability infrastructure has not caught up to deployment velocity.

Without auditability and consistent measurement, even organizations with strong foundations cannot **prove** AI's value or manage its risk.

---

## Chapter Takeaway

> Organizations trust AI faster than they can verify it. Governance and auditability infrastructures need to catch up to deployment velocity to prove that AI is working safely and repeatably.

### Implications for a GitHub Metrics Dashboard

- Audit trail automation maps directly to **GitHub's required PR reviews, CODEOWNERS, audit log API, and artifact retention settings**.
- "Developer experience" and "operational efficiency" are the two most broadly tracked KPIs — both can be surfaced from GitHub Actions and Pull Request APIs.
- Governance/risk reduction (the least tracked at 35%) is where teams most need dashboard support — code scanning, branch protection, and secret scanning provide this signal.
