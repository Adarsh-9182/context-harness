import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { AppError } from "./http";

export type EncryptedKey = {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export async function masterKey(): Promise<Buffer> {
  if (process.env.HARNESS_MASTER_KEY) {
    const key = Buffer.from(process.env.HARNESS_MASTER_KEY, "base64");
    if (
      key.length !== 32 ||
      key.toString("base64") !== process.env.HARNESS_MASTER_KEY
    )
      throw new AppError(
        503,
        "configuration_error",
        "HARNESS_MASTER_KEY must be a base64-encoded 32-byte key.",
      );
    return key;
  }
  if (process.env.NODE_ENV === "production")
    throw new AppError(
      503,
      "configuration_error",
      "The encryption master key has not been configured.",
    );
  const directory = resolve(process.env.HARNESS_DATA_DIR || ".local");
  const path = resolve(directory, "master-key");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, randomBytes(32).toString("base64"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const encoded = (await readFile(path, "utf8")).trim();
  await chmod(path, 0o600);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded)
    throw new AppError(
      503,
      "configuration_error",
      "The local encryption key is damaged. Restore it before accessing saved connections.",
    );
  return key;
}

export async function encryptKey(plaintext: string): Promise<EncryptedKey> {
  if (!plaintext || plaintext.length > 8192)
    throw new AppError(400, "invalid_key", "Enter a valid API key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await masterKey(), iv);
  cipher.setAAD(Buffer.from("harness:provider-key:v1"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export async function decryptKey(envelope: EncryptedKey): Promise<string> {
  try {
    if (
      !envelope ||
      envelope.v !== 1 ||
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.ciphertext !== "string"
    )
      throw Error("invalid");
    const iv = Buffer.from(envelope.iv, "base64"),
      tag = Buffer.from(envelope.tag, "base64");
    if (
      iv.length !== 12 ||
      tag.length !== 16 ||
      envelope.ciphertext.length > 16_384
    )
      throw Error("invalid");
    const decipher = createDecipheriv("aes-256-gcm", await masterKey(), iv);
    decipher.setAAD(Buffer.from("harness:provider-key:v1"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      500,
      "credential_unavailable",
      "This saved connection could not be decrypted. Restore the original master key or reconnect the provider.",
    );
  }
}
