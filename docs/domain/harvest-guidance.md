# Harvest and postharvest guidance

- Status: validated

`harvest_guidance` describes an exact subject and source context. It can describe
harvest readiness, collection, quality observations, elapsed timings, cultivar
maturity classes, curing, surface drying, ripening, fresh storage, overwintering
and source-specific storage ratings. Each fact names the relevant plant part.
The operation, stage, purpose, applicability and cues describe the source's
intended use. These facts carry no edibility, safety or preservation guarantee.

Use [cultivation rules](calendar-rules.md) for calendar windows and reviewed
conditional-season rules. Use `days_to_first_harvest` where the source supports
that exact endpoint and the existing day-range shape. The harvest guidance
contract preserves other elapsed quantities and qualifications.

- `timing` carries the role, start event, endpoint, original unit and supported
  bounds. It may carry a qualifier or a condition specific to that interval.
  The explicit `unknown` start retains an unstated event. Check intervals
  describe inspection of the crop, and harvest frequency describes collection.
  Neither schedules an initial harvest. An unknown anchor supplies descriptive
  guidance only.
- A single fact can retain multiple related timings. The salad-radish benchmark
  retains the earliest germination-relative estimate and the separate
  early-sowing estimate. Each interval keeps its own anchor and condition.
- `allOfConditions` applies jointly to the whole fact. Where present,
  `preparation` is ordered and precedes the operation. For example, fully
  curing storage onions precedes keeping the bulbs dry with circulating air.
  A best-quality window after harvest is a quality estimate.
- Temperature, relative humidity and size quantities use the source unit.
  A diameter qualifier indicates how to read a boundary. Cultivar ratings
  retain the source label and scoring scheme. A maturity class or keeping
  rating supplies no elapsed duration.

`projectHarvestGuidance` preserves the value, subject, context, review and
evidence references in the consumer fact. Match the exact subject. Apply the
recorded source geography, growing setting, preparation and combined
conditions when displaying a fact. A named applicability subset remains
required on a broader subject. Parent, comparison and cultivar links confer
no inheritance. A relative benchmark supplies no local date by itself.
The authoring projection supports inspection of accepted content. The
commercial projection enforces the existing evidence, licence and geographic
rights gates.

[Harvest guidance schema](../../schemas/catalog/v1/harvest-guidance.schema.json)
