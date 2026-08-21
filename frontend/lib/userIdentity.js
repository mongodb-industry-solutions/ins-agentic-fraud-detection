/**
 * Anonymous per-browser identity, used only as the agent platform's `user_id`.
 *
 * There is no login in this demo, so this is what lets the platform attribute
 * conversations to distinct actors even though every browser shares one API key.
 */

const USER_ID_KEY = "leafy_fraud_user_id";

export function getOrCreateUserId() {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(USER_ID_KEY);
    if (existing) return existing;

    const created = crypto.randomUUID();
    window.localStorage.setItem(USER_ID_KEY, created);
    return created;
  } catch {
    // Private-browsing modes can throw on localStorage. A missing user id is
    // not worth failing a chat over — the platform treats it as optional.
    return null;
  }
}
