# Plant care guidance

- Status: validated

`care_guidance` is a source-specific plant fact for a reviewed care operation.
`projectCareGuidance` projects the authored value, exact subject, context reference,
review and evidence references together. Consumers resolve the context reference to
display the source geography and growing system. The commercial profile applies
the same source, licence and review gates as other plant facts.

Each group describes independent operations, alternatives, or a source-stated
sequence. A consumer can offer any applicable alternative. Required alternatives
express a required choice of method. Only a sequence indicates that one action
depends on the preceding action. Multiple groups carry no implied order.

Each action has a strength and a target. Required, recommended, optional,
prohibited and unnecessary convey distinct source instructions. The strength applies
to the entire action, including its target, method and conditions. For example, the
potato rotation warning prohibits repeated planting in the same bed each year. Action codes
distinguish operations such as maintenance pruning, renewal pruning, deadheading,
pinching, thinning, training, installing support and removing spent material.
Method codes are available where the reviewed source identifies a particular
support or weed-removal method. Dedicated fields carry purpose, cutting position,
material, placement, tools, frequency and measured bounds as applicable.

Preserve all conditions on an action. `allOfConditions` joins conditions;
`anyOfConditions` offers alternatives within one condition set. `allOfTiming`
and `anyOfTiming` apply the same distinction to the existing establishment
timing contract. An event anchor stays attached to its action. A calendar month
applies only in the source context. An applicability path is the exact reviewed
qualifier chain on the subject and must travel with that fact. A growing-type
qualifier applies only as recorded, including when the authoring subject is the
admitted parent and the qualifier supplies the narrower form. Consumers must
not inherit it between subjects or treat a narrower form as a catalog identity.

Display these as observation-dependent guidance. Geographic adaptation,
evaluating a trigger from garden measurements, and automatic scheduling need
separate reviewed models. See the [plant care decisions](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-care-decisions.md).

The Manitoba raspberry refinement uses explicit action conditions for the second
and following years, a source-local April or early May seasonal cue, ground-level
cut position, disposal method text and a separate healthy-cane retention action.
Early May has no invented day boundary. These observations remain dependent on
local judgment; they do not create an automated calendar rule.

Accepted reviews may carry `assertionSupersessions` with exact predecessor and
successor IDs and content digests. This same-subject, same-predicate refinement
mechanism leaves historical records immutable and removes the predecessor from
active projections in both profiles. It does not create a cultivar override or
transfer applicability between subjects. The review is validated with the
catalog; missing, changed, duplicate and cyclic lineage fails validation.
