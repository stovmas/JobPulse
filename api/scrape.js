// Vercel serverless function — scrapes custom job boards that have no standard ATS API
// Handles: Netflix (known JSON API), plus generic JSON-LD structured data for any site

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url parameter required", jobs: [] });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL", jobs: [] });
  }

  const host = parsedUrl.hostname.toLowerCase();

  try {
    let jobs = [];

    if (host === "jobs.netflix.com" || host.endsWith(".netflix.com")) {
      jobs = await scrapeNetflix();
    } else {
      jobs = await scrapeGenericJsonLd(url);
    }

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}

// ── Netflix ───────────────────────────────────────────────────────────────────
// Netflix exposes a JSON search API at /api/search with pagination.
async function scrapeNetflix() {
  const jobs = [];
  let page = 1;

  while (page <= 25) {
    const res = await fetch(`https://jobs.netflix.com/api/search?page=${page}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobPulse/1.0)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) break;

    let data;
    try { data = await res.json(); } catch { break; }

    // API returns { count, records: { postings: [...] } }
    const postings = data?.records?.postings || data?.jobs || data?.results || [];
    if (postings.length === 0) break;

    for (const j of postings) {
      const extId = j.external_id || j.id || j.requisitionId;
      const title = j.text || j.title || j.name || "";

      // Location can be nested in several shapes
      let location = "";
      if (typeof j.location === "string") location = j.location;
      else if (j.location?.text) location = j.location.text;
      else if (j.location?.name) location = j.location.name;
      else if (j.tags?.location) {
        const locs = Array.isArray(j.tags.location) ? j.tags.location : [j.tags.location];
        location = locs.map(l => l.label || l).filter(Boolean).join(", ");
      }

      const raw = j.description || j.content?.description || j.descriptionPlain || "";
      const description = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
      const jobUrl = extId
        ? `https://jobs.netflix.com/jobs/${extId}`
        : "https://jobs.netflix.com";

      jobs.push({
        id: `scrape-nf-${extId || Math.random().toString(36).slice(2)}`,
        title,
        company: "Netflix",
        location,
        description,
        url: jobUrl,
        postedAt: j.updated_at || j.createdAt || j.publishedAt || new Date().toISOString(),
        ats: "scrape",
      });
    }

    // Stop if we've fetched all pages
    const total = data?.count ?? data?.total ?? null;
    if (total !== null && jobs.length >= total) break;
    if (postings.length < 20) break; // partial page = last page
    page++;
  }

  return jobs;
}

// ── Generic JSON-LD ───────────────────────────────────────────────────────────
// Many company career pages embed Schema.org JobPosting structured data.
async function scrapeGenericJsonLd(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; JobPulse/1.0)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const html = await res.text();
  const jobs = [];
  const origin = new URL(url).hostname;

  // Find all <script type="application/ld+json"> blocks
  const RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = RE.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }

    const items = Array.isArray(data)
      ? data
      : data["@graph"]
      ? data["@graph"]
      : [data];

    for (const item of items) {
      if (item["@type"] === "JobPosting") {
        jobs.push(normalizeJsonLdJob(item, url, origin));
      }
    }
  }

  return jobs;
}

function normalizeJsonLdJob(j, sourceUrl, orgFallback) {
  const id = (j.identifier?.value || j["@id"] || j.title || Math.random()).toString();
  const company = j.hiringOrganization?.name || orgFallback || "";

  let location = "";
  if (j.jobLocation) {
    const loc = Array.isArray(j.jobLocation) ? j.jobLocation[0] : j.jobLocation;
    const addr = loc?.address || loc;
    if (addr) {
      location = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
        .filter(Boolean).join(", ");
    }
  }

  const description = (j.description || "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);

  return {
    id: `scrape-${id.slice(0, 60)}`,
    title: j.title || "",
    company,
    location,
    description,
    url: j.url || sourceUrl,
    postedAt: j.datePosted || new Date().toISOString(),
    ats: "scrape",
  };
}
