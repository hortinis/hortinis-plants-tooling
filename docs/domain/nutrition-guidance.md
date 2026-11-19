# Nutrition and feeding guidance

- Status: validated

`nutrition_guidance` projects as a plant fact for its exact reviewed subject through
`projectNutritionGuidance`. Resolve `contextId` for source geography, production setting and growing
system. Apply the exact `applicabilityPath` when present. Observations and guidance stay on the authored
subject and do not propagate to a comparison, cultivar or other growing type.

Each value has `evaluation: source-guidance-only`. Consumers can present the source statement and the
inputs or checks it requires. A missing prerequisite leaves the site-specific decision unresolved.
Even when a user supplies those inputs, this contract provides no fertilizer calculation, local
calibration or task scheduling. `sequence` orders actions, such as testing soil before correcting
nutrients. Within an action, the split program and seasonal feed have their own ordered steps.

The action code distinguishes advisory referral, soil testing, soil nutrient correction, a
soil fertility observation, a deficiency assessment, manure amendment, seasonal maintenance feeding,
an observation that additional feeding is unnecessary, and source application benchmarks.
`when` states the trigger and `prerequisites` identifies the required local inputs or assessments.
A deficiency assessment records a possible risk; its conditions and cautions do not trigger dosing.

Amounts carry `basis`, original number and unit, denominator, and period. The mineral-soil garlic
program records a program total of elemental N per acre and a fraction of that same total at spring
growth. The remaining fraction goes into the stated number of side dressings. The source gives the
interval between those dressings and leaves the initial gap and distribution of the remainder
unspecified. The product concentration is required for any product-mass calculation. A nutrient
identifier distinguishes elemental and oxide-equivalent bases. The contract makes no conversion
between them.

The potato benchmark records paired approximate product masses per seed piece and separate soil-layer
depths in the original units. The paired numbers are two source expressions of the same benchmark.
Retain the soil-texture-specific source grade examples and the product-label prerequisite. The
`unresolvedSourceRates` array carries the source's ambiguous area and volume alternatives and their
issues. These entries have no usable application dimension in the contract. A grade does not supply
an application rate, and a mass cannot serve as a dilution or concentration.

The container lemon record preserves the RHS switch between seasonal formulations with the
source's month qualifiers. Dose, dilution and repeat frequency depend on the chosen product.
Border-grown nasturtiums have a separate condition for no supplemental feeding. The sweet potato
manure timing applies only when using manure, and the qualitative lead time carries no inferred
duration. Watering is recorded independently.

The commercial projection uses the normal evidence, licence and review gates. See the
[batch decisions](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-nutrition-decisions.md).
