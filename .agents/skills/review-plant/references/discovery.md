# Catalog discovery for one plant

## Establish the comparison set

- Identify the crop and the requested growing types and cultivars. Start with
  the canonical records and the latest reviewed packets. Reuse existing
  subject IDs and evidence where they match. Use packet scope IDs for new
  subjects. For a crop-wide comparison with no cultivar list, start with
  relevant reviewed cultivars. If none exist, choose a small, source-backed
  set where it adds useful variety distinctions. Explain the selection or
  the evidence gap in the curator summary.
- Preserve canonical denominations. Propose sourced or curator-directed
  English and French display names where appropriate. Keep market names and
  broad types scoped when a name is used for several distinct cultivars.
- For browse work, reuse existing category IDs, including the discovery pilot
  vocabulary where available. Propose several memberships when useful. Give
  the editorial reason for each. Missing categories leave the crop available
  through search and the full crop list.

## Research values and descriptions

Use the [review policy](../../../../docs/development/plant-review-policy.md)
and [catalog contract](../../../../docs/contracts/catalog-v1.md). Check the
schemas and predicate definitions at the pinned revision.

1. Target traits that distinguish the in-scope varieties or explain suitability.
   Look for exact breeder or maintainer descriptions and documented trials
   before using supplier observations. Consult trial methods and results for
   seed source, site, treatment, and measured endpoint. Preserve independent
   observations with their own provenance and conditions.
2. Start with the traits most useful for this crop, including any requested
   traits. Consider taste, texture, culinary uses, harvest, mature dimensions,
   growth habit, containers, support, sunlight, water, nutrition, and
   temperature tolerance. Transfer an
   existing predicate only when its meaning and value shape match the source.
   For filtering, use the pinned stable codes where supported. Record a
   supported observation with no suitable code as a proposed representation.
3. Retain the source's meaning and context. Keep fruit or head size distinct
   from plant dimensions. Preserve whether harvest duration starts at sowing
   or transplanting, and identify the harvest stage. Record actual container
   or bed, season, stage, and geography when supplied. Crop or growing-type
   advice remains at its scope. A missing cultivar value remains unknown and
   its cultivar remains selectable.
4. Use short equivalent English and French text for descriptions and display
   notes. Keep subjective taste, texture, and reported uses attributed.
   Evidence retains its original wording or value and locator separately.
   Put claims and dispositions into the existing packet domains and use
   `implementation` to flag gaps in the pinned contract.

## Select and show images

- Choose one primary candidate for the crop and for each compared cultivar
  when supported. Open the image bytes and primary source page. Check the
  caption, named cultivar or accession, and visual content. Prefer a clear
  photograph that shows the plant or edible part in its growing environment.
  Label a captioned illustration as such. Where an exact cultivar image
  is unavailable, mark the crop photo as a fallback. If no suitable crop
  image can be verified, report the gap and its cause.
- Show the chosen image inline in the saved curator summary and in the
  handoff. Place the plant or cultivar label with the image, and include
  its proposal ID, credit, and link to the exact image or source record.
  Use the inspected file or a preview of those same bytes. If inline
  rendering is unavailable, attach the inspected image when possible or
  provide a direct link that opens that exact image. Show a shared fallback
  once and name the scopes that use it.
- Record the source page and file locator, file revision or observation date,
  exact subject scope, photo or illustration type, creator, published
  attribution and licence, and stated availability. Leave unavailable
  metadata unknown. For a visual-only selection, record the published metadata
  and leave file-level clearance pending where it has not already been reviewed.
  Such selections are valid inputs for review. Asset release follows the
  repository's independent file-level rights checks. Text and data eligibility
  have their own evidence.
- Prefer stable source and file URLs. When downloading a candidate for
  inspection, keep it in the ignored source-input cache or a temporary
  directory. Record the SHA-256, byte size, and dimensions of verified bytes.
  Save leads when the file is unavailable and mark them as unverified.
  Pack generation, publication, and app activation follow the release
  workflow.

## Save and verify

Keep traits and descriptions in `packet.json`. Save `discovery.json` beside
each new review packet revision. Use `browseMemberships` and `imageCandidates`
arrays, which may be empty when the review records a gap. Each entry carries the
packet `scopeId` and a stable opaque proposal ID. Store the known canonical
subject ID when available. Membership entries identify the category IDs or
proposed bilingual labels and the editorial basis. Image entries carry the
source and file metadata above and label the intended use as an exact subject
image or crop fallback. Existing approved assets may be linked by ID.

In the same curator summary, show each in-scope cultivar's comparable values,
attributed notes, and material unknowns. Show the browse proposals and the
chosen images or documented gaps. Link the sidecar and its SHA-256. Check
the sidecar references, source labels, supported claim value shapes, and any
downloaded file hashes. Verify each displayed image matches its selected
proposal ID and subject. Bind later approval of sidecar entries to the exact
revision, sidecar hash, and entry IDs. The packet retains the standard
eight-domain coverage and existing approval process.
