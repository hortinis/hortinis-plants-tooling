# Predicate and unit registry

The authoring contract uses a fixed predicate registry. Consumer `plant-fact` records use the fact
predicates and typed values below; cultivation timing is projected into `cultivation-rule`, not treated as
an untyped plant fact.

```text
life_cycle
growth_habit
mature_height
mature_spread
sun_requirement
soil_texture
soil_ph_range
drainage_requirement
water_requirement
frost_sensitivity
minimum_germination_temperature
germination_profile
growing_temperature
germination_days
days_to_first_harvest
harvest_guidance
watering_guidance
establishment_guidance
nutrition_guidance
spacing
```

Authored timing predicates are `sowing_window`, `transplant_window`, `harvest_window` and
`growing_degree_days`; they use the same timing structures as cultivation rules. They remain authoring
claims until the source and context support one explicit catalog action. In particular, do not infer
`start_indoors` versus `direct_sow` from an unspecified sowing window. Numeric values always carry explicit
units. Qualitative values remain qualitative when conversion is not defensible. Never infer a range from a
category or fill a missing bound.

Action-bearing `cultivation_window` assertions use the catalog action vocabulary and may retain the source
action, source timing and mapping method alongside the typed value. `identity` mappings must preserve the
source action; a combined sowing-or-transplant claim may only map to `establish_outdoors`. Dynamic
`plant_now`, ambiguous actions and unanchored timing remain deferred decisions.

[Harvest guidance](harvest-guidance.md) uses elapsed intervals with explicit source units,
anchors and endpoints. Its curing and storage quantities retain their source temperature units.

[Planting and establishment guidance](establishment-guidance.md) keeps source timing, preparation,
dimensions and thermal observations on the relevant action.

## Temperature profiles

Cultivation temperature profiles use Celsius (`Cel`) and include only source-supported members:

```json
{ "unit": "Cel", "minimum": 10, "maximum": 30, "optimum": 24 }
```

`minimum`, `maximum` and `optimum` are independently optional; the profile is invalid if all are absent.
When both bounds and an optimum are supplied, the optimum must lie within the bounds. GROW's optimum
germination field may be a scalar optimum or a source-labelled optimum band. The ideal growing-temperature
range is the reported ideal band, not an absolute survival range. GROW temperatures are normalized to
Celsius under a reviewed source-specific mapping and retain the exact original source value in provenance.

Germination duration is conditional on the reported germination temperature. Store the available
components together in a `germination_profile` or, when the source describes a specific action and
its conditions, in one step of `establishment_guidance`. Durations use the UCUM day unit `d`.
Do not publish an unqualified duration when its source specifies an optimum temperature.

Growing-degree-day thresholds use `Cel.d`, an explicit base temperature, the fixed `daily-mean` method and
an explicit accumulation anchor. Soil-temperature thresholds use `Cel` and may carry source-supported
measurement details. A missing anchor, method or unit is not inferred.

[Watering guidance](watering-guidance.md) preserves source depth or volume, rainfall accounting, application or period semantics, and qualitative conditions.

[Temperature and frost guidance](temperature-guidance.md) uses `temperature_guidance`
for source-specific roles, stage, medium, time basis, exposure and protection. Existing simple
frost and temperature predicates remain available for their reviewed records.

[Nutrition and feeding guidance](nutrition-guidance.md) keeps source application quantities,
their product or nutrient basis, original units, denominators, formulation and local-input
prerequisites together.
