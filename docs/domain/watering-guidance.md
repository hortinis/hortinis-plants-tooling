# Watering guidance

- Status: validated

`watering_guidance` is a source-specific plant fact for reference and human judgment. It uses the same exact subject, cultivation context, evidence references and accepted content review as other authored plant facts. Each fact lists one or more related statements from the same proposal. The statements retain crop stages and separate watering actions, water-supply benchmarks, desired moisture, preferred water sources and observations.

Programs can display stage, conditions and the observation trigger alongside each statement. All `allOfConditions` apply together and `anyOfConditions` records alternatives. These fields contain display text. They do not define sensor thresholds or executable predicates. Use the cultivation context for source geography and site. Where present, `applicability` and `applicabilityPath` restrict the exact subject to the stated crop type or growing situation. The path runs from the narrowest qualifier toward its admitted subject. The fact does not transfer to related subjects.

A quantitative statement preserves the original unit, magnitude, range and qualifier in `sourceAmounts`. Multiple amounts in a statement describe the same recommendation in the source's stated units. Display inconsistent printed equivalents with their qualification and refrain from selecting a dose from them. A depth refers to water over the cultivated area. Litres or millilitres require an explicit per-plant or per-container denominator.

`waterAccounting` identifies values that count rainfall, values that represent added irrigation, and values for which the source leaves the distinction open. `amountTiming` distinguishes an event-relative application from a total over a period. `per-reported-interval` preserves the pairing of a depth and an elapsed-time range where the source's wording leaves application count and rainfall accounting open. A period total does not specify how to distribute applications. An interval with `kind: every` records the time between occurrences. `times-per-period` records a count and period unit. An interval can stand alone.

The authoring projection preserves the complete reviewed value and context reference. The commercial projection also requires eligible evidence and source geography under the existing rights gates. A regional source benchmark carries its own geography and growing conditions into every profile.
