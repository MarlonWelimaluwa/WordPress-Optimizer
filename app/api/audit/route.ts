import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are the "WordPress Audit Pro AI Engine" — a world-class WordPress performance and SEO specialist.

You analyze real PageSpeed Insights data and generate professional audit reports that help site owners fix their WordPress sites.

WORDPRESS PERFORMANCE EXPERTISE (2026):

CORE WEB VITALS THRESHOLDS:
- LCP (Largest Contentful Paint): Good < 2.5s | Needs Improvement 2.5-4s | Poor > 4s
- FID/INP (Interaction to Next Paint): Good < 200ms | Needs Improvement 200-500ms | Poor > 500ms
- CLS (Cumulative Layout Shift): Good < 0.1 | Needs Improvement 0.1-0.25 | Poor > 0.25
- TTFB (Time to First Byte): Good < 800ms | Needs Improvement 800ms-1.8s | Poor > 1.8s
- FCP (First Contentful Paint): Good < 1.8s | Needs Improvement 1.8-3s | Poor > 3s

COMMON WORDPRESS PERFORMANCE ISSUES:
1. No caching plugin → Install WP Rocket, W3 Total Cache, or LiteSpeed Cache
2. Unoptimized images → Install Smush or ShortPixel, use WebP format
3. No CDN → Use Cloudflare free tier or BunnyCDN
4. Too many plugins → Audit and remove unused plugins
5. Render-blocking JS/CSS → Defer JS, minify CSS, use async loading
6. No GZIP compression → Enable via .htaccess or caching plugin
7. Large page size → Minify HTML, CSS, JS
8. Slow hosting → Upgrade to SiteGround, Cloudways, or WP Engine
9. No lazy loading → Enable native lazy loading for images
10. Outdated PHP → Upgrade to PHP 8.2 or 8.3 for 30%+ speed improvement

WORDPRESS SEO ESSENTIALS:
- Title tag: 50-60 chars, primary keyword near start
- Meta description: 150-160 chars, compelling, includes keyword
- H1: One per page, contains primary keyword
- Image ALT text: Descriptive, includes keywords naturally
- XML Sitemap: Must exist and be submitted to Google Search Console
- Robots.txt: Must be configured correctly
- SSL/HTTPS: Required for ranking
- Schema markup: Helps with rich snippets
- Core Web Vitals: Direct ranking factor since 2021

PLUGIN RECOMMENDATIONS BY ISSUE:
- Caching: WP Rocket ($59/yr - best), LiteSpeed Cache (free), W3 Total Cache (free)
- Images: Smush (free), ShortPixel (paid), Imagify (freemium)
- SEO: Yoast SEO (free/paid), Rank Math (free - recommended 2026)
- Security: Wordfence (free), Sucuri (paid)
- CDN: Cloudflare (free tier excellent), BunnyCDN (cheap)
- Database: WP-Optimize (free)
- Minification: Autoptimize (free), if not using WP Rocket

Be specific, accurate, and professional. Give exact plugin names, exact settings to change, and measurable impact of each fix.
OUTPUT: ONLY valid JSON. No markdown. No explanation. No text before or after.`;

function extractJSON(text: string): string {
    // Remove markdown code blocks
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('No valid JSON found in response');
    cleaned = cleaned.slice(start, end + 1);

    // Fix common JSON issues from AI output
    cleaned = cleaned
        .replace(/,\s*}/g, '}')          // trailing comma in object
        .replace(/,\s*]/g, ']')          // trailing comma in array
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')  // unquoted keys
        .replace(/:\s*'([^']*)'/g, ': "$1"')  // single quotes to double quotes
        .replace(/[\x00-\x1F\x7F]/g, ' '); // remove control characters

    // Validate — try parse, if fails try to salvage
    try {
        JSON.parse(cleaned);
        return cleaned;
    } catch {
        // Last resort — find last valid closing brace
        let lastValid = cleaned;
        for (let i = cleaned.length - 1; i > 0; i--) {
            if (cleaned[i] === '}') {
                try {
                    JSON.parse(cleaned.slice(0, i + 1));
                    lastValid = cleaned.slice(0, i + 1);
                    break;
                } catch { continue; }
            }
        }
        return lastValid;
    }
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000,
                responseMimeType: 'application/json',
            },
        }),
    });
    const d = await res.json();
    if (d.error) throw new Error(`Gemini error: ${d.error.message}`);
    const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) throw new Error('Empty response from Gemini');
    return extractJSON(raw);
}


async function fetchPageSpeed(url: string, strategy: 'desktop' | 'mobile') {
    const apiKey = process.env.PAGESPEED_API_KEY || '';
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&category=seo&category=best-practices${apiKey ? `&key=${apiKey}` : ''}`;

    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`PageSpeed API error: ${res.status}`);
    return await res.json();
}

export async function POST(req: NextRequest) {
    try {
        const { url } = await req.json();
        if (!url) return NextResponse.json({ ok: false, error: 'URL is required' }, { status: 400 });

        // Fetch both desktop and mobile PageSpeed data in parallel
        let desktopData: Record<string, unknown> = {};
        let mobileData: Record<string, unknown> = {};
        let pageSpeedError = '';

        try {
            [desktopData, mobileData] = await Promise.all([
                fetchPageSpeed(url, 'desktop'),
                fetchPageSpeed(url, 'mobile'),
            ]);
        } catch (e) {
            pageSpeedError = e instanceof Error ? e.message : 'PageSpeed fetch failed';
        }

        // Extract key metrics
        const extractMetrics = (data: Record<string, unknown>) => {
            const lhr = data.lighthouseResult as Record<string, unknown> || {};
            const categories = lhr.categories as Record<string, Record<string, unknown>> || {};
            const audits = lhr.audits as Record<string, Record<string, unknown>> || {};

            return {
                performanceScore: Math.round(((categories.performance?.score as number) || 0) * 100),
                seoScore: Math.round(((categories.seo?.score as number) || 0) * 100),
                bestPracticesScore: Math.round(((categories['best-practices']?.score as number) || 0) * 100),
                lcp: (audits['largest-contentful-paint']?.displayValue as string) || 'N/A',
                fid: (audits['max-potential-fid']?.displayValue as string) || (audits['interactive']?.displayValue as string) || 'N/A',
                cls: (audits['cumulative-layout-shift']?.displayValue as string) || 'N/A',
                ttfb: (audits['server-response-time']?.displayValue as string) || 'N/A',
                fcp: (audits['first-contentful-paint']?.displayValue as string) || 'N/A',
                speedIndex: (audits['speed-index']?.displayValue as string) || 'N/A',
                tti: (audits['interactive']?.displayValue as string) || 'N/A',
                totalByteWeight: (audits['total-byte-weight']?.displayValue as string) || 'N/A',
                domSize: (audits['dom-size']?.displayValue as string) || 'N/A',
                renderBlocking: (audits['render-blocking-resources']?.displayValue as string) || 'None detected',
                unusedJS: (audits['unused-javascript']?.displayValue as string) || 'N/A',
                unusedCSS: (audits['unused-css-rules']?.displayValue as string) || 'N/A',
                imageOptimization: (audits['uses-optimized-images']?.displayValue as string) || 'N/A',
                usesWebP: (audits['uses-webp-images']?.displayValue as string) || 'N/A',
                lazyLoading: (audits['offscreen-images']?.displayValue as string) || 'N/A',
                textCompression: (audits['uses-text-compression']?.displayValue as string) || 'N/A',
                https: (audits['is-on-https']?.score as number) === 1 ? 'Yes' : 'No',
                httpRedirect: (audits['redirects-http']?.score as number) === 1 ? 'Yes' : 'No',
                opportunities: Object.entries(audits)
                    .filter(([, v]) => (v as Record<string, unknown>).details && (v as Record<string, unknown>).score !== null && ((v as Record<string, unknown>).score as number) < 0.9)
                    .slice(0, 10)
                    .map(([key, v]) => ({
                        id: key,
                        title: (v as Record<string, unknown>).title as string,
                        description: (v as Record<string, unknown>).description as string,
                        score: (v as Record<string, unknown>).score as number,
                        displayValue: (v as Record<string, unknown>).displayValue as string,
                    })),
            };
        };

        const desktop = Object.keys(desktopData).length > 0 ? extractMetrics(desktopData) : null;
        const mobile = Object.keys(mobileData).length > 0 ? extractMetrics(mobileData) : null;

        // Build analysis prompt with real data
        const userPrompt = `Analyze this WordPress site and generate a complete professional audit report.

URL: ${url}
Audit Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

${pageSpeedError ? `NOTE: PageSpeed API error: ${pageSpeedError}. Generate a thorough audit based on WordPress best practices and common issues.` : ''}

REAL PAGESPEED DATA:
Desktop Performance Score: ${desktop?.performanceScore ?? 'unavailable'}
Mobile Performance Score: ${mobile?.performanceScore ?? 'unavailable'}
Desktop SEO Score: ${desktop?.seoScore ?? 'unavailable'}
Mobile SEO Score: ${mobile?.seoScore ?? 'unavailable'}

CORE WEB VITALS (Desktop):
- LCP: ${desktop?.lcp ?? 'unavailable'}
- FID/INP: ${desktop?.fid ?? 'unavailable'}
- CLS: ${desktop?.cls ?? 'unavailable'}
- TTFB: ${desktop?.ttfb ?? 'unavailable'}
- FCP: ${desktop?.fcp ?? 'unavailable'}

CORE WEB VITALS (Mobile):
- LCP: ${mobile?.lcp ?? 'unavailable'}
- CLS: ${mobile?.cls ?? 'unavailable'}
- FCP: ${mobile?.fcp ?? 'unavailable'}

PAGE METRICS:
- Page Size: ${desktop?.totalByteWeight ?? 'unavailable'}
- DOM Size: ${desktop?.domSize ?? 'unavailable'}
- Render Blocking: ${desktop?.renderBlocking ?? 'unavailable'}
- Unused JS: ${desktop?.unusedJS ?? 'unavailable'}
- Unused CSS: ${desktop?.unusedCSS ?? 'unavailable'}
- Image Optimization: ${desktop?.imageOptimization ?? 'unavailable'}
- WebP Images: ${desktop?.usesWebP ?? 'unavailable'}
- Lazy Loading: ${desktop?.lazyLoading ?? 'unavailable'}
- Text Compression/GZIP: ${desktop?.textCompression ?? 'unavailable'}
- HTTPS: ${desktop?.https ?? 'unavailable'}

TOP OPPORTUNITIES IDENTIFIED BY PAGESPEED:
${desktop?.opportunities?.map(o => `- ${o.title}: ${o.displayValue || ''} (Score: ${o.score})`).join('\n') || 'None available'}

Based on this REAL data, generate a comprehensive WordPress audit report. Use the actual scores and metrics. If data shows issues, diagnose them accurately. Be specific about what the numbers mean.

Return this EXACT JSON structure:
{
  "url": "${url}",
  "auditDate": "${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}",
  "overallScore": 65,
  "performanceScore": ${desktop?.performanceScore ?? 50},
  "seoScore": ${desktop?.seoScore ?? 50},
  "mobileScore": ${mobile?.performanceScore ?? 45},
  "securityScore": 70,
  "grade": "C",
  "summary": "3-4 sentence honest executive summary of what this site's performance means for the business — mention specific scores, what is causing the main issues, and the business impact (lost rankings, lost conversions)",
  "coreWebVitals": {
    "lcp": {
      "value": "${desktop?.lcp ?? 'N/A'}",
      "status": "poor",
      "description": "LCP measures how long it takes for the largest content element to load. This directly affects user experience and Google ranking.",
      "fix": "specific actionable fix based on the actual LCP value detected"
    },
    "fid": {
      "value": "${desktop?.fid ?? 'N/A'}",
      "status": "good",
      "description": "FID/INP measures how quickly the page responds to user interactions like clicks and taps.",
      "fix": "specific fix or confirmation it is good"
    },
    "cls": {
      "value": "${desktop?.cls ?? 'N/A'}",
      "status": "needs-improvement",
      "description": "CLS measures visual stability — how much the page layout shifts unexpectedly as it loads.",
      "fix": "specific fix based on actual CLS value"
    },
    "ttfb": {
      "value": "${desktop?.ttfb ?? 'N/A'}",
      "status": "needs-improvement",
      "description": "TTFB measures how fast the server responds. A high TTFB usually means slow hosting or no caching.",
      "fix": "specific fix based on actual TTFB value"
    },
    "fcp": {
      "value": "${desktop?.fcp ?? 'N/A'}",
      "status": "needs-improvement",
      "description": "FCP measures how long until the first content appears on screen. Users perceive this as the page starting to load.",
      "fix": "specific fix based on actual FCP value"
    }
  },
  "speedMetrics": {
    "desktop": ${desktop?.performanceScore ?? 50},
    "mobile": ${mobile?.performanceScore ?? 40},
    "loadTime": "estimated based on available metrics",
    "pageSize": "${desktop?.totalByteWeight ?? 'N/A'}",
    "requests": 45
  },
  "issues": {
    "critical": [
      {
        "title": "specific critical issue found from the real data",
        "description": "what is causing this and why it is serious",
        "impact": "specific measurable impact on rankings/conversions/revenue",
        "fix": "exact step-by-step fix",
        "plugin": "specific plugin name if applicable"
      }
    ],
    "warnings": [
      {
        "title": "specific warning from the real data",
        "description": "what is causing this",
        "impact": "impact on performance or SEO",
        "fix": "exact fix with specific settings",
        "plugin": "specific plugin name if applicable"
      }
    ],
    "passed": [
      {
        "title": "what is working well",
        "description": "why this is good for performance or SEO"
      }
    ]
  },
  "seoChecks": [
    {
      "title": "Page Title Tag",
      "status": "pass",
      "current": "detected or estimated status",
      "issue": "specific issue if any",
      "fix": "specific fix"
    },
    {
      "title": "Meta Description",
      "status": "warn",
      "current": "detected or estimated status",
      "issue": "specific issue",
      "fix": "specific fix"
    },
    {
      "title": "HTTPS Security",
      "status": "${desktop?.https === 'Yes' ? 'pass' : 'fail'}",
      "current": "${desktop?.https === 'Yes' ? 'HTTPS enabled' : 'HTTP only - not secure'}",
      "issue": "${desktop?.https === 'Yes' ? 'None' : 'Site is not using HTTPS — Google penalizes HTTP sites'}",
      "fix": "${desktop?.https === 'Yes' ? 'No action needed' : 'Install SSL certificate — free with Lets Encrypt through your hosting provider'}"
    },
    {
      "title": "Image ALT Text",
      "status": "warn",
      "current": "estimated based on site analysis",
      "issue": "specific issue",
      "fix": "specific fix"
    },
    {
      "title": "XML Sitemap",
      "status": "warn",
      "current": "estimated status",
      "issue": "specific issue",
      "fix": "Install Rank Math or Yoast SEO to auto-generate and submit sitemap"
    },
    {
      "title": "Core Web Vitals (Ranking Factor)",
      "status": "${(desktop?.performanceScore ?? 0) >= 90 ? 'pass' : (desktop?.performanceScore ?? 0) >= 50 ? 'warn' : 'fail'}",
      "current": "Performance score: ${desktop?.performanceScore ?? 'N/A'}/100",
      "issue": "${(desktop?.performanceScore ?? 0) < 90 ? 'Core Web Vitals are a direct Google ranking factor since 2021. Poor scores = lower ranking.' : 'Good performance scores'}",
      "fix": "Apply all performance fixes in this report to improve Core Web Vitals"
    }
  ],
  "wordpressSpecific": {
    "phpVersion": "Detected from server headers or estimated — recommend PHP 8.2+",
    "wordpressVersion": "Detected or estimated — should always be latest",
    "pluginBloat": "estimated based on page size and request count",
    "caching": "${(desktop?.performanceScore ?? 0) < 70 ? 'No caching detected — critical issue' : 'Some caching detected'}",
    "imageOptimization": "${desktop?.imageOptimization !== 'N/A' ? 'Issues detected' : 'Status unknown'}",
    "cdnDetected": "Not detected — recommended",
    "gzipEnabled": "${desktop?.textCompression === 'N/A' ? 'Status unknown' : 'Detected'}",
    "httpsEnabled": "${desktop?.https === 'Yes' ? 'Yes — HTTPS enabled' : 'No — HTTP only'}",
    "recommendations": [
      {
        "priority": "high",
        "action": "Install a caching plugin immediately",
        "plugin": "WP Rocket (paid, best) or LiteSpeed Cache (free)",
        "impact": "Can improve page speed score by 20-40 points instantly"
      },
      {
        "priority": "high",
        "action": "Optimize and compress all images",
        "plugin": "Smush or ShortPixel — enable WebP conversion",
        "impact": "Reduces page size by 40-60%, improves LCP significantly"
      },
      {
        "priority": "high",
        "action": "Install and configure Rank Math SEO",
        "plugin": "Rank Math (free) — better than Yoast in 2026",
        "impact": "Fixes meta tags, generates sitemap, adds schema markup automatically"
      },
      {
        "priority": "medium",
        "action": "Set up Cloudflare CDN",
        "plugin": "Cloudflare (free tier) — add site and update nameservers",
        "impact": "Reduces TTFB by 200-400ms, adds DDoS protection, free SSL"
      },
      {
        "priority": "medium",
        "action": "Upgrade PHP to version 8.2 or 8.3",
        "plugin": "Done in hosting control panel — no plugin needed",
        "impact": "Improves WordPress execution speed by up to 30%"
      },
      {
        "priority": "low",
        "action": "Clean database and remove unused plugins",
        "plugin": "WP-Optimize (free) for database cleanup",
        "impact": "Reduces database query time, improves TTFB"
      }
    ]
  },
  "topFixes": [
    "specific #1 fix based on the actual data that will have most impact",
    "specific #2 fix",
    "specific #3 fix",
    "specific #4 fix",
    "specific #5 fix"
  ],
  "nextActions": {
    "immediate": [
      "specific action to do today based on the audit data",
      "another specific immediate action",
      "another immediate action"
    ],
    "shortTerm": [
      "specific action for this week",
      "another this week action",
      "another"
    ],
    "longTerm": [
      "specific action for this month",
      "another this month action",
      "another"
    ]
  }
}`;

        const raw = await callOpenAI(SYSTEM_PROMPT, userPrompt);
        const parsed = JSON.parse(raw);

        // Override AI hallucinations with real PageSpeed data
        if (desktop?.https === 'Yes') {
            if (Array.isArray(parsed.seoChecks)) {
                const httpsCheck = parsed.seoChecks.find((c: { title: string }) => c.title?.toLowerCase().includes('https'));
                if (httpsCheck) {
                    httpsCheck.status = 'pass';
                    httpsCheck.current = 'HTTPS enabled — SSL certificate active';
                    httpsCheck.issue = 'None — HTTPS is properly configured';
                    httpsCheck.fix = 'No action needed — SSL is active';
                }
            }
            if (parsed.wordpressSpecific) {
                parsed.wordpressSpecific.httpsEnabled = 'Yes — HTTPS active';
            }
            if (Array.isArray(parsed.issues?.critical)) {
                parsed.issues.critical = parsed.issues.critical.filter(
                    (i: { title: string }) => !i.title?.toLowerCase().includes('https') && !i.title?.toLowerCase().includes('ssl')
                );
            }
            if (Array.isArray(parsed.issues?.warnings)) {
                parsed.issues.warnings = parsed.issues.warnings.filter(
                    (i: { title: string }) => !i.title?.toLowerCase().includes('https') && !i.title?.toLowerCase().includes('ssl')
                );
            }
        }

        // Override scores with real PageSpeed data
        if (desktop?.performanceScore) parsed.performanceScore = desktop.performanceScore;
        if (desktop?.seoScore) parsed.seoScore = desktop.seoScore;
        if (mobile?.performanceScore) parsed.mobileScore = mobile.performanceScore;
        if (desktop?.performanceScore && mobile?.performanceScore) {
            parsed.overallScore = Math.round((desktop.performanceScore + mobile.performanceScore + (desktop.seoScore || 80)) / 3);
            parsed.grade = parsed.overallScore >= 90 ? 'A' : parsed.overallScore >= 75 ? 'B' : parsed.overallScore >= 60 ? 'C' : parsed.overallScore >= 45 ? 'D' : 'F';
        }
        if (desktop?.performanceScore) parsed.speedMetrics.desktop = desktop.performanceScore;
        if (mobile?.performanceScore) parsed.speedMetrics.mobile = mobile.performanceScore;

        return NextResponse.json({ ok: true, data: parsed });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Audit error:', msg);
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}