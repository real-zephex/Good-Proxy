import { HonoRequest } from "hono";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "3600",
};

export async function RequestHandler({ response }: { response: HonoRequest }) {
  try {
    const { url, ref } = response.query();
    const userHeaders = response.header();

    // fetching content from the remote server using the headers provided by the user
    const fetchedRespone = await fetch(url, {
      headers: { ...userHeaders, ...corsHeaders, Referer: ref ? ref : "" },
    }); // making request

    const type = fetchedRespone.headers.get("Content-Type") || "text/plain"; // detecting type of the response
    const responseBody: BodyInit | null = fetchedRespone.body; // getting content

    // M3U8 Check

    corsHeaders["Content-Type"] = type;
    return new Response(responseBody, {
      headers: corsHeaders,
      status: fetchedRespone.status,
      statusText: fetchedRespone.statusText,
    });
  } catch (error: any) {
    console.error(error);

    return new Response(
      JSON.stringify({ message: "Request failed", error: error.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json", // Set content type to JSON
        },
      }
    );
  }
}
