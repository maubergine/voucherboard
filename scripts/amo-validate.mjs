#!/usr/bin/env node
// Runs AMO's own validator on the Firefox zip, through the add-on upload API (v5), and fails if it isn't valid.
// An upload is only validated: it creates no version and submits nothing for review. Creating a listed version
// (which submits it for review) is left to the owner, in the Developer Hub. See docs/FIREFOX.md.
//
// Usage: node scripts/amo-validate.mjs dist/voucherboard-firefox-<version>.zip
// Env:   AMO_JWT_ISSUER, AMO_JWT_SECRET (the AMO API key and secret), AMO_API (default https://addons.mozilla.org)
import { readFileSync, appendFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API = `${process.env.AMO_API || "https://addons.mozilla.org"}/api/v5/addons/upload/`;
const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

// AMO's API auth: an HS256 JWT signed with the secret, valid for at most 5 minutes, with a unique jti.
export function jwt(issuer, secret, now = Math.floor(Date.now() / 1000)) {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function call(url, init = {}) {
  const { AMO_JWT_ISSUER: iss, AMO_JWT_SECRET: secret } = process.env;
  const res = await fetch(url, { ...init, headers: { Authorization: `JWT ${jwt(iss, secret)}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url} returned ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function main(zip) {
  if (!zip) throw new Error("Usage: node scripts/amo-validate.mjs <zip>");
  if (!process.env.AMO_JWT_ISSUER || !process.env.AMO_JWT_SECRET) throw new Error("AMO_JWT_ISSUER and AMO_JWT_SECRET must be set");
  const form = new FormData();
  form.append("upload", new Blob([readFileSync(zip)], { type: "application/zip" }), path.basename(zip));
  form.append("channel", "listed");
  let u = await call(API, { method: "POST", body: form });
  console.log(`Uploaded ${path.basename(zip)} for validation: ${u.uuid}`);
  for (let i = 0; !u.processed && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    u = await call(`${API}${u.uuid}/`);
  }
  if (!u.processed) throw new Error("AMO didn't finish validating within 5 minutes");
  const v = u.validation || {};
  const msgs = (v.messages || []).map((m) => `${m.type}: ${m.message}${m.file ? ` (${m.file}${m.line ? `:${m.line}` : ""})` : ""}`);
  for (const m of msgs) console.log(m);
  const summary = `AMO validation of ${u.version || "?"}: ${u.valid ? "valid" : "not valid"}, ${v.errors ?? "?"} errors, ${v.warnings ?? "?"} warnings, ${v.notices ?? "?"} notices.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Firefox\n\n${summary}\n`);
  if (!u.valid) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
