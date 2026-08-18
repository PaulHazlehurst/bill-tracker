"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// A thick, low-opacity band across the top of every authenticated page,
// replacing the old thin decorative accent stripe with something that
// actually carries information: a greeting. There's no name field in the
// database - just email - so the display name is derived from the local
// part of the address (e.g. "jane.doe@x.com" -> "Jane Doe").
function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function WelcomeBar() {
  const supabase = createClient();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setName(displayNameFromEmail(data.user.email));
    });
  }, []);

  return (
    <div className="welcome-bar">
      {name && <span>Welcome back, {name}</span>}
    </div>
  );
}
