// Vercel serverless function — sends email alerts via EmailJS using server-side credentials.
// The EmailJS API keys are stored as Vercel environment variables, never exposed to the client.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { to_email, subject, message } = req.body || {};
  if (!to_email || !subject) {
    return res.status(400).json({ error: "to_email and subject are required" });
  }

  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) {
    return res.status(500).json({ error: "Email service not configured on the server" });
  }

  try {
    const emailRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: { to_email, subject, message },
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text();
      return res.status(emailRes.status).json({ error: `EmailJS error: ${text}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
