/**
 * Experiments Service — A/B Testing with deterministic assignment
 * Assigns variants based on a stable hash of conversationId + experimentKey.
 */
import prisma from "../db.server";

/**
 * Get all active (running) experiments with their variants
 * @returns {Promise<Array>}
 */
export async function getActiveExperiments() {
  return prisma.experiment.findMany({
    where: { status: 'running' },
    include: { variants: true }
  });
}

/**
 * Deterministic variant assignment.
 * Uses a hash of conversationId + experimentKey for stable bucketing.
 * Returns the assigned variant, creating an ExperimentAssignment if new.
 *
 * @param {string} experimentKey
 * @param {string} conversationId
 * @param {string} [shopId]
 * @returns {Promise<object|null>} The assigned variant or null
 */
export async function assignVariant(experimentKey, conversationId, shopId) {
  // 1. Check existing assignment
  const existing = await prisma.experimentAssignment.findFirst({
    where: {
      conversationId,
      experiment: { key: experimentKey }
    },
    include: { variant: true }
  });
  if (existing) return existing.variant;

  // 2. Load experiment + variants
  const experiment = await prisma.experiment.findUnique({
    where: { key: experimentKey },
    include: { variants: true }
  });
  if (!experiment || experiment.variants.length === 0) return null;

  // 3. Deterministic hash → variant selection
  const hash = simpleHash(conversationId + ':' + experimentKey);
  const variant = selectByWeight(experiment.variants, hash);

  // 4. Persist assignment
  await prisma.experimentAssignment.create({
    data: {
      experimentId: experiment.id,
      variantId: variant.id,
      conversationId,
      shopId: shopId || null
    }
  });

  return variant;
}

/**
 * Get all assignments for a conversation (across experiments)
 * @param {string} conversationId
 * @returns {Promise<Array>}
 */
export async function getConversationAssignments(conversationId) {
  return prisma.experimentAssignment.findMany({
    where: { conversationId },
    include: { variant: true, experiment: true }
  });
}

/**
 * Simple deterministic hash (djb2 algorithm)
 * @param {string} str
 * @returns {number} Positive integer hash
 */
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash);
}

/**
 * Select a variant based on weight distribution
 * @param {Array} variants - [{id, key, weight}, ...]
 * @param {number} hash - Deterministic hash value
 * @returns {object} Selected variant
 */
function selectByWeight(variants, hash) {
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  const bucket = (hash % 1000) / 1000;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight / totalWeight;
    if (bucket < cumulative) return variant;
  }
  return variants[variants.length - 1];
}
