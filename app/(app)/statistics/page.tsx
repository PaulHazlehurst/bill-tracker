import { redirect } from "next/navigation";

// Insights used to be two pages; this address now opens the one that replaced them.
export default function Page() {
  redirect("/insights");
}
