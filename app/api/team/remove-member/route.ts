import { NextRequest } from "next/server";
import { DELETE } from "../members/route";

// Older address for removing a member; kept so a cached page still works.
// POST { memberId } behaves like DELETE /api/team/members.
export async function POST(req: NextRequest) {
  return DELETE(req);
}
