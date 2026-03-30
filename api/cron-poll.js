// Vercel Cron Job — polls job sources for ALL users and sends email alerts server-side.
// Runs on a schedule so users get alerts even when their browser is closed.
// Requires SUPABASE_SERVICE_ROLE_KEY env var to read all users' settings.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  // Verify this is a cron invocation (Vercel sets this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emailServiceId = process.env.EMAILJS_SERVICE_ID;
  const emailTemplateId = process.env.EMAILJS_TEMPLATE_ID;
  const emailPublicKey = process.env.EMAILJS_PUBLIC_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Load all user settings
  const { data: rows, error } = await supabase
    .from("user_settings")
    .select("user_id, settings");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  let totalAlerts = 0;

  for (const row of rows || []) {
    const { user_id, settings } = row;
    if (!settings) continue;

    // Only process users with email alerts enabled
    if (!settings.notifications?.emailEnabled || !settings.notifications?.email) continue;

    // Get all unique sources across tabs
    const srcs = [...new Map(
      (settings.tabs || []).flatMap(t => t.sources || []).map(s => [s.id, s])
    ).values()];
    if (srcs.length === 0) continue;

    // Fetch jobs from all sources
    const fetched = {};
    await Promise.all(srcs.map(async s => {
      try { fetched[s.id] = await fetchSourceJobs(s); } catch {}
    }));

    // Check for new matching jobs
    const seen = new Set(settings.seenJobIds || []);
    const initialized = new Set(settings.initializedSrcIds || []);
    const alerts = [];

    for (const tab of (settings.tabs || [])) {
      for (const src of (tab.sources || [])) {
        for (const job of (fetched[src.id] || [])) {
          const isNew = !seen.has(job.id);
          const srcReady = initialized.has(src.id);
          if (isNew && srcReady) {
            const { titleMatches, descMatches, matched } = matchJob(job, tab.keywords || []);
            if (matched && titleMatches.length > 0) {
              alerts.push({ job, tab, titleMatches, descMatches });
            }
          }
        }
      }
    }

    // Update seen job IDs and initialized sources
    const allIds = Object.values(fetched).flat().map(j => j.id);
    const newInitialized = [...initialized, ...srcs.map(s => s.id)];
    const updatedSettings = {
      ...settings,
      seenJobIds: [...new Set([...(settings.seenJobIds || []), ...allIds])],
      initializedSrcIds: [...new Set(newInitialized)],
      alertHistory: [
        ...alerts.map(a => ({
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          jobTitle: a.job.title,
          company: a.job.company,
          location: a.job.location,
          url: a.job.url,
          tabName: a.tab.name,
          titleMatches: a.titleMatches,
          descMatches: a.descMatches,
          alertedAt: new Date().toISOString(),
        })),
        ...(settings.alertHistory || []),
      ].slice(0, 200),
    };

    // Save updated settings
    await supabase.from("user_settings").update({ settings: updatedSettings })
      .eq("user_id", user_id);

    // Send email alerts
    if (alerts.length > 0 && emailServiceId && emailTemplateId && emailPublicKey) {
      for (const a of alerts) {
        const mt = a.titleMatches.length > 0 ? "TITLE MATCH" : "DESC MATCH";
        const kws = [...a.titleMatches, ...a.descMatches].join(", ");
        const subject = `[JobPulse · ${a.tab.name} · ${mt}] ${a.job.title}`;
        const message = `New match!\n\n${a.job.title}\n${a.job.company} · ${a.job.location}\n\nMatch: ${mt}\nKeywords: ${kws}\n\nView: ${a.job.url}`;

        try {
          await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              service_id: emailServiceId,
              template_id: emailTemplateId,
              user_id: emailPublicKey,
              template_params: { to_email: settings.notifications.email, subject, message },
            }),
          });
        } catch {}
      }
      totalAlerts += alerts.length;
    }
  }

  return res.status(200).json({ ok: true, usersProcessed: (rows || []).length, alertsSent: totalAlerts });
}

// ── ATS fetchers (duplicated from client for server-side use) ────────────────

async function fetchGreenhouse(slug) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (d.jobs || []).map(j => {
    const pay = j.pay_input_ranges?.[0];
    const salary = pay ? `$${Math.round((pay.min_cents || 0) / 100000)}k–$${Math.round((pay.max_cents || 0) / 100000)}k` : "";
    return { id: `gh-${j.id}`, title: j.title || "", company: slug, location: j.location?.name || "", description: j.content ? j.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "", url: j.absolute_url || "", postedAt: j.updated_at || new Date().toISOString(), ats: "greenhouse", salary };
  });
}

async function fetchLever(slug) {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (Array.isArray(d) ? d : []).map(j => ({ id: `lv-${j.id}`, title: j.text || "", company: slug, location: j.categories?.location || "", description: j.descriptionPlain || "", url: j.hostedUrl || "", postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(), ats: "lever" }));
}

async function fetchAshby(slug) {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (d.jobPostings || []).map(j => ({ id: `ash-${j.id}`, title: j.title || "", company: slug, location: j.locationName || "", description: (j.descriptionSocial || j.descriptionHtml || "").replace(/<[^>]+>/g, " "), url: j.jobPostingUrl || "", postedAt: j.publishedAt || new Date().toISOString(), ats: "ashby" }));
}

async function fetchSmartRecruiters(slug) {
  const res = await fetch(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (d.content || []).map(j => ({ id: `sr-${j.uuid}`, title: j.name || "", company: slug, location: [j.location?.city, j.location?.country].filter(Boolean).join(", "), description: (j.jobAd?.sections?.jobDescription?.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), url: `https://jobs.smartrecruiters.com/${slug}/${j.uuid}`, postedAt: j.releasedDate || new Date().toISOString(), ats: "smartrecruiters" }));
}

async function fetchRecruitee(slug) {
  const res = await fetch(`https://${slug}.recruitee.com/api/offers/?scope=published`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (d.offers || []).map(j => ({ id: `re-${j.id}`, title: j.title || "", company: slug, location: j.city || j.country || "", description: (j.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), url: j.careers_url || `https://${slug}.recruitee.com/o/${j.slug}`, postedAt: j.published_at || new Date().toISOString(), ats: "recruitee" }));
}

async function fetchWorkable(slug) {
  const res = await fetch(`https://apply.workable.com/api/v1/widget/jobs/${slug}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (d.jobs || []).map(j => ({ id: `wk-${j.shortcode}`, title: j.title || "", company: slug, location: [j.city, j.country].filter(Boolean).join(", "), description: (j.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), url: j.url || `https://apply.workable.com/${slug}/j/${j.shortcode}`, postedAt: j.published_on || new Date().toISOString(), ats: "workable" }));
}

async function fetchSourceJobs(s) {
  if (s.atsType === "greenhouse") return fetchGreenhouse(s.slug);
  if (s.atsType === "lever") return fetchLever(s.slug);
  if (s.atsType === "ashby") return fetchAshby(s.slug);
  if (s.atsType === "smartrecruiters") return fetchSmartRecruiters(s.slug);
  if (s.atsType === "recruitee") return fetchRecruitee(s.slug);
  if (s.atsType === "workable") return fetchWorkable(s.slug);
  // Skip scrape sources in cron — they need the app's own domain
  return [];
}

function matchJob(job, kws) {
  const t = job.title.toLowerCase(), d = job.description.toLowerCase();
  const titleMatches = kws.filter(k => t.includes(k.toLowerCase()));
  const descMatches = kws.filter(k => !t.includes(k.toLowerCase()) && d.includes(k.toLowerCase()));
  return { titleMatches, descMatches, matched: titleMatches.length > 0 || descMatches.length > 0 };
}
