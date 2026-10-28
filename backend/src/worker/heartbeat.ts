/** Clé Redis rafraîchie par le worker : permet à /health/ready d'indiquer s'il tourne. */
export const WORKER_HEARTBEAT_KEY = 'ineed:worker:heartbeat';
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
/** Au-delà de ce délai sans battement, le worker est considéré comme absent. */
export const WORKER_HEARTBEAT_TTL_S = 60;
