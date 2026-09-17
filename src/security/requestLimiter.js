import { createHash } from 'node:crypto';
import { getTenantSchema } from '../config/tenantContext.js';

// Per-process defense; edge/shared limits are also needed for multiple replicas.
export function requestLimiter({ limit, windowMs, identity = req => req.ip, maxEntries = 10000, now = Date.now }) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, value] of buckets) if (value.until <= time) buckets.delete(key);
    const key = createHash('sha256').update(JSON.stringify([getTenantSchema(), identity(req)])).digest('hex');
    let bucket = buckets.get(key);
    if (!bucket && buckets.size < maxEntries) {
      bucket = { until: time + windowMs, count: 0 };
      buckets.set(key, bucket);
    }
    if (!bucket || ++bucket.count > limit) {
      res.set('Retry-After', String(Math.ceil(((bucket?.until || time + windowMs) - time) / 1000)));
      return res.status(429).json({ detail: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    next();
  };
}
