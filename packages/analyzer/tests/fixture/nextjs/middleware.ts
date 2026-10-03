import { NextResponse } from "next/server";

export function middleware(request: Request) {
  const session = request.headers.get("cookie");
  return session ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/api/users/:path*"] };
