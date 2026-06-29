"use client";

import type { FeatureExtractionPipeline } from "@xenova/transformers";

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    const { pipeline } = await import("@xenova/transformers");
    extractor = (await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    )) as FeatureExtractionPipeline;
  }
  return extractor;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const model = await getExtractor();
  const vectors: number[][] = [];
  for (const text of texts) {
    const output = await model(text, {
      pooling: "mean",
      normalize: true,
    });
    vectors.push(Array.from(output.data as Float32Array));
  }
  return vectors;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
