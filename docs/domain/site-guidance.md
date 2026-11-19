# Source-specific site guidance

- Status: validated

`site_guidance` is a plant fact with one exact subject, source evidence and a cultivation context.
An option combines its fields as a conjunction. For example, two options can express full sun or
partial shade, each with the same moist, well-drained soil conditions. Read each option's role and
applicability together. Options may be alternatives for the same role or distinct observations such as
a preferred site and a tolerated alternative. A `needed` profile is the source's requirement within
its scope. `reported` describes an observation or reported practice; `avoid` describes an adverse
condition. `listed` preserves a source category without inventing a ranking or tolerance level.

`appliesWhen` limits an option, for example to a growing type, establishment phase or growing system.
`qualification` carries the source-specific nuance that cannot be represented by the typed fields.
Consumer displays should retain both. If applicability needs human interpretation, displays may show it
as descriptive guidance with its source and context. Automated recommendations need evaluable applicability.
Geography, life stage, production setting and other conditions shared by the observation remain in its
cultivation context. Commercial projection uses the usual content, evidence, licence and geographic
evidence gates. An option carries no inheritance to a related cultivar or plant concept.

The reviewed mappings is pinned to the GROW `Edible plants` table in
`plant1.accdb`, release [10.15132/10000157](https://doi.org/10.15132/10000157).
The [frozen proposals](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-site-frozen.json)
and the [approved resolution](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-site-resolution.json)
identify the exact fields, records and results.

| Source field or wording                                                                | Consumer meaning                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GROW `Sunlight requirements`: `Full sun`, `partial shade`, `full shade`                | `full_sun`, `partial_shade`, `full_shade`. Slashes join unranked options.                                                                                                         |
| GROW `Soil`: loam/loamy, sand/sandy, clay, silty                                       | Keep exact qualitative classes as `loam`, `loamy`, `sand`, `sandy`, `clay`, `silty`. Loamy and silty do not establish precise particle-size classes. Lists allow several classes. |
| GROW `Soil`: chalk, peat-rich soil, potting mix                                        | Chalk and peat-rich describe material. Potting mix describes substrate. A list with loamy soil and potting mix allows separate options.                                           |
| GROW `Soil`: `Any well-drained and fertile`                                            | One option with both `well_drained` and `fertile`.                                                                                                                                |
| GROW `Soil`: `All soil types`                                                          | The categorical field singles out no soil type.                                                                                                                                   |
| Source prose: light soil, rich soil, organic matter, moist soil and moisture retention | Light soil retains the qualitative description without a particle-size class. Fertility, organic matter, moisture and retention have separate fields.                             |
| Source prose: moist but well-drained, free-draining, fast-draining                     | Maintain any moisture requirement separately. Preserve the source drainage wording without creating a measured rate.                                                              |
| Source prose: sheltered, open, sunny, good light                                       | Shelter and openness describe site exposure. Light keeps qualitative source meaning. Hours appear only where the source states them explicitly.                                   |
| Source prose: acidic or neutral to alkaline                                            | Keep a qualitative pH class. A numerical range requires source bounds.                                                                                                            |

Standalone measured pH and simple drainage retain their existing fact contracts when the evidence and
context support a standalone assertion. Existing scalar facts and their prior reviews remain readable.
Use the [cultivation context](cultivation-context.md) and preserve the [assertion evidence and profile
gates](../architecture/decisions/0003-assertions-and-licence-gates.md).
