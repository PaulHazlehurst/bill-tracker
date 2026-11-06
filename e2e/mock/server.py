# A stand-in for Supabase, used only by the automatic screenshot and speed
# checks (e2e/). It answers the database and sign-in requests the app makes
# with the sample data in fixtures.py: a made-up team, bills and clients.
# Python standard library only. Run: python3 e2e/mock/server.py [port]
import json, re, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *
for b in BILLS: b["actions_cache"] = ACTIONS if b["id"] == "hr-2407-119" else [{"actionDate": b["latest_action_date"], "text": b["latest_action"], "type": "Floor"}]
for b in BILLS: b["actions_fetched_at"] = ts(0)
for b in BILLS: b.update(related_bills=[{"congress":119,"type":"S","number":"1299","title":"Rural Hospital Closure Relief Act of 2025","relationshipType":"Identical bill"}] if b["id"]=="hr-2407-119" else [], related_bills_fetched_at=ts(0), summaries=[{"text":"This bill revises requirements for the critical access hospital designation under Medicare. It allows certain hospitals located within 35 miles of another hospital to qualify if they serve a population that is at least 25% low-income or in a health professional shortage area, among other criteria. The bill also requires the Centers for Medicare & Medicaid Services to report on payment adequacy.","actionDesc":"Introduced in House","actionDate":"2025-03-27","updateDate":"2025-04-30"}], summaries_fetched_at=ts(0), cosponsor_breakdown={"D":17,"R":24,"I":0,"total":41,"capped":False}, cosponsor_breakdown_fetched_at=ts(0), committee_activity=[{"committeeName":"Energy and Commerce Committee","chamber":"House","activities":[{"date":"2025-05-14","name":"Hearings by"},{"date":"2025-07-09","name":"Markup by"}]}], committee_activity_fetched_at=ts(0), hearing_details=[], hearing_details_fetched_at=ts(0), text_versions=[{"type":"Engrossed in House","date":d(2),"formats":[{"type":"PDF","url":"#"},{"type":"Formatted Text","url":"#"}]},{"type":"Introduced in House","date":"2025-03-27","formats":[{"type":"PDF","url":"#"}]}], text_versions_fetched_at=ts(0), lobbying_activity=[], lobbying_activity_fetched_at=ts(0), congressional_record_mentions=[], congressional_record_mentions_fetched_at=ts(0), news_items=[], news_items_fetched_at=ts(0))
TABLES = {"bills": BILLS, "tracked_bills": TRACKED, "bill_events": EVENTS, "prospective_bills": PROSPECTIVE, "profiles": [PROFILE, PROFILE2], "organizations": [PROFILE["organizations"]], "prospective_regulations": [{"id": "r1"}, {"id": "r2"}, {"id": "r3"}], "bill_workspace_items": [], "members": [], "member_positions": [], "api_call_log": [], "api_rate_limit_snapshot": [], "notifications": NOTIFICATIONS, "team_invites": INVITES, "push_subscriptions": [], "app_secrets": []}
USER = {"id": UID, "aud": "authenticated", "role": "authenticated", "email": PROFILE["email"], "app_metadata": {}, "user_metadata": {}, "created_at": "2025-01-01T00:00:00Z"}

def apply_filters(rows, params):
    out = rows
    for k, vals in params.items():
        if k in ("select", "order", "limit", "offset", "or", "on_conflict", "columns"): continue
        v = vals[0]
        m = re.match(r"^(not\.)?(eq|in|is|gte|lte|lt|gt|neq)\.(.*)$", v)
        if not m: continue
        neg, op, arg = m.groups()
        def test(r):
            x = r.get(k)
            if op == "eq": res = str(x).lower() == arg.lower() if isinstance(x, bool) else str(x) == arg
            elif op == "neq": res = str(x) != arg
            elif op == "in": res = str(x) in [a.strip('"') for a in arg.strip("()").split(",")]
            elif op == "is": res = (x is None) if arg == "null" else str(x).lower() == arg
            elif op in ("gte", "gt", "lte", "lt"):
                if x is None: return False
                res = {"gte": str(x) >= arg, "gt": str(x) > arg, "lte": str(x) <= arg, "lt": str(x) < arg}[op]
            else: res = True
            return not res if neg else res
        out = [r for r in out if test(r)]
    if "order" in params:
        for part in reversed(params["order"][0].split(",")):
            f, *rest = part.split(".")
            desc = "desc" in rest
            out = sorted(out, key=lambda r: (r.get(f) is None, str(r.get(f))), reverse=desc)
    if "limit" in params: out = out[: int(params["limit"][0])]
    return out

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Range")
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def send(self, code, body, extra=None):
        data = json.dumps(body).encode() if body is not None else b""
        self.send_response(code); self.cors()
        self.send_header("Content-Type", "application/json")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(data)
    def handle_any(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith("/auth/v1/user"): return self.send(200, USER)
        if u.path.startswith("/auth/v1/"): return self.send(200, {})
        m = re.match(r"^/rest/v1/(\w+)", u.path)
        if not m: return self.send(404, {"message": "not found"})
        table = m.group(1)
        if self.command in ("POST", "PATCH", "DELETE"):
            n = int(self.headers.get("Content-Length") or 0)
            if n: self.rfile.read(n)
            return self.send(201 if self.command == "POST" else 200, [] if "return=representation" in (self.headers.get("Prefer") or "") else None)
        rows = apply_filters(TABLES.get(table, []), urllib.parse.parse_qs(u.query))
        extra = {"Content-Range": f"0-{max(0, len(rows) - 1)}/{len(rows)}"}
        if self.command == "HEAD": return self.send(200, None, extra)
        if "vnd.pgrst.object" in (self.headers.get("Accept") or ""):
            return self.send(200, rows[0], extra) if rows else self.send(406, {"code": "PGRST116", "message": "no rows"})
        self.send(200, rows, extra)
    do_GET = do_POST = do_PATCH = do_DELETE = do_HEAD = handle_any

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 54321
print(f"mock database on http://127.0.0.1:{PORT}", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
