# Pollination guidance

- Status: validated

`pollination_guidance` is an assertion-backed plant fact for conditional pollen transfer and its effects. The
assertion subject is the recipient crop. Each rule names the recipient's applicable cultivar class, sexual
role or crop use. `pollenDonor.subject` is a catalog subject reference with a qualifier identifying the
applicable donor class. For example, a supersweet sweetcorn recipient and a standard sweetcorn donor
use the same crop concept with different cultivar-class qualifiers. Consumers read this as pollen moving
from the qualified donor to the qualified recipient. The reference to a crop concept alone does not
identify an individual cultivar or authorize a reciprocal rule, inheritance, or a pair recommendation.

`pollenCarrier` distinguishes pollen transport by insects or wind from the supplying plant. The
insect-access rule gives a field management action for pollen transfer during flowering. It makes no
claim about the genetics of the source pollen, a need for a separate plant, a specific animal species,
or a yield effect from increasing visits. Cross-pollination rules distinguish a requirement for set,
a possible production benefit, and an adverse quality risk. Self-pollination describes transfer of
own pollen, self-compatibility describes capacity to use it for fertilization, and self-fertility
describes the ability to set a crop with own pollen. Fruit set may still depend on effective transfer.

Each rule's `when` array lists conditions that apply together. `applicabilityPath` preserves the exact
review qualifier where the recipient uses an admitted parent identity for a narrower planting system
or crop use. `evidenceBasis` identifies the batch's evidence as attributed horticultural guidance.
The `limitations` and source setting travel with the value. Consumers use the context ID and evidence
references for source geography, production system, locators and rights. The consumer projector
`projectPollinationGuidance` preserves the exact approved value and uses the same content and rights
eligibility checks as other plant facts.

Plant-to-plant companion claims about habitat, attraction, suppression, physical support, spatial
compatibility or traditional advice require their own evidence and a directed representation.
See [relationships and threats](relationships-and-threats.md).
