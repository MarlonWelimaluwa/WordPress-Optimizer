'use client';
import { useState } from 'react';

type SiteData = {
  url: string; isWordPress: boolean;
  title: string; metaDesc: string; h1: string; generator: string;
  hasYoast: boolean; hasWPRocket: boolean; hasSchema: boolean; hasSitemap: boolean;
  imgsTotal: number; imgsNoAlt: number; hasLazyLoad: boolean;
  https: boolean; hasMinified: boolean; hasCDN: boolean;
  hasWooCommerce: boolean; pluginCount: number; pluginNames: string[];
  themeName: string; pageBuilder: string;
  xmlrpcExposed: boolean; defaultLoginExposed: boolean;
  userEnumExposed: boolean; exposedUsername: string;
};
type SpeedData = {
  performance: number; seo: number;
  lcp: string; cls: string; fcp: string; ttfb: string; tbt: string;
  pageSize: string; unusedJS: string; unusedCSS: string;
  renderBlocking: string; opportunities: string[];
};
type VitalItem  = { value: string; status: string; description: string; fix: string };
type IssueItem  = { title: string; description: string; impact: string; fix: string; plugin?: string };
type SEOCheck   = { title: string; status: string; current: string; issue: string; fix: string };
type SecCheck   = { title: string; status: string; current: string; risk: string; fix: string };
type AuditData  = {
  url: string; auditDate: string;
  overallScore: number; performanceScore: number; seoScore: number;
  mobileScore: number; securityScore: number; grade: string;
  summary: string; conversionImpact: string;
  coreWebVitals: { lcp: VitalItem; fid: VitalItem; cls: VitalItem; ttfb: VitalItem; fcp: VitalItem };
  speedMetrics: { desktop: number; mobile: number; loadTime: string; pageSize: string };
  issues: { critical: IssueItem[]; warnings: IssueItem[]; passed: { title: string; description: string }[] };
  seoChecks: SEOCheck[];
  securityChecks: SecCheck[];
  wordpressSpecific: {
    phpVersion: string; wordpressVersion: string; pluginBloat: string;
    caching: string; imageOptimization: string; cdnDetected: string;
    gzipEnabled: string; httpsEnabled: string; themeName: string; pageBuilder: string;
    hasWooCommerce: boolean; pluginCount: number; detectedPlugins: string[];
    recommendations: { priority: string; action: string; plugin: string; impact: string }[];
  };
  topFixes: string[];
  nextActions: { immediate: string[]; shortTerm: string[]; longTerm: string[] };
};

export default function Home() {
  const [url, setUrl]     = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep]   = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AuditData | null>(null);

  const steps = [
    'Fetching PageSpeed scores...',
    'Scanning WordPress security...',
    'Detecting plugins & theme...',
    'Running AI audit...',
    'Building report...',
  ];

  async function fetchPS(target: string, strategy: 'desktop'|'mobile') {
    const key = process.env.NEXT_PUBLIC_PAGESPEED_API_KEY || '';
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(target)}&strategy=${strategy}&category=performance&category=seo${key ? `&key=${key}` : ''}`);
    if (!r.ok) throw new Error(`PageSpeed ${strategy} failed`);
    return r.json();
  }

  function parsePS(d: Record<string,unknown>): SpeedData {
    const lr  = (d.lighthouseResult||{}) as Record<string,unknown>;
    const cats = (lr.categories||{}) as Record<string,{score:number}>;
    const aud  = (lr.audits||{}) as Record<string,{displayValue?:string;score?:number}>;
    const opps = Object.entries(aud).filter(([,v])=>v.score!==null&&(v.score??1)<0.9&&v.displayValue).map(([,v])=>v.displayValue as string).filter(Boolean).slice(0,6);
    return {
      performance: Math.round((cats.performance?.score??0)*100),
      seo:         Math.round((cats.seo?.score??0)*100),
      lcp:  aud['largest-contentful-paint']?.displayValue??'N/A',
      cls:  aud['cumulative-layout-shift']?.displayValue??'N/A',
      fcp:  aud['first-contentful-paint']?.displayValue??'N/A',
      ttfb: aud['server-response-time']?.displayValue??'N/A',
      tbt:  aud['total-blocking-time']?.displayValue??'N/A',
      pageSize:       aud['total-byte-weight']?.displayValue??'N/A',
      unusedJS:       aud['unused-javascript']?.displayValue??'N/A',
      unusedCSS:      aud['unused-css-rules']?.displayValue??'N/A',
      renderBlocking: aud['render-blocking-resources']?.displayValue??'None',
      opportunities: opps,
    };
  }

  async function runAudit() {
    if (!url.trim()) { setError('Please enter a WordPress site URL.'); return; }
    let clean = url.trim();
    if (!clean.startsWith('http')) clean = 'https://'+clean;
    setLoading(true); setError(''); setResult(null); setStep(0);

    try {
      setStep(0);
      const [desktopRaw, mobileRaw] = await Promise.all([fetchPS(clean,'desktop'), fetchPS(clean,'mobile')]);
      const desktop = parsePS(desktopRaw);
      const mobile  = parsePS(mobileRaw);
      setStep(1);

      let site: SiteData|null = null;
      try {
        const sr = await fetch('/api/audit',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:clean}) });
        const sj = await sr.json();
        if (sj.ok) site = sj.data;
      } catch { /* optional */ }
      setStep(2);

      const GEMINI_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY||'';
      if (!GEMINI_KEY) throw new Error('Add NEXT_PUBLIC_GEMINI_API_KEY to Vercel env vars.');

      const auditDate = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      const httpsOk   = site?.https ?? clean.startsWith('https://');

      // Security score: start 100, deduct per issue
      let secScore = 100;
      if (!httpsOk)                    secScore -= 40;
      if (site?.xmlrpcExposed)         secScore -= 20;
      if (site?.defaultLoginExposed)   secScore -= 20;
      if (site?.userEnumExposed)       secScore -= 15;
      if (secScore < 0) secScore = 0;

      const SYSTEM = `You are "WordPress Audit Pro AI" — a world-class WordPress performance, SEO and security specialist. You analyse real PageSpeed data and WordPress-specific signals to generate precise, actionable audit reports. Be brutally specific — exact plugin names, exact settings, measurable impact. OUTPUT: ONLY valid JSON. No markdown. No explanation outside JSON.

STRICT RULES:
1. wordpressVersion: ALWAYS output exactly "Cannot detect externally — check WP Admin > Dashboard > Updates". NEVER invent a version number.
2. TTFB severity: TTFB < 600ms = good. TTFB 600-1800ms = warning ONLY, never critical. TTFB > 1800ms = critical.
3. Security issues are pre-detected and injected — do not contradict them.`;

      const USER = `Audit this WordPress site using the REAL data below.

URL: ${clean}
DATE: ${auditDate}

=== PAGESPEED DATA ===
Desktop Performance: ${desktop.performance}/100 | Mobile: ${mobile.performance}/100
Desktop SEO: ${desktop.seo}/100
LCP: ${desktop.lcp} (desktop) | CLS: ${desktop.cls} | FCP: ${desktop.fcp} | TTFB: ${desktop.ttfb} | TBT: ${desktop.tbt}
Page Size: ${desktop.pageSize} | Unused JS: ${desktop.unusedJS} | Unused CSS: ${desktop.unusedCSS}
Render Blocking: ${desktop.renderBlocking}
Top Issues: ${desktop.opportunities.join('; ')||'None'}

=== WORDPRESS SIGNALS ===
Is WordPress: ${site?.isWordPress?'YES':'Unknown'}
Theme: ${site?.themeName||'Not detected'}
Page Builder: ${site?.pageBuilder||'Not detected'}
WooCommerce: ${site?.hasWooCommerce?'YES — eCommerce site':'NO'}
Plugins detected (${site?.pluginCount??0}): ${site?.pluginNames?.join(', ')||'None visible'}
SEO Plugin: ${site?.hasYoast?'YES':'NOT detected'}
Caching Plugin: ${site?.hasWPRocket?'YES':'NOT detected'}
Schema Markup: ${site?.hasSchema?'YES':'NO'}
XML Sitemap: ${site?.hasSitemap?'YES':'Not found'}
Images: ${site?.imgsTotal??'?'} total, ${site?.imgsNoAlt??'?'} missing alt text
Lazy Loading: ${site?.hasLazyLoad?'YES':'NO'}
CDN: ${site?.hasCDN?'YES':'NO'}
HTTPS: ${httpsOk?'YES':'NO'}

=== SECURITY SCAN RESULTS ===
HTTPS: ${httpsOk?'SECURE':'NOT SECURE — critical'}
xmlrpc.php exposed: ${site?.xmlrpcExposed?'YES — brute force & DDoS risk':'NO — good'}
Default login URL (/wp-admin): ${site?.defaultLoginExposed?'YES — exposed':'NO — protected'}
User enumeration (?author=1): ${site?.userEnumExposed?`YES — username "${site.exposedUsername}" exposed`:'NO — protected'}

Return ONLY this JSON (fill all FILL values with specific professional content):
{"url":"${clean}","auditDate":"${auditDate}","overallScore":${Math.round((desktop.performance+mobile.performance+desktop.seo)/3)},"performanceScore":${desktop.performance},"seoScore":${desktop.seo},"mobileScore":${mobile.performance},"securityScore":${secScore},"grade":"FILL","summary":"FILL: 2-3 sentences using real data","conversionImpact":"FILL: revenue/lead impact estimate","coreWebVitals":{"lcp":{"value":"${desktop.lcp}","status":"${parseFloat(desktop.lcp)<2.5?'good':parseFloat(desktop.lcp)<4?'needs-improvement':'poor'}","description":"FILL","fix":"FILL"},"fid":{"value":"${desktop.tbt}","status":"${parseInt(desktop.tbt)<200?'good':parseInt(desktop.tbt)<600?'needs-improvement':'poor'}","description":"FILL","fix":"FILL"},"cls":{"value":"${desktop.cls}","status":"${parseFloat(desktop.cls)<0.1?'good':parseFloat(desktop.cls)<0.25?'needs-improvement':'poor'}","description":"FILL","fix":"FILL"},"ttfb":{"value":"${desktop.ttfb}","status":"${parseFloat(desktop.ttfb)<0.6?'good':'needs-improvement'}","description":"FILL","fix":"FILL"},"fcp":{"value":"${desktop.fcp}","status":"${parseFloat(desktop.fcp)<1.8?'good':parseFloat(desktop.fcp)<3?'needs-improvement':'poor'}","description":"FILL","fix":"FILL"}},"speedMetrics":{"desktop":${desktop.performance},"mobile":${mobile.performance},"loadTime":"${desktop.lcp}","pageSize":"${desktop.pageSize}"},"issues":{"critical":[{"title":"FILL","description":"FILL","impact":"FILL","fix":"FILL","plugin":"FILL or none"}],"warnings":[{"title":"FILL","description":"FILL","impact":"FILL","fix":"FILL","plugin":"FILL or none"}],"passed":[{"title":"FILL","description":"FILL"}]},"seoChecks":[{"title":"HTTPS Security","status":"${httpsOk?'pass':'fail'}","current":"${httpsOk?'HTTPS enabled':'HTTP only — not secure'}","issue":"${httpsOk?'None':'No SSL'}","fix":"${httpsOk?'No action needed':"Install free SSL via Let's Encrypt"}"},{"title":"Page Title","status":"${site?.title?(site.title.length>60?'warn':site.title.length<30?'warn':'pass'):'fail'}","current":"${site?.title?site.title+' ('+site.title.length+' chars)':'Not detected'}","issue":"FILL","fix":"FILL"},{"title":"Meta Description","status":"${site?.metaDesc?(site.metaDesc.length>160?'warn':'pass'):'fail'}","current":"${site?.metaDesc?site.metaDesc.length+' chars':'Missing'}","issue":"FILL","fix":"FILL"},{"title":"SEO Plugin","status":"${site?.hasYoast?'pass':'fail'}","current":"${site?.hasYoast?'Detected':'Not detected'}","issue":"FILL","fix":"FILL"},{"title":"XML Sitemap","status":"${site?.hasSitemap?'pass':'warn'}","current":"${site?.hasSitemap?'Detected':'Not found'}","issue":"FILL","fix":"FILL"},{"title":"Core Web Vitals","status":"${desktop.performance>=90?'pass':desktop.performance>=50?'warn':'fail'}","current":"Desktop: ${desktop.performance}/100 | Mobile: ${mobile.performance}/100","issue":"FILL","fix":"FILL"},{"title":"Image Alt Text","status":"${(site?.imgsNoAlt??0)===0?'pass':'warn'}","current":"${site?.imgsNoAlt??'?'} missing of ${site?.imgsTotal??'?'} total","issue":"FILL","fix":"FILL"},{"title":"Schema Markup","status":"${site?.hasSchema?'pass':'warn'}","current":"${site?.hasSchema?'Detected':'Not found'}","issue":"FILL","fix":"FILL"}],"securityChecks":[{"title":"HTTPS / SSL","status":"${httpsOk?'pass':'fail'}","current":"${httpsOk?'Secure — HTTPS active':'HTTP only — no SSL'}","risk":"${httpsOk?'None':'Google penalises HTTP sites, browser shows Not Secure warning'}","fix":"${httpsOk?'No action needed':"Install free SSL via Let's Encrypt in hosting cPanel"}"},{"title":"xmlrpc.php Exposure","status":"${site?.xmlrpcExposed?'fail':'pass'}","current":"${site?.xmlrpcExposed?'EXPOSED — xmlrpc.php is publicly accessible':'Protected — not accessible'}","risk":"${site?.xmlrpcExposed?'Enables brute force attacks, DDoS amplification, and unauthorised access':'No risk'}","fix":"${site?.xmlrpcExposed?'Add to .htaccess: <Files xmlrpc.php> Order Deny,Allow Deny from all </Files> or use Wordfence to block it':'No action needed'}"},{"title":"Default Login URL","status":"${site?.defaultLoginExposed?'warn':'pass'}","current":"${site?.defaultLoginExposed?'/wp-admin accessible at default URL':'Login URL is protected or changed'}","risk":"${site?.defaultLoginExposed?'Attackers know exactly where to target brute force login attempts':'No risk'}","fix":"${site?.defaultLoginExposed?'Change login URL using WPS Hide Login plugin and enable 2FA':'No action needed'}"},{"title":"User Enumeration","status":"${site?.userEnumExposed?'fail':'pass'}","current":"${site?.userEnumExposed?`Username exposed: ${site.exposedUsername}`:'User enumeration blocked'}","risk":"${site?.userEnumExposed?'Attackers can harvest WordPress usernames for targeted brute force attacks':'No risk'}","fix":"${site?.userEnumExposed?'Add to functions.php: remove_action(redirect_canonical) or use Wordfence to block author scans':'No action needed'}"}],"wordpressSpecific":{"phpVersion":"Cannot detect externally — check WP Admin > Tools > Site Health. Recommend PHP 8.2+","wordpressVersion":"Cannot detect externally — check WP Admin > Dashboard > Updates","themeName":"${site?.themeName||'Not detected'}","pageBuilder":"${site?.pageBuilder||'Not detected'}","hasWooCommerce":${site?.hasWooCommerce??false},"pluginCount":${site?.pluginCount??0},"detectedPlugins":${JSON.stringify(site?.pluginNames?.slice(0,20)||[])},"pluginBloat":"FILL: assessment of ${site?.pluginCount??0} plugins detected","caching":"${site?.hasWPRocket?'Caching plugin detected — good':'No caching plugin detected — install WP Rocket or LiteSpeed Cache'}","imageOptimization":"FILL: based on page size ${desktop.pageSize} and ${site?.imgsNoAlt??0} missing alts","cdnDetected":"${site?.hasCDN?'CDN detected':'No CDN — recommend Cloudflare free tier'}","gzipEnabled":"FILL","httpsEnabled":"${httpsOk?'Yes — HTTPS active':'No — install SSL immediately'}","recommendations":[{"priority":"high","action":"FILL","plugin":"FILL","impact":"FILL"},{"priority":"high","action":"FILL","plugin":"FILL","impact":"FILL"},{"priority":"medium","action":"FILL","plugin":"FILL","impact":"FILL"},{"priority":"medium","action":"FILL","plugin":"FILL","impact":"FILL"},{"priority":"low","action":"FILL","plugin":"FILL","impact":"FILL"}]},"topFixes":["FILL","FILL","FILL","FILL","FILL"],"nextActions":{"immediate":["FILL","FILL","FILL"],"shortTerm":["FILL","FILL","FILL"],"longTerm":["FILL","FILL","FILL"]}}`;

      let parsed: AuditData|null = null;
      for (let attempt=1; attempt<=3; attempt++) {
        try {
          const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ systemInstruction:{parts:[{text:SYSTEM}]}, contents:[{role:'user',parts:[{text:USER}]}], generationConfig:{temperature:0.2,maxOutputTokens:8000} }),
          });
          const gd = await gr.json();
          if (gd.error) { const m=gd.error.message||''; if((m.includes('overloaded')||m.includes('high demand'))&&attempt<3){await new Promise(r=>setTimeout(r,3000*attempt));continue;} throw new Error('Gemini: '+m); }
          const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text||'';
          if (!raw) throw new Error('Empty Gemini response');
          let j = raw.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
          j = j.slice(j.indexOf('{'), j.lastIndexOf('}')+1).replace(/,\s*([}\]])/g,'$1');
          parsed = JSON.parse(j) as AuditData;
          break;
        } catch(e) { if(attempt===3) throw e; await new Promise(r=>setTimeout(r,2000*attempt)); }
      }
      if (!parsed) throw new Error('AI audit failed after retries');

      // Hard overrides
      parsed.performanceScore = desktop.performance;
      parsed.seoScore         = desktop.seo;
      parsed.mobileScore      = mobile.performance;
      parsed.speedMetrics     = {desktop:desktop.performance,mobile:mobile.performance,loadTime:desktop.lcp,pageSize:desktop.pageSize};
      parsed.overallScore     = Math.round((desktop.performance+mobile.performance+desktop.seo)/3);
      parsed.grade            = parsed.overallScore>=90?'A':parsed.overallScore>=75?'B':parsed.overallScore>=60?'C':parsed.overallScore>=45?'D':'F';
      parsed.securityScore    = secScore;
      parsed.url              = clean;
      parsed.auditDate        = auditDate;
      if (parsed.wordpressSpecific) {
        parsed.wordpressSpecific.wordpressVersion = 'Cannot detect externally — check WP Admin > Dashboard > Updates';
        parsed.wordpressSpecific.themeName        = site?.themeName||'Not detectable';
        parsed.wordpressSpecific.pageBuilder      = site?.pageBuilder||'Not detected';
        parsed.wordpressSpecific.hasWooCommerce   = site?.hasWooCommerce??false;
        parsed.wordpressSpecific.pluginCount      = site?.pluginCount??0;
        parsed.wordpressSpecific.detectedPlugins  = site?.pluginNames?.slice(0,10)||[];
      }
      // TTFB must never be critical unless >1800ms
      const ttfbMs = parseFloat((desktop.ttfb||'0').replace(/[^0-9.]/g,''))*(desktop.ttfb?.includes('s')&&!desktop.ttfb?.includes('ms')?1000:1);
      if (ttfbMs<1800&&Array.isArray(parsed.issues?.critical)) {
        parsed.issues.critical = parsed.issues.critical.filter((i:IssueItem)=>!i.title?.toLowerCase().includes('ttfb')&&!i.title?.toLowerCase().includes('server response')&&!i.title?.toLowerCase().includes('time to first byte'));
      }

      setStep(4);
      setResult(parsed);
    } catch(e:unknown) {
      setError(e instanceof Error ? e.message : 'Audit failed. Check the URL and try again.');
    }
    setLoading(false);
  }

  const sc  = (s:number) => s>=80?'#16a34a':s>=60?'#d97706':'#dc2626';
  const stc = (s:string) => (s==='pass'||s==='good')?'#16a34a':(s==='warn'||s==='needs-improvement')?'#d97706':'#dc2626';
  const stl = (s:string) => (s==='pass'||s==='good')?'PASS':(s==='warn'||s==='needs-improvement')?'WARN':'FAIL';

  async function downloadReport() {
    if (!result) return;
    const r = result;
    const jsPDFModule = await import('jspdf');
    const jsPDF = jsPDFModule.default;
    const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const W=210,H=297,M=14,CW=182;
    let y=0; let pageNum=1;

    function cl(t:string):string { return (t||'').replace(/[^\x00-\x7F]/g,(c:string)=>{const m:Record<string,string>={'\u2019':"'",'\u2018':"'",'\u201c':'"','\u201d':'"','\u2013':'-','\u2014':'-','\u2026':'...'};return m[c]??'';}).replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1'); }
    function wt(t:string,w:number,fs:number):string[]{doc.setFontSize(fs);return doc.splitTextToSize(cl(t),w);}
    function scc(s:number):[number,number,number]{return s>=80?[22,163,74]:s>=60?[217,119,6]:[220,38,38];}
    function stcc(s:string):[number,number,number]{return(s==='pass'||s==='good')?[22,163,74]:(s==='warn'||s==='needs-improvement')?[217,119,6]:[220,38,38];}

    function addFooter(){
      doc.setFillColor(30,58,138);doc.rect(0,H-8,W,8,'F');
      doc.setTextColor(180,200,255);doc.setFontSize(7);doc.setFont('helvetica','normal');
      doc.text('WordPress Audit Pro',M,H-3);
      doc.text(`Page ${pageNum}`,W/2,H-3,{align:'center'});
      doc.text(cl(r.url),W-M,H-3,{align:'right'});
    }
    function np(){addFooter();doc.addPage();pageNum++;y=20;}
    function cy(n:number){if(y+n>H-12)np();}

    // ── COVER ──
    doc.setFillColor(255,255,255);doc.rect(0,0,W,H,'F');
    doc.setFillColor(30,58,138);doc.rect(0,0,W,56,'F');
    doc.setFillColor(37,99,235);doc.roundedRect(M,14,20,20,3,3,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
    doc.text('WP',M+10,26,{align:'center'});
    doc.setFontSize(18);doc.text('WordPress Audit Pro',M+26,24);
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(180,200,255);
    doc.text('Professional Speed, SEO & Security Report',M+26,33);
    doc.setFontSize(8);doc.setTextColor(160,185,240);
    doc.text(cl(r.url),M+8,46);doc.text(r.auditDate,M+8,52);
    const[gr2,gg2,gb2]=scc(r.overallScore);
    doc.setFillColor(255,255,255);doc.roundedRect(W-48,8,34,42,3,3,'F');
    doc.setFillColor(gr2,gg2,gb2);doc.rect(W-48,8,3,42,'F');
    doc.setTextColor(gr2,gg2,gb2);doc.setFontSize(24);doc.setFont('helvetica','bold');
    doc.text(r.grade,W-31,30,{align:'center'});
    doc.setFontSize(8);doc.setTextColor(107,114,128);doc.text(`${r.overallScore}/100`,W-31,40,{align:'center'});
    doc.setFontSize(6.5);doc.setTextColor(156,163,175);doc.text('SCORE',W-31,46,{align:'center'});

    y=66;
    const scoreCards=[{l:'PERFORMANCE',v:r.performanceScore},{l:'SEO',v:r.seoScore},{l:'MOBILE',v:r.mobileScore},{l:'SECURITY',v:r.securityScore}];
    const sw2=CW/4;
    scoreCards.forEach((s2,i)=>{
      const x=M+i*sw2;const[cr,cg,cb]=scc(s2.v);
      doc.setFillColor(248,250,252);doc.roundedRect(x,y,sw2-3,26,2,2,'F');
      doc.setFillColor(cr,cg,cb);doc.rect(x,y,sw2-3,2,'F');
      doc.setTextColor(cr,cg,cb);doc.setFontSize(18);doc.setFont('helvetica','bold');
      doc.text(String(s2.v),x+(sw2-3)/2,y+15,{align:'center'});
      doc.setTextColor(107,114,128);doc.setFontSize(6.5);doc.setFont('helvetica','normal');
      doc.text(s2.l,x+(sw2-3)/2,y+22,{align:'center'});
    });
    y+=34;
    const sumLines=wt(r.summary||'',CW-16,8.5).slice(0,6);
    const sumH=Math.max(28,12+sumLines.length*5.5);
    doc.setFillColor(239,246,255);doc.roundedRect(M,y,CW,sumH,3,3,'F');
    doc.setFillColor(37,99,235);doc.rect(M,y,3,sumH,'F');
    doc.setTextColor(30,58,138);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
    doc.text('EXECUTIVE SUMMARY',M+8,y+8);
    doc.setTextColor(55,65,81);doc.setFont('helvetica','normal');doc.setFontSize(8);
    sumLines.forEach((l,i)=>doc.text(l,M+8,y+15+i*5.5));
    y+=sumH+8;

    // WP info strip on cover
    const wpInfo=[
      {l:'Theme',v:r.wordpressSpecific?.themeName},
      {l:'Page Builder',v:r.wordpressSpecific?.pageBuilder},
      {l:'Plugins',v:`${r.wordpressSpecific?.pluginCount||0} detected`},
      {l:'WooCommerce',v:r.wordpressSpecific?.hasWooCommerce?'YES — eCommerce':'No'},
    ];
    doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,20,2,2,'F');
    doc.setFillColor(30,58,138);doc.rect(M,y,3,20,'F');
    doc.setTextColor(30,58,138);doc.setFontSize(7);doc.setFont('helvetica','bold');
    doc.text('WORDPRESS PROFILE',M+8,y+7);
    doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
    wpInfo.forEach((it,i)=>{
      const x=M+8+i*46;
      doc.setFontSize(6.5);doc.setTextColor(107,114,128);doc.text(it.l,x,y+13);
      doc.setFontSize(7.5);doc.setTextColor(17,24,39);doc.setFont('helvetica','bold');
      doc.text(cl(it.v||'N/A').substring(0,18),x,y+18);
      doc.setFont('helvetica','normal');
    });
    y+=28;

    const speedMets=[`Desktop: ${r.speedMetrics?.desktop}/100`,`Mobile: ${r.speedMetrics?.mobile}/100`,`LCP: ${r.speedMetrics?.loadTime}`,`Size: ${r.speedMetrics?.pageSize}`];
    doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,18,2,2,'F');
    doc.setFillColor(37,99,235);doc.rect(M,y,3,18,'F');
    doc.setTextColor(30,58,138);doc.setFontSize(7);doc.setFont('helvetica','bold');doc.text('SPEED METRICS',M+8,y+6);
    doc.setTextColor(75,85,99);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
    speedMets.forEach((m,i)=>doc.text(m,M+8+i*46,y+14));

    // ── PAGE 2: CORE WEB VITALS ──
    np();
    doc.setFillColor(30,58,138);doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text("CORE WEB VITALS — Google's Ranking Signals",M,9.5);
    y=20;
    const vitals=[
      {key:'LCP — Largest Contentful Paint',d:r.coreWebVitals?.lcp},
      {key:'TBT — Total Blocking Time',d:r.coreWebVitals?.fid},
      {key:'CLS — Cumulative Layout Shift',d:r.coreWebVitals?.cls},
      {key:'TTFB — Time to First Byte',d:r.coreWebVitals?.ttfb},
      {key:'FCP — First Contentful Paint',d:r.coreWebVitals?.fcp},
    ];
    vitals.forEach(v=>{
      if(!v.d)return;
      const col=stcc(v.d.status);
      const descL=wt(v.d.description||'',CW-16,7.5);
      const fixL=wt('Fix: '+(v.d.fix||''),CW-16,7.5);
      const bh=Math.max(26,8+descL.length*4.5+fixL.length*4.5+6);
      cy(bh+4);
      doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(col[0],col[1],col[2]);doc.rect(M,y,3,bh,'F');
      doc.setFillColor(col[0],col[1],col[2]);doc.roundedRect(M+5,y+4,20,6,1,1,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(5.5);doc.setFont('helvetica','bold');
      const vl=v.d.status==='good'?'GOOD':v.d.status==='needs-improvement'?'NEEDS WORK':'POOR';
      doc.text(vl,M+15,y+8.5,{align:'center'});
      doc.setTextColor(17,24,39);doc.setFontSize(8.5);doc.setFont('helvetica','bold');
      doc.text(cl(v.key),M+28,y+9);
      doc.setTextColor(col[0],col[1],col[2]);doc.setFontSize(9);
      doc.text(cl(v.d.value||''),W-M-2,y+9,{align:'right'});
      let iy=y+14;
      doc.setTextColor(107,114,128);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
      descL.forEach((l,i)=>doc.text(l,M+5,iy+i*4.5));iy+=descL.length*4.5+2;
      doc.setTextColor(30,58,138);
      fixL.forEach((l,i)=>doc.text(l,M+5,iy+i*4.5));
      y+=bh+4;
    });

    // ── PAGE 3: SECURITY ──
    np();
    doc.setFillColor(30,58,138);doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text('SECURITY AUDIT',M,9.5);
    y=20;
    // Security score banner
    const[sr2,sg2,sb2]=scc(r.securityScore);
    doc.setFillColor(sr2,sg2,sb2);doc.roundedRect(M,y,CW,12,2,2,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text(`Security Score: ${r.securityScore}/100`,M+6,y+8.5);
    const secLabel=r.securityScore>=80?'GOOD':r.securityScore>=60?'NEEDS WORK':'AT RISK';
    doc.text(secLabel,W-M-4,y+8.5,{align:'right'});
    y+=18;
    r.securityChecks?.forEach(c=>{
      const col=stcc(c.status);
      const riskL=wt('Risk: '+(c.risk||''),CW-14,7.5);
      const fixL2=wt(c.fix||'',CW-14,8);
      const bh=Math.max(26,8+riskL.length*5+fixL2.length*5+4);
      cy(bh+4);
      doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(col[0],col[1],col[2]);doc.rect(M,y,3,bh,'F');
      doc.setFillColor(col[0],col[1],col[2]);doc.roundedRect(M+5,y+4,13,5.5,1,1,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(5.5);doc.setFont('helvetica','bold');
      doc.text(stl(c.status),M+11.5,y+8.3,{align:'center'});
      doc.setTextColor(17,24,39);doc.setFontSize(8.5);doc.setFont('helvetica','bold');
      doc.text(cl(c.title),M+22,y+9);
      doc.setTextColor(107,114,128);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
      doc.text(cl(c.current||''),M+22,y+15);
      let iy=y+20;
      if(c.status!=='pass'){
        doc.setTextColor(220,38,38);
        riskL.forEach((l,i)=>doc.text(l,M+5,iy+i*5));iy+=riskL.length*5+2;
        doc.setTextColor(30,58,138);
        fixL2.forEach((l,i)=>doc.text((i===0?'> ':' ')+l,M+5,iy+i*5));
      } else {
        doc.setTextColor(22,163,74);doc.text('No action needed',M+5,iy);
      }
      y+=bh+4;
    });

    // ── PAGE 4: ISSUES ──
    np();
    doc.setFillColor(30,58,138);doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text('PERFORMANCE ISSUES & RECOMMENDATIONS',M,9.5);
    y=20;
    if(r.issues?.critical?.length>0){
      doc.setFillColor(220,38,38);doc.roundedRect(M,y,CW,9,2,2,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
      doc.text(`CRITICAL ISSUES (${r.issues.critical.length})`,M+5,y+6.5);y+=13;
      r.issues.critical.forEach((issue,idx)=>{
        const impL=wt('Impact: '+(issue.impact||''),CW-14,7.5);
        const fixL2=wt(issue.fix||'',CW-14,8);
        const bh=Math.max(26,8+impL.length*5+fixL2.length*5+(issue.plugin?5:0)+4);
        cy(bh+4);
        doc.setFillColor(255,241,242);doc.roundedRect(M,y,CW,bh,2,2,'F');
        doc.setFillColor(220,38,38);doc.rect(M,y,3,bh,'F');
        doc.setTextColor(17,24,39);doc.setFontSize(9);doc.setFont('helvetica','bold');
        doc.text(cl(`${idx+1}. ${issue.title}`),M+7,y+8);
        let iy=y+14;
        doc.setTextColor(185,28,28);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
        impL.forEach((l,i)=>{doc.text(l,M+7,iy+i*5);});iy+=impL.length*5;
        doc.setTextColor(30,58,138);
        fixL2.forEach((l,i)=>doc.text((i===0?'> ':' ')+l,M+7,iy+i*5));iy+=fixL2.length*5;
        if(issue.plugin){doc.setTextColor(22,163,74);doc.text('Plugin: '+cl(issue.plugin),M+7,iy+3);}
        y+=bh+4;
      });y+=4;
    }
    if(r.issues?.warnings?.length>0){
      cy(13);
      doc.setFillColor(217,119,6);doc.roundedRect(M,y,CW,9,2,2,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
      doc.text(`WARNINGS (${r.issues.warnings.length})`,M+5,y+6.5);y+=13;
      r.issues.warnings.forEach((issue,idx)=>{
        const impL=wt('Impact: '+(issue.impact||''),CW-14,7.5);
        const fixL2=wt(issue.fix||'',CW-14,8);
        const bh=Math.max(26,8+impL.length*5+fixL2.length*5+4);
        cy(bh+4);
        doc.setFillColor(255,251,235);doc.roundedRect(M,y,CW,bh,2,2,'F');
        doc.setFillColor(217,119,6);doc.rect(M,y,3,bh,'F');
        doc.setTextColor(17,24,39);doc.setFontSize(9);doc.setFont('helvetica','bold');
        doc.text(cl(`${idx+1}. ${issue.title}`),M+7,y+8);
        let iy=y+14;
        doc.setTextColor(146,64,14);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
        impL.forEach((l,i)=>{doc.text(l,M+7,iy+i*5);});iy+=impL.length*5;
        doc.setTextColor(30,58,138);
        fixL2.forEach((l,i)=>doc.text((i===0?'> ':' ')+l,M+7,iy+i*5));
        y+=bh+4;
      });
    }
    if(r.issues?.passed?.length>0){
      cy(13);
      doc.setFillColor(22,163,74);doc.roundedRect(M,y,CW,9,2,2,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
      doc.text('PASSING CHECKS',M+5,y+6.5);y+=13;
      r.issues.passed.forEach(p=>{
        const lines=wt(`${p.title}: ${p.description}`,CW-16,8);
        const bh=Math.max(12,5+lines.length*5);cy(bh+3);
        doc.setFillColor(240,253,244);doc.roundedRect(M,y,CW,bh,2,2,'F');
        doc.setFillColor(22,163,74);doc.rect(M,y,3,bh,'F');
        doc.setTextColor(22,163,74);doc.setFontSize(9);doc.setFont('helvetica','bold');doc.text('✓',M+7,y+bh/2+3);
        doc.setTextColor(17,24,39);doc.setFontSize(8);doc.setFont('helvetica','normal');
        lines.forEach((l,i)=>doc.text(l,M+14,y+7+i*5));
        y+=bh+3;
      });
    }

    // ── SEO CHECKS ──
    y+=8;
    if(y>H-80){
      // enough room for a new full page
      np();
      doc.setFillColor(30,58,138);doc.rect(0,0,W,13,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(10);doc.setFont('helvetica','bold');
      doc.text('SEO CHECKS',M,9.5);y=20;
    } else {
      // continue on same page with inline section header
      cy(13);
      doc.setFillColor(30,58,138);doc.roundedRect(M,y,CW,9,1,1,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont('helvetica','bold');
      doc.text('SEO CHECKS',M+5,y+6.2);y+=13;
    }
    r.seoChecks?.forEach(c=>{
      const col=stcc(c.status);
      const curL=wt('Current: '+(c.current||''),CW-14,7.5);
      const fixL3=wt(c.fix||'',CW-14,8);
      const bh=Math.max(24,8+curL.length*4.5+fixL3.length*5+4);
      cy(bh+4);
      doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(col[0],col[1],col[2]);doc.rect(M,y,3,bh,'F');
      doc.setFillColor(col[0],col[1],col[2]);doc.roundedRect(M+5,y+4,13,5.5,1,1,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(5.5);doc.setFont('helvetica','bold');
      doc.text(stl(c.status),M+11.5,y+8.3,{align:'center'});
      doc.setTextColor(17,24,39);doc.setFontSize(8.5);doc.setFont('helvetica','bold');
      doc.text(cl(c.title),M+22,y+9);
      let iy=y+14;
      doc.setTextColor(107,114,128);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
      curL.forEach((l,i)=>{doc.text(l,M+5,iy+i*4.5);});iy+=curL.length*4.5+2;
      doc.setTextColor(col[0],col[1],col[2]);
      fixL3.forEach((l,i)=>doc.text((i===0?'> ':' ')+l,M+5,iy+i*5));
      y+=bh+4;
    });

    // ── PAGE 6: WP ANALYSIS + ACTION PLAN ──
    np();
    doc.setFillColor(30,58,138);doc.rect(0,0,W,13,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text('WORDPRESS ANALYSIS & ACTION PLAN',M,9.5);y=20;

    const wpItems=[
      {l:'PHP Version',v:r.wordpressSpecific?.phpVersion},
      {l:'WP Version',v:r.wordpressSpecific?.wordpressVersion},
      {l:'Theme',v:r.wordpressSpecific?.themeName},
      {l:'Page Builder',v:r.wordpressSpecific?.pageBuilder},
      {l:'Caching',v:r.wordpressSpecific?.caching},
      {l:'CDN',v:r.wordpressSpecific?.cdnDetected},
      {l:'HTTPS',v:r.wordpressSpecific?.httpsEnabled},
      {l:'WooCommerce',v:r.wordpressSpecific?.hasWooCommerce?'YES — eCommerce active':'No'},
    ];
    doc.setFillColor(30,58,138);doc.roundedRect(M,y,CW,8,1,1,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
    doc.text('WORDPRESS HEALTH',M+5,y+5.8);y+=12;
    wpItems.forEach((it,i)=>{
      if(i%2===0){cy(12);doc.setFillColor(i%4<2?248:255,250,252);doc.roundedRect(M,y,CW,10,1,1,'F');}
      const x=M+(i%2)*(CW/2);
      doc.setTextColor(107,114,128);doc.setFontSize(7);doc.setFont('helvetica','normal');
      doc.text(it.l+':',x+4,y+5.5);
      doc.setTextColor(17,24,39);doc.setFont('helvetica','bold');
      const vLines=wt(it.v||'N/A',CW/2-44,7);
      doc.text(vLines[0]||'',x+40,y+5.5);
      if(i%2===1)y+=12;
    });
    if(wpItems.length%2===1)y+=12;

    // Detected plugins
    if(r.wordpressSpecific?.detectedPlugins?.length>0){
      y+=4;cy(18);
      doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,14,1,1,'F');
      doc.setFillColor(30,58,138);doc.rect(M,y,3,14,'F');
      doc.setTextColor(30,58,138);doc.setFontSize(7);doc.setFont('helvetica','bold');
      doc.text(`DETECTED PLUGINS (${r.wordpressSpecific.pluginCount})`,M+6,y+6);
      doc.setTextColor(75,85,99);doc.setFont('helvetica','normal');
      doc.text(r.wordpressSpecific.detectedPlugins.map(p=>cl(p)).join(', ').substring(0,110),M+6,y+11);
      y+=18;
    }

    y+=4;
    if(r.wordpressSpecific?.recommendations?.length>0){
      cy(13);
      doc.setFillColor(30,58,138);doc.roundedRect(M,y,CW,8,1,1,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
      doc.text('PLUGIN RECOMMENDATIONS',M+5,y+5.8);y+=12;
      r.wordpressSpecific.recommendations.forEach(rec=>{
        const lines=wt(`${rec.action} — ${rec.impact}`,CW-30,7.5);
        const bh=Math.max(12,6+lines.length*5);cy(bh+3);
        const[pr,pg,pb]=rec.priority==='high'?[220,38,38]:rec.priority==='medium'?[217,119,6]:[22,163,74];
        doc.setFillColor(248,250,252);doc.roundedRect(M,y,CW,bh,1,1,'F');
        doc.setFillColor(pr,pg,pb);doc.roundedRect(M+4,y+3,14,6,1,1,'F');
        doc.setTextColor(255,255,255);doc.setFontSize(5.5);doc.setFont('helvetica','bold');
        doc.text(rec.priority.toUpperCase(),M+11,y+7.3,{align:'center'});
        doc.setTextColor(17,24,39);doc.setFontSize(7.5);doc.setFont('helvetica','normal');
        lines.forEach((l,i)=>doc.text(l,M+22,y+7+i*5));
        doc.setTextColor(22,163,74);doc.setFontSize(7);doc.text(cl(rec.plugin||''),W-M-2,y+7,{align:'right'});
        y+=bh+3;
      });y+=6;
    }

    cy(13);
    doc.setFillColor(37,99,235);doc.roundedRect(M,y,CW,8,1,1,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
    doc.text('TOP PRIORITY FIXES',M+5,y+5.8);y+=12;
    r.topFixes?.forEach((fix,i)=>{
      const lines=wt(fix,CW-20,8);const bh=Math.max(14,7+lines.length*5.5);cy(bh+3);
      doc.setFillColor(239,246,255);doc.roundedRect(M,y,CW,bh,2,2,'F');
      doc.setFillColor(37,99,235);doc.circle(M+7,y+bh/2,4,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
      doc.text(String(i+1),M+7,y+bh/2+2.5,{align:'center'});
      doc.setTextColor(17,24,39);doc.setFontSize(8);doc.setFont('helvetica','normal');
      lines.forEach((l,li)=>doc.text(l,M+16,y+8+li*5.5));
      y+=bh+3;
    });y+=6;

    const groups=[
      {label:'DO TODAY',items:r.nextActions?.immediate,c:[220,38,38] as [number,number,number],bg:[255,241,242] as [number,number,number]},
      {label:'THIS WEEK',items:r.nextActions?.shortTerm,c:[217,119,6] as [number,number,number],bg:[255,251,235] as [number,number,number]},
      {label:'THIS MONTH',items:r.nextActions?.longTerm,c:[22,163,74] as [number,number,number],bg:[240,253,244] as [number,number,number]},
    ];
    groups.forEach(g=>{
      cy(16);
      doc.setFillColor(g.c[0],g.c[1],g.c[2]);doc.roundedRect(M,y,CW,8,1,1,'F');
      doc.setTextColor(255,255,255);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
      doc.text(g.label,M+5,y+5.8);y+=11;
      g.items?.forEach(a=>{
        const lines=wt(a,CW-16,8);const bh=Math.max(12,5+lines.length*5);cy(bh+3);
        doc.setFillColor(g.bg[0],g.bg[1],g.bg[2]);doc.roundedRect(M,y,CW,bh,1,1,'F');
        doc.setTextColor(g.c[0],g.c[1],g.c[2]);doc.setFontSize(9);doc.text('>',M+5,y+bh/2+3);
        doc.setTextColor(17,24,39);doc.setFontSize(8);doc.setFont('helvetica','normal');
        lines.forEach((l,li)=>doc.text(l,M+12,y+7+li*5));
        y+=bh+3;
      });y+=5;
    });

    const total=(doc as unknown as{internal:{getNumberOfPages:()=>number}}).internal.getNumberOfPages();
    for(let p=1;p<=total;p++){doc.setPage(p);addFooter();}
    doc.save(`wordpress-audit-${cl(r.url).replace(/https?:\/\//,'').replace(/[^a-z0-9]/gi,'-').toLowerCase()}.pdf`);
  }

  return (
      <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'#f8fafc', fontFamily:"'Outfit','Segoe UI',sans-serif", color:'#0f172a', overflow:'hidden' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap'); @keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}} *{box-sizing:border-box}`}</style>

        {/* NAV */}
        <nav style={{ background:'white', borderBottom:'1px solid #e5e7eb', padding:'0 32px', display:'flex', alignItems:'center', justifyContent:'space-between', height:60, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, background:'linear-gradient(135deg,#2563eb,#1d4ed8)', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white"/></svg>
            </div>
            <div>
              <div style={{ fontWeight:800, fontSize:15, letterSpacing:-0.5, lineHeight:1 }}>WordPress Audit Pro</div>
              <div style={{ fontSize:9, color:'#9ca3af', letterSpacing:0.5 }}>PROFESSIONAL SITE ANALYSIS</div>
            </div>
          </div>
          <span style={{ fontSize:11, color:'#6b7280', background:'#f3f4f6', padding:'4px 12px', borderRadius:100 }}>Free · Google PageSpeed + AI</span>
        </nav>

        {/* HERO — fills remaining viewport, no scroll */}
        {!result && !loading && (
            <div style={{ flex:1, background:'linear-gradient(135deg,#1e3a8a,#2563eb)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'0 24px', textAlign:'center' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.8)', letterSpacing:2, marginBottom:20, background:'rgba(255,255,255,0.12)', padding:'5px 16px', borderRadius:100, display:'inline-block' }}>
                GOOGLE PAGESPEED + GEMINI AI + SECURITY SCAN
              </div>
              <h1 style={{ fontSize:'clamp(28px,4vw,52px)', fontWeight:900, color:'white', margin:'0 0 14px', letterSpacing:-1.5, lineHeight:1.1 }}>
                Is Your WordPress Site<br /><span style={{ color:'#93c5fd' }}>Losing You Money?</span>
              </h1>
              <p style={{ fontSize:16, color:'rgba(255,255,255,0.72)', maxWidth:480, margin:'0 auto 32px', lineHeight:1.7 }}>
                Complete audit — Core Web Vitals, SEO, Security & exact WordPress fixes. Free.
              </p>
              <div style={{ width:'100%', maxWidth:560 }}>
                <div style={{ display:'flex', gap:8, background:'white', borderRadius:14, padding:7, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
                  <input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runAudit()} placeholder="yourwordpresssite.com" style={{ flex:1, padding:'12px 14px', border:'none', outline:'none', fontSize:14, color:'#0f172a', background:'transparent', borderRadius:8 }} />
                  <button onClick={runAudit} style={{ padding:'12px 24px', borderRadius:9, background:'linear-gradient(135deg,#2563eb,#1d4ed8)', border:'none', color:'white', fontSize:14, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>Audit Now →</button>
                </div>
                {error && <div style={{ marginTop:10, padding:'9px 14px', borderRadius:8, background:'rgba(239,68,68,0.15)', color:'#fca5a5', fontSize:13 }}>{error}</div>}
              </div>
              <div style={{ display:'flex', gap:10, marginTop:28, flexWrap:'wrap', justifyContent:'center' }}>
                {['⚡ Core Web Vitals','🔍 SEO','🔒 Security Scan','📱 Mobile','🔌 Plugin Audit','📄 PDF'].map(f=>(
                    <div key={f} style={{ padding:'5px 14px', borderRadius:100, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.85)', fontSize:12 }}>{f}</div>
                ))}
              </div>
              {/* Footer inside hero — always visible */}
              <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'10px 32px', display:'flex', justifyContent:'space-between', fontSize:11, color:'rgba(255,255,255,0.35)' }}>
                <span>© 2026 WordPress Audit Pro · Free Professional Site Analysis</span>
                <span>Powered by Google PageSpeed + Gemini AI</span>
              </div>
            </div>
        )}

        {/* LOADING */}
        {loading && (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px', animation:'fadeUp 0.4s ease' }}>
              <div style={{ background:'white', borderRadius:16, padding:40, border:'1px solid #e5e7eb', boxShadow:'0 4px 24px rgba(0,0,0,0.06)', textAlign:'center', width:'100%', maxWidth:460 }}>
                <div style={{ width:44, height:44, borderRadius:'50%', border:'3px solid #e5e7eb', borderTop:'3px solid #2563eb', margin:'0 auto 20px', animation:'spin 0.8s linear infinite' }} />
                <div style={{ fontWeight:800, fontSize:18, marginBottom:6 }}>Auditing WordPress Site</div>
                <div style={{ fontSize:13, color:'#2563eb', marginBottom:24 }}>{steps[step]}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8, textAlign:'left' }}>
                  {steps.map((s,i)=>(
                      <div key={s} style={{ display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
                        <div style={{ width:20, height:20, borderRadius:5, background:i<step?'#2563eb':i===step?'rgba(37,99,235,0.1)':'#f3f4f6', border:i===step?'1px solid #2563eb':'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:i<step?'white':'#2563eb', flexShrink:0 }}>
                          {i<step?'✓':i===step?'●':''}
                        </div>
                        <span style={{ color:i<=step?'#374151':'#9ca3af' }}>{s}</span>
                      </div>
                  ))}
                </div>
              </div>
            </div>
        )}

        {/* RESULTS */}
        {result && (
            <div style={{ flex:1, overflowY:'auto', padding:'24px', animation:'fadeUp 0.4s ease' }}>
              <div style={{ maxWidth:960, margin:'0 auto', paddingBottom:60 }}>

                {/* Header */}
                <div style={{ background:'white', borderRadius:14, padding:'20px 24px', marginBottom:14, border:'1px solid #e5e7eb', borderTop:'3px solid #2563eb', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:14 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:'#2563eb', letterSpacing:1.5, marginBottom:4 }}>AUDIT COMPLETE</div>
                    <div style={{ fontWeight:800, fontSize:17 }}>{result.url}</div>
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{result.auditDate}</div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <div style={{ textAlign:'center', background:'#f8fafc', borderRadius:10, padding:'10px 18px', border:'1px solid #e5e7eb' }}>
                      <div style={{ fontWeight:900, fontSize:34, color:sc(result.overallScore), lineHeight:1 }}>{result.grade}</div>
                      <div style={{ fontSize:9, color:'#9ca3af', letterSpacing:1 }}>GRADE</div>
                    </div>
                  </div>
                </div>

                {/* Score grid */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
                  {[{l:'Performance',v:result.performanceScore},{l:'SEO',v:result.seoScore},{l:'Mobile',v:result.mobileScore},{l:'Security',v:result.securityScore}].map(s2=>(
                      <div key={s2.l} style={{ background:'white', borderRadius:10, padding:'14px', border:'1px solid #e5e7eb', textAlign:'center' }}>
                        <div style={{ fontWeight:800, fontSize:26, color:sc(s2.v) }}>{s2.v}</div>
                        <div style={{ fontSize:9, color:'#9ca3af', marginBottom:6 }}>{s2.l.toUpperCase()}</div>
                        <div style={{ height:3, background:'#f3f4f6', borderRadius:2 }}><div style={{ height:'100%', width:`${s2.v}%`, background:sc(s2.v), borderRadius:2 }} /></div>
                      </div>
                  ))}
                </div>

                {/* WP Profile strip */}
                <div style={{ background:'#eff6ff', borderRadius:10, padding:'12px 18px', marginBottom:14, display:'flex', gap:24, flexWrap:'wrap', borderLeft:'3px solid #2563eb' }}>
                  {[
                    {l:'Theme', v:result.wordpressSpecific?.themeName},
                    {l:'Page Builder', v:result.wordpressSpecific?.pageBuilder},
                    {l:'Plugins', v:`${result.wordpressSpecific?.pluginCount||0} detected`},
                    {l:'WooCommerce', v:result.wordpressSpecific?.hasWooCommerce?'Active':'No'},
                  ].map(it=>(
                      <div key={it.l}>
                        <div style={{ fontSize:10, color:'#6b7280' }}>{it.l}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:'#1e3a8a' }}>{it.v||'N/A'}</div>
                      </div>
                  ))}
                </div>

                {/* Security */}
                <div style={{ background:'white', borderRadius:14, padding:20, marginBottom:14, border:'1px solid #e5e7eb', borderTop:`2px solid ${sc(result.securityScore)}` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:1.5 }}>🔒 SECURITY AUDIT</div>
                    <div style={{ fontWeight:700, fontSize:14, color:sc(result.securityScore) }}>Score: {result.securityScore}/100</div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:8 }}>
                    {result.securityChecks?.map((c,i)=>(
                        <div key={i} style={{ padding:'10px 14px', borderRadius:8, background:'#f8fafc', borderLeft:`3px solid ${stc(c.status)}` }}>
                          <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:4 }}>
                            <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3, background:`${stc(c.status)}15`, color:stc(c.status) }}>{stl(c.status)}</span>
                            <span style={{ fontWeight:600, fontSize:12 }}>{c.title}</span>
                          </div>
                          <div style={{ fontSize:11, color:'#6b7280' }}>{c.current}</div>
                          {c.status!=='pass' && <div style={{ fontSize:11, color:'#1d4ed8', marginTop:4 }}>→ {c.fix}</div>}
                        </div>
                    ))}
                  </div>
                </div>

                {/* Core Web Vitals */}
                <div style={{ background:'white', borderRadius:14, padding:20, marginBottom:14, border:'1px solid #e5e7eb' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:1.5, marginBottom:14 }}>CORE WEB VITALS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:8 }}>
                    {[{k:'LCP',d:result.coreWebVitals?.lcp},{k:'TBT',d:result.coreWebVitals?.fid},{k:'CLS',d:result.coreWebVitals?.cls},{k:'TTFB',d:result.coreWebVitals?.ttfb},{k:'FCP',d:result.coreWebVitals?.fcp}].map(v=>(
                        v.d && <div key={v.k} style={{ padding:'12px', borderRadius:9, background:'#f8fafc', borderLeft:`3px solid ${stc(v.d.status)}` }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                            <span style={{ fontWeight:700, fontSize:12 }}>{v.k}</span>
                            <span style={{ fontWeight:800, fontSize:13, color:stc(v.d.status) }}>{v.d.value}</span>
                          </div>
                          <div style={{ fontSize:10, padding:'1px 6px', borderRadius:3, background:`${stc(v.d.status)}15`, color:stc(v.d.status), display:'inline-block' }}>{stl(v.d.status)}</div>
                        </div>
                    ))}
                  </div>
                </div>

                {/* Issues */}
                {result.issues?.critical?.length>0 && (
                    <div style={{ background:'white', borderRadius:14, padding:20, marginBottom:14, border:'1px solid #fecaca', borderTop:'2px solid #dc2626' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#dc2626', letterSpacing:1.5, marginBottom:14 }}>🚨 CRITICAL ISSUES</div>
                      {result.issues.critical.map((issue,i)=>(
                          <div key={i} style={{ padding:'12px 14px', borderRadius:8, background:'#fff1f2', marginBottom:8, borderLeft:'3px solid #dc2626' }}>
                            <div style={{ fontWeight:700, fontSize:13, marginBottom:3, color:'#7f1d1d' }}>{issue.title}</div>
                            <div style={{ fontSize:11, color:'#dc2626', marginBottom:5 }}>Impact: {issue.impact}</div>
                            <div style={{ fontSize:12, color:'#1d4ed8' }}>→ {issue.fix}</div>
                            {issue.plugin && <div style={{ fontSize:11, color:'#16a34a', marginTop:3 }}>🔌 {issue.plugin}</div>}
                          </div>
                      ))}
                    </div>
                )}

                {/* Top Fixes */}
                <div style={{ background:'linear-gradient(135deg,#1e3a8a,#2563eb)', borderRadius:14, padding:20, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.6)', letterSpacing:1.5, marginBottom:14 }}>⚡ TOP PRIORITY FIXES</div>
                  {result.topFixes?.map((fix,i)=>(
                      <div key={i} style={{ display:'flex', gap:10, padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.08)', marginBottom:7 }}>
                        <span style={{ width:22, height:22, borderRadius:'50%', background:'rgba(255,255,255,0.2)', color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i+1}</span>
                        <span style={{ fontSize:13, color:'rgba(255,255,255,0.9)', lineHeight:1.5 }}>{fix}</span>
                      </div>
                  ))}
                </div>

                {/* Buttons */}
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  <button onClick={downloadReport} style={{ padding:'13px 28px', borderRadius:10, background:'linear-gradient(135deg,#1e3a8a,#2563eb)', border:'none', color:'white', fontSize:14, fontWeight:700, cursor:'pointer' }}>↓ Download PDF Report</button>
                  <button onClick={()=>{setResult(null);setUrl('');}} style={{ padding:'13px 28px', borderRadius:10, background:'white', border:'1px solid #e5e7eb', color:'#374151', fontSize:14, fontWeight:600, cursor:'pointer' }}>↺ Audit Another Site</button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}