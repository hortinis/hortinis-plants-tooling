import { Readable } from "node:stream";
import { readJsonLines } from "../serialization/json-lines.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { compressDeterministicGzip } from "./deterministic-gzip.js";
import {
  serializeCanonicalJson,
  parseJsonStrict,
} from "../serialization/canonical-json.js";
import { validate } from "../schema/validation-api.js";
import type { DatasetRecord } from "../curation/validation-dataset.js";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown) =>
  Buffer.from(serializeCanonicalJson(value));
const schema = (kind: string) => "urn:hortinis:plants:schema:v1:" + kind;
function check(kind: string, row: unknown) {
  const result = validate(schema(kind), row);
  if (!result.valid)
    throw new Error(`Invalid ${kind}: ${JSON.stringify(result.errors)}`);
}

/** Non-publishable acquisition candidate using the actual catalog contracts and compressor. */
export async function buildCatalogCandidate(
  directory: string,
  families: Readonly<Record<string, readonly DatasetRecord[]>>,
  metadata: Readonly<Record<string, unknown>>,
  options: {
    targetBytes?: number;
    maximumBytes?: number;
    profile?: "dev-validation" | "reviewed-catalog";
  } = {},
) {
  const target = options.targetBytes ?? 1024 * 1024;
  const maximum = options.maximumBytes ?? 2 * 1024 * 1024;
  if (target <= 0 || maximum < target || maximum > 2 * 1024 * 1024)
    throw new Error("Invalid chunk budget");
  await mkdir(directory, { recursive: true });
  const artifacts: DatasetRecord[] = [];
  for (const kind of Object.keys(families).sort()) {
    const rows = [...families[kind]!].sort((a, b) =>
      String(a.id).localeCompare(String(b.id), "en"),
    );
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error("Duplicate record ID");
    for (const row of rows) check(kind, row);
    let index = 0;
    const emit = async (part: readonly DatasetRecord[]): Promise<void> => {
      if (!part.length) return;
      const framed = Buffer.concat(
        part.map((row) => Buffer.concat([canonical(row), Buffer.from("\n")])),
      );
      const zipped = compressDeterministicGzip(framed, part.length);
      if (zipped.compressedByteSize > target && part.length > 1) {
        const mid = Math.floor(part.length / 2);
        await emit(part.slice(0, mid));
        await emit(part.slice(mid));
        return;
      }
      if (zipped.compressedByteSize > maximum)
        throw new Error("Single record exceeds maximum compressed chunk size");
      const path = `${kind}-${String(index++).padStart(4, "0")}.jsonl.gz`;
      const descriptor = {
        path,
        kind: "jsonl-gzip",
        mediaType: "application/x-ndjson",
        schemaId: schema(kind),
        contentEncoding: "gzip",
        byteSize: zipped.compressedByteSize,
        entryCount: part.length,
        sha256: zipped.sha256,
      };
      check("chunk-descriptor", descriptor);
      await writeFile(join(directory, path), zipped.bytes);
      artifacts.push(descriptor);
    };
    await emit(rows);
  }
  for (const name of Object.keys(metadata).sort()) {
    if (!/^[a-z0-9-]+\.json$/.test(name))
      throw new Error("Unsafe metadata path");
    const bytes = canonical(metadata[name]);
    await writeFile(join(directory, name), bytes);
    const descriptor = {
      path: name,
      kind: name === "schemas.json" ? "schema" : "json-document",
      role: name === "schemas.json" ? "schemas" : "other",
      ...(name === "schemas.json"
        ? { schemaId: "urn:hortinis:plants:schema:v1:audit-bundle" }
        : {}),
      mediaType: "application/json",
      byteSize: bytes.length,
      sha256: sha(bytes),
    };
    check("artifact-descriptor", descriptor);
    artifacts.push(descriptor);
  }
  const manifest = {
    schemaVersion: "1.0.0",
    catalogVersion: "0.0.0",
    minimumConsumerVersion: "0.0.0",
    profile: options.profile ?? "dev-validation",
    generatedAt: "2026-11-17T00:00:00Z",
    requiredArtifacts: artifacts,
    optionalArtifacts: [],
  };
  check("release-manifest", manifest);
  await writeFile(join(directory, "manifest.json"), canonical(manifest));
  return manifest;
}

/** Verify bytes before parsing records; caller owns operator trust and version compatibility policy. */
export async function ingestCatalogCandidate(directory: string) {
  const manifest = parseJsonStrict(
    await readFile(join(directory, "manifest.json")),
  ) as DatasetRecord;
  check("release-manifest", manifest);
  const families: Record<string, DatasetRecord[]> = {};
  const paths = new Set<string>();
  const ids = new Set<unknown>();
  for (const descriptor of manifest.requiredArtifacts as DatasetRecord[]) {
    const path = String(descriptor.path);
    if (paths.has(path) || path.includes("..") || path.startsWith("/"))
      throw new Error("Duplicate or unsafe artifact path");
    paths.add(path);
    const bytes = await readFile(join(directory, path));
    if (
      bytes.length !== descriptor.byteSize ||
      sha(bytes) !== descriptor.sha256
    )
      throw new Error("Artifact checksum or size mismatch");
    if (descriptor.kind !== "jsonl-gzip") {
      parseJsonStrict(bytes);
      continue;
    }
    if (bytes.length > 2 * 1024 * 1024) throw new Error("Oversized chunk");
    if (bytes[3] !== 0 || bytes.readUInt32LE(4) !== 0 || bytes[9] !== 255)
      throw new Error("Non-deterministic gzip header");
    const uncompressed = gunzipSync(bytes);
    const text = uncompressed.toString("utf8");
    if (!text.endsWith("\n") || text.includes("\r"))
      throw new Error("Invalid JSONL framing");
    const lines = text.slice(0, -1).split("\n");
    if (lines.length !== descriptor.entryCount)
      throw new Error("Entry count mismatch");
    const kind = String(descriptor.schemaId).replace(schema(""), "");
    const rows = families[kind] ?? [];
    for await (const entry of readJsonLines(Readable.from([uncompressed]), {
      schemaId: String(descriptor.schemaId),
    })) {
      const row = entry.value as DatasetRecord;
      const line = lines[entry.lineNumber - 1]!;
      if (ids.has(row.id)) throw new Error("Duplicate ingested ID");
      ids.add(row.id);
      rows.push(row);
      if (canonical(row).toString() !== line)
        throw new Error("Noncanonical record");
    }
    families[kind] = rows;
  }
  return { manifest, families };
}
