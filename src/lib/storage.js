// Small localStorage helpers shared by the player and the library. Every call is wrapped, because
// storage can be blocked, full or missing (private windows, thumbnail capture, server render).

export const readStored = (key, fallback = []) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (e) {
    return fallback;
  }
};

// Returns false when the write failed (e.g. storage full), so callers can warn instead of losing data
export const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
};

export const removeStored = (key) => {
  try { localStorage.removeItem(key); } catch (e) {}
};

// Strip heavy payloads before saving, to keep storage and cloud documents small
export const lightTrack = (track) => {
  const light = { ...track };
  delete light.lyrics;
  delete light.djIntro;
  return light;
};
