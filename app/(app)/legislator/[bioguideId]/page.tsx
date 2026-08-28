"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Phone, Globe, FileText, Star, User, Award, CalendarClock, Scale } from "lucide-react";
import { STAGE_LABELS } from "@/lib/billMeta";
import Spinner from "@/components/Spinner";

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
  office: string | null;
  servingSince: number | null;
  yearsInOffice: number | null;
  leadershipRoles: string[];
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
  position: string | null;
};

type Alignment = { aligned: number; atOdds: number; watching: number; label: string };

const ALIGN_COLORS: Record<string, string> = {
  "Aligned with you": "var(--pos-support)",
  "At odds with you": "var(--pos-oppose)",
  "Mixed record": "var(--accent-gold)",
  "No overlap yet": "var(--text-soft)",
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
  const [alignment, setAlignment] = useState<Alignment | null>(null);
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
        setAlignment(data.alignment ?? null);
        setLoading(false);
      })
      .catch(() => { setError("Couldn't load this legislator."); setLoading(false); });
  }, [bioguideId]);

  if (loading) return <div className="container-wide"><Spinner label="Loading profile…" large /></div>;
  if (error || !member) return (
    <div className="container" style={{ padding: 40 }}>
      <p className="error-text">{error ?? "Legislator not found."}</p>
      <Link href="/legislators"><button className="ghost"><ArrowLeft size={14} /> Back to directory</button></Link>
    </div>
  );

  const activeBills = tab === "sponsored" ? sponsored : cosponsored;
  const trackedInList = activeBills.filter((b) => b.isTracked);
  const otherInList = activeBills.filter((b) => !b.isTracked);

  return (
    <div className="container-wide">
      <Link href="/legislators" className="briefing-back" style={{ marginBottom: 20, display: "inline-flex" }}>
        <ArrowLeft size={14} /> All legislators
      </Link>

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
            {member.yearsInOffice != null && member.servingSince != null && (
              <span className="legislator-tenure">
                <CalendarClock size={12} /> In office since {member.servingSince} · {member.yearsInOffice} yr{member.yearsInOffice === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {member.leadershipRoles.length > 0 && (
            <div className="legislator-leadership">
              {member.leadershipRoles.map((role) => (
                <span key={role} className="legislator-leadership-badge">
                  <Award size={12} /> {role}
                </span>
              ))}
            </div>
          )}
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

      {alignment && (alignment.aligned > 0 || alignment.atOdds > 0 || alignment.watching > 0) && (
        <div className="legislator-alignment" style={{ borderColor: ALIGN_COLORS[alignment.label] ?? "var(--border)" }}>
          <div className="legislator-alignment-verdict">
            <Scale size={16} style={{ color: ALIGN_COLORS[alignment.label] ?? "var(--text-soft)" }} />
            <div>
              <div className="legislator-alignment-label" style={{ color: ALIGN_COLORS[alignment.label] ?? "var(--text)" }}>
                {alignment.label}
              </div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>Based on your positions on bills they've sponsored or cosponsored</div>
            </div>
          </div>
          <div className="legislator-alignment-tally">
            <span className="legislator-align-chip" style={{ color: "var(--pos-support)" }}>{alignment.aligned} support</span>
            <span className="legislator-align-chip" style={{ color: "var(--pos-oppose)" }}>{alignment.atOdds} oppose</span>
            <span className="legislator-align-chip muted">{alignment.watching} watching</span>
          </div>
        </div>
      )}

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
            <Link key={b.billId} href={`/bill/${b.billId}`} className="legislator-bill-row legislator-bill-tracked">
              <FileText size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="legislator-bill-title">{b.title}</div>
                {b.latestActionText && <div className="muted" style={{ fontSize: "0.75rem" }}>{b.latestActionText}</div>}
              </div>
              <span className="legislator-tracked-badge">Tracked</span>
            </Link>
          ))}
        </div>
      )}

      {otherInList.length > 0 && (
        <div>
          {trackedInList.length > 0 && <h3 className="legislator-section-label">Other bills</h3>}
          {otherInList.map((b) => (
            <Link key={b.billId} href={`/bill/${b.billId}`} className="legislator-bill-row">
              <FileText size={14} className="muted" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="legislator-bill-title">{b.title}</div>
                {b.latestActionText && <div className="muted" style={{ fontSize: "0.75rem" }}>{b.latestActionText}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {activeBills.length === 0 && (
        <p className="muted" style={{ padding: 20 }}>No {tab} bills found in the current congress.</p>
      )}
    </div>
  );
}
