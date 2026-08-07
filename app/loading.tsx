import Spinner from "@/components/Spinner";

// Next.js shows this automatically while a route is loading - e.g. right
// after clicking a nav link, before the destination page has rendered.
// No wiring needed beyond this file existing at app/loading.tsx.
export default function Loading() {
  return <Spinner label="Loading Bill Tracker…" large />;
}
