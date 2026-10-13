// Turns the Chrome manifest.json into Firefox's, at package time. The repo keeps one manifest, Chrome's.
//   - drops "key" (the Chrome Web Store's public key) and "version_name" (Chrome only);
//   - adds browser_specific_settings: the add-on id, the minimum Firefox, and the built-in data consent declaring
//     that nothing is collected (AMO requires it for new add-ons since November 2025).
// 140 (desktop) and 142 (Android) are the first versions with built-in data consent. Both show the MV3 host
// permissions (the content script's matches) at install and grant them; the user can revoke them in about:addons.
export const GECKO_ID = "voucherboard@mariusrubin.com";
export const MIN_DESKTOP = "140.0";
export const MIN_ANDROID = "142.0";

export function firefoxManifest(chrome) {
  const { key, version_name, ...m } = structuredClone(chrome);
  m.browser_specific_settings = {
    gecko: { id: GECKO_ID, strict_min_version: MIN_DESKTOP, data_collection_permissions: { required: ["none"] } },
    gecko_android: { strict_min_version: MIN_ANDROID },
  };
  return m;
}
