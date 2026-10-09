"use client";
// YouTube "PO tokens", minted on the phone. Without a token from a passing BotGuard
// attestation, YouTube serves only the first ~1 MB of a song. The flow mirrors
// invidious-companion; here BotGuard runs in the app's real WebView instead of jsdom.
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, GOOG_API_KEY } from "bgutils-js/utils";
import { nativeFetch } from "./nativeHttp";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

export async function createPoTokenMinter(innertube) {
  const challenge = await innertube.getAttestationChallenge("ENGAGEMENT_TYPE_UNBOUND");
  const bg = challenge?.bg_challenge;
  if (!bg) throw new Error("YouTube returned no BotGuard challenge");

  const interpreterUrl = bg.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
  const interpreter = await (await nativeFetch(`https:${interpreterUrl}`)).text();
  if (!interpreter) throw new Error("Could not load the BotGuard interpreter");
  new Function(interpreter)();

  const botguard = await BotGuardClient.create({
    program: bg.program,
    globalName: bg.global_name,
    globalObject: window,
  });
  const webPoSignalOutput = [];
  const snapshot = await botguard.snapshot({ webPoSignalOutput });

  const response = await nativeFetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
      "user-agent": navigator.userAgent,
    },
    body: JSON.stringify([REQUEST_KEY, snapshot]),
  });
  const [integrityToken, ttlSeconds] = await response.json();
  if (!integrityToken) {
    throw new Error("BotGuard attestation was not accepted (no integrity token)");
  }

  const minter = await WebPoMinter.create({ integrityToken }, webPoSignalOutput);
  return {
    minter,
    // Refresh a little before YouTube's stated lifetime (usually 12h)
    expiresAt: Date.now() + (Number(ttlSeconds) || 3600) * 1000 * 0.9,
  };
}
