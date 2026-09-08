const store = new Map();

function getCached(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.value;
  const promise = Promise.resolve()
    .then(loader)
    .catch((err) => {
      store.delete(key);
      throw err;
    });
  store.set(key, { ts: Date.now(), value: promise });
  return promise;
}

function clearCache(key) {
  store.delete(key);
}

module.exports = { getCached, clearCache };