# Cultivation rules

A cultivation rule is a reviewed, evidence-backed parameter for one action, subject and context. It is
not a current recommendation. A rule never substitutes a missing date, temperature, anchor, context or
observation with a guessed value.

The V1 action registry is fixed:

- `start_indoors`
- `direct_sow`
- `transplant`
- `plant`
- `harvest`
- `establish_outdoors`
- `sow_indoors_or_undercover`

Timing uses the following forms.

- `calendar-month-window`: start and end months;
- `calendar-date-window`: start and end month/day pairs, without a year;
- `relative-day-window`: integer offsets from last spring frost, first autumn frost or previous crop
  harvest;
- `soil-temperature-threshold`: at-least, at-most or between temperatures in `Cel`, with optional
  measurement depth, period and aggregation;
- `growing-degree-day-threshold`: threshold in `Cel.d`, explicit base temperature in `Cel`, fixed
  `daily-mean` method and stated accumulation anchor;
- `conditional-season`: a recurring planning season without day or month boundaries. The `allOf`
  list requires every applicable condition. Conditions can carry qualitative guidance, the passing
  of local frost risk, a soil-temperature threshold or air temperature reliably above a threshold.
  A condition with `appliesTo: transplant` is required for that route. The rule carries confidence
  and limitations, including unspecified measurement depth or persistence where relevant.

Authored action decisions retain the source action and timing before projection. A source-native action is
mapped by an explicit method, and the projection must retain the typed timing exactly. `plant_now`,
ambiguous soil-temperature meaning and harvest durations without an anchor are not narrowed into a rule;
they remain deferred.

Calendar-month and calendar-date windows remain different values. Start/end order may describe a window
crossing year-end. Validation must reject impossible month/day pairs (including February 30), even though
JSON Schema alone checks only the individual month and day ranges. GDD method is not guessed from a source;
the V1 supported method is only `daily-mean`.

Rules retain plant-concept, cultivar-group or cultivar scope. A selected cultivar receives eligible
parent rules unless a cultivar rule lists a parent rule in `supersedesRuleIds` or the rule requires exact
subject applicability. Conditional-season rules require `exact-subject-only` and
`local-observation-required`. Match the explicit commune and cultivation context before displaying the
rule. A match establishes scope. The gardener checks the conditions in the year of use. Consumers
carry the whole conjunction and preserve the distinction between a seasonal cue and a calendar window.
For `reliably-above`, the source supplies a strict threshold and leaves the observation duration open.

Local inferences use `mappingMethod: local-inference` on the authoring assertion. The assertion carries
the proposal ID and derivation method. The admission review holds the exact approval and source
comparison lineage. Catalog validation checks that each local rule cites a live, accepted mapping
for its exact subject and packet revision, including the original approval binding when a mapping
was admitted by a later batch. `projectCultivationRules` carries action, subject, context, review, evidence and the
complete timing object into the consumer contract. The authoring projection supports inspection.
The commercial projection requires accepted rights and commercially allowed licences on referenced
evidence, including geography evidence. Release profile selection and packaging follow the C5 handoff.

The Bordeaux workbook explicitly groups sowing indoors and sowing under cover
under one heading. The projected `sow_indoors_or_undercover` action retains that
alternative with the `indoor_or_undercover` context. The source specifies no
heating, so consumers cannot treat this as heated indoor propagation, a
guaranteed unheated shelter window or an outdoor date. The authoring source
timing retains the ordinal source season and the 2017 Excel carrier year.
A year-end window retains ordered month/day boundaries. Source qualifications
and autumn-planted onion applicability are in the projected context.
