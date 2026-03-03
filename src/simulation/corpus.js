// ═══════════════════════════════════════════════════════════════
// CORPUS LOADER — Context-window RAG (A.1)
// Loads reference documents directly into the LLM prompt.
// Scale-conditional: escalation framework only at Tiers 4-6.
// ═══════════════════════════════════════════════════════════════

import escalationFramework from "../corpus/escalation-framework.md?raw";
import adjudicatorRole from "../corpus/adjudicator-role.md?raw";

/**
 * Load the corpus for injection into the adjudication prompt.
 * scaleTier controls which documents are included:
 *   Tiers 1-3: adjudicator role only (no escalation framework)
 *   Tier 4: both docs (could condense escalation in the future)
 *   Tiers 5-6: both full docs
 */
export function loadCorpus(scaleTier = 3) {
  const sections = [];

  // Escalation framework: only relevant at Operational+ (tier 4+)
  if (scaleTier >= 4) {
    sections.push(
      "════════════════════════════════════════",
      "REFERENCE DOCUMENT: ESCALATION FRAMEWORK",
      "════════════════════════════════════════",
      escalationFramework.trim(),
      "",
    );
  }

  sections.push(
    "════════════════════════════════════════",
    "REFERENCE DOCUMENT: ADJUDICATOR ROLE GUIDANCE",
    "════════════════════════════════════════",
    adjudicatorRole.trim(),
  );

  return sections.join("\n");
}

/**
 * Get individual corpus documents for display/inspection.
 */
export function getCorpusDocuments() {
  return [
    { name: "Escalation Framework", content: escalationFramework },
    { name: "Adjudicator Role Guidance", content: adjudicatorRole },
  ];
}
