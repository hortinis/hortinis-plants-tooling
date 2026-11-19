/** Reviewed categorical labels from the pinned GROW Access release. */
const soilClasses = {
  loam: { texture: "loam" },
  loamy: { texture: "loamy" },
  sand: { texture: "sand" },
  sandy: { texture: "sandy" },
  clay: { texture: "clay" },
  silty: { texture: "silty" },
  chalk: { material: "chalk" },
  "peat-rich soil": { material: "peat_rich" },
  "potting mix": { substrate: "potting_mix" },
} as const;
const lightClasses = {
  "full sun": { light: "full_sun" },
  "partial shade": { light: "partial_shade" },
  "full shade": { light: "full_shade" },
} as const;

export function mapGrowSiteClass(
  field: "Soil" | "Sunlight requirements",
  original: string,
) {
  const value = original.trim().toLowerCase();
  if (field === "Soil" && value === "any well-drained and fertile") {
    return {
      options: [
        { role: "listed", drainage: "well_drained", fertility: "fertile" },
      ],
    };
  }
  if (field === "Soil" && value === "all soil types") {
    return {
      options: [
        { role: "listed", qualification: "No soil type is singled out." },
      ],
    };
  }
  const vocabulary: Readonly<Record<string, object>> =
    field === "Soil" ? soilClasses : lightClasses;
  const options = [];
  for (const label of value.split(/\s*(?:,|\/|\band\b)\s*/u)) {
    const mapped = Object.hasOwn(vocabulary, label)
      ? vocabulary[label]
      : undefined;
    if (!mapped) return undefined;
    options.push({ role: "listed", ...mapped });
  }
  return { options };
}
