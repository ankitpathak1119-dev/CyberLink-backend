const crypto = require("crypto");

function resolveKey() {
  const raw = process.env.MESSAGE_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
  // Derive fixed 32-byte key from configured secret.
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptText(plainText) {
  const iv = crypto.randomBytes(12);
  const key = resolveKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    cipherText: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decryptText({ cipherText, iv, authTag }) {
  const key = resolveKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(String(iv), "base64")
  );
  decipher.setAuthTag(Buffer.from(String(authTag), "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(cipherText), "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function privateConversationKey(a, b) {
  const p = [String(a).toLowerCase(), String(b).toLowerCase()].sort();
  return `p:${p[0]}::${p[1]}`;
}

function groupConversationKey(group) {
  return `g:${String(group || "").toLowerCase().trim()}`;
}

module.exports = {
  encryptText,
  decryptText,
  privateConversationKey,
  groupConversationKey,
};

