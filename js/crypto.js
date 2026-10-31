// Decrypts the bundle envelope written by pipeline/instagene/crypto.py.
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(passphrase, saltB64, iter) {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(saltB64), iterations: iter },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

export async function decryptWithKey(env, key) {
  let plain;
  try {
    plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(env.iv) },
      key,
      b64ToBytes(env.ct),
    );
  } catch {
    throw new Error("bad-passphrase");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function decryptBundle(env, passphrase) {
  const key = await deriveKey(passphrase, env.salt, env.iter);
  const data = await decryptWithKey(env, key);
  return { data, key };
}
