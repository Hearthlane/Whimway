// Stand-in for next/server on Supabase Edge Functions: the API only uses NextResponse.json
// and NextResponse.redirect, which map directly onto the standard Response.
export class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit) {
    return Response.json(data, init);
  }
  static redirect(url: string | URL, init?: number | ResponseInit) {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    return new Response(null, { status, headers: { Location: String(url) } });
  }
}
