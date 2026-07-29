const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";

export function getElevenLabsApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }
  return apiKey;
}

export async function elevenLabsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", getElevenLabsApiKey());

  const response = await fetch(`${ELEVENLABS_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs request failed (${response.status}): ${detail || response.statusText}`);
  }
  return response;
}
