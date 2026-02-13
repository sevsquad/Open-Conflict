// ═══════════════════════════════════════════════════════════════
// CORPUS LOADER — Context-window RAG (A.1)
// Loads reference documents directly into the LLM prompt.
// ═══════════════════════════════════════════════════════════════

import escalationFramework from "../corpus/escalation-framework.md?raw";
import adjudicatorRole from "../corpus/adjudicator-role.md?raw";

/**
 * Load the full corpus for injection into the adjudication prompt.
 * Returns a single string containing all reference documents with clear delimiters.
 */
export function loadCorpus() {
  return [
    "════════════════════════════════════════",
    "REFERENCE DOCUMENT: ESCALATION FRAMEWORK",
    "════════════════════════════════════════",
    escalationFramework.trim(),
    "",
    "════════════════════════════════════════",
    "REFERENCE DOCUMENT: ADJUDICATOR ROLE GUIDANCE",
    "════════════════════════════════════════",
    adjudicatorRole.trim(),
  ].join("\n");
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
