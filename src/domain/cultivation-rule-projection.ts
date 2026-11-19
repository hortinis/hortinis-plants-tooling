import { assertionProjectionEligibility } from "./assertion-projection-eligibility.js";
import { validate } from "../schema/validation-api.js";
import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";

function asRecord(value: unknown): DatasetRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DatasetRecord)
    : undefined;
}

/** Project accepted cultivation windows from a structurally validated dataset. */
export function projectCultivationRules(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
): DatasetRecord[] {
  const eligible = assertionProjectionEligibility(dataset, profile);
  const rules: DatasetRecord[] = [];
  for (const assertion of dataset.assertions) {
    if (assertion.predicate !== "cultivation_window") continue;
    if (!eligible(assertion)) continue;
    const ids = assertion.evidenceReferenceIds;
    const value = asRecord(assertion.value);
    const rule = {
      id: assertion.id,
      status: "active",
      subject: assertion.subject,
      contextId: assertion.contextId,
      reviewId: assertion.reviewId,
      evidenceReferenceIds: ids,
      action: value?.action,
      timing: value?.timing,
    };
    const result = validate(
      "urn:hortinis:plants:schema:v1:cultivation-rule",
      rule,
    );
    if (!result.valid)
      throw new Error(
        `Invalid cultivation rule ${String(rule.id)}: ${JSON.stringify(result.errors)}`,
      );
    rules.push(rule);
  }
  return rules;
}

/** Match applicability only. The season and observations still guide the gardener. */
export function matchesConditionalCultivationRule(
  rule: DatasetRecord,
  context: DatasetRecord,
  geography: DatasetRecord,
  garden: {
    subject: { type: string; id: string };
    communeCode: string;
    growingSystem: string;
    soilOrContainer: string;
    protection: string;
    productionSetting: string;
  },
): boolean {
  const subject = asRecord(rule.subject);
  const area = asRecord(geography.administrativeCode);
  const scope = asRecord(context.geographicScope);
  return (
    asRecord(rule.timing)?.type === "conditional-season" &&
    rule.status === "active" &&
    geography.status === "active" &&
    rule.contextId === context.id &&
    scope?.type === "specified" &&
    Array.isArray(scope.geographicContextIds) &&
    scope.geographicContextIds.includes(geography.id) &&
    area?.scheme === "INSEE-COG-commune" &&
    area.code === garden.communeCode &&
    subject?.type === garden.subject.type &&
    subject.id === garden.subject.id &&
    context.growingSystem === garden.growingSystem &&
    context.soilOrContainer === garden.soilOrContainer &&
    context.protection === garden.protection &&
    context.productionSetting === garden.productionSetting
  );
}
