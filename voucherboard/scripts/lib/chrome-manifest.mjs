// Generic Chrome extension manifest validator. No dependencies; touches the filesystem only when rootDir is given.
// Rules: https://developer.chrome.com/docs/extensions/reference/manifest and its child pages.
// errors = Chrome or the Chrome Web Store would reject it; warnings = ignored, deprecated, MV2-only or unknown.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const at = (p, k) => (typeof k === "number" ? `${p}[${k}]` : p ? `${p}.${k}` : k);
const MSG = /__MSG_([A-Za-z0-9_@]+)__/g;

// https://developer.chrome.com/docs/extensions/reference/manifest (key list)
const TOP = new Set(["manifest_version", "name", "version", "description", "icons", "action", "author", "background",
  "chrome_settings_overrides", "chrome_url_overrides", "commands", "content_scripts", "content_security_policy",
  "cross_origin_embedder_policy", "cross_origin_opener_policy", "declarative_net_request", "default_locale",
  "devtools_page", "export", "externally_connectable", "homepage_url", "host_permissions", "import", "incognito", "key",
  "mime_types_handler", "minimum_chrome_version", "oauth2", "omnibox", "optional_host_permissions",
  "optional_permissions", "options_page", "options_ui", "permissions", "requirements", "sandbox", "short_name",
  "side_panel", "storage", "tts_engine", "update_url", "version_name", "web_accessible_resources",
  "file_browser_handlers", "file_handlers", "file_system_provider_capabilities", "input_components", "trial_tokens"]);
const MV2_ONLY = { browser_action: "action", page_action: "action" };

// https://developer.chrome.com/docs/extensions/reference/permissions-list
export const PERMISSIONS = new Set(["accessibilityFeatures.modify", "accessibilityFeatures.read", "activeTab", "alarms",
  "audio", "background", "bookmarks", "browsingData", "certificateProvider", "clipboardRead", "clipboardWrite",
  "contentSettings", "contextMenus", "cookies", "debugger", "declarativeContent", "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess", "declarativeNetRequestFeedback", "dns", "desktopCapture", "documentScan",
  "downloads", "downloads.open", "downloads.ui", "enterprise.deviceAttributes", "enterprise.hardwarePlatform",
  "enterprise.networkingAttributes", "enterprise.platformKeys", "favicon", "fileBrowserHandler", "fileSystemProvider",
  "fontSettings", "gcm", "geolocation", "history", "identity", "identity.email", "idle", "loginState", "management",
  "nativeMessaging", "notifications", "offscreen", "pageCapture", "platformKeys", "power", "printerProvider", "printing",
  "printingMetrics", "privacy", "processes", "proxy", "publicSuffix", "readingList", "runtime", "scripting", "search",
  "sessions", "sidePanel", "storage", "system.cpu", "system.display", "system.memory", "system.storage", "tabCapture",
  "tabGroups", "tabs", "topSites", "tts", "ttsEngine", "unlimitedStorage", "userScripts", "vpnProvider", "wallpaper",
  "webAuthenticationProxy", "webNavigation", "webRequest", "webRequestBlocking"]);
// https://developer.chrome.com/docs/extensions/reference/api/permissions (can't be optional)
const NOT_OPTIONAL = new Set(["debugger", "declarativeNetRequest", "devtools", "geolocation", "mdns", "proxy", "tts", "ttsEngine", "wallpaper"]);

// https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
// ws/wss are accepted too: Chrome allows them in host permissions though the page doesn't list them.
export function matchPatternError(p) {
  if (!isStr(p)) return `must be a string, got ${typeOf(p)}`;
  if (p === "<all_urls>") return null;
  const m = /^(\*|https?|wss?|file):\/\/([^/]*)(\/.*)?$/.exec(p);
  if (!m) return /^[^:/]+:\/\//.test(p) && !/^(\*|https?|wss?|file):/.test(p) ? `invalid match pattern "${p}": unsupported scheme` : `invalid match pattern "${p}"`;
  const [, scheme, host, path] = m;
  if (path === undefined) return `invalid match pattern "${p}": missing path (use "/*")`;
  if (scheme === "file") return host ? `invalid match pattern "${p}": file patterns need three slashes (file:///)` : null;
  if (!host) return `invalid match pattern "${p}": missing host`;
  const [, name, port] = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(host);
  if (port !== undefined && port !== "*" && !(/^\d{1,5}$/.test(port) && +port <= 65535)) return `invalid match pattern "${p}": invalid port`;
  if (name.includes("*") && !(name === "*" || /^\*\.[^*]+$/.test(name))) return `invalid match pattern "${p}": wildcard in host must be first and followed by "." or "/"`;
  const bare = name.replace(/^\*\.?/, "");
  if (name !== "*" && !/^\[[0-9A-Fa-f:.]+\]$/.test(bare) && !/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(bare)) return `invalid match pattern "${p}": invalid host`;
  return null;
}
const patternPath = (p) => (p === "<all_urls>" ? "/*" : /^[^:]+:\/\/[^/]*(\/.*)?$/.exec(p)?.[1]);
const looksLikePattern = (s) => isStr(s) && (s === "<all_urls>" || /^[^:/]+:\/\//.test(s));

// https://developer.chrome.com/docs/extensions/reference/manifest/version
export const versionError = (v) =>
  !isStr(v) ? `must be a string, got ${typeOf(v)}`
  : !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(v) ? `invalid version "${v}": use 1 to 4 dot-separated integers 0-65535 without leading zeros`
  : v.split(".").some((n) => +n > 65535) ? `invalid version "${v}": each part must be at most 65535`
  : v.split(".").every((n) => n === "0") ? `invalid version "${v}": must not be all zeros` : null;

// https://developer.chrome.com/docs/extensions/reference/api/commands
const CMD_KEYS = new Set([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "Comma", "Period", "Home", "End", "PageUp", "PageDown", "Space", "Insert", "Delete", "Up", "Down", "Left", "Right"]);
const MEDIA_KEYS = new Set(["MediaNextTrack", "MediaPlayPause", "MediaPrevTrack", "MediaStop"]);
const MODS = { Ctrl: null, Alt: null, Shift: null, MacCtrl: "mac", Option: "mac", Command: "mac", Search: "chromeos" };
const PLATFORMS = new Set(["default", "chromeos", "linux", "mac", "windows"]);
export function shortcutError(s, platform = "default") {
  if (!isStr(s) || !s) return `must be a non-empty string`;
  const parts = s.split("+").map((x) => x.trim()), key = parts.pop(), mods = parts;
  if (MEDIA_KEYS.has(key)) return mods.length ? `invalid shortcut "${s}": media keys can't have modifiers` : null;
  if (!CMD_KEYS.has(key)) return `invalid shortcut "${s}": unsupported key "${key}"`;
  for (const m of mods) {
    if (!(m in MODS)) return `invalid shortcut "${s}": unknown modifier "${m}"`;
    if (MODS[m] && MODS[m] !== platform) return `invalid shortcut "${s}": "${m}" is only allowed for ${MODS[m]}`;
  }
  if (new Set(mods).size !== mods.length) return `invalid shortcut "${s}": repeated modifier`;
  if (mods.includes("Ctrl") && mods.includes("Alt")) return `invalid shortcut "${s}": Ctrl+Alt is not allowed`;
  if (!mods.some((m) => ["Ctrl", "Alt", "MacCtrl", "Command", "Option"].includes(m))) return `invalid shortcut "${s}": must include Ctrl or Alt`;
  return null;
}

// https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
const CSP_OK = new Set(["'self'", "'none'", "'wasm-unsafe-eval'", "'inline-speculation-rules'"]);
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:(\d+|\*))?\/?$/;
export function cspErrors(policy) {
  const out = [], dirs = {};
  for (const d of policy.split(";").map((x) => x.trim().split(/\s+/)).filter((x) => x[0])) dirs[d[0].toLowerCase()] ??= d.slice(1);
  for (const name of ["script-src", "object-src", "worker-src", "script-src-elem"]) {
    for (const src of dirs[name] || []) {
      if (CSP_OK.has(src.toLowerCase()) || LOCALHOST.test(src)) continue;
      out.push(`insecure CSP value "${src}" in directive '${name}'`);
    }
  }
  return out;
}

export function validateManifest(manifest, { rootDir } = {}) {
  const errors = [], warnings = [], files = [];
  const err = (p, m) => errors.push(`${p}: ${m}`), warn = (p, m) => warnings.push(`${p}: ${m}`);
  if (!isObj(manifest)) return { errors: [`manifest: must be a JSON object, got ${typeOf(manifest)}`], warnings };
  const M = manifest, mv = M.manifest_version, mv3 = mv !== 2; // unknown versions are checked as MV3

  const type = (p, v, t) => {
    const ok = t === "array" ? Array.isArray(v) : t === "object" ? isObj(v) : t === "integer" ? Number.isInteger(v) : typeof v === t;
    if (!ok) err(p, `must be ${t === "array" || t === "object" || t === "integer" ? "an" : "a"} ${t}, got ${typeOf(v)}`);
    return ok;
  };
  const strs = (p, v, each) => type(p, v, "array") && v.forEach((s, i) => type(at(p, i), s, "string") && each?.(at(p, i), s));
  const keys = (p, o, allowed, mv2 = {}) => { for (const k of Object.keys(o)) if (k in mv2) warn(at(p, k), mv2[k]); else if (!allowed.includes(k)) warn(at(p, k), "unknown key, ignored"); };
  const nonEmpty = (p, v) => type(p, v, "string") && (v.trim() ? true : (err(p, "must not be empty"), false));
  const file = (p, v) => {
    if (!nonEmpty(p, v)) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return err(p, `"${v}" must be a path inside the extension, not a URL`);
    const rel = normalize(v.replace(/^\/+/, "")).replace(/\\/g, "/");
    if (rel === ".." || rel.startsWith("../")) return err(p, `"${v}" points outside the extension`);
    files.push([p, v, rel.split(/[?#]/)[0]]);
  };
  const pattern = (p, v) => { const e = matchPatternError(v); if (e) err(p, e); return !e; };
  const enumOf = (p, v, vals) => type(p, v, "string") && !vals.includes(v) && err(p, `must be one of ${vals.map((x) => `"${x}"`).join(", ")}, got "${v}"`);
  const iconPath = (p, v) => {
    file(p, v);
    if (!isStr(v)) return;
    const ext = /\.([a-z0-9]+)$/i.exec(v)?.[1]?.toLowerCase();
    if (ext === "svg" || ext === "webp") warn(p, `${ext.toUpperCase()} icons are not supported; use PNG`);
    else if (ext !== "png") warn(p, `"${v}" is not a PNG; PNG is recommended`);
  };
  const iconMap = (p, v) => {
    if (!type(p, v, "object")) return;
    for (const [k, f] of Object.entries(v)) {
      if (!/^[1-9]\d*$/.test(k)) err(at(p, k), `icon size must be a positive integer, got "${k}"`);
      iconPath(at(p, k), f);
    }
  };
  const extId = (p, v) => type(p, v, "string") && v !== "*" && !/^[a-p]{32}$/.test(v) && err(p, `invalid extension id "${v}"`);

  // https://developer.chrome.com/docs/extensions/reference/manifest (required keys)
  if (mv === undefined) err("manifest_version", "is required");
  else if (mv === 2) err("manifest_version", "Manifest V2 is no longer accepted; use 3");
  else if (mv !== 3) err("manifest_version", `must be 3, got ${JSON.stringify(mv)}`);
  for (const k of ["name", "version"]) if (M[k] === undefined) err(k, "is required");
  if (M.description === undefined) err("description", "is required by the Chrome Web Store");
  if (M.icons === undefined) err("icons", "is required by the Chrome Web Store");

  for (const k of Object.keys(M)) {
    if (k in MV2_ONLY) (mv3 ? warn(k, `is Manifest V2 only and ignored; use "${MV2_ONLY[k]}"`) : null);
    else if (!TOP.has(k)) warn(k, "unknown key, ignored");
  }

  // https://developer.chrome.com/docs/extensions/reference/api/i18n
  let messages = null;
  const usesMsg = (v) => isStr(v) && /__MSG_[A-Za-z0-9_@]+__/.test(v);
  const localized = ["name", "short_name", "description"].filter((k) => usesMsg(M[k]));
  if (M.default_locale !== undefined && type("default_locale", M.default_locale, "string")) {
    if (!/^[a-zA-Z]{2,3}(_[a-zA-Z0-9]{2,3})?$/.test(M.default_locale)) err("default_locale", `invalid locale "${M.default_locale}" (use e.g. "en" or "en_GB")`);
    else if (rootDir) {
      const mf = join(rootDir, "_locales", M.default_locale, "messages.json");
      if (!existsSync(mf)) err("default_locale", `_locales/${M.default_locale}/messages.json not found`);
      else try {
        const raw = JSON.parse(readFileSync(mf, "utf8"));
        messages = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v?.message]));
      } catch (e) { err("default_locale", `_locales/${M.default_locale}/messages.json is not valid JSON: ${e.message}`); }
    }
  } else if (localized.length || Object.values(M).some(usesMsg)) err("default_locale", "is required when the manifest uses __MSG_ placeholders");
  if (rootDir && M.default_locale === undefined && existsSync(join(rootDir, "_locales"))) err("default_locale", "is required when a _locales directory exists");
  const resolve = (p, v) => {
    if (!usesMsg(v)) return v;
    if (!messages) return null;
    let missing = false;
    const out = v.replace(MSG, (_, n) => {
      if (n.startsWith("@@")) return "";
      const m = messages[n.toLowerCase()];
      if (!isStr(m)) { missing = true; err(p, `message "${n}" is not defined in _locales/${M.default_locale}/messages.json`); return ""; }
      return m;
    });
    return missing ? null : out;
  };

  // https://developer.chrome.com/docs/extensions/reference/manifest/name, .../short-name, .../description
  const text = (k, max, level) => {
    if (M[k] === undefined || !type(k, M[k], "string")) return;
    const v = resolve(k, M[k]);
    if (v === null) return;
    if (!v.trim()) return err(k, "must not be empty");
    if ([...v].length > max) (level === "warn" ? warn : err)(k, `must be at most ${max} characters (it is ${[...v].length})`);
  };
  text("name", 75); text("short_name", 12, "warn"); text("description", 132);

  if (M.version !== undefined) { const e = versionError(M.version); if (e) err("version", e); }
  if (M.version_name !== undefined) nonEmpty("version_name", M.version_name);
  if (M.author !== undefined && !isStr(M.author) && !isObj(M.author)) err("author", `must be a string or object, got ${typeOf(M.author)}`);

  // https://developer.chrome.com/docs/extensions/reference/manifest/icons
  if (M.icons !== undefined) {
    iconMap("icons", M.icons);
    if (isObj(M.icons) && !("128" in M.icons)) warn("icons", "should include a 128x128 icon for installation and the Chrome Web Store");
  }

  // https://developer.chrome.com/docs/extensions/reference/api/action
  const actionKey = (k) => {
    const a = M[k];
    if (a === undefined || !type(k, a, "object")) return;
    keys(k, a, ["default_icon", "default_title", "default_popup", "default_state"]);
    if (a.default_icon !== undefined) isStr(a.default_icon) ? iconPath(at(k, "default_icon"), a.default_icon) : iconMap(at(k, "default_icon"), a.default_icon);
    if (a.default_title !== undefined) type(at(k, "default_title"), a.default_title, "string");
    if (a.default_popup !== undefined && a.default_popup !== "") file(at(k, "default_popup"), a.default_popup);
    if (a.default_state !== undefined) enumOf(at(k, "default_state"), a.default_state, ["enabled", "disabled"]);
  };
  actionKey("action"); if (!mv3) { actionKey("browser_action"); actionKey("page_action"); }

  // https://developer.chrome.com/docs/extensions/reference/manifest/background
  if (M.background !== undefined && type("background", M.background, "object")) {
    const b = M.background;
    keys("background", b, ["service_worker", "type", "scripts", "page", "persistent", "preferred_environment"]);
    if (b.service_worker !== undefined) file("background.service_worker", b.service_worker);
    if (b.type !== undefined) enumOf("background.type", b.type, ["module", "classic"]);
    if (mv3) {
      for (const k of ["scripts", "page"]) if (b[k] !== undefined)
        b.service_worker !== undefined ? warn(`background.${k}`, "is ignored by Chrome in Manifest V3 (service_worker is used)")
          : err(`background.${k}`, "is not supported in Manifest V3; use background.service_worker");
      if (b.persistent !== undefined) warn("background.persistent", "is Manifest V2 only and ignored");
      if (b.service_worker === undefined && b.scripts === undefined && b.page === undefined) warn("background", "has no service_worker");
    } else {
      if (b.scripts !== undefined) strs("background.scripts", b.scripts, file);
      if (b.page !== undefined) file("background.page", b.page);
      if (b.persistent !== undefined) type("background.persistent", b.persistent, "boolean");
    }
  }

  // https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
  if (M.content_scripts !== undefined && type("content_scripts", M.content_scripts, "array")) M.content_scripts.forEach((c, i) => {
    const p = at("content_scripts", i);
    if (!type(p, c, "object")) return;
    keys(p, c, ["matches", "exclude_matches", "include_globs", "exclude_globs", "css", "js", "run_at", "all_frames", "match_about_blank", "match_origin_as_fallback", "world"]);
    if (c.matches === undefined) err(at(p, "matches"), "is required");
    else if (type(at(p, "matches"), c.matches, "array")) {
      if (!c.matches.length) err(at(p, "matches"), "must not be empty");
      c.matches.forEach((m, j) => pattern(at(at(p, "matches"), j), m));
    }
    if (c.exclude_matches !== undefined && type(at(p, "exclude_matches"), c.exclude_matches, "array")) c.exclude_matches.forEach((m, j) => pattern(at(at(p, "exclude_matches"), j), m));
    for (const g of ["include_globs", "exclude_globs"]) if (c[g] !== undefined) strs(at(p, g), c[g]);
    for (const f of ["js", "css"]) if (c[f] !== undefined) strs(at(p, f), c[f], file);
    if (!(c.js?.length) && !(c.css?.length)) err(p, "needs at least one file in js or css");
    if (c.run_at !== undefined) enumOf(at(p, "run_at"), c.run_at, ["document_start", "document_end", "document_idle"]);
    if (c.world !== undefined) enumOf(at(p, "world"), c.world, ["ISOLATED", "MAIN"]);
    for (const k of ["all_frames", "match_about_blank", "match_origin_as_fallback"]) if (c[k] !== undefined) type(at(p, k), c[k], "boolean");
    // match_origin_as_fallback only matches on origin, so Chrome rejects patterns with a specific path.
    if (c.match_origin_as_fallback === true && Array.isArray(c.matches)) c.matches.forEach((m, j) => {
      if (isStr(m) && !matchPatternError(m) && patternPath(m) !== "/*") err(at(at(p, "matches"), j), `"${m}" must have path "/*" when match_origin_as_fallback is true`);
    });
  });

  // https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions, .../permissions-list
  const perms = (k, optional) => {
    if (M[k] === undefined || !type(k, M[k], "array")) return;
    const seen = new Set();
    M[k].forEach((v, i) => {
      const p = at(k, i);
      if (!type(p, v, "string")) return;
      if (seen.has(v)) warn(p, `duplicate "${v}"`); seen.add(v);
      if (looksLikePattern(v)) {
        if (mv3) return warn(p, `host pattern "${v}" is ignored here in Manifest V3; move it to ${optional ? "optional_host_permissions" : "host_permissions"}`);
        return pattern(p, v);
      }
      if (!PERMISSIONS.has(v)) return warn(p, `unknown permission "${v}"`);
      if (optional && NOT_OPTIONAL.has(v)) warn(p, `"${v}" can't be optional and will be omitted`);
      if (v === "webRequestBlocking" && mv3) warn(p, `"webRequestBlocking" is only available to policy-installed extensions in Manifest V3`);
    });
  };
  perms("permissions", false); perms("optional_permissions", true);
  for (const k of ["host_permissions", "optional_host_permissions"]) if (M[k] !== undefined) {
    if (!mv3) warn(k, "is Manifest V3 only");
    if (type(k, M[k], "array")) M[k].forEach((v, i) => pattern(at(k, i), v));
  }
  const has = (perm) => [M.permissions, M.optional_permissions].some((l) => Array.isArray(l) && l.includes(perm));

  // https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources
  if (M.web_accessible_resources !== undefined && type("web_accessible_resources", M.web_accessible_resources, "array")) M.web_accessible_resources.forEach((w, i) => {
    const p = at("web_accessible_resources", i);
    if (!mv3) return type(p, w, "string") && !/[*?]/.test(w) && file(p, w);
    if (isStr(w)) return err(p, "must be an object with resources and matches in Manifest V3, not a string");
    if (!type(p, w, "object")) return;
    keys(p, w, ["resources", "matches", "extension_ids", "use_dynamic_url"]);
    if (w.resources === undefined) err(at(p, "resources"), "is required");
    else strs(at(p, "resources"), w.resources, (q, s) => { if (!/[*?]/.test(s)) file(q, s); });
    if (w.matches === undefined && w.extension_ids === undefined) err(p, "needs matches or extension_ids");
    if (w.matches !== undefined && type(at(p, "matches"), w.matches, "array")) w.matches.forEach((m, j) => {
      const q = at(at(p, "matches"), j);
      if (pattern(q, m) && patternPath(m) !== "/*") err(q, `invalid match pattern "${m}": path must be "/*"`);
    });
    if (w.extension_ids !== undefined) strs(at(p, "extension_ids"), w.extension_ids, extId);
    if (w.use_dynamic_url !== undefined) type(at(p, "use_dynamic_url"), w.use_dynamic_url, "boolean");
  });

  // https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
  if (M.content_security_policy !== undefined) {
    const c = M.content_security_policy, k = "content_security_policy";
    if (!mv3) type(k, c, "string");
    else if (isStr(c)) err(k, "must be an object with extension_pages and/or sandbox in Manifest V3");
    else if (type(k, c, "object")) {
      keys(k, c, ["extension_pages", "sandbox"]);
      if (c.extension_pages !== undefined && type(`${k}.extension_pages`, c.extension_pages, "string"))
        for (const e of cspErrors(c.extension_pages)) err(`${k}.extension_pages`, e);
      if (c.sandbox !== undefined && type(`${k}.sandbox`, c.sandbox, "string")) {
        const dirs = c.sandbox.split(";").map((x) => x.trim().split(/\s+/));
        const sb = dirs.find((d) => d[0].toLowerCase() === "sandbox");
        if (!sb) err(`${k}.sandbox`, "must include the sandbox directive");
        else if (sb.includes("allow-same-origin")) err(`${k}.sandbox`, "must not include allow-same-origin");
      }
    }
  }

  // https://developer.chrome.com/docs/extensions/reference/manifest/sandbox
  if (M.sandbox !== undefined && type("sandbox", M.sandbox, "object")) {
    keys("sandbox", M.sandbox, ["pages"], mv3 ? { content_security_policy: "is Manifest V2 only; use content_security_policy.sandbox" } : {});
    if (!mv3 && M.sandbox.content_security_policy !== undefined) type("sandbox.content_security_policy", M.sandbox.content_security_policy, "string");
    if (M.sandbox.pages === undefined) err("sandbox.pages", "is required");
    else strs("sandbox.pages", M.sandbox.pages, file);
  }

  // https://developer.chrome.com/docs/extensions/reference/api/commands
  if (M.commands !== undefined && type("commands", M.commands, "object")) {
    let suggested = 0;
    for (const [name, c] of Object.entries(M.commands)) {
      const p = at("commands", name), special = /^_execute_(action|browser_action|page_action)$/.test(name);
      if (!type(p, c, "object")) continue;
      keys(p, c, ["suggested_key", "description", "global"]);
      if (mv3 && (name === "_execute_browser_action" || name === "_execute_page_action")) warn(p, `is Manifest V2 only; use "_execute_action"`);
      if (!mv3 && name === "_execute_action") warn(p, `is Manifest V3 only`);
      if (c.description !== undefined) type(at(p, "description"), c.description, "string");
      else if (!special) err(at(p, "description"), "is required");
      if (c.global !== undefined) type(at(p, "global"), c.global, "boolean");
      const sk = c.suggested_key, sp = at(p, "suggested_key");
      if (sk === undefined) continue;
      suggested++;
      const check = (q, s, plat) => {
        const e = shortcutError(s, plat);
        if (e) return err(q, e);
        if (c.global === true && !/^Ctrl\+Shift\+[0-9]$/.test(s)) warn(q, `global shortcuts are limited to Ctrl+Shift+[0-9]`);
      };
      if (isStr(sk)) check(sp, sk, "default");
      else if (isObj(sk)) {
        for (const [plat, s] of Object.entries(sk)) PLATFORMS.has(plat) ? check(at(sp, plat), s, plat) : warn(at(sp, plat), "unknown platform, ignored");
      } else err(sp, `must be a string or object, got ${typeOf(sk)}`);
    }
    if (suggested > 4) err("commands", `at most 4 commands may have a suggested_key (found ${suggested})`);
  }

  // https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable
  if (M.externally_connectable !== undefined && type("externally_connectable", M.externally_connectable, "object")) {
    const e = M.externally_connectable, k = "externally_connectable";
    keys(k, e, ["ids", "matches", "accepts_tls_channel_id"]);
    if (e.ids !== undefined) strs(`${k}.ids`, e.ids, extId);
    if (e.matches !== undefined && type(`${k}.matches`, e.matches, "array")) e.matches.forEach((m, i) => {
      const q = at(`${k}.matches`, i);
      // Chrome ignores patterns that match every site or a whole TLD here.
      if (pattern(q, m) && (m === "<all_urls>" || /^[^:]+:\/\/(\*|\*\.[^./:]+)(:|\/)/.test(m))) warn(q, `"${m}" is too broad and is ignored; name a specific domain`);
    });
    if (e.accepts_tls_channel_id !== undefined) type(`${k}.accepts_tls_channel_id`, e.accepts_tls_channel_id, "boolean");
  }

  // https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
  if (M.declarative_net_request !== undefined && type("declarative_net_request", M.declarative_net_request, "object")) {
    const k = "declarative_net_request", d = M.declarative_net_request;
    keys(k, d, ["rule_resources"]);
    if (!has("declarativeNetRequest") && !has("declarativeNetRequestWithHostAccess")) warn(k, `needs the "declarativeNetRequest" or "declarativeNetRequestWithHostAccess" permission`);
    if (d.rule_resources !== undefined && type(`${k}.rule_resources`, d.rule_resources, "array")) {
      const ids = new Set();
      d.rule_resources.forEach((r, i) => {
        const p = at(`${k}.rule_resources`, i);
        if (!type(p, r, "object")) return;
        keys(p, r, ["id", "enabled", "path"]);
        if (r.id === undefined) err(at(p, "id"), "is required");
        else if (nonEmpty(at(p, "id"), r.id)) {
          if (r.id.startsWith("_")) err(at(p, "id"), `"${r.id}" must not start with "_"`);
          if (ids.has(r.id)) err(at(p, "id"), `duplicate ruleset id "${r.id}"`); ids.add(r.id);
        }
        if (r.enabled === undefined) err(at(p, "enabled"), "is required"); else type(at(p, "enabled"), r.enabled, "boolean");
        if (r.path === undefined) err(at(p, "path"), "is required"); else file(at(p, "path"), r.path);
      });
      if (d.rule_resources.length > 100) err(`${k}.rule_resources`, `at most 100 static rulesets are allowed (found ${d.rule_resources.length})`);
      const on = d.rule_resources.filter((r) => r?.enabled === true).length;
      if (on > 50) err(`${k}.rule_resources`, `at most 50 static rulesets can be enabled (found ${on})`);
    }
  }

  // https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages
  if (M.chrome_url_overrides !== undefined && type("chrome_url_overrides", M.chrome_url_overrides, "object")) {
    const o = M.chrome_url_overrides, ks = Object.keys(o);
    for (const k of ks) ["newtab", "history", "bookmarks"].includes(k) ? file(at("chrome_url_overrides", k), o[k]) : err(at("chrome_url_overrides", k), `can't override "${k}"; use newtab, history or bookmarks`);
    if (ks.length > 1) err("chrome_url_overrides", "an extension can only override one page");
  }

  // https://developer.chrome.com/docs/extensions/develop/ui/options-page, .../reference/manifest/devtools-page
  if (M.options_page !== undefined) file("options_page", M.options_page);
  if (M.options_ui !== undefined && type("options_ui", M.options_ui, "object")) {
    const o = M.options_ui;
    keys("options_ui", o, ["page", "open_in_tab"], mv3 ? { chrome_style: "is Manifest V2 only and ignored" } : {});
    if (!mv3 && o.chrome_style !== undefined) type("options_ui.chrome_style", o.chrome_style, "boolean");
    if (o.page === undefined) err("options_ui.page", "is required"); else file("options_ui.page", o.page);
    if (o.open_in_tab !== undefined) type("options_ui.open_in_tab", o.open_in_tab, "boolean");
    if (M.options_page !== undefined) warn("options_page", "is ignored because options_ui is set");
  }
  if (M.devtools_page !== undefined) file("devtools_page", M.devtools_page);

  // https://developer.chrome.com/docs/extensions/reference/api/sidePanel
  if (M.side_panel !== undefined && type("side_panel", M.side_panel, "object")) {
    keys("side_panel", M.side_panel, ["default_path"]);
    if (M.side_panel.default_path !== undefined) file("side_panel.default_path", M.side_panel.default_path);
    if (!has("sidePanel")) warn("side_panel", `needs the "sidePanel" permission`);
  }

  // https://developer.chrome.com/docs/extensions/reference/manifest/oauth2
  if (M.oauth2 !== undefined && type("oauth2", M.oauth2, "object")) {
    keys("oauth2", M.oauth2, ["client_id", "scopes"]);
    if (M.oauth2.client_id === undefined) err("oauth2.client_id", "is required"); else nonEmpty("oauth2.client_id", M.oauth2.client_id);
    if (M.oauth2.scopes !== undefined) strs("oauth2.scopes", M.oauth2.scopes);
    if (!has("identity")) warn("oauth2", `is used by chrome.identity; add the "identity" permission`);
  }

  // https://developer.chrome.com/docs/extensions/reference/api/omnibox
  if (M.omnibox !== undefined && type("omnibox", M.omnibox, "object")) {
    keys("omnibox", M.omnibox, ["keyword"]);
    if (M.omnibox.keyword === undefined) err("omnibox.keyword", "is required"); else nonEmpty("omnibox.keyword", M.omnibox.keyword);
  }

  // https://developer.chrome.com/docs/extensions/reference/manifest/storage
  if (M.storage !== undefined && type("storage", M.storage, "object")) {
    keys("storage", M.storage, ["managed_schema"]);
    if (M.storage.managed_schema !== undefined) file("storage.managed_schema", M.storage.managed_schema);
  }

  // https://developer.chrome.com/docs/extensions/reference/manifest/incognito
  if (M.incognito !== undefined) enumOf("incognito", M.incognito, ["spanning", "split", "not_allowed"]);

  // https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
  if (M.minimum_chrome_version !== undefined && type("minimum_chrome_version", M.minimum_chrome_version, "string") && !/^\d+(\.\d+){0,3}$/.test(M.minimum_chrome_version))
    err("minimum_chrome_version", `invalid version "${M.minimum_chrome_version}"`);

  // https://developer.chrome.com/docs/extensions/reference/manifest/key
  if (M.key !== undefined && type("key", M.key, "string")) {
    if (/-----BEGIN|\s/.test(M.key)) err("key", "must be the base64 public key on one line, without PEM headers or whitespace");
    else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(M.key) || M.key.length % 4) err("key", "must be a base64 string");
    // The store assigns the id from its own key and rejects uploads that include one.
    else warn("key", "remove before uploading to the Chrome Web Store");
  }

  for (const k of ["homepage_url", "update_url"]) if (M[k] !== undefined && type(k, M[k], "string")) {
    let u = null; try { u = new URL(M[k]); } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) err(k, `must be an http(s) URL, got "${M[k]}"`);
  }
  if (isStr(M.update_url)) warn("update_url", "is ignored for Chrome Web Store items");

  // https://developer.chrome.com/docs/extensions/reference/manifest/cross-origin-embedder-policy, .../cross-origin-opener-policy
  for (const k of ["cross_origin_embedder_policy", "cross_origin_opener_policy"]) if (M[k] !== undefined && type(k, M[k], "object")) {
    keys(k, M[k], ["value"]);
    if (M[k].value === undefined) err(`${k}.value`, "is required"); else type(`${k}.value`, M[k].value, "string");
  }

  // Shape checks only for the rarer keys. https://developer.chrome.com/docs/extensions/reference/manifest
  const shapes = { chrome_settings_overrides: "object", requirements: "object", tts_engine: "object", export: "object",
    import: "array", file_browser_handlers: "array", file_handlers: "array", file_system_provider_capabilities: "object",
    input_components: "array", mime_types_handler: "string", trial_tokens: "array" };
  for (const [k, t] of Object.entries(shapes)) if (M[k] !== undefined) type(k, M[k], t);
  if (Array.isArray(M.import)) M.import.forEach((m, i) => {
    const p = at("import", i);
    if (!type(p, m, "object")) return;
    if (m.id === undefined) err(at(p, "id"), "is required"); else extId(at(p, "id"), m.id);
    if (m.minimum_version !== undefined) { const e = versionError(m.minimum_version); if (e) err(at(p, "minimum_version"), e); }
  });
  if (isObj(M.tts_engine) && M.tts_engine.voices !== undefined) type("tts_engine.voices", M.tts_engine.voices, "array");
  if (Array.isArray(M.trial_tokens)) strs("trial_tokens", M.trial_tokens);
  if (Array.isArray(M.file_browser_handlers)) M.file_browser_handlers.forEach((h, i) => {
    const p = at("file_browser_handlers", i);
    if (type(p, h, "object")) for (const f of ["id", "default_title"]) if (h[f] === undefined) err(at(p, f), "is required");
  });

  // https://developer.chrome.com/docs/webstore/troubleshooting ("files mentioned in your manifest that are not present")
  if (rootDir) for (const [p, v, rel] of files) {
    const f = join(rootDir, rel);
    if (!existsSync(f)) err(p, `file not found: "${v}"`);
    else if (!statSync(f).isFile()) err(p, `"${v}" is not a file`);
  }
  return { errors, warnings };
}
