import Link from "next/link";
export default function TermsPage() {
  return (
    <div className="container" style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 500 }}>Terms of Service</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Placeholder text - review with an actual lawyer before relying on this for a real product.
      </p>

      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>1. What this service does</h2>
        <p>
          Bill Tracker lets you track federal legislation and receive email or text notifications when
          a tracked bill's status changes. Bill data comes from the congress.gov API; we don't control
          its accuracy or timeliness.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>2. Your account</h2>
        <p>
          You're responsible for keeping your login credentials secure and for the accuracy of the
          contact information (email, phone number) you provide.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>3. Team and organization data</h2>
        <p>
          If you join an organization, other members of that organization can see which bills you're
          tracking. Choose "No organization" at signup or in Settings if you'd rather keep your
          tracking private.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>4. No warranty</h2>
        <p>
          This service is provided as-is, without warranty of any kind. Notifications may be delayed,
          missed, or inaccurate. Don't rely on this as your sole source of information for anything
          time-sensitive or high-stakes.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>5. Changes</h2>
        <p>These terms may change. Continued use after a change means you accept the updated terms.</p>
      </div>

      <p className="muted"><Link href="/">← Back home</Link></p>
    </div>
  );
}
