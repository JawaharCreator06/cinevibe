// netlify/functions/omdb-proxy.js
export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};

    const OMDB_KEY = process.env.OMDB_API_KEY;
    if (!OMDB_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "OMDB_API_KEY not configured in Netlify" }),
      };
    }

    const qs = new URLSearchParams({
      apikey: OMDB_KEY,
      ...params,
    });

    const url = `https://www.omdbapi.com/?${qs.toString()}`;

    const res = await fetch(url);
    const data = await res.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json" },
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
