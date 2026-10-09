"use client";
// fetch() on top of Capacitor's native HTTP. The app's WebView (origin https://localhost) can't
// call YouTube directly: CORS blocks it and browsers forbid setting Origin/Referer/User-Agent.
// Native requests have neither limit and go out from the phone's own IP.
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const isNativeApp = () => typeof window !== "undefined" && Capacitor.isNativePlatform();

const toUrl = (input) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const headersToObject = (headers) => {
  const out = {};
  if (headers) new Headers(headers).forEach((value, key) => { out[key] = value; });
  return out;
};

const hasHeader = (headers, name) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name);

export const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

// Android encodes with line breaks; atob ignores whitespace
export const base64ToBytes = (base64) => {
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export async function nativeFetch(input, init = {}) {
  const request = input instanceof Request ? input : null;
  const url = toUrl(input);
  const method = (init.method || request?.method || "GET").toUpperCase();
  const headers = { ...headersToObject(request?.headers), ...headersToObject(init.headers) };

  let body = init.body;
  if (body == null && request && method !== "GET" && method !== "HEAD") {
    body = new Uint8Array(await request.clone().arrayBuffer());
  }

  const options = { url, method, headers, responseType: "text" };
  if (body != null) {
    if (typeof body === "string") {
      options.data = body;
      // The native layer only writes a body when a Content-Type is set
      if (!hasHeader(headers, "content-type")) headers["content-type"] = "text/plain;charset=UTF-8";
    } else {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      options.data = bytesToBase64(bytes);
      options.dataType = "file"; // base64 -> raw bytes on the native side
      if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/octet-stream";
    }
  }

  const res = await CapacitorHttp.request(options);
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
  const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
  const response = new Response(method === "HEAD" || NULL_BODY_STATUS.has(status) ? null : text, {
    status,
    headers: res.headers || {},
  });
  Object.defineProperty(response, "url", { value: res.url || url });
  return response;
}

// Binary download (the audio itself). Returns raw bytes plus the final URL after redirects.
export async function nativeFetchBytes(url, { method = "GET", headers = {}, bodyBase64 } = {}) {
  const options = { url, method, headers: { ...headers }, responseType: "arraybuffer" };
  if (bodyBase64) {
    options.data = bodyBase64;
    options.dataType = "file";
    if (!hasHeader(options.headers, "content-type")) options.headers["content-type"] = "application/x-protobuf";
  }
  const res = await CapacitorHttp.request(options);
  const ok = res.status >= 200 && res.status < 300;
  return {
    status: res.status,
    headers: res.headers || {},
    url: res.url || url,
    bytes: ok && method !== "HEAD" ? base64ToBytes(res.data) : null,
  };
}
