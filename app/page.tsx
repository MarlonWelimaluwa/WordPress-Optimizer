'use client';
import { useState } from 'react';

type SiteData = {
  url: string; isWordPress: boolean; wpVersion: string;
  title: string; metaDesc: string; h1: string;
  hasYoast: boolean; hasWPRocket: boolean; hasSchema: boolean; hasSitemap: boolean;
  imgsTotal: number; imgsNoAlt: number; hasLazyLoad: boolean;
  https: boolean; hasMinified: boolean; hasCDN: boolean; generator: string;
};

type SpeedData = {
  performance: number; seo: number;
  lcp: string; cls: string; fcp: string; ttfb: string; tbt: string; si: string;
  pageSize: string; unusedJS: string; unusedCSS: string;
  renderBlocking: string; opportunities: string[];
};

type AuditData = {
  url: string; auditDate: string;
  overallScore: number; performanceScore: number; seoScore: number;
  mobileScore: number; securityScore: number; grade: string;
  summary: string; conversionImpact: string;
  coreWebVitals: { lcp: VitalItem; fid: VitalItem; cls: VitalItem; ttfb: VitalItem; fcp: VitalItem };
  speedMetrics: { desktop: number; mobile: number; loadTime: string; pageSize: string };
  issues: {
    critical: IssueItem[];
    warnings: IssueItem[];
    passed: { title: string; description: string }[];
  };
  seoChecks: SEOCheck[];
  wordpressSpecific: {
    phpVersion: string; wordpressVersion: string; pluginBloat: string;
    caching: string; imageOptimization: string; cdnDetected: string;
    gzipEnabled: string; httpsEnabled: string;
    recommendations: { priority: string; action: string; plugin: string; impact: string }[];
  };
  topFixes: string[];
  nextActions: { immediate: string[]; shortTerm: string[]; longTerm: string[] };
};
type VitalItem   = { value: string; status: string; description: string; fix: string };
type IssueItem   = { title: string; description: string; impact: string; fix: string; plugin?: string };
type SEOCheck    = { title: string; status: string; current: string; issue: string; fix: string };

export default function Home() {
  const [url, setUrl]               = useState('');
  const [loading, setLoading]       = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError]           = useState('');
  const [result, setResult]         = useState<AuditData | null>(null);

  const steps = [
    'Fetching desktop PageSpeed score...',
    'Fetching mobile PageSpeed score...',
    'Scraping site data...',
    'Running AI WordPress audit...',
    'Building your report...',
  ];

  async function fetchPS(target: string, strategy: 'desktop' | 'mobile') {
    const key = process.env.NEXT_PUBLIC_PAGESPEED_API_KEY || '';
    const r = await fetch(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(target)}&strategy=${strategy}&category=performance&category=seo&category=best-practices${key ? `&key=${key}` : ''}`
    );
    if (!r.ok) throw new Error(`PageSpeed ${strategy} failed (${r.status})`);
    return r.json();
  }

  function parsePS(d: Record<string, unknown>): SpeedData {
    const lr  = (d.lighthouseResult || {}) as Record<string, unknown>;
    const cats = (lr.categories || {}) as Record<string, { score: number }>;
    const aud  = (lr.audits || {}) as Record<string, { displayValue?: string; score?: number }>;
    const opps = Object.entries(aud)
        .filter(([, v]) => v.score !== null && (v.score ?? 1) < 0.9 && v.displayValue)
        .map(([, v]) => v.displayValue as string)
        .filter(Boolean).slice(0, 6);
    return {
      performance: Math.round((cats.performance?.score ?? 0) * 100),
      seo:         Math.round((cats.seo?.score ?? 0) * 100),
      lcp:  aud['largest-contentful-paint']?.displayValue ?? 'N/A',
      cls:  aud['cumulative-layout-shift']?.displayValue   ?? 'N/A',
      fcp:  aud['first-contentful-paint']?.displayValue    ?? 'N/A',
      ttfb: aud['server-response-time']?.displayValue      ?? 'N/A',
      tbt:  aud['total-blocking-time']?.displayValue       ?? 'N/A',
      si:   aud['speed-index']?.displayValue               ?? 'N/A',
      pageSize:       aud['total-byte-weight']?.displayValue     ?? 'N/A',
      unusedJS:       aud['unused-javascript']?.displayValue     ?? 'N/A',
      unusedCSS:      aud['unused-css-rules']?.displayValue      ?? 'N/A',
      renderBlocking: aud['render-blocking-resources']?.displayValue ?? 'None',
      opportunities: opps,
    };
  }

  async function runAudit() {
    if (!url.trim()) { setError('Please enter a WordPress site URL.'); return; }
    let clean = url.trim();
    if (!clean.startsWith('http')) clean = 'https://' + clean;
    setLoading(true); setError(''); setResult(null); setLoadingStep(0);

    try {
      // Step 1-2: PageSpeed in browser — no Vercel timeout
      setLoadingStep(0);
      const [desktopRaw, mobileRaw] = await Promise.all([
        fetchPS(clean, 'desktop'),
        fetchPS(clean, 'mobile'),
      ]);
      const desktop = parsePS(desktopRaw);
      const mobile  = parsePS(mobileRaw);
      setLoadingStep(2);

      // Step 3: Scrape via /api/audit (fast — HTML only, <10s)
      let site: SiteData | null = null;
      try {
        const sr = await fetch('/api/audit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: clean }),
        });
        const sj = await sr.json();
        if (sj.ok) site = sj.data;
      } catch { /* optional */ }
      setLoadingStep(3);

      // Step 4: Gemini in browser — no Vercel timeout
      const GEMINI_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
      if (!GEMINI_KEY) throw new Error('Add NEXT_PUBLIC_GEMINI_API_KEY to Vercel env vars.');

      const auditDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const httpsOk = site?.https ?? clean.startsWith('https://');

      const SYSTEM = `You are "WordPress Audit Pro AI" — a world-class WordPress performance and SEO specialist. You analyse real PageSpeed data and generate precise, actionable audit reports. Be brutally specific — exact plugin names, exact settings, measurable impact. OUTPUT: ONLY valid JSON. No markdown. No explanation outside JSON.

STRICT RULES — never break these:
1. wordpressVersion: ALWAYS output exactly "Cannot detect externally — check WP Admin > Dashboard > Updates". NEVER invent, guess, or hallucinate a version number. Even if you think you know it.
2. TTFB severity: TTFB < 600ms = good. TTFB 600ms–1800ms = needs-improvement (WARNING only, NEVER critical). TTFB > 1800ms = poor (critical). Never put TTFB in critical issues unless it exceeds 1800ms.`;

      const USER = `Audit this WordPress site using the REAL data below.

URL: ${clean}
DATE: ${auditDate}

=== PAGESPEED DATA (real from Google) ===
Desktop Performance: ${desktop.performance}/100
Mobile Performance:  ${mobile.performance}/100
Desktop SEO Score:   ${desktop.seo}/100
LCP Desktop: ${desktop.lcp} | LCP Mobile: ${mobile.lcp}
CLS: ${desktop.cls} | FCP: ${desktop.fcp} | TTFB: ${desktop.ttfb} | TBT: ${desktop.tbt}
Page Size: ${desktop.pageSize}
Unused JS: ${desktop.unusedJS} | Unused CSS: ${desktop.unusedCSS}
Render Blocking: ${desktop.renderBlocking}
Top Issues: ${desktop.opportunities.join('; ') || 'None'}

=== SCRAPED SITE DATA ===
Is WordPress: ${site?.isWordPress ? 'YES' : 'Unknown'}
WordPress Version: ${site?.wpVersion || 'Not detectable'}
Page Title: ${site?.title || 'Not detected'}
Meta Description: ${site?.metaDesc || 'None'}
H1: ${site?.h1 || 'Not detected'}
SEO Plugin (Yoast/RankMath): ${site?.hasYoast ? 'YES - detected' : 'NOT detected'}
Caching Plugin (WP Rocket/etc): ${site?.hasWPRocket ? 'YES - detected' : 'NOT detected'}
Schema Markup: ${site?.hasSchema ? 'YES' : 'NO'}
XML Sitemap link: ${site?.hasSitemap ? 'YES' : 'NO'}
Images total: ${site?.imgsTotal ?? 'Unknown'} | Missing alt text: ${site?.imgsNoAlt ?? 'Unknown'}
Lazy loading: ${site?.hasLazyLoad ? 'YES' : 'NO'}
HTTPS: ${httpsOk ? 'YES - Secure' : 'NO - Critical'}
Minified assets: ${site?.hasMinified ? 'YES' : 'NO'}
CDN detected: ${site?.hasCDN ? 'YES' : 'NO'}

Return ONLY this JSON structure (fill all FILL values with specific professional content):
{"url":"${clean}","auditDate":"${auditDate}","overallScore":${Math.round((desktop.performance + mobile.performance + desktop.seo) / 3)},"performanceScore":${desktop.performance},"seoScore":${desktop.seo},"mobileScore":${mobile.performance},"securityScore":${httpsOk ? 82 : 20},"grade":"FILL","summary":"FILL: 2-3 specific sentences using real scores desktop:${desktop.performance} mobile:${mobile.performance} LCP:${desktop.lcp}","conversionImpact":"FILL: estimate revenue/lead impact using mobile score ${mobile.performance}","coreWebVitals":{"lcp":{"value":"${desktop.lcp}","status":"${parseFloat(desktop.lcp) < 2.5 ? 'good' : parseFloat(desktop.lcp) < 4 ? 'needs-improvement' : 'poor'}","description":"FILL: what this LCP means","fix":"FILL: exact fix"},"fid":{"value":"${desktop.tbt}","status":"${parseInt(desktop.tbt) < 200 ? 'good' : parseInt(desktop.tbt) < 600 ? 'needs-improvement' : 'poor'}","description":"FILL","fix":"FILL"},"cls":{"value":"${desktop.cls}","status":"${parseFloat(desktop.cls) < 0.1 ? 'good' : parseFloat(desktop.cls) < 0.25 ? 'needs-improvement' : 'poor'}","description":"FILL","fix":"FILL"},"ttfb":{"value":"${desktop.ttfb}","status":"FILL: good or needs-improvement or poor","description":"FILL","fix":"FILL"},"fcp":{"value":"${desktop.fcp}","status":"${parseFloat(desktop.fcp) < 1.8 ? 'good' : parseFloat(desktop.fcp) < 3 ? 'needs-improvement' : 'poor'}","description":"FILL","fix":"FILL"}},"speedMetrics":{"desktop":${desktop.performance},"mobile":${mobile.performance},"loadTime":"${desktop.lcp}","pageSize":"${desktop.pageSize}"},"issues":{"critical":[{"title":"FILL","description":"FILL","impact":"FILL","fix":"FILL: exact WordPress fix","plugin":"FILL or none"}],"warnings":[{"title":"FILL","description":"FILL","impact":"FILL","fix":"FILL","plugin":"FILL or none"},{"title":"FILL","description":"FILL","impact":"FILL","fix":"FILL","plugin":"FILL or none"}],"passed":[{"title":"FILL: something genuinely good","description":"FILL: why it helps"}]},"seoChecks":[{"title":"HTTPS Security","status":"${httpsOk ? 'pass' : 'fail'}","current":"${httpsOk ? 'HTTPS enabled — SSL active' : 'HTTP only — not secure'}","issue":"${httpsOk ? 'None' : 'No SSL — Google penalises HTTP sites'}","fix":"${httpsOk ? 'No action needed' : "Install free SSL via Let's Encrypt in your hosting cPanel"}"},{"title":"Page Title Tag","status":"${site?.title ? 'pass' : 'fail'}","current":"${site?.title || 'Not detected'}","issue":"FILL","fix":"FILL"},{"title":"Meta Description","status":"${site?.metaDesc ? (site.metaDesc.length > 160 ? 'warn' : 'pass') : 'fail'}","current":"${site?.metaDesc ? site.metaDesc.length + ' chars' : 'Missing'}","issue":"FILL","fix":"FILL"},{"title":"SEO Plugin","status":"${site?.hasYoast ? 'pass' : 'fail'}","current":"${site?.hasYoast ? 'Detected' : 'Not detected'}","issue":"FILL","fix":"FILL: install Rank Math (free, recommended 2026)"},{"title":"XML Sitemap","status":"${site?.hasSitemap ? 'pass' : 'warn'}","current":"${site?.hasSitemap ? 'Detected' : 'Not found'}","issue":"FILL","fix":"FILL"},{"title":"Core Web Vitals","status":"${desktop.performance >= 90 ? 'pass' : desktop.performance >= 50 ? 'warn' : 'fail'}","current":"Desktop: ${desktop.performance}/100 | Mobile: ${mobile.performance}/100","issue":"FILL","fix":"FILL"},{"title":"Image Alt Text","status":"${(site?.imgsNoAlt ?? 0) === 0 ? 'pass' : 'warn'}","current":"${site?.imgsNoAlt ?? 'Unknown'} images missing alt text of ${site?.imgsTotal ?? '?'} total","issue":"FILL","fix":"FILL"},{"title":"Schema Markup","status":"${site?.hasSchema ? 'pass' : 'warn'}","current":"${site?.hasSchema ? 'Schema detected' : 'No schema found'}","issue":"FILL","fix":"FILL: add LocalBusiness schema via Rank Math"}],"wordpressSpecific":{"phpVersion":"Cannot detect externally — check WP Admin > Tools > Site Health. Recommend PHP 8.2+","wordpressVersion":"${site?.wpVersion || 'Cannot detect — check WP Admin > Dashboard > Updates'}","pluginBloat":"FILL: assessment based on performance score ${desktop.performance}","caching":"${site?.hasWPRocket ? 'Caching plugin detected — good' : 'No caching plugin detected — critical issue'}","imageOptimization":"FILL: based on page size ${desktop.pageSize} and ${site?.imgsNoAlt ?? 0} missing alts","cdnDetected":"${site?.hasCDN ? 'CDN detected' : 'No CDN detected — recommend Cloudflare free tier'}","gzipEnabled":"FILL: based on page size and render blocking data","httpsEnabled":"${httpsOk ? 'Yes — HTTPS active and SSL working' : 'No — install SSL immediately'}","recommendations":[{"priority":"high","action":"FILL: most important action","plugin":"FILL: specific plugin","impact":"FILL: measurable impact"},{"priority":"high","action":"FILL: second most important","plugin":"FILL","impact":"FILL"},{"priority":"medium","action":"FILL","plugin":"FILL","impact":"FILL"},{"priority":"medium","action":"FILL","plugin":"FILL","impact":"FILL"},{"priority":"low","action":"FILL","plugin":"FILL","impact":"FILL"}]},"topFixes":["FILL: fix 1 specific to this site","FILL: fix 2","FILL: fix 3","FILL: fix 4","FILL: fix 5"],"nextActions":{"immediate":["FILL: urgent action 1","FILL: urgent action 2","FILL: urgent action 3"],"shortTerm":["FILL: this week 1","FILL: this week 2","FILL: this week 3"],"longTerm":["FILL: this month 1","FILL: this month 2","FILL: this month 3"]}}`;

      let parsed: AuditData | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const gr = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: SYSTEM }] },
                  contents: [{ role: 'user', parts: [{ text: USER }] }],
                  generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
                }),
              }
          );
          const gd = await gr.json();
          if (gd.error) {
            const m = gd.error.message || '';
            if ((m.includes('overloaded') || m.includes('high demand')) && attempt < 3) {
              await new Promise(r => setTimeout(r, 3000 * attempt)); continue;
            }
            throw new Error('Gemini: ' + m);
          }
          const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!raw) throw new Error('Empty Gemini response');
          let j = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
          j = j.slice(j.indexOf('{'), j.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1');
          parsed = JSON.parse(j) as AuditData;
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      if (!parsed) throw new Error('AI audit failed after retries');

      // Hard overrides — real data always wins
      parsed.performanceScore = desktop.performance;
      parsed.seoScore         = desktop.seo;
      parsed.mobileScore      = mobile.performance;
      parsed.speedMetrics     = { desktop: desktop.performance, mobile: mobile.performance, loadTime: desktop.lcp, pageSize: desktop.pageSize };
      parsed.overallScore     = Math.round((desktop.performance + mobile.performance + desktop.seo) / 3);
      parsed.grade            = parsed.overallScore >= 90 ? 'A' : parsed.overallScore >= 75 ? 'B' : parsed.overallScore >= 60 ? 'C' : parsed.overallScore >= 45 ? 'D' : 'F';
      parsed.securityScore    = httpsOk ? 82 : 20;
      parsed.url              = clean;
      parsed.auditDate        = auditDate;
      // Fix 1: Always lock WP version — never show hallucinated version
      if (parsed.wordpressSpecific) {
        parsed.wordpressSpecific.wordpressVersion = 'Cannot detect externally — check WP Admin > Dashboard > Updates';
      }
      // Fix 2: TTFB 600ms-1800ms must be warning only — remove from critical if misclassified
      const ttfbMs = parseFloat((desktop.ttfb || '0').replace(/[^0-9.]/g, '')) * (desktop.ttfb?.includes('s') && !desktop.ttfb?.includes('ms') ? 1000 : 1);
      if (ttfbMs < 1800 && Array.isArray(parsed.issues?.critical)) {
        parsed.issues.critical = parsed.issues.critical.filter((i: IssueItem) => !i.title?.toLowerCase().includes('ttfb') && !i.title?.toLowerCase().includes('server response') && !i.title?.toLowerCase().includes('time to first byte'));
      }

      setLoadingStep(4);
      setResult(parsed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Audit failed. Check the URL and try again.');
    }
    setLoading(false);
  }

  const sc = (s: number) => s >= 80 ? '#16a34a' : s >= 60 ? '#d97706' : '#dc2626';
  const stc = (s: string) => (s === 'pass' || s === 'good') ? '#16a34a' : (s === 'warn' || s === 'needs-improvement') ? '#d97706' : '#dc2626';
  const stl = (s: string) => (s === 'pass' || s === 'good') ? 'PASS' : (s === 'warn' || s === 'needs-improvement') ? 'WARN' : 'FAIL';

  async function downloadReport() {
    if (!result) return;
    const r = result;
    const jsPDFModule = await import('jspdf');
    const jsPDF = jsPDFModule.default;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 14, CW = 182;
    let y = 0;
    let pageNum = 1;

    function cl(t: string): string {
      return (t || '').replace(/[^\x00-\x7F]/g, (c: string) => {
        const m: Record<string,string> = {'\u2019':"'",'\u2018':"'",'\u201c':'"','\u201d':'"','\u2013':'-','\u2014':'-','\u2026':'...'};
        return m[c] ?? '';
      }).replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1');
    }
    function wt(t: string, w: number, fs: number): string[] { doc.setFontSize(fs); return doc.splitTextToSize(cl(t), w); }
    function scc(s: number): [number,number,number] { return s>=80?[22,163,74]:s>=60?[217,119,6]:[220,38,38]; }
    function stcc(s: string): [number,number,number] { return (s==='pass'||s==='good')?[22,163,74]:(s==='warn'||s==='needs-improvement')?[217,119,6]:[220,38,38]; }

    function addFooter() {
      doc.setFillColor(30,58,138); doc.rect(0,H-8,W,8,'F');
      doc.setTextColor(180,200,255); doc.setFontSize(7); doc.setFont('helvetica','normal');
      doc.text('WordPress Audit Pro', M, H-3);
      doc.text(`Page ${pageNum}`, W/2, H-3, {align:'center'});
      doc.text(cl(r.url), W-M, H-3, {align:'right'});
    }
    function np() { addFooter(); doc.addPage(); pageNum++; y = 20; }
    function cy(n: number) { if (y+n > H-12) np(); }

    // ── COVER — white, clean, professional ──
    doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
    // Top navy bar
    doc.setFillColor(30,58,138); doc.rect(0,0,W,56,'F');
    // Logo area
    doc.setFillColor(37,99,235); doc.roundedRect(M,14,20,20,3,3,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text('WP', M+10, 26, {align:'center'});
    doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
    doc.text('WordPress Audit Pro', M+26, 24);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(180,200,255);
    doc.text('Professional Speed & SEO Report', M+26, 33);
    doc.setFontSize(8); doc.setTextColor(160,185,240);
    doc.text(cl(r.url), M+8, 46);
    doc.text(r.auditDate, M+8, 52);

    // Score box top-right
    const [gr2,gg2,gb2] = scc(r.overallScore);
    doc.setFillColor(255,255,255); doc.roundedRect(W-48,8,34,42,3,3,'F');
    doc.setFillColor(gr2,gg2,gb2); doc.rect(W-48,8,3,42,'F');
    doc.setTextColor(gr2,gg2,gb2); doc.setFontSize(24); doc.setFont('helvetica','bold');
    doc.text(r.grade, W-31, 30, {align:'center'});
    doc.setFontSize(8); doc.setTextColor(107,114,128);
    doc.text(`${r.overallScore}/100`, W-31, 40, {align:'center'});
    doc.setFontSize(6.5); doc.setTextColor(156,163,175);
    doc.text('SCORE', W-31, 46, {align:'center'});

    // Score cards row
    y = 66;
    const scoreCards = [
      {l:'PERFORMANCE', v:r.performanceScore},
      {l:'SEO', v:r.seoScore},
      {l:'MOBILE', v:r.mobileScore},
      {l:'SECURITY', v:r.securityScore},
    ];
    const sw2 = CW/4;
    scoreCards.forEach((s2,i) => {
      const x = M + i*sw2;
      const [cr,cg,cb] = scc(s2.v);
      doc.setFillColor(248,250,252); doc.roundedRect(x,y,sw2-3,26,2,2,'F');
      doc.setFillColor(cr,cg,cb); doc.rect(x,y,sw2-3,2,'F');
      doc.setTextColor(cr,cg,cb); doc.setFontSize(18); doc.setFont('helvetica','bold');
      doc.text(String(s2.v), x+(sw2-3)/2, y+15, {align:'center'});
      doc.setTextColor(107,114,128); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
      doc.text(s2.l, x+(sw2-3)/2, y+22, {align:'center'});
    });
    y += 34;

    // Summary box
    const sumLines = wt(r.summary||'', CW-16, 8.5).slice(0,6);
    const sumH = Math.max(28, 12+sumLines.length*5.5);
    doc.setFillColor(239,246,255); doc.roundedRect(M,y,CW,sumH,3,3,'F');
    doc.setFillColor(37,99,235); doc.rect(M,y,3,sumH,'F');
    doc.setTextColor(30,58,138); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('EXECUTIVE SUMMARY', M+8, y+8);
    doc.setTextColor(55,65,81); doc.setFont('helvetica','normal'); doc.setFontSize(8);
    sumLines.forEach((l,i) => doc.text(l, M+8, y+15+i*5.5));
    y += sumH+10;

    // Conversion impact
    if (r.conversionImpact) {
      const ciL = wt(r.conversionImpact, CW-16, 8).slice(0,5);
      const ciH = Math.max(24, 10+ciL.length*5);
      doc.setFillColor(255,251,235); doc.roundedRect(M,y,CW,ciH,3,3,'F');
      doc.setFillColor(217,119,6); doc.rect(M,y,3,ciH,'F');
      doc.setTextColor(146,64,14); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text('REVENUE IMPACT', M+8, y+8);
      doc.setTextColor(55,65,81); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      ciL.forEach((l,i) => doc.text(l, M+8, y+14+i*5));
      y += ciH+10;
    }

    // Speed metrics strip
    doc.setFillColor(248,250,252); doc.roundedRect(M,y,CW,22,2,2,'F');
    doc.setFillColor(30,58,138); doc.rect(M,y,3,22,'F');
    doc.setTextColor(30,58,138); doc.setFontSize(7); doc.setFont('helvetica','bold');
    doc.text('SPEED METRICS', M+8, y+7);
    const mets2 = [
      `Desktop: ${r.speedMetrics?.desktop}/100`,
      `Mobile: ${r.speedMetrics?.mobile}/100`,
      `LCP: ${r.speedMetrics?.loadTime}`,
      `Page Size: ${r.speedMetrics?.pageSize}`,
    ];
    doc.setTextColor(75,85,99); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
    mets2.forEach((m,i) => doc.text(m, M+8+i*46, y+16));
    y += 30;

    // ── PAGE 2: CORE WEB VITALS ──
    np();
    doc.setFillColor(30,58,138); doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text("CORE WEB VITALS — Google's Ranking Signals", M, 9.5);
    y = 20;

    const vitals = [
      {key:'LCP — Largest Contentful Paint', d:r.coreWebVitals?.lcp},
      {key:'TBT — Total Blocking Time',       d:r.coreWebVitals?.fid},
      {key:'CLS — Cumulative Layout Shift',   d:r.coreWebVitals?.cls},
      {key:'TTFB — Time to First Byte',       d:r.coreWebVitals?.ttfb},
      {key:'FCP — First Contentful Paint',    d:r.coreWebVitals?.fcp},
    ];
    vitals.forEach(v => {
      if (!v.d) return;
      const col = stcc(v.d.status);
      const descL = wt(v.d.description||'', CW-16, 7.5);
      const fixL  = wt('Fix: '+(v.d.fix||''), CW-16, 7.5);
      const bh = Math.max(26, 8+descL.length*4.5+fixL.length*4.5+6);
      cy(bh+4);
      doc.setFillColor(248,250,252); doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(col[0],col[1],col[2]); doc.rect(M,y,3,bh,'F');
      // Badge
      doc.setFillColor(col[0],col[1],col[2]); doc.roundedRect(M+5,y+4,20,6,1,1,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(5.5); doc.setFont('helvetica','bold');
      const vl = v.d.status==='good'?'GOOD':v.d.status==='needs-improvement'?'NEEDS WORK':'POOR';
      doc.text(vl, M+15, y+8.5, {align:'center'});
      // Key + value
      doc.setTextColor(17,24,39); doc.setFontSize(8.5); doc.setFont('helvetica','bold');
      doc.text(cl(v.key), M+28, y+9);
      doc.setTextColor(col[0],col[1],col[2]); doc.setFontSize(9); doc.setFont('helvetica','bold');
      doc.text(cl(v.d.value||''), W-M-2, y+9, {align:'right'});
      let iy = y+14;
      doc.setTextColor(107,114,128); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
      descL.forEach((l,i) => doc.text(l, M+5, iy+i*4.5));
      iy += descL.length*4.5+2;
      doc.setTextColor(30,58,138);
      fixL.forEach((l,i) => doc.text(l, M+5, iy+i*4.5));
      y += bh+4;
    });

    // ── PAGE 3: ISSUES ──
    np();
    doc.setFillColor(30,58,138); doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text('ISSUES & RECOMMENDATIONS', M, 9.5);
    y = 20;

    // Critical
    if (r.issues?.critical?.length > 0) {
      doc.setFillColor(220,38,38); doc.roundedRect(M,y,CW,9,2,2,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
      doc.text(`CRITICAL ISSUES (${r.issues.critical.length})`, M+5, y+6.5); y += 13;
      r.issues.critical.forEach((issue,idx) => {
        const impL = wt('Impact: '+(issue.impact||''), CW-14, 7.5);
        const fixL2 = wt(issue.fix||'', CW-14, 8);
        const bh = Math.max(26, 8+impL.length*5+fixL2.length*5+(issue.plugin?5:0)+4);
        cy(bh+4);
        doc.setFillColor(255,241,242); doc.roundedRect(M,y,CW,bh,2,2,'F');
        doc.setFillColor(220,38,38); doc.rect(M,y,3,bh,'F');
        doc.setTextColor(17,24,39); doc.setFontSize(9); doc.setFont('helvetica','bold');
        doc.text(cl(`${idx+1}. ${issue.title}`), M+7, y+8);
        let iy = y+14;
        doc.setTextColor(185,28,28); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
        impL.forEach((l,i) => { doc.text(l, M+7, iy+i*5); }); iy += impL.length*5;
        doc.setTextColor(30,58,138);
        fixL2.forEach((l,i) => doc.text((i===0?'> ':' ')+l, M+7, iy+i*5)); iy += fixL2.length*5;
        if (issue.plugin) { doc.setTextColor(22,163,74); doc.text('Plugin: '+cl(issue.plugin), M+7, iy+3); }
        y += bh+4;
      });
      y += 4;
    }

    // Warnings
    if (r.issues?.warnings?.length > 0) {
      cy(13);
      doc.setFillColor(217,119,6); doc.roundedRect(M,y,CW,9,2,2,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
      doc.text(`WARNINGS (${r.issues.warnings.length})`, M+5, y+6.5); y += 13;
      r.issues.warnings.forEach((issue,idx) => {
        const impL = wt('Impact: '+(issue.impact||''), CW-14, 7.5);
        const fixL2 = wt(issue.fix||'', CW-14, 8);
        const bh = Math.max(26, 8+impL.length*5+fixL2.length*5+4);
        cy(bh+4);
        doc.setFillColor(255,251,235); doc.roundedRect(M,y,CW,bh,2,2,'F');
        doc.setFillColor(217,119,6); doc.rect(M,y,3,bh,'F');
        doc.setTextColor(17,24,39); doc.setFontSize(9); doc.setFont('helvetica','bold');
        doc.text(cl(`${idx+1}. ${issue.title}`), M+7, y+8);
        let iy = y+14;
        doc.setTextColor(146,64,14); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
        impL.forEach((l,i) => { doc.text(l, M+7, iy+i*5); }); iy += impL.length*5;
        doc.setTextColor(30,58,138);
        fixL2.forEach((l,i) => doc.text((i===0?'> ':' ')+l, M+7, iy+i*5));
        y += bh+4;
      });
    }

    // Passed
    if (r.issues?.passed?.length > 0) {
      cy(13);
      doc.setFillColor(22,163,74); doc.roundedRect(M,y,CW,9,2,2,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
      doc.text('PASSING CHECKS', M+5, y+6.5); y += 13;
      r.issues.passed.forEach(p => {
        const lines = wt(`${p.title}: ${p.description}`, CW-16, 8);
        const bh = Math.max(12, 5+lines.length*5);
        cy(bh+3);
        doc.setFillColor(240,253,244); doc.roundedRect(M,y,CW,bh,2,2,'F');
        doc.setFillColor(22,163,74); doc.rect(M,y,3,bh,'F');
        doc.setTextColor(22,163,74); doc.setFontSize(9); doc.setFont('helvetica','bold');
        doc.text('✓', M+7, y+bh/2+3);
        doc.setTextColor(17,24,39); doc.setFontSize(8); doc.setFont('helvetica','normal');
        lines.forEach((l,i) => doc.text(l, M+14, y+7+i*5));
        y += bh+3;
      });
    }

    // ── PAGE 4: SEO CHECKS ──
    np();
    doc.setFillColor(30,58,138); doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text('SEO CHECKS', M, 9.5);
    y = 20;

    r.seoChecks?.forEach(c => {
      const col = stcc(c.status);
      const lbl2 = stl(c.status);
      const curL = wt('Current: '+(c.current||''), CW-14, 7.5);
      const fixL3 = wt(c.fix||'', CW-14, 8);
      const bh = Math.max(24, 8+curL.length*4.5+fixL3.length*5+4);
      cy(bh+4);
      doc.setFillColor(248,250,252); doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(col[0],col[1],col[2]); doc.rect(M,y,3,bh,'F');
      doc.setFillColor(col[0],col[1],col[2]); doc.roundedRect(M+5,y+4,13,5.5,1,1,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(5.5); doc.setFont('helvetica','bold');
      doc.text(lbl2, M+11.5, y+8.3, {align:'center'});
      doc.setTextColor(17,24,39); doc.setFontSize(8.5); doc.setFont('helvetica','bold');
      doc.text(cl(c.title), M+22, y+9);
      let iy = y+14;
      doc.setTextColor(107,114,128); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
      curL.forEach((l,i) => { doc.text(l, M+5, iy+i*4.5); }); iy += curL.length*4.5+2;
      doc.setTextColor(col[0],col[1],col[2]);
      fixL3.forEach((l,i) => doc.text((i===0?'> ':' ')+l, M+5, iy+i*5));
      y += bh+4;
    });

    // ── PAGE 5: WP SPECIFIC + ACTION PLAN ──
    np();
    doc.setFillColor(30,58,138); doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text('WORDPRESS ANALYSIS & ACTION PLAN', M, 9.5);
    y = 20;

    // WP info grid
    const wpItems = [
      {l:'PHP Version',         v:r.wordpressSpecific?.phpVersion},
      {l:'WP Version',          v:r.wordpressSpecific?.wordpressVersion},
      {l:'Caching',             v:r.wordpressSpecific?.caching},
      {l:'Image Optimization',  v:r.wordpressSpecific?.imageOptimization},
      {l:'CDN',                 v:r.wordpressSpecific?.cdnDetected},
      {l:'HTTPS',               v:r.wordpressSpecific?.httpsEnabled},
    ];
    doc.setFillColor(30,58,138); doc.roundedRect(M,y,CW,8,1,1,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('WORDPRESS HEALTH', M+5, y+5.8); y += 12;
    wpItems.forEach((it,i) => {
      const x = M + (i%2)*(CW/2);
      if (i%2===0) {
        const rowH = 10;
        cy(rowH+2);
        doc.setFillColor(i%4<2?248:255, 250, 252); doc.roundedRect(M,y,CW,rowH,1,1,'F');
      }
      doc.setTextColor(107,114,128); doc.setFontSize(7); doc.setFont('helvetica','normal');
      doc.text(it.l+':', x+4, y+5.5);
      doc.setTextColor(17,24,39); doc.setFont('helvetica','bold');
      const vLines = wt(it.v||'N/A', CW/2-40, 7);
      doc.text(vLines[0]||'', x+40, y+5.5);
      if (i%2===1) y += 12;
    });
    if (wpItems.length%2===1) y += 12;
    y += 6;

    // Plugin recommendations
    if (r.wordpressSpecific?.recommendations?.length > 0) {
      cy(13);
      doc.setFillColor(30,58,138); doc.roundedRect(M,y,CW,8,1,1,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text('PLUGIN RECOMMENDATIONS', M+5, y+5.8); y += 12;
      r.wordpressSpecific.recommendations.forEach(rec => {
        const lines = wt(`${rec.action} — ${rec.impact}`, CW-30, 7.5);
        const bh = Math.max(12, 6+lines.length*5);
        cy(bh+3);
        const [pr,pg,pb] = rec.priority==='high'?[220,38,38]:rec.priority==='medium'?[217,119,6]:[22,163,74];
        doc.setFillColor(248,250,252); doc.roundedRect(M,y,CW,bh,1,1,'F');
        doc.setFillColor(pr,pg,pb); doc.roundedRect(M+4,y+3,14,6,1,1,'F');
        doc.setTextColor(255,255,255); doc.setFontSize(5.5); doc.setFont('helvetica','bold');
        doc.text(rec.priority.toUpperCase(), M+11, y+7.3, {align:'center'});
        doc.setTextColor(17,24,39); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
        lines.forEach((l,i) => doc.text(l, M+22, y+7+i*5));
        doc.setTextColor(22,163,74); doc.setFontSize(7);
        doc.text(cl(rec.plugin||''), W-M-2, y+7, {align:'right'});
        y += bh+3;
      });
      y += 6;
    }

    // Top fixes
    cy(13);
    doc.setFillColor(37,99,235); doc.roundedRect(M,y,CW,8,1,1,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('TOP PRIORITY FIXES', M+5, y+5.8); y += 12;
    r.topFixes?.forEach((fix,i) => {
      const lines = wt(fix, CW-20, 8);
      const bh = Math.max(14, 7+lines.length*5.5);
      cy(bh+3);
      doc.setFillColor(239,246,255); doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(37,99,235); doc.circle(M+7, y+bh/2, 4,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text(String(i+1), M+7, y+bh/2+2.5, {align:'center'});
      doc.setTextColor(17,24,39); doc.setFontSize(8); doc.setFont('helvetica','normal');
      lines.forEach((l,li) => doc.text(l, M+16, y+8+li*5.5));
      y += bh+3;
    });
    y += 6;

    // Action plan
    const groups = [
      {label:'DO TODAY',    items:r.nextActions?.immediate, c:[220,38,38]  as [number,number,number], bg:[255,241,242] as [number,number,number]},
      {label:'THIS WEEK',   items:r.nextActions?.shortTerm, c:[217,119,6]  as [number,number,number], bg:[255,251,235] as [number,number,number]},
      {label:'THIS MONTH',  items:r.nextActions?.longTerm,  c:[22,163,74]  as [number,number,number], bg:[240,253,244] as [number,number,number]},
    ];
    groups.forEach(g => {
      cy(16);
      doc.setFillColor(g.c[0],g.c[1],g.c[2]); doc.roundedRect(M,y,CW,8,1,1,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text(g.label, M+5, y+5.8); y += 11;
      g.items?.forEach(a => {
        const lines = wt(a, CW-16, 8);
        const bh = Math.max(12, 5+lines.length*5);
        cy(bh+3);
        doc.setFillColor(g.bg[0],g.bg[1],g.bg[2]); doc.roundedRect(M,y,CW,bh,1,1,'F');
        doc.setTextColor(g.c[0],g.c[1],g.c[2]); doc.setFontSize(9); doc.text('>', M+5, y+bh/2+3);
        doc.setTextColor(17,24,39); doc.setFontSize(8); doc.setFont('helvetica','normal');
        lines.forEach((l,li) => doc.text(l, M+12, y+7+li*5));
        y += bh+3;
      });
      y += 5;
    });

    // Footers on all pages
    const total = (doc as unknown as {internal:{getNumberOfPages:()=>number}}).internal.getNumberOfPages();
    for (let p=1; p<=total; p++) { doc.setPage(p); addFooter(); }
    doc.save(`wordpress-audit-${cl(r.url).replace(/https?:\/\//,'').replace(/[^a-z0-9]/gi,'-').toLowerCase()}.pdf`);
  }

  const stlFn = (s: string) => (s==='pass'||s==='good')?'PASS':(s==='warn'||s==='needs-improvement')?'WARN':'FAIL';

  return (
      <div style={{ minHeight:'100vh', background:'#f8fafc', fontFamily:"'Outfit','Segoe UI',sans-serif", color:'#0f172a' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap'); @keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} * {box-sizing:border-box}`}</style>

        {/* NAV */}
        <nav style={{ background:'white', borderBottom:'1px solid #e5e7eb', padding:'0 40px', display:'flex', alignItems:'center', justifyContent:'space-between', height:64, position:'sticky', top:0, zIndex:100 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, background:'linear-gradient(135deg,#2563eb,#1d4ed8)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white"/></svg>
            </div>
            <div>
              <div style={{ fontWeight:800, fontSize:16, letterSpacing:-0.5, lineHeight:1 }}>WordPress Audit Pro</div>
              <div style={{ fontSize:10, color:'#9ca3af', letterSpacing:0.5 }}>PROFESSIONAL SITE ANALYSIS</div>
            </div>
          </div>
          <span style={{ fontSize:12, color:'#6b7280', background:'#f3f4f6', padding:'4px 12px', borderRadius:100 }}>Free · Powered by Google PageSpeed + AI</span>
        </nav>

        {/* HERO */}
        {!result && !loading && (
            <div style={{ background:'linear-gradient(135deg,#1e3a8a,#2563eb)', padding:'80px 40px', textAlign:'center', minHeight:'calc(100vh - 64px - 57px)', display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <div style={{ display:'inline-block', padding:'5px 14px', borderRadius:100, background:'rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.9)', fontSize:10, fontWeight:700, letterSpacing:1.5, marginBottom:24 }}>POWERED BY GOOGLE PAGESPEED + GEMINI AI</div>
              <h1 style={{ fontSize:'clamp(30px,5vw,54px)', fontWeight:900, color:'white', margin:'0 0 16px', letterSpacing:-1.5, lineHeight:1.1 }}>Is Your WordPress Site<br /><span style={{ color:'#93c5fd' }}>Losing You Money?</span></h1>
              <p style={{ fontSize:17, color:'rgba(255,255,255,0.75)', maxWidth:500, margin:'0 auto 40px', lineHeight:1.7 }}>Get a complete professional audit — Core Web Vitals, SEO, Security, and exact WordPress fixes. Free.</p>
              <div style={{ maxWidth:580, margin:'0 auto' }}>
                <div style={{ display:'flex', gap:10, background:'white', borderRadius:14, padding:8, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
                  <input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runAudit()} placeholder="yourwordpresssite.com" style={{ flex:1, padding:'13px 16px', border:'none', outline:'none', fontSize:14, color:'#0f172a', background:'transparent', borderRadius:8 }} />
                  <button onClick={runAudit} style={{ padding:'13px 26px', borderRadius:9, background:'linear-gradient(135deg,#2563eb,#1d4ed8)', border:'none', color:'white', fontSize:14, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>Audit Now →</button>
                </div>
                {error && <div style={{ marginTop:10, padding:'10px 16px', borderRadius:8, background:'rgba(239,68,68,0.15)', color:'#fca5a5', fontSize:13 }}>{error}</div>}
              </div>
              <div style={{ display:'flex', gap:12, justifyContent:'center', marginTop:36, flexWrap:'wrap' }}>
                {['⚡ Core Web Vitals','🔍 SEO Analysis','🔒 Security Check','📱 Mobile Score','🔌 Plugin Audit','📄 PDF Report'].map(f=>(
                    <div key={f} style={{ padding:'6px 14px', borderRadius:100, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.85)', fontSize:12 }}>{f}</div>
                ))}
              </div>
            </div>
        )}

        {/* LOADING */}
        {loading && (
            <div style={{ maxWidth:500, margin:'80px auto', padding:'0 24px', animation:'fadeUp 0.4s ease' }}>
              <div style={{ background:'white', borderRadius:16, padding:44, border:'1px solid #e5e7eb', boxShadow:'0 4px 24px rgba(0,0,0,0.06)', textAlign:'center' }}>
                <div style={{ width:48, height:48, borderRadius:'50%', border:'3px solid #e5e7eb', borderTop:'3px solid #2563eb', margin:'0 auto 24px', animation:'spin 0.8s linear infinite' }} />
                <div style={{ fontWeight:800, fontSize:19, marginBottom:6 }}>Auditing Your WordPress Site</div>
                <div style={{ fontSize:13, color:'#2563eb', marginBottom:28 }}>{steps[loadingStep]}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:10, textAlign:'left' }}>
                  {steps.map((s,i)=>(
                      <div key={s} style={{ display:'flex', alignItems:'center', gap:12, fontSize:13 }}>
                        <div style={{ width:22, height:22, borderRadius:5, background:i<loadingStep?'#2563eb':i===loadingStep?'rgba(37,99,235,0.1)':'#f3f4f6', border:i===loadingStep?'1px solid #2563eb':'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:i<loadingStep?'white':'#2563eb', flexShrink:0 }}>
                          {i<loadingStep?'✓':i===loadingStep?'●':''}
                        </div>
                        <span style={{ color:i<=loadingStep?'#374151':'#9ca3af' }}>{s}</span>
                      </div>
                  ))}
                </div>
              </div>
            </div>
        )}

        {/* RESULTS */}
        {result && (
            <div style={{ maxWidth:960, margin:'0 auto', padding:'32px 24px 80px', animation:'fadeUp 0.4s ease' }}>

              {/* Header */}
              <div style={{ background:'white', borderRadius:16, padding:'24px 28px', marginBottom:16, border:'1px solid #e5e7eb', borderTop:'3px solid #2563eb', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:16 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'#2563eb', letterSpacing:1.5, marginBottom:6 }}>AUDIT COMPLETE</div>
                  <div style={{ fontWeight:800, fontSize:18 }}>{result.url}</div>
                  <div style={{ fontSize:12, color:'#9ca3af', marginTop:3 }}>{result.auditDate}</div>
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <div style={{ textAlign:'center', background:'#f8fafc', borderRadius:10, padding:'12px 20px', border:'1px solid #e5e7eb' }}>
                    <div style={{ fontWeight:900, fontSize:38, color:sc(result.overallScore), lineHeight:1 }}>{result.grade}</div>
                    <div style={{ fontSize:9, color:'#9ca3af', letterSpacing:1 }}>GRADE</div>
                  </div>
                  <div style={{ textAlign:'center', background:'#f8fafc', borderRadius:10, padding:'12px 20px', border:'1px solid #e5e7eb' }}>
                    <div style={{ fontWeight:900, fontSize:38, color:'#0f172a', lineHeight:1 }}>{result.overallScore}</div>
                    <div style={{ fontSize:9, color:'#9ca3af', letterSpacing:1 }}>SCORE</div>
                  </div>
                </div>
              </div>

              {/* Score grid */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
                {[{l:'Performance',v:result.performanceScore},{l:'SEO',v:result.seoScore},{l:'Mobile',v:result.mobileScore},{l:'Security',v:result.securityScore}].map(s2=>(
                    <div key={s2.l} style={{ background:'white', borderRadius:10, padding:'16px', border:'1px solid #e5e7eb', textAlign:'center' }}>
                      <div style={{ fontWeight:800, fontSize:28, color:sc(s2.v) }}>{s2.v}</div>
                      <div style={{ fontSize:10, color:'#9ca3af', marginBottom:8 }}>{s2.l.toUpperCase()}</div>
                      <div style={{ height:3, background:'#f3f4f6', borderRadius:2 }}><div style={{ height:'100%', width:`${s2.v}%`, background:sc(s2.v), borderRadius:2 }} /></div>
                    </div>
                ))}
              </div>

              {/* Summary */}
              <div style={{ background:'#eff6ff', borderRadius:12, padding:'16px 20px', marginBottom:16, borderLeft:'3px solid #2563eb' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#1d4ed8', letterSpacing:1.5, marginBottom:6 }}>EXECUTIVE SUMMARY</div>
                <div style={{ fontSize:14, color:'#374151', lineHeight:1.8 }}>{result.summary}</div>
              </div>

              {/* Core Web Vitals */}
              <div style={{ background:'white', borderRadius:14, padding:24, marginBottom:16, border:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:1.5, marginBottom:18 }}>CORE WEB VITALS</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 }}>
                  {[{k:'LCP',d:result.coreWebVitals?.lcp},{k:'TBT',d:result.coreWebVitals?.fid},{k:'CLS',d:result.coreWebVitals?.cls},{k:'TTFB',d:result.coreWebVitals?.ttfb},{k:'FCP',d:result.coreWebVitals?.fcp}].map(v=>(
                      v.d && <div key={v.k} style={{ padding:'14px', borderRadius:10, background:'#f8fafc', border:`1px solid ${stc(v.d.status)}30`, borderLeft:`3px solid ${stc(v.d.status)}` }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                          <span style={{ fontWeight:700, fontSize:13 }}>{v.k}</span>
                          <span style={{ fontWeight:800, fontSize:14, color:stc(v.d.status) }}>{v.d.value}</span>
                        </div>
                        <div style={{ fontSize:11, padding:'2px 6px', borderRadius:4, background:`${stc(v.d.status)}15`, color:stc(v.d.status), display:'inline-block', marginBottom:6 }}>{stlFn(v.d.status)}</div>
                        <div style={{ fontSize:12, color:'#6b7280', lineHeight:1.5 }}>{v.d.description}</div>
                      </div>
                  ))}
                </div>
              </div>

              {/* Issues */}
              {result.issues?.critical?.length > 0 && (
                  <div style={{ background:'white', borderRadius:14, padding:24, marginBottom:16, border:'1px solid #fecaca', borderTop:'2px solid #dc2626' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#dc2626', letterSpacing:1.5, marginBottom:18 }}>🚨 CRITICAL ISSUES</div>
                    {result.issues.critical.map((issue,i)=>(
                        <div key={i} style={{ padding:'14px 16px', borderRadius:8, background:'#fff1f2', marginBottom:10, borderLeft:'3px solid #dc2626' }}>
                          <div style={{ fontWeight:700, fontSize:14, marginBottom:4, color:'#7f1d1d' }}>{issue.title}</div>
                          <div style={{ fontSize:12, color:'#dc2626', fontWeight:600, marginBottom:6 }}>Impact: {issue.impact}</div>
                          <div style={{ fontSize:13, color:'#1d4ed8', lineHeight:1.6 }}>→ {issue.fix}</div>
                          {issue.plugin && <div style={{ fontSize:12, color:'#16a34a', marginTop:4 }}>🔌 {issue.plugin}</div>}
                        </div>
                    ))}
                  </div>
              )}
              {result.issues?.warnings?.length > 0 && (
                  <div style={{ background:'white', borderRadius:14, padding:24, marginBottom:16, border:'1px solid #e5e7eb' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#d97706', letterSpacing:1.5, marginBottom:18 }}>⚠ WARNINGS</div>
                    {result.issues.warnings.map((issue,i)=>(
                        <div key={i} style={{ padding:'14px 16px', borderRadius:8, background:'#fffbeb', marginBottom:10, borderLeft:'3px solid #d97706' }}>
                          <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>{issue.title}</div>
                          <div style={{ fontSize:12, color:'#d97706', fontWeight:600, marginBottom:6 }}>Impact: {issue.impact}</div>
                          <div style={{ fontSize:13, color:'#1d4ed8', lineHeight:1.6 }}>→ {issue.fix}</div>
                        </div>
                    ))}
                  </div>
              )}

              {/* SEO Checks */}
              <div style={{ background:'white', borderRadius:14, padding:24, marginBottom:16, border:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:1.5, marginBottom:18 }}>SEO CHECKS</div>
                {result.seoChecks?.map((c,i)=>(
                    <div key={i} style={{ padding:'12px 16px', borderRadius:8, background:'#f8fafc', marginBottom:8, borderLeft:`3px solid ${stc(c.status)}` }}>
                      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, flexWrap:'wrap' }}>
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4, background:`${stc(c.status)}15`, color:stc(c.status) }}>{stlFn(c.status)}</span>
                        <span style={{ fontWeight:600, fontSize:14 }}>{c.title}</span>
                      </div>
                      <div style={{ fontSize:12, color:'#9ca3af', marginBottom:4 }}>Current: {c.current}</div>
                      <div style={{ fontSize:13, color:'#1d4ed8', fontWeight:500 }}>→ {c.fix}</div>
                    </div>
                ))}
              </div>

              {/* Top Fixes */}
              <div style={{ background:'linear-gradient(135deg,#1e3a8a,#2563eb)', borderRadius:14, padding:24, marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.6)', letterSpacing:1.5, marginBottom:16 }}>⚡ TOP PRIORITY FIXES</div>
                {result.topFixes?.map((fix,i)=>(
                    <div key={i} style={{ display:'flex', gap:12, padding:'12px 16px', borderRadius:8, background:'rgba(255,255,255,0.08)', marginBottom:8 }}>
                      <span style={{ width:24, height:24, borderRadius:'50%', background:'rgba(255,255,255,0.2)', color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i+1}</span>
                      <span style={{ fontSize:14, color:'rgba(255,255,255,0.9)', lineHeight:1.6 }}>{fix}</span>
                    </div>
                ))}
              </div>

              {/* Action Plan */}
              <div style={{ background:'white', borderRadius:14, padding:24, marginBottom:24, border:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:1.5, marginBottom:18 }}>ACTION PLAN</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:14 }}>
                  {[{l:'DO TODAY',items:result.nextActions?.immediate,c:'#dc2626',bg:'#fff1f2'},{l:'THIS WEEK',items:result.nextActions?.shortTerm,c:'#d97706',bg:'#fffbeb'},{l:'THIS MONTH',items:result.nextActions?.longTerm,c:'#16a34a',bg:'#f0fdf4'}].map(g=>(
                      <div key={g.l} style={{ background:g.bg, borderRadius:10, padding:18 }}>
                        <div style={{ fontWeight:800, fontSize:11, color:g.c, letterSpacing:1.5, marginBottom:12 }}>{g.l}</div>
                        {g.items?.map((a,i)=>(<div key={i} style={{ fontSize:13, color:'#374151', marginBottom:8, display:'flex', gap:8, lineHeight:1.6 }}><span style={{ color:g.c, flexShrink:0 }}>→</span>{a}</div>))}
                      </div>
                  ))}
                </div>
              </div>

              {/* Buttons */}
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                <button onClick={downloadReport} style={{ padding:'15px 30px', borderRadius:10, background:'linear-gradient(135deg,#1e3a8a,#2563eb)', border:'none', color:'white', fontSize:14, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>↓ Download PDF Report</button>
                <button onClick={()=>{setResult(null);setUrl('');}} style={{ padding:'15px 30px', borderRadius:10, background:'white', border:'1px solid #e5e7eb', color:'#374151', fontSize:14, fontWeight:600, cursor:'pointer' }}>↺ Audit Another Site</button>
              </div>
            </div>
        )}

        {/* FOOTER */}
        {!result && !loading && (
            <div style={{ background:'#0f172a', padding:'48px 40px 32px' }}>
              <div style={{ maxWidth:900, margin:'0 auto', borderTop:'1px solid #1e293b', paddingTop:24, display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
                <div style={{ fontSize:12, color:'#475569' }}>© 2026 WordPress Audit Pro · Free Professional Site Analysis</div>
                <div style={{ fontSize:12, color:'#475569' }}>Powered by Google PageSpeed + Gemini AI</div>
              </div>
            </div>
        )}
      </div>
  );
}