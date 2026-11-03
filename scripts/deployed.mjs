#!/usr/bin/env node
// Whether a store has already been sent something: a successful deployment to its environment whose URL is the
// release (or, for TestFlight builds of main, the commit). Store workflows check this before asking for approval, so a
// re-run, or a run that waited behind another, doesn't upload the same thing twice. Which platforms have something new
// is release-please's job: a platform only gets a release when its files changed.
//   node scripts/deployed.mjs <environment> <url>
// Env: GITHUB_REPOSITORY, GH_TOKEN (deployments: read). Writes deployed=true|false to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { deployedAt } from "./lib/deployed.mjs";

const [env, url] = process.argv.slice(2);
if (!env || !url) { console.error("Usage: deployed.mjs <environment> <url>"); process.exit(2); }
const REPO = process.env.GITHUB_REPOSITORY || "maubergine/voucherboard";
const gh = (p) => JSON.parse(execFileSync("gh", ["api", p], { encoding: "utf8", maxBuffer: 64 << 20 }));

const deployments = gh(`repos/${REPO}/deployments?environment=${encodeURIComponent(env)}&per_page=30`);
const found = deployedAt(deployments, (d) => gh(`${d.statuses_url.replace(/^https:\/\/api\.github\.com\//, "")}?per_page=1`)[0], url);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deployed=${!!found}\n`);
console.log(found ? `${url} already went to ${env} (deployment ${found.id}).` : `${url} hasn't gone to ${env} yet.`);
