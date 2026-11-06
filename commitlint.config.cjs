// GitHub adds " (#123)" to a squash-merged pull request's title. Titles may be 100 characters before that suffix, so
// config-conventional's header-max-length (which counts the suffix) is replaced by a rule that ignores it.
const MAX_HEADER = 100;
// Scopes name a platform (each releases on its own: docs/RELEASING.md) or an area. Only a warning: what releases is
// decided by the files a commit changes, not its scope. "main" is release-please's ("chore(main): release ios 0.13.2").
const SCOPES = ["chrome", "firefox", "safari", "ios", "android", "core", "deps", "ci", "release", "main", "mobile", "codeql"];

module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [{
    rules: {
      "header-max-length-before-pr-number": ({ header }, when, max) => {
        const title = (header || "").replace(/ \(#\d+\)$/, "");
        return [title.length <= max, `header must not be longer than ${max} characters, not counting the " (#123)" GitHub adds on merge`];
      }
    }
  }],
  rules: {
    "header-max-length": [0],
    "header-max-length-before-pr-number": [2, "always", MAX_HEADER],
    "scope-enum": [1, "always", SCOPES]
  }
};
