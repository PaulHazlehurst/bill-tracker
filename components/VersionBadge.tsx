import { APP_VERSION } from "@/lib/version";

// Small, quiet, fixed to the corner - the kind of detail a polished
// product has and a templated one doesn't. Never competes for attention
// with real content.
export default function VersionBadge() {
  return (
    <div className="version-badge" aria-hidden="true">
      v{APP_VERSION}
    </div>
  );
}
