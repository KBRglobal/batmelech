'use strict';

// The client's purchased storage plan (2 GB) and account facts, plus the
// metering that backs them. Usage is the actual byte count of her content
// in the R2 bucket (menu photos, delivery proofs, migrated site images);
// the nightly `backups/` prefix is service overhead and does not count.
//
// Sits behind the admin decoy gate (mounted under /api/settings, already in
// PROTECTED_PREFIXES) — never reachable without a valid staff session.

const express = require('express');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const PLAN = Object.freeze({
  storageLimitBytes: 2 * 1024 * 1024 * 1024, // 2 GB purchased plan
  upgradeUrlYearly: '', // Stripe payment link — filled once created
  upgradeUrlMonthly: '', // Stripe payment link — filled once created
  domainName: 'batmelech.ae',
  domainExpiry: '', // ISO date — filled once known
  supportContact: 'KBR',
});

const EXCLUDED_PREFIX = 'backups/';
const CACHE_TTL_MS = 5 * 60 * 1_000;

function createStoragePlan({ env = process.env, clientFactory = (config) => new S3Client(config), logger = console } = {}) {
  const configured = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].every(
    (name) => typeof env[name] === 'string' && env[name].trim() !== ''
  );

  let client = null;
  let cache = null; // { usedBytes, objectCount, at }

  function resolveClient() {
    if (client === null) {
      client = clientFactory({
        region: 'auto',
        endpoint: env.R2_ENDPOINT.trim(),
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
          secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
        },
      });
    }
    return client;
  }

  async function measureUsage() {
    if (!configured) return { usedBytes: 0, objectCount: 0 };
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return { usedBytes: cache.usedBytes, objectCount: cache.objectCount };
    }
    let usedBytes = 0;
    let objectCount = 0;
    let continuationToken;
    do {
      const response = await resolveClient().send(
        new ListObjectsV2Command({
          Bucket: env.R2_BUCKET_NAME.trim(),
          ContinuationToken: continuationToken,
        })
      );
      for (const object of response.Contents || []) {
        if (typeof object.Key === 'string' && object.Key.startsWith(EXCLUDED_PREFIX)) continue;
        usedBytes += object.Size || 0;
        objectCount += 1;
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    cache = { usedBytes, objectCount, at: Date.now() };
    return { usedBytes, objectCount };
  }

  async function isOverQuota(incomingBytes) {
    try {
      const { usedBytes } = await measureUsage();
      return usedBytes + (incomingBytes || 0) > PLAN.storageLimitBytes;
    } catch (error) {
      // Metering failure must not take uploads down with it.
      logger.error('[storage-plan] usage check failed:', error?.message || error);
      return false;
    }
  }

  function invalidateCache() {
    cache = null;
  }

  function createRouter() {
    const router = express.Router();
    router.use((_request, response, next) => {
      response.set('Cache-Control', 'no-store');
      next();
    });
    router.get('/', async (_request, response) => {
      try {
        const { usedBytes, objectCount } = await measureUsage();
        response.json({
          usedBytes,
          objectCount,
          limitBytes: PLAN.storageLimitBytes,
          upgradeUrlYearly: PLAN.upgradeUrlYearly,
          upgradeUrlMonthly: PLAN.upgradeUrlMonthly,
          domainName: PLAN.domainName,
          domainExpiry: PLAN.domainExpiry,
          supportContact: PLAN.supportContact,
        });
      } catch (error) {
        logger.error('[storage-plan] failed to read usage:', error?.message || error);
        response.status(502).json({ error: 'storage usage unavailable' });
      }
    });
    return router;
  }

  return { enabled: configured, plan: PLAN, measureUsage, isOverQuota, invalidateCache, createRouter };
}

module.exports = { createStoragePlan, PLAN };
