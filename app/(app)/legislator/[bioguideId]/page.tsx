"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Phone, Globe, FileText, Star, User } from "lucide-react";
import { STAGE_LABELS } from "@/lib/billMeta";

type MemberDetail = {
  bioguideId: string;
  name: string;
  party: string;
  state: string;
  district: string | null;
  chamber: string;
  imageUrl: string | null;
  officialUrl: string | null;
  phone: string | null;
  sponsoredLegislation: { count: number };
  cosponsoredLegislation: { count: number };
};

type MemberBill = {
  billId: string;
  congress: number;
  type: string;
  number: string;
  title: string;
  latestActionText: string | null;
  latestActionDate: string | null;
  isTracked: boolean;
};

const PARTY_NAMES: Record<string, string> = { D: "Democrat", R: "Republican", I: "Independent" };
const PARTY_COLORS: Record<string, string> = { D: "var(--party-dem)", R: "var(--party-rep)", I: "var(--party-ind)" };

// Profile page for a single legislator, showing their contact info,
// sponsored/cosponsored bills, and which of those overlap with the
// user's tracked portfolio. The "In your portfolio" badge is the key
// value-add over just looking at congress.gov — it connects the person
// to the bills you actually care about.
export default function LegislatorProfilePage({ params }: { params: { bioguideId: string } }) {
  const { bioguideId } = params;
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [sponsored, setSponsored] = useState<MemberBill[]>([]);
  const [cosponsored, setCosponsored] = useState<MemberBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"sponsored" | "cosponsored">("sponsored");

  useEffect(() => {
    fetch(`/api/legislators/${bioguideId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        setMember(data.member);
        setSponsored(data.sponsored ?? []);
        setCosponsored(data.cosponsored ?? []);
        setLoading(false);
      })
      .catch(() => { setError("Couldn't load this legislator."); setLoading(false); });
  }, [bioguideId]);

  if (loading) return <div className="container" style={{ padding: 40 }}>Loading profile...</div>;
  if (error || !member) return (
    <div className="container" style={{ padding: 40 }}>
      <p className="error-text">{error ?? "Legislator not found."}</p>
      <a href="/legislators"><button className="ghost"><ArrowLeft size={14} /> Back to directory</button></a>
    </div>
  );

  const activeBills = tab === "sponsored" ? sponsored : cosponsored;
  const trackedInList = activeBills.filter((b) => b.isTracked);
  const otherInList = activeBills.filter((b) => !b.isTracked);

  return (
    <div className="container-wide">
      <a href="/legislators" className="briefing-back" style={{ marginBottom: 20, display: "inline-flex" }}>
        <ArrowLeft size={14} /> All legislators
      </a>

      <div className="legislator-profile-header">
        <div className="legislator-profile-photo">
          {member.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.imageUrl} alt="" className="legislator-photo-lg" />
          ) : (
            <div className="legislator-photo-placeholder-lg"><User size={40} /></div>
          )}
        </div>
        <div className="legislator-profile-info">
          <h1 style={{ fontSize: "1.75rem", fontWeight: 500, margin: 0 }}>{member.name}</h1>
          <div className="legislator-profile-meta">
            <span className="legislator-party-badge-lg" style={{ background: PARTY_COLORS[member.party] ?? "var(--text-soft)", color: "#fff" }}>
              {PARTY_NAMES[member.party] ?? member.party}
            </span>
            <span>{member.state}{member.district ? `, District ${member.district}` : ""}</span>
            <span>{member.chamber}</span>
          </div>
          <div className="legislator-profile-contact">
            {member.phone && (
              <a href={`tel:${member.phone}`} className="legislator-contact-link">
                <Phone size={13} /> {member.phone}
              </a>
            )}
            {member.officialUrl && (
              <a href={member.officialUrl} target="_blank" rel="noreferrer" className="legislator-contact-link">
                <Globe size={13} /> Official website
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="legislator-stats-row">
        <div className="legislator-stat-card">
          <div className="legislator-stat-value">{member.sponsoredLegislation.count}</div>
          <div className="legislator-stat-label">Bills sponsored</div>
        </div>
        <div className="legislator-stat-card">
          <div className="legislator-stat-value">{member.cosponsoredLegislation.count}</div>
          <div className="legislator-stat-label">Bills cosponsored</div>
        </div>
        <div className="legislator-stat-card">
          <div className="legislator-stat-value" style={{ color: "var(--accent-gold)" }}>
            {sponsored.filter((b) => b.isTracked).length + cosponsored.filter((b) => b.isTracked).length}
          </div>
          <div className="legislator-stat-label">In your portfolio</div>
        </div>
      </div>

      <div className="legislator-tabs">
        <button
          className={`legislator-tab ${tab === "sponsored" ? "legislator-tab-active" : ""}`}
          onClick={() => setTab("sponsored")}
        >
          Sponsored ({sponsored.length})
        </button>
        <button
          className={`legislator-tab ${tab === "cosponsored" ? "legislator-tab-active" : ""}`}
          onClick={() => setTab("cosponsored")}
        >
          Cosponsored ({cosponsored.length})
        </button>
      </div>

      {trackedInList.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 className="legislator-section-label"><Star size={13} style={{ color: "var(--accent-gold)" }} /> In your portfolio</h3>
          {trackedInList.map((b) => (
            <a key={b.billId} href={`/bill/${b.billId}`} className="legislator-bill-row legislator-bill-tracked">
              <FileText size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="legislator-bill-title">{b.title}</div>
                {b.latestActionText && <div className="muted" style={{ fontSize: "0.75rem" }}>{b.latestActionText}</div>}
              </div>
              <span className="legislator-tracked-badge">Tracked</span>
            </a>
          ))}
        </div>
      )}

      {otherInList.length > 0 && (
        <div>
          {trackedInList.length > 0 && <h3 className="legislator-section-label">Other bills</h3>}
          {otherInList.map((b) => (
            <a key={b.billId} href={`/bill/${b.billId}`} className="legislator-bill-row">
              <FileText size={14} className="muted" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="legislator-bill-title">{b.title}</div>
                {b.latestActionText && <div className="muted" style={{ fontSize: "0.75rem" }}>{b.latestActionText}</div>}
              </div>
            </a>
          ))}
        </div>
      )}

      {activeBills.length === 0 && (
        <p className="muted" style={{ padding: 20 }}>No {tab} bills found in the current congress.</p>
      )}
    </div>
  );
}
