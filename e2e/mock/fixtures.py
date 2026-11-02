# Sample data for the stand-in database (e2e/mock/server.py). All made up.
import datetime as dt
TODAY = dt.date.today()
def d(n): return (TODAY - dt.timedelta(days=n)).isoformat()
def ts(n, h=7): return (dt.datetime.combine(TODAY - dt.timedelta(days=n), dt.time(h, 12))).isoformat() + "Z"
UID = "11111111-1111-1111-1111-111111111111"
UID2 = "22222222-2222-2222-2222-222222222222"
ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

def snap(sponsor, party, state, cos, intro, policy, chamber="House", cbo=None):
    return {"sponsors": [{"fullName": f"Rep. {sponsor} [{party}-{state}]", "party": party, "state": state}], "cosponsors": {"count": cos}, "introducedDate": intro, "policyArea": {"name": policy}, "originChamber": chamber, "cboCostEstimates": cbo or [], "textVersions": {"count": 2}, "summaries": {"count": 1}, "committees": {"count": 2}}

BILLS = [
  dict(id="hr-2407-119", title="Rural Hospital Closure Relief Act of 2025", status_stage="passed_house", progress_pct=55, latest_action="Received in the Senate and Read twice and referred to the Committee on Finance.", latest_action_date=d(1), raw_snapshot=snap("Ashley Hinson", "R", "IA", 41, "2025-03-27", "Health", cbo=[{"description": "As ordered reported by the House Committee on Energy and Commerce", "pubDate": "2025-07-10T00:00:00Z", "url": "https://www.cbo.gov/publication/1"}])),
  dict(id="s-1260-119", title="Critical Access Hospital Relief Act", status_stage="reported", progress_pct=36, latest_action="Placed on Senate Legislative Calendar under General Orders. Calendar No. 212.", latest_action_date=d(3), raw_snapshot=snap("John Barrasso", "R", "WY", 18, "2025-04-03", "Health", chamber="Senate")),
  dict(id="hr-4206-119", title="Telehealth Modernization Act", status_stage="committee", progress_pct=20, latest_action="Referred to the Subcommittee on Health.", latest_action_date=d(6), raw_snapshot=snap("Buddy Carter", "R", "GA", 63, "2025-06-26", "Health")),
  dict(id="s-2016-119", title="CONNECT for Health Act of 2025", status_stage="committee", progress_pct=20, latest_action="Read twice and referred to the Committee on Finance.", latest_action_date=d(140), raw_snapshot=snap("Brian Schatz", "D", "HI", 60, "2025-06-10", "Health", chamber="Senate")),
  dict(id="hr-1-119", title="One Big Beautiful Bill Act", status_stage="enacted", progress_pct=100, latest_action="Became Public Law No: 119-21.", latest_action_date="2025-07-04", raw_snapshot=snap("Jodey Arrington", "R", "TX", 0, "2025-05-20", "Economics and Public Finance")),
  dict(id="hr-3592-119", title="Rural Obstetrics Readiness Act", status_stage="introduced", progress_pct=8, latest_action="Introduced in House", latest_action_date=d(0), raw_snapshot=snap("Angie Craig", "D", "MN", 4, d(0), "Health")),
  dict(id="s-1003-119", title="340B Access Act", status_stage="passed_both", progress_pct=75, latest_action="Message on Senate action sent to the House.", latest_action_date=d(9), raw_snapshot=snap("Shelley Moore Capito", "R", "WV", 22, "2025-03-12", "Health", chamber="Senate")),
  dict(id="hr-5110-119", title="Rural EMS Funding Extension Act", status_stage="to_president", progress_pct=88, latest_action="Presented to President.", latest_action_date=d(2), raw_snapshot=snap("Jen Kiggans", "R", "VA", 31, "2025-09-03", "Health")),
]
for b in BILLS:
    t, n, c = b["id"].split("-")
    b.update(congress=int(c), bill_type=t, bill_number=int(n), congress_url=None, last_polled_at=ts(0, 6), next_poll_at=ts(-1))

POS = ["support", "watching", "support", "none", "watching", "support", "oppose", "support"]
TRACKED = [dict(id=f"t{i}", bill_id=b["id"], user_id=UID if i != 6 else UID2, notify_email=True, notify_sms=False, position=POS[i], created_at=ts(30 - i), bills={k: b[k] for k in ("title","status_stage","progress_pct","latest_action","latest_action_date","congress_url","raw_snapshot","last_polled_at","bill_type")}) for i, b in enumerate(BILLS)]
TITLE = {b["id"]: b["title"] for b in BILLS}
def ev(i, bill, typ, summary, ad, seen):
    return dict(id=f"e{i}", bill_id=bill, event_type=typ, summary=summary, action_date=ad, occurred_at=seen, details=None, notified_at=seen, bills={"title": TITLE[bill]})
EVENTS = [
  ev(1, "hr-3592-119", "new_action", "Introduced in House", d(0), ts(0)),
  ev(2, "hr-2407-119", "new_action", "Received in the Senate and Read twice and referred to the Committee on Finance.", d(1), ts(0)),
  ev(3, "hr-2407-119", "status_change", "Passed House: Passed/agreed to in House: On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays: (2/3 required): 381 - 37 (Roll no. 288).", d(2), ts(1)),
  ev(4, "hr-5110-119", "status_change", "Sent to President: Presented to President.", d(2), ts(1)),
  ev(5, "s-1260-119", "status_change", "Reported by committee: Placed on Senate Legislative Calendar under General Orders. Calendar No. 212.", d(3), ts(2)),
  ev(6, "s-1260-119", "cbo_published", "CBO cost estimate published: As reported by the Senate Committee on Finance", d(4), ts(3)),
  ev(7, "hr-4206-119", "cosponsor_change", "5 cosponsors added (now 63)", None, ts(3)),
  ev(8, "hr-4206-119", "new_action", "Referred to the Subcommittee on Health.", d(6), ts(5)),
  ev(9, "s-1003-119", "status_change", "Passed both chambers: Passed House without amendment by Voice Vote.", d(9), ts(8)),
  ev(10, "s-1003-119", "text_published", "New version of the bill text published", None, ts(8)),
  ev(11, "hr-2407-119", "cosponsor_change", "3 cosponsors added (now 41)", None, ts(11)),
  ev(12, "s-1260-119", "new_action", "Committee on Finance. Ordered to be reported with an amendment in the nature of a substitute favorably.", d(12), ts(11)),
]
ACTIONS = [
  {"actionDate": d(1), "text": "Received in the Senate and Read twice and referred to the Committee on Finance.", "type": "IntroReferral", "chamber": "Senate"},
  {"actionDate": d(2), "text": "Motion to reconsider laid on the table Agreed to without objection.", "type": "Floor", "chamber": "House floor actions"},
  {"actionDate": d(2), "text": "Passed/agreed to in House: On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays: (2/3 required): 381 - 37 (Roll no. 288).", "type": "Floor", "actionCode": "8000", "chamber": "Library of Congress", "hasRecordedVote": True},
  {"actionDate": d(2), "text": "Considered under suspension of the rules.", "type": "Floor", "chamber": "House floor actions"},
  {"actionDate": "2025-09-18", "text": "Placed on the Union Calendar, Calendar No. 233.", "type": "Calendars", "chamber": "House"},
  {"actionDate": "2025-09-18", "text": "Reported (Amended) by the Committee on Energy and Commerce. H. Rept. 119-251.", "type": "Committee", "chamber": "House"},
  {"actionDate": "2025-07-09", "text": "Ordered to be Reported (Amended) by the Yeas and Nays: 50 - 0.", "type": "Committee", "chamber": "House committee actions"},
  {"actionDate": "2025-05-14", "text": "Subcommittee Hearings Held", "type": "Committee", "chamber": "House committee actions"},
  {"actionDate": "2025-03-27", "text": "Referred to the House Committee on Energy and Commerce.", "type": "IntroReferral", "chamber": "House floor actions"},
  {"actionDate": "2025-03-27", "text": "Introduced in House", "type": "IntroReferral", "actionCode": "Intro-H", "chamber": "Library of Congress"},
]
PROSPECTIVE = [
  dict(id="p1", bill_id="hr-6120-119", matched_topic="telehealth", discovered_at=ts(0), dismissed=False, match_reason='Title mentions "telehealth" · Published in the last 4 months', match_score=11, organization_id=ORG, user_id=None, bills={"title": "Permanent Telehealth Flexibility for Seniors Act", "status_stage": "committee", "latest_action_date": d(5), "bill_type": "hr", "latest_action": "Referred", "progress_pct": 20}),
  dict(id="p2", bill_id="s-2877-119", matched_topic="critical access hospital", discovered_at=ts(0), dismissed=False, match_reason='Bill text mentions "critical access hospital"', match_score=6, organization_id=ORG, user_id=None, bills={"title": "Rural Health Infrastructure Investment Act of 2025", "status_stage": "committee", "latest_action_date": d(8), "bill_type": "s", "latest_action": "Referred", "progress_pct": 20}),
  dict(id="p3", bill_id="hr-5901-119", matched_topic="340B", discovered_at=ts(1), dismissed=False, match_reason='Title mentions "340B" · Recently active in Congress', match_score=9, organization_id=ORG, user_id=None, bills={"title": "340B Pharmaceutical Access and Transparency Act", "status_stage": "introduced", "latest_action_date": d(1), "bill_type": "hr", "latest_action": "Introduced", "progress_pct": 8}),
  dict(id="p4", bill_id="hr-4810-119", matched_topic="telehealth", discovered_at=ts(2), dismissed=False, match_reason='Bill text mentions "telehealth"', match_score=4, organization_id=ORG, user_id=None, bills={"title": "Behavioral Health Workforce Expansion and Telemental Health Act", "status_stage": "committee", "latest_action_date": d(30), "bill_type": "hr", "latest_action": "Referred", "progress_pct": 20}),
]
PROFILE = dict(id=UID, email="ben@pinnaclestrategies.com", organization_id=ORG, phone=None, email_notifications_enabled=True, default_notify_email=True, default_notify_sms=False, topics=[], organizations=dict(id=ORG, name="Pinnacle Strategies", logo_url=None, topics=["telehealth", "critical access hospital", "340B", "rural EMS"], invite_code="PNCL24XQ", created_by=UID))
PROFILE2 = dict(id=UID2, email="dana@pinnaclestrategies.com", organization_id=ORG, phone=None, email_notifications_enabled=False, topics=[])
