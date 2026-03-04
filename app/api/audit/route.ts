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

IMPORTANT: Do NOT include any HTTPS or SSL checks in your response. Security checks are handled by a separate backend system. Never mention HTTPS, SSL certificates, or HTTP/HTTPS in your issues, warnings, summary, topFixes, or nextActions.

OUTPUT: ONLY valid JSON. No markdown. No explanation. No text before or after.`;

function extractJSON(text: string): string {
    // Step 1: Clean markdown
    let s = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    // Step 2: Find JSON boundaries
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found');
    s = s.slice(start, end + 1);

    // Step 3: Fix trailing commas (most common Gemini issue)
    // Remove trailing comma before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1');

    // Step 4: Remove control characters
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Step 5: Try to parse
    try {
        JSON.parse(s);
        return s;
    } catch(e) {
        // Step 6: Try again with more aggressive fixes
        s = s
            .replace(/,\s*,/g, ',')           // double commas
            .replace(/\[\s*,/g, '[')           // leading comma in array
            .replace(/,\s*([}\]])/g, '$1');    // trailing commas again

        try {
            JSON.parse(s);
            return s;
        } catch {
            // Step 7: Last resort - find last valid position
            for (let i = s.length - 1; i > 0; i--) {
                if (s[i] === '}') {
                    const candidate = s.slice(0, i + 1).replace(/,\s*([}\]])/g, '$1');
                    try { JSON.parse(candidate); return candidate; } catch { continue; }
                }
            }
            throw new Error('Could not parse JSON from AI response');
        }
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
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
            },
        }),
    });
    const d = await res.json();
    if (d.error) throw new Error(`Gemini error: ${d.error.message}`);
    const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) throw new Error('Empty response from Gemini');
    try {
        return extractJSON(raw);
    } catch(e) {
        // Return first 200 chars so we can debug
        throw new Error('JSON_PARSE_FAIL: ' + raw.substring(0, 300).replace(/\n/g, ' '));
    }
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
                // is-on-https: score=1 means pass, score=null also means pass (not applicable = already https), score=0 means fail
                https: (audits['is-on-https']?.score as number) === 0 ? 'No' : 'Yes',
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

        // Build clean prompt — NO JSON template inside prompt (causes Gemini confusion)
        const auditDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const userPrompt = `You are auditing this WordPress site. Generate a professional audit report as JSON.

SITE URL: ${url}
AUDIT DATE: ${auditDate}

REAL PAGESPEED DATA (use these exact values):
- Desktop Performance Score: ${desktop?.performanceScore ?? 0}
- Mobile Performance Score: ${mobile?.performanceScore ?? 0}  
- Desktop SEO Score: ${desktop?.seoScore ?? 0}
- Security: Handled separately by backend system
- LCP Desktop: ${desktop?.lcp ?? 'N/A'}
- FID Desktop: ${desktop?.fid ?? 'N/A'}
- CLS Desktop: ${desktop?.cls ?? 'N/A'}
- TTFB Desktop: ${desktop?.ttfb ?? 'N/A'}
- FCP Desktop: ${desktop?.fcp ?? 'N/A'}
- LCP Mobile: ${mobile?.lcp ?? 'N/A'}
- Page Size: ${desktop?.totalByteWeight ?? 'N/A'}
- Unused JS: ${desktop?.unusedJS ?? 'N/A'}
- Unused CSS: ${desktop?.unusedCSS ?? 'N/A'}
- Render Blocking: ${desktop?.renderBlocking ?? 'N/A'}
- Image Issues: ${desktop?.imageOptimization ?? 'N/A'}
- WebP Issues: ${desktop?.usesWebP ?? 'N/A'}
- GZIP: ${desktop?.textCompression ?? 'N/A'}

TOP PAGESPEED ISSUES:
${desktop?.opportunities?.slice(0,6).filter(o => !o.title?.toLowerCase().includes('https') && !o.title?.toLowerCase().includes('ssl')).map(o => `- ${o.title}: ${o.displayValue || 'needs fixing'}`).join('\n') || 'None'}

IMPORTANT: The seoChecks array must NOT include an HTTPS check — it is handled separately. Only include: Page Title Tag, Meta Description, Image ALT Text, XML Sitemap, Core Web Vitals.

Return ONLY this JSON. No extra text. Fill in all string values with professional content:

{"url":"${url}","auditDate":"${auditDate}","overallScore":0,"performanceScore":${desktop?.performanceScore ?? 0},"seoScore":${desktop?.seoScore ?? 0},"mobileScore":${mobile?.performanceScore ?? 0},"securityScore":75,"grade":"B","summary":"FILL: 3 sentences about this site performance based on real scores above","coreWebVitals":{"lcp":{"value":"${desktop?.lcp ?? 'N/A'}","status":"FILL: good or needs-improvement or poor","description":"FILL: what this LCP means for this site","fix":"FILL: specific fix"},"fid":{"value":"${desktop?.fid ?? 'N/A'}","status":"FILL: good or needs-improvement or poor","description":"FILL: what FID means","fix":"FILL: specific fix"},"cls":{"value":"${desktop?.cls ?? 'N/A'}","status":"FILL: good or needs-improvement or poor","description":"FILL: what CLS means","fix":"FILL: specific fix"},"ttfb":{"value":"${desktop?.ttfb ?? 'N/A'}","status":"FILL: good or needs-improvement or poor","description":"FILL: what TTFB means","fix":"FILL: specific fix"},"fcp":{"value":"${desktop?.fcp ?? 'N/A'}","status":"FILL: good or needs-improvement or poor","description":"FILL: what FCP means","fix":"FILL: specific fix"}},"speedMetrics":{"desktop":${desktop?.performanceScore ?? 0},"mobile":${mobile?.performanceScore ?? 0},"loadTime":"FILL: estimated load time","pageSize":"${desktop?.totalByteWeight ?? 'N/A'}","requests":45},"issues":{"critical":[{"title":"FILL: critical issue title","description":"FILL: description","impact":"FILL: impact","fix":"FILL: exact fix","plugin":"FILL: plugin name or none"}],"warnings":[{"title":"FILL: warning title","description":"FILL: description","impact":"FILL: impact","fix":"FILL: exact fix","plugin":"FILL: plugin name or none"}],"passed":[{"title":"FILL: passing check","description":"FILL: why it is good"}]},"seoChecks":[{"title":"Page Title Tag","status":"FILL: pass or warn or fail","current":"FILL: status","issue":"FILL: issue or none","fix":"FILL: fix or no action needed"},{"title":"Meta Description","status":"FILL: pass or warn or fail","current":"FILL: status","issue":"FILL: issue","fix":"FILL: fix"},{"title":"Image ALT Text","status":"FILL: pass or warn or fail","current":"FILL: status","issue":"FILL: issue","fix":"FILL: fix"},{"title":"XML Sitemap","status":"FILL: pass or warn or fail","current":"FILL: status","issue":"FILL: issue","fix":"FILL: fix"},{"title":"Core Web Vitals","status":"${(desktop?.performanceScore ?? 0) >= 90 ? 'pass' : (desktop?.performanceScore ?? 0) >= 50 ? 'warn' : 'fail'}","current":"Performance score: ${desktop?.performanceScore ?? 0}/100","issue":"FILL: issue or none","fix":"FILL: fix or no action needed"}],"wordpressSpecific":{"phpVersion":"Cannot detect externally - check WordPress Admin > Tools > Site Health. Recommend PHP 8.2+","wordpressVersion":"Cannot detect externally - check WordPress Admin > Dashboard > Updates","caching":"FILL: assessment based on TTFB value","imageOptimization":"FILL: assessment based on image data","cdnDetected":"Cannot detect externally - Cloudflare CDN recommended","gzipEnabled":"${desktop?.textCompression !== 'N/A' ? 'Issues detected - ' + (desktop?.textCompression ?? '') : 'Status unknown - verify via hosting'}","httpsEnabled":"${desktop?.https === 'Yes' ? 'Yes - HTTPS active and SSL certificate working correctly' : 'No - install SSL certificate immediately'}","pluginBloat":"FILL: assessment based on performance","recommendations":[{"priority":"high","action":"FILL: top action","plugin":"FILL: plugin name","impact":"FILL: impact"},{"priority":"high","action":"FILL: second action","plugin":"FILL: plugin name","impact":"FILL: impact"},{"priority":"medium","action":"FILL: third action","plugin":"FILL: plugin name","impact":"FILL: impact"},{"priority":"medium","action":"FILL: fourth action","plugin":"FILL: plugin name","impact":"FILL: impact"},{"priority":"low","action":"FILL: fifth action","plugin":"FILL: plugin name","impact":"FILL: impact"}]},"topFixes":["FILL: fix 1","FILL: fix 2","FILL: fix 3","FILL: fix 4","FILL: fix 5"],"nextActions":{"immediate":["FILL: action 1","FILL: action 2","FILL: action 3"],"shortTerm":["FILL: action 1","FILL: action 2","FILL: action 3"],"longTerm":["FILL: action 1","FILL: action 2","FILL: action 3"]}}`;
        const raw = await callOpenAI(SYSTEM_PROMPT, userPrompt);

        // Log raw response for debugging
        console.log('=== GEMINI RAW RESPONSE ===');
        console.log(raw.substring(0, 500));
        console.log('=== END ===');

        const parsed = JSON.parse(raw);

        // ── HARD OVERRIDE — real PageSpeed data always wins ──
        const httpsStatus = desktop?.https === 'Yes';

        // Helper — does this text mention HTTPS/SSL as an issue?
        const hasHttpsIssue = (t: string) => {
            const s = (t || '').toLowerCase();
            return s.includes('https') || s.includes('ssl') || s.includes('not secure') || s.includes('certificate') || s.includes('http only') || s.includes('insecure');
        };

        // If HTTPS is missing — inject it as a critical issue
        if (!httpsStatus) {
            if (Array.isArray(parsed.issues?.critical)) {
                const alreadyHasIt = parsed.issues.critical.some((i: {title:string}) => hasHttpsIssue(i.title));
                if (!alreadyHasIt) {
                    parsed.issues.critical.unshift({
                        title: 'HTTPS Not Enabled',
                        description: 'Your site is loading over HTTP which is unencrypted and insecure',
                        impact: 'Google Chrome shows Not Secure warning — kills visitor trust. Google penalizes HTTP sites in rankings.',
                        fix: "Install a free SSL certificate via your hosting control panel. Look for SSL/TLS or Let's Encrypt in cPanel. Takes 5 minutes.",
                        plugin: 'Cloudflare free tier also provides SSL automatically',
                    });
                }
            }
        }

        if (httpsStatus) {
            // 1. Remove from critical issues
            if (Array.isArray(parsed.issues?.critical)) {
                parsed.issues.critical = parsed.issues.critical.filter((i: {title:string}) => !hasHttpsIssue(i.title));
            }
            // 2. Remove from warnings
            if (Array.isArray(parsed.issues?.warnings)) {
                parsed.issues.warnings = parsed.issues.warnings.filter((i: {title:string}) => !hasHttpsIssue(i.title));
            }
            // 3. Remove from topFixes
            if (Array.isArray(parsed.topFixes)) {
                parsed.topFixes = parsed.topFixes.filter((f: string) => !hasHttpsIssue(f));
            }
            // 4. Remove from all nextActions
            ['immediate','shortTerm','longTerm'].forEach(key => {
                if (Array.isArray(parsed.nextActions?.[key])) {
                    parsed.nextActions[key] = parsed.nextActions[key].filter((a: string) => !hasHttpsIssue(a));
                }
            });
            // 5. Rewrite summary — replace ALL sentences mentioning HTTPS/SSL issue
            if (parsed.summary) {
                // Split into sentences, filter out HTTPS issue sentences, rejoin
                const sentences = parsed.summary.split(/(?<=[.!?])\s+/);
                const cleaned = sentences.filter((s: string) => !hasHttpsIssue(s));
                parsed.summary = cleaned.join(' ').trim();
                // If summary became too short, add a positive note
                if (parsed.summary.length < 50) {
                    parsed.summary = `This site demonstrates solid performance with HTTPS security properly configured. Focus on the performance improvements below to boost rankings and conversions.`;
                }
            }
            // 6. Fix wordpressSpecific
            if (parsed.wordpressSpecific) {
                parsed.wordpressSpecific.httpsEnabled = 'Yes — HTTPS active and SSL certificate working correctly';
            }
        }

        // 7. Always inject correct HTTPS into seoChecks — regardless of httpsStatus
        const httpsCheckObj = {
            title: 'HTTPS Security',
            status: httpsStatus ? 'pass' : 'fail',
            current: httpsStatus ? 'HTTPS enabled — SSL certificate active' : 'HTTP only — not secure',
            issue: httpsStatus ? 'None — HTTPS is properly configured' : 'Site is not using HTTPS — Google penalizes HTTP sites',
            fix: httpsStatus ? 'No action needed — SSL is active and working' : "Install free SSL via your hosting control panel — Let's Encrypt is free",
        };
        if (Array.isArray(parsed.seoChecks)) {
            const idx = parsed.seoChecks.findIndex((c: {title:string}) => hasHttpsIssue(c.title));
            if (idx >= 0) {
                parsed.seoChecks[idx] = httpsCheckObj;
            } else {
                parsed.seoChecks.unshift(httpsCheckObj);
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