import Link from "next/link";
export default function PrivacyPage() {
  return (
    <div className="container" style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 500 }}>Privacy Policy</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Placeholder text - review with an actual lawyer before relying on this for a real product.
      </p>

      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>What we collect</h2>
        <p>
          Your email address (required), and phone number (optional, only if you want text alerts).
          If you join an organization, your email is visible to other members of that organization.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>How we use it</h2>
        <p>
          To send you email or text notifications about bills you've chosen to track, and nothing else.
          We don't sell or share your contact information with third parties.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Third parties involved</h2>
        <p>
          Supabase (hosting your account and data), Resend (sending emails), Twilio (sending texts),
          and congress.gov (the source of bill data). Each has its own privacy practices for the data
          that passes through them.
        </p>

        <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Your choices</h2>
        <p>
          Turn off email or text notifications per bill at any time from your dashboard or the bill's
          page. Delete your phone number in Settings. To delete your account entirely, contact support.
        </p>
      </div>

      <p className="muted"><Link href="/">← Back home</Link></p>
    </div>
  );
}
