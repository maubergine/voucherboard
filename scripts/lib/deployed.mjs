// The newest deployment, of those given (newest first), whose latest status is a success at url; or null.
// latestStatus(deployment) returns its newest status, or undefined.
export function deployedAt(deployments, latestStatus, url) {
  for (const d of deployments || []) {
    const s = latestStatus(d);
    if (s && s.state === "success" && s.environment_url === url) return d;
  }
  return null;
}
