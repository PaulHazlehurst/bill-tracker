"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

export default function OrgLogoUploader({
  orgId,
  currentLogoUrl,
  onUploaded,
}: {
  orgId: string;
  currentLogoUrl: string | null;
  onUploaded: (url: string) => void;
}) {
  const supabase = createClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentLogoUrl);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 2MB.");
      return;
    }

    setUploading(true);

    // One fixed filename per org (extension included) - re-uploading always
    // overwrites the same file via upsert, so there's no cleanup needed and
    // the org's logo URL never changes, only what it points to.
    const ext = file.name.split(".").pop() || "png";
    const path = `${orgId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("org-logos")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("org-logos").getPublicUrl(path);
    // Cache-bust so the new image shows immediately instead of a stale
    // browser-cached version at the same URL.
    const bustedUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("organizations")
      .update({ logo_url: bustedUrl })
      .eq("id", orgId);

    setUploading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setPreview(bustedUrl);
    onUploaded(bustedUrl);
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--surface-soft)", display: "flex", alignItems: "center",
            justifyContent: "center", overflow: "hidden", flexShrink: 0,
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Team logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span className="muted" style={{ fontSize: '0.6875rem' }}>No logo</span>
          )}
        </div>
        <div>
          <label className="ghost" style={{ display: "inline-block", cursor: "pointer" }}>
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} style={{ display: "none" }} />
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {uploading && <span className="spinner" aria-hidden="true" />}
              {uploading ? "Uploading…" : "Upload logo"}
            </span>
          </label>
          <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>PNG or JPG, under 2MB. Shown in the header for your whole team.</p>
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}
