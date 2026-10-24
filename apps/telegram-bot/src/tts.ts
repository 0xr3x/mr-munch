/**
 * OpenAI Text-to-Speech — female voice for Saint's reservation call.
 * https://platform.openai.com/docs/guides/text-to-speech
 */

export async function synthesizeReservationVoice(input: {
  restaurantName: string;
  restaurantPhone: string;
  partySize: number;
  timeLabel: string;
}): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const voice = process.env.OPENAI_TTS_VOICE ?? "nova";
  const model = process.env.OPENAI_TTS_MODEL ?? "tts-1";

  const script = [
    `Hello, this is Saint calling from Mr Munch, on behalf of a dining party.`,
    `We would like to make a reservation at ${input.restaurantName} for ${input.partySize} people tonight at ${input.timeLabel}.`,
    `One guest is vegan, so please note dietary requirements on the booking.`,
    `Could you please hold a table for us? You can reach us back on this line if needed.`,
    `Thank you so much.`,
  ].join(" ");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: script,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai_tts_failed:${res.status}:${err.slice(0, 120)}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
