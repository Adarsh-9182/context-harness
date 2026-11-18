import { AppError } from "./http";

export const OPENAI_ISSUER = "https://auth.openai.com";
export const OPENAI_RESOURCE = "https://api.openai.com/v1";

/** Only explicit local test runs may replace the official service endpoints. */
export function accountEndpoints() {
  const origin = process.env.HARNESS_TEST_PROVIDER_ORIGIN;
  if (process.env.HARNESS_E2E === "true" && process.env.NODE_ENV !== "production" && origin) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new AppError(503, "configuration_error", "The account test service must use a loopback origin.");
    return {
      authorize: `${url.origin}/chatgpt/authorize`,
      token: `${url.origin}/chatgpt/token`,
      jwks: `${url.origin}/chatgpt/jwks`,
      discovery: `${url.origin}/chatgpt/discovery`,
      api: `${url.origin}/chatgpt/v1`,
    };
  }
  return {
    authorize: `${OPENAI_ISSUER}/api/accounts/authorize`,
    token: `${OPENAI_ISSUER}/api/accounts/oauth/token`,
    jwks: `${OPENAI_ISSUER}/.well-known/jwks.json`,
    discovery: `${OPENAI_ISSUER}/.well-known/openid-configuration`,
    api: OPENAI_RESOURCE,
  };
}
