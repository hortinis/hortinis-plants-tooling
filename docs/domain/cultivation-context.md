# Cultivation context

Every cultivation claim names a reusable context describing where and under what conditions it applies.
Context IDs are stable. A context may specify one or more geographic-context IDs or explicitly state that
geographic scope is unknown.

Supported dimensions are:

- semantic geography (catalog scope, administrative area, source location or climate region);
- growing system: outdoor, unheated shelter, heated greenhouse, indoor or unknown;
- propagation: direct sowing, transplant, vegetative, the source-native combined
  `direct_sowing_or_transplant`, or unknown;
- optional life stage, soil/container, irrigation, protection and home-garden production setting.

The schema intentionally contains no coordinates, polygons, climate cells or dynamic weather data.
Geographic parentage and evidence are records in their own right; it does not imply containment beyond
the explicitly stored links. Missing dimensions stay absent or explicitly unknown. Never present a broad
source claim as France-specific, cultivar-specific or system-specific without evidence.

A source observation may specify `observation.measurementMedium`, `observation.eventAnchor`
and `observation.qualifications`. A germination duration may carry the sowing anchor when the
source basis or review interpretation supports it. Qualify an interpreted anchor in the context.
Keep the context with the fact via `contextId` in both authoring and the consumer catalog. A paired
germination profile retains its temperature and duration in one value. Unknown medium, stage or
protocol supplies no condition for automated recommendations.

The distinct `germination` and `growing_plant` stages preserve source specificity without assuming
that every growing plant is vegetative. The `commercial-field` production setting remains paired
with the original geographic scope. Context conditions, including qualifications, apply only to
the assertion's exact subject.

The `applicabilityPath` lists the qualified scope labels from the review.
Consumers display these restrictions with the fact. They do not use the
labels as subject identifiers or infer that a record applies to the parent in
another context. `regulatorySpecification` identifies the exact designation,
jurisdiction, version and publication date applicable to a production record.
