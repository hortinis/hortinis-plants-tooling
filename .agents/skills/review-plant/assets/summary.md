# Plant claim review

- Plant and growing types: fill from packet scope.
- Packet ID / revision: fill from final packet.
- Packet SHA-256: compute from final packet bytes.
- Research status: in progress; specify whether researchComplete is true.
- Content approval: planned; active integration: planned.
- Coverage: report recommended claims, alternatives/exclusions and unresolved domains.

| Claim ID | Recommended value | Applies to | Source / reuse basis | Qualification |
| -------- | ----------------- | ---------- | -------------------- | ------------- |

## Decisions that need attention

List material conflicts, inferred anchors/type application, licensing limitations and unsupported catalog representation. Omit routine research history.

## Missing data and exclusions

Give the reason, research stopping point and what would resolve each material gap. Link evidence/candidate dispositions in packet.json.

## Catalog discovery

For new reviews, show the browse categories, bilingual descriptions and
cultivar comparison coverage. Show one selected image per subject where
available, with its name, proposal ID, source and credit. Label crop fallbacks
and record gaps. Link the discovery sidecar and its SHA-256. For a focused
update, include the discovery items covered by that update.

## Verification and save state

Report structural and semantic checks actually run, missing captures, saved files and Git commit state. This summary does not admit claims to the active catalog.

## Curator response

Approve the selected claims and images, or identify proposal IDs to revise. Record the decision against the exact packet revision, packet and discovery hashes, and approved entry IDs.
