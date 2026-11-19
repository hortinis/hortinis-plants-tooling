# Temperature and frost guidance

- Status: validated

The `temperature_guidance` predicate represents source-specific observations for the exact
subject and cultivation context. The [schema](../../schemas/catalog/v1/temperature-guidance.schema.json)
uses the existing planting quantity shape for Celsius (`Cel`) and Fahrenheit (`[degF]`).
The `projectTemperatureGuidance` consumer projection carries the entire value, with context,
evidence and review identifiers. Qualifiers in `applicabilityPath` restrict a record to the named
growing type or management condition. Catalog relationships confer no applicability.

Each observation identifies a response role, measurement medium and time basis. A reported growth
range, a best-production band and a germination optimum are distinct observations. The bounds in
`quantity` bound the reported value for that role. An explicit `above`, `below`, `at-least` or
`at-most` comparison preserves the source threshold direction. Daytime and nighttime entries can
describe a paired regime, identified in their conditions. A day or night temperature carries no
implied minimum, maximum or averaging method. Use `unspecified` when the source leaves the medium
or time basis open. Retain stated parts, life stages, protection, growing settings and exposure
duration. Time to sprouting after planting is a different duration from time spent exposed to cold.

GROW's `Temperature class` labels such as `Hardy` and `Half hardy` are kept under the GROW
2020 scheme without numeric conversions. The RHS's `H3` is a separate UK rating. The Manitoba
production guides describe frost sensitivity in words and keep any numerical growth advice under
its own role. Flower damage, yield effects and survival of floral tissue are separate responses.
Where a publisher gives parallel units, the text identifies their relationship. Where the source
expresses only a qualitative condition, the observation has no temperature quantity.

All current values are `observation-dependent`. Numeric claims and descriptive actions retain their
original scope and conditions. A consumer can display them or filter by role, subject or context.
Promotion into a locally evaluated frost or planting rule would need its own reviewed input and
applicability. Commercial projection applies the same rights gate as other plant facts.
