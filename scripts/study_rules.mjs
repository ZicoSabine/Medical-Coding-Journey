export const DIFFICULTIES = Object.freeze(["simple", "intermediate", "complex"]);

export const REQUIRED_CATEGORIES = Object.freeze({
  simple: ["icd10", "cpt"],
  intermediate: ["icd10", "cpt", "hcpcs"],
  complex: ["icd10", "cpt"],
});

export function normalizeAnswer(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function cleanAnswerList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

export function normalizedAnswerList(values) {
  return cleanAnswerList(values).map(normalizeAnswer).sort((a, b) => a.localeCompare(b));
}

export function answersMatch(left, right) {
  return JSON.stringify(normalizedAnswerList(left)) === JSON.stringify(normalizedAnswerList(right));
}

export function unresolvedVerification(categories, states, corrections) {
  const unresolved = [];
  for (const category of categories) {
    const verification = states?.[category];
    if (typeof verification?.userCorrect !== "boolean" || typeof verification?.systemCorrect !== "boolean") {
      unresolved.push(`${category.toUpperCase()} needs both verification choices.`);
    } else if (verification.systemCorrect === false && !cleanAnswerList(corrections?.[category]).length) {
      unresolved.push(`${category.toUpperCase()} needs a corrected authoritative answer.`);
    }
  }
  return unresolved;
}
