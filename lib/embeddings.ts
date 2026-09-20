import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// "Xenova/all-MiniLM-L6-v2" is the ONNX export of
// sentence-transformers/all-MiniLM-L6-v2 that transformers.js (the JS port
// of HuggingFace transformers) actually runs — same model/weights, just
// converted to a format this runtime can execute in-process. Runs locally,
// no API key, no network call once the ~90MB model is cached.
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID);
  }
  return extractorPromise;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

// pgvector's wire format is a bracketed literal ("[0.1,0.2,...]"), not a
// native JS/pg type — node-postgres has no vector binding, so queries pass
// this string and cast it with `::vector` in the SQL.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
