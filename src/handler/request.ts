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
    let responseBody;
    // THIS LITERALLY TOOK 5 HOURS
    if (type.includes("text/vtt")) {
      console.log("VTT file found");
      responseBody = (await fetchedRespone.text()) as string;

      const regex = /.+?\.(jpg)+/g;
      const matches = [...responseBody.matchAll(regex)];

      let fileNames: string[] = [];
      // Iterate over matches
      for (const match of matches) {
        const filename = match[0];
        if (!fileNames.includes(filename)) {
          fileNames.push(filename);
        }
      }

      if (fileNames.length > 0) {
        for (const filename of fileNames) {
          const newUrl = url.replace(/\/[^\/]*$/, `/${filename}`);
          responseBody = responseBody.replaceAll(
            filename,
            "https://goodproxy.zephex0-f6c.workers.dev/fetch?url=" + newUrl
          );
        }
      }
    } else {
      console.log(type);
      responseBody = fetchedRespone.body;
    }
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
