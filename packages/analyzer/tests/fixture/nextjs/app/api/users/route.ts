import { listUsers } from "@/lib/users";

export async function GET() {
  return Response.json(await listUsers());
}

export async function POST(request: Request) {
  return Response.json(await request.json());
}
