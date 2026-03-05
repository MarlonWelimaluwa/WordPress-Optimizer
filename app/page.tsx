'use client';
import { useState } from 'react';

type AuditData = {
  url: string;
  auditDate: string;
  overallScore: number;
  performanceScore: number;
  seoScore: number;
  mobileScore: number;
  securityScore: number;
  grade: string;
  summary: string;
  coreWebVitals: {
    lcp: { value: string; status: string; description: string; fix: string };
    fid: { value: string; status: string; description: string; fix: string };
    cls: { value: string; status: string; description: string; fix: string };
    ttfb: { value: string; status: string; description: string; fix: string };
    fcp: { value: string; status: string; description: string; fix: string };
  };
  speedMetrics: {
    desktop: number;
    mobile: number;
    loadTime: string;
    pageSize: string;
    requests: number;
  };
  issues: {
    critical: { title: string; description: string; impact: string; fix: string; plugin?: string }[];
    warnings: { title: string; description: string; impact: string; fix: string; plugin?: string }[];
    passed: { title: string; description: string }[];
  };
  seoChecks: {
    title: string;
    status: string;
    current: string;
    issue: string;
    fix: string;
  }[];
  wordpressSpecific: {
    phpVersion: string;
    wordpressVersion: string;
    pluginBloat: string;
    caching: string;
    imageOptimization: string;
    cdnDetected: string;
    gzipEnabled: string;
    httpsEnabled: string;
    recommendations: { priority: string; action: string; plugin: string; impact: string }[];
  };
  topFixes: string[];
  nextActions: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
};

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AuditData | null>(null);

  async function runAudit() {
    if (!url) { setError('Please enter a WordPress site URL.'); return; }
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

    setLoading(true); setError(''); setResult(null);

    const steps = [
      'Fetching PageSpeed data...',
      'Analyzing Core Web Vitals...',
      'Checking WordPress-specific issues...',
      'Running SEO checks...',
      'Generating AI recommendations...',
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) { setLoadingStep(steps[i]); i++; }
    }, 2000);

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl }),
      });
      const data = await res.json();
      clearInterval(interval);
      if (!data.ok) throw new Error(data.error);
      setResult(data.data);
    } catch (e: unknown) {
      clearInterval(interval);
      setError(e instanceof Error ? e.message : 'Audit failed. Please check the URL and try again.');
    }
    setLoading(false);
    setLoadingStep('');
  }

  function getGradeColor(grade: string) {
    if (grade === 'A') return '#16a34a';
    if (grade === 'B') return '#65a30d';
    if (grade === 'C') return '#d97706';
    if (grade === 'D') return '#ea580c';
    return '#dc2626';
  }

  function getScoreColor(score: number) {
    if (score >= 90) return '#16a34a';
    if (score >= 70) return '#d97706';
    return '#dc2626';
  }

  function getStatusColor(status: string) {
    if (status === 'good' || status === 'pass') return '#16a34a';
    if (status === 'needs-improvement' || status === 'warn') return '#d97706';
    return '#dc2626';
  }

  function getStatusLabel(status: string) {
    if (status === 'good' || status === 'pass') return 'GOOD';
    if (status === 'needs-improvement' || status === 'warn') return 'NEEDS WORK';
    return 'POOR';
  }

  async function downloadReport() {
    if (!result) return;

    // Dynamically load jsPDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageW = 210;
    const pageH = 297;
    const margin = 16;
    const contentW = pageW - margin * 2;
    let y = 0;

    const colors = {
      navy: [30, 58, 138] as [number,number,number],
      blue: [37, 99, 235] as [number,number,number],
      green: [22, 163, 74] as [number,number,number],
      red: [220, 38, 38] as [number,number,number],
      amber: [217, 119, 6] as [number,number,number],
      gray: [107, 114, 128] as [number,number,number],
      lightgray: [243, 244, 246] as [number,number,number],
      white: [255, 255, 255] as [number,number,number],
      dark: [17, 24, 39] as [number,number,number],
    };

    function newPage() {
      doc.addPage();
      y = margin;
    }

    function checkY(needed: number) {
      if (y + needed > pageH - margin) newPage();
    }

    function scoreColor(s: number): [number,number,number] {
      return s >= 80 ? colors.green : s >= 60 ? colors.amber : colors.red;
    }

    function statusColor(s: string): [number,number,number] {
      return (s === 'good' || s === 'pass') ? colors.green : (s === 'needs-improvement' || s === 'warn') ? colors.amber : colors.red;
    }

    function wrapText(text: string, maxW: number, fontSize: number): string[] {
      doc.setFontSize(fontSize);
      return doc.splitTextToSize(text || '', maxW);
    }

    // ── COVER PAGE ──
    doc.setFillColor(...colors.navy);
    doc.rect(0, 0, pageW, pageH, 'F');

    doc.setFillColor(...colors.blue);
    doc.rect(0, 0, pageW, 80, 'F');

    doc.setTextColor(...colors.white);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('WordPress Audit Pro', margin, 30);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.text('Professional Speed & SEO Report', margin, 42);

    doc.setFontSize(10);
    doc.setTextColor(180, 200, 255);
    doc.text(`${result.url}`, margin, 56);
    doc.text(`Audit Date: ${result.auditDate}`, margin, 64);

    // Grade box
    doc.setFillColor(...colors.white);
    doc.roundedRect(pageW - 60, 20, 44, 44, 4, 4, 'F');
    doc.setTextColor(...scoreColor(result.overallScore));
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text(result.grade, pageW - 42, 42, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(...colors.gray);
    doc.text(`${result.overallScore}/100`, pageW - 42, 54, { align: 'center' });

    // Scores grid on cover
    const scores = [
      { label: 'Performance', val: result.performanceScore },
      { label: 'SEO', val: result.seoScore },
      { label: 'Mobile', val: result.mobileScore },
      { label: 'Security', val: result.securityScore },
    ];
    let sx = margin;
    scores.forEach(s => {
      doc.setFillColor(255,255,255,0.1);
      doc.setDrawColor(255,255,255,0.2);
      doc.roundedRect(sx, 100, 40, 28, 3, 3, 'S');
      doc.setTextColor(...scoreColor(s.val));
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(String(s.val), sx + 20, 114, { align: 'center' });
      doc.setFontSize(7);
      doc.setTextColor(180, 200, 255);
      doc.text(s.label.toUpperCase(), sx + 20, 122, { align: 'center' });
      sx += 46;
    });

    // Summary box
    doc.setFillColor(20, 40, 80);
    doc.roundedRect(margin, 140, contentW, 60, 4, 4, 'F');
    doc.setTextColor(180, 200, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('EXECUTIVE SUMMARY', margin + 8, 152);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.white);
    doc.setFontSize(9);
    const sumLines = wrapText(result.summary || '', contentW - 16, 9);
    sumLines.slice(0, 5).forEach((line, i) => {
      doc.text(line, margin + 8, 160 + i * 6);
    });

    // Footer
    doc.setTextColor(100, 130, 180);
    doc.setFontSize(8);
    doc.text('Confidential — Prepared exclusively for: ' + result.url, margin, pageH - 10);

    // ── PAGE 2 — CORE WEB VITALS ──
    newPage();
    doc.setFillColor(...colors.navy);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(...colors.white);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CORE WEB VITALS', margin, 11);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text("Google's official ranking signals", pageW - margin, 11, { align: 'right' });
    y = 24;

    const vitals = [
      { key: 'LCP', data: result.coreWebVitals?.lcp },
      { key: 'FID/INP', data: result.coreWebVitals?.fid },
      { key: 'CLS', data: result.coreWebVitals?.cls },
      { key: 'TTFB', data: result.coreWebVitals?.ttfb },
      { key: 'FCP', data: result.coreWebVitals?.fcp },
    ];

    vitals.forEach(v => {
      if (!v.data) return;
      const col = statusColor(v.data.status);
      checkY(36);
      doc.setFillColor(...colors.lightgray);
      doc.roundedRect(margin, y, contentW, 32, 3, 3, 'F');
      doc.setFillColor(...col);
      doc.rect(margin, y, 3, 32, 'F');
      doc.setTextColor(...colors.dark);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(v.key, margin + 8, y + 9);
      doc.setTextColor(...col);
      doc.setFontSize(12);
      doc.text(v.data.value || 'N/A', pageW - margin - 2, y + 9, { align: 'right' });
      doc.setTextColor(...colors.gray);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      const descLines = wrapText(v.data.description || '', contentW - 16, 7.5);
      descLines.slice(0,1).forEach((l, i) => doc.text(l, margin + 8, y + 17 + i * 5));
      doc.setTextColor(...colors.blue);
      const fixLines = wrapText('Fix: ' + (v.data.fix || ''), contentW - 16, 7.5);
      fixLines.slice(0,1).forEach((l, i) => doc.text(l, margin + 8, y + 26 + i * 5));
      y += 36;
    });

    // ── PAGE 3 — ISSUES ──
    newPage();
    doc.setFillColor(...colors.navy);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(...colors.white);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('ISSUES & RECOMMENDATIONS', margin, 11);
    y = 24;

    // Critical
    if (result.issues?.critical?.length > 0) {
      doc.setFillColor(...colors.red);
      doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
      doc.setTextColor(...colors.white);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`CRITICAL ISSUES (${result.issues.critical.length})`, margin + 4, y + 7);
      y += 14;

      result.issues.critical.forEach((issue, idx) => {
        const lines = wrapText(issue.fix || '', contentW - 60, 8);
        const boxH = Math.max(28, 14 + lines.length * 5);
        checkY(boxH + 4);
        doc.setFillColor(255, 240, 240);
        doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
        doc.setFillColor(...colors.red);
        doc.rect(margin, y, 3, boxH, 'F');
        doc.setTextColor(...colors.dark);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx+1}. ${issue.title}`, margin + 7, y + 8);
        doc.setTextColor(...colors.red);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.text(`Impact: ${issue.impact || ''}`, margin + 7, y + 15);
        doc.setTextColor(...colors.blue);
        lines.forEach((l, i) => doc.text(l, margin + 7, y + 22 + i * 5));
        if (issue.plugin) {
          doc.setTextColor(22, 163, 74);
          doc.text(`Plugin: ${issue.plugin}`, margin + 7, y + 22 + lines.length * 5);
        }
        y += boxH + 4;
      });
      y += 4;
    }

    // Warnings
    if (result.issues?.warnings?.length > 0) {
      checkY(14);
      doc.setFillColor(...colors.amber);
      doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
      doc.setTextColor(...colors.white);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`WARNINGS (${result.issues.warnings.length})`, margin + 4, y + 7);
      y += 14;

      result.issues.warnings.forEach((issue, idx) => {
        const lines = wrapText(issue.fix || '', contentW - 60, 8);
        const boxH = Math.max(28, 14 + lines.length * 5);
        checkY(boxH + 4);
        doc.setFillColor(255, 251, 235);
        doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
        doc.setFillColor(...colors.amber);
        doc.rect(margin, y, 3, boxH, 'F');
        doc.setTextColor(...colors.dark);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx+1}. ${issue.title}`, margin + 7, y + 8);
        doc.setTextColor(...colors.amber);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.text(`Impact: ${issue.impact || ''}`, margin + 7, y + 15);
        doc.setTextColor(...colors.blue);
        lines.forEach((l, i) => doc.text(l, margin + 7, y + 22 + i * 5));
        y += boxH + 4;
      });
    }

    // Passing
    if (result.issues?.passed?.length > 0) {
      checkY(14);
      doc.setFillColor(...colors.green);
      doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
      doc.setTextColor(...colors.white);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('PASSING CHECKS', margin + 4, y + 7);
      y += 14;
      result.issues.passed.forEach(p => {
        checkY(12);
        doc.setFillColor(240, 253, 244);
        doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
        doc.setTextColor(...colors.green);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('✓', margin + 4, y + 7);
        doc.setTextColor(...colors.dark);
        doc.setFont('helvetica', 'normal');
        doc.text(`${p.title}: ${p.description}`, margin + 10, y + 7);
        y += 13;
      });
    }

    // ── PAGE 4 — SEO CHECKS ──
    newPage();
    doc.setFillColor(...colors.navy);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(...colors.white);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('SEO CHECKS', margin, 11);
    y = 24;

    result.seoChecks?.forEach(c => {
      const col = statusColor(c.status);
      const fixLines = wrapText(c.fix || '', contentW - 16, 8);
      const boxH = Math.max(28, 14 + fixLines.length * 5);
      checkY(boxH + 4);
      doc.setFillColor(...colors.lightgray);
      doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
      doc.setFillColor(...col);
      doc.rect(margin, y, 3, boxH, 'F');
      const statusLabel = c.status === 'pass' || c.status === 'good' ? 'PASS' : c.status === 'warn' || c.status === 'needs-improvement' ? 'WARN' : 'FAIL';
      doc.setFillColor(...col);
      doc.roundedRect(margin + 7, y + 4, 16, 7, 1, 1, 'F');
      doc.setTextColor(...colors.white);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text(statusLabel, margin + 15, y + 9, { align: 'center' });
      doc.setTextColor(...colors.dark);
      doc.setFontSize(9);
      doc.text(c.title, margin + 26, y + 9);
      doc.setTextColor(...colors.gray);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Current: ${c.current || ''}`, margin + 7, y + 17);
      doc.setTextColor(...colors.blue);
      fixLines.forEach((l, i) => doc.text(l, margin + 7, y + 23 + i * 5));
      y += boxH + 4;
    });

    // ── PAGE 5 — ACTION PLAN ──
    newPage();
    doc.setFillColor(...colors.navy);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(...colors.white);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('ACTION PLAN & TOP FIXES', margin, 11);
    y = 24;

    // Top fixes
    doc.setFillColor(...colors.blue);
    doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
    doc.setTextColor(...colors.white);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('TOP PRIORITY FIXES', margin + 4, y + 7);
    y += 14;

    result.topFixes?.forEach((fix, i) => {
      const lines = wrapText(fix, contentW - 20, 8.5);
      const boxH = Math.max(14, 6 + lines.length * 6);
      checkY(boxH + 3);
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
      doc.setFillColor(...colors.blue);
      doc.circle(margin + 7, y + boxH/2, 4, 'F');
      doc.setTextColor(...colors.white);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(String(i+1), margin + 7, y + boxH/2 + 2.5, { align: 'center' });
      doc.setTextColor(...colors.dark);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      lines.forEach((l, li) => doc.text(l, margin + 16, y + 7 + li * 6));
      y += boxH + 3;
    });

    y += 8;

    const actionGroups = [
      { label: 'DO TODAY', items: result.nextActions?.immediate, color: colors.red as [number,number,number], bg: [255,240,240] as [number,number,number] },
      { label: 'THIS WEEK', items: result.nextActions?.shortTerm, color: colors.amber as [number,number,number], bg: [255,251,235] as [number,number,number] },
      { label: 'THIS MONTH', items: result.nextActions?.longTerm, color: colors.green as [number,number,number], bg: [240,253,244] as [number,number,number] },
    ];

    actionGroups.forEach(g => {
      checkY(20);
      doc.setFillColor(...g.color);
      doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
      doc.setTextColor(...colors.white);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(g.label, margin + 4, y + 7);
      y += 13;
      g.items?.forEach(a => {
        const lines = wrapText(a, contentW - 16, 8);
        const boxH = Math.max(12, 5 + lines.length * 5);
        checkY(boxH + 3);
        doc.setFillColor(...g.bg);
        doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
        doc.setTextColor(...g.color);
        doc.setFontSize(10);
        doc.text('→', margin + 5, y + boxH/2 + 3);
        doc.setTextColor(...colors.dark);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        lines.forEach((l, li) => doc.text(l, margin + 13, y + 7 + li * 5));
        y += boxH + 3;
      });
      y += 5;
    });

    // Footer on all pages
    const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFillColor(...colors.navy);
      doc.rect(0, pageH - 10, pageW, 10, 'F');
      doc.setTextColor(150, 170, 220);
      doc.setFontSize(7);
      doc.text('WordPress Audit Pro', margin, pageH - 4);
      doc.text(`Page ${p} of ${totalPages}`, pageW / 2, pageH - 4, { align: 'center' });
      doc.text(result.url, pageW - margin, pageH - 4, { align: 'right' });
    }

    const filename = `wordpress-audit-${result.url.replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '-')}.pdf`;
    doc.save(filename);
  }

  const ScoreCircle = ({ score, label }: { score: number; label: string }) => (
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: `conic-gradient(${getScoreColor(score)} ${score * 3.6}deg, #e5e7eb ${score * 3.6}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', position: 'relative' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: getScoreColor(score) }}>{score}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5 }}>{label}</div>
      </div>
  );

  return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Outfit', 'Segoe UI', sans-serif", color: '#0f172a' }}>

        {/* NAV */}
        <nav style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white" strokeWidth="0"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.5, lineHeight: 1 }}>WordPress Audit Pro</div>
              <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.5 }}>PROFESSIONAL SITE ANALYSIS</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '4px 12px', borderRadius: 100 }}>Free Professional Audit</span>
          </div>
        </nav>

        {/* HERO */}
        {!result && (
            <div style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #2563eb 100%)', padding: '80px 40px', textAlign: 'center' }}>
              <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: 100, background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, marginBottom: 24 }}>
                POWERED BY GOOGLE PAGESPEED + AI ANALYSIS
              </div>
              <h1 style={{ fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 900, color: 'white', margin: '0 0 16px', letterSpacing: -1.5, lineHeight: 1.1 }}>
                Is Your WordPress Site<br />Losing You Money?
              </h1>
              <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.75)', maxWidth: 520, margin: '0 auto 40px', lineHeight: 1.7 }}>
                Get a complete professional audit with exact fixes. The same report agencies charge $200+ for. Free.
              </p>

              {/* URL INPUT */}
              <div style={{ maxWidth: 600, margin: '0 auto' }}>
                <div style={{ display: 'flex', gap: 12, background: 'white', borderRadius: 16, padding: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                  <input
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && runAudit()}
                      placeholder="Enter WordPress site URL... e.g. yoursite.com"
                      style={{ flex: 1, padding: '14px 16px', border: 'none', outline: 'none', fontSize: 15, color: '#0f172a', background: 'transparent', borderRadius: 10 }}
                  />
                  <button onClick={runAudit} disabled={loading} style={{ padding: '14px 28px', borderRadius: 10, background: loading ? '#93c5fd' : 'linear-gradient(135deg, #2563eb, #1d4ed8)', border: 'none', color: 'white', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                    {loading ? 'Auditing...' : 'Audit Now →'}
                  </button>
                </div>
                {error && <div style={{ marginTop: 12, padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.15)', color: '#fca5a5', fontSize: 13 }}>{error}</div>}
              </div>

              {/* WHAT WE CHECK */}
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 40, flexWrap: 'wrap' }}>
                {['⚡ Core Web Vitals','🔍 SEO Analysis','🔒 Security Check','📱 Mobile Score','🔌 Plugin Audit','📄 PDF Report'].map(f => (
                    <div key={f} style={{ padding: '8px 16px', borderRadius: 100, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500 }}>{f}</div>
                ))}
              </div>
            </div>
        )}

        {/* LOADING */}
        {loading && (
            <div style={{ maxWidth: 600, margin: '80px auto 120px', padding: '0 24px', textAlign: 'center' }}>
              <div style={{ background: 'white', borderRadius: 20, padding: 48, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', border: '4px solid #e5e7eb', borderTop: '4px solid #2563eb', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Auditing Your Site</div>
                <div style={{ fontSize: 14, color: '#6b7280' }}>{loadingStep || 'Initializing audit...'}</div>
                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['Fetching PageSpeed data','Analyzing Core Web Vitals','Checking WordPress specifics','Running SEO checks','Generating AI recommendations'].map((s, i) => (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#9ca3af' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb', opacity: 0.5 }} />
                        {s}
                      </div>
                  ))}
                </div>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        )}

        {/* RESULTS */}
        {result && (
            <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>

              {/* HEADER BAR */}
              <div style={{ background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', borderRadius: 16, padding: '24px 32px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5, marginBottom: 4 }}>AUDIT COMPLETE</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'white' }}>{result.url}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{result.auditDate}</div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 20px' }}>
                    <div style={{ fontSize: 42, fontWeight: 900, color: 'white', lineHeight: 1 }}>{result.grade}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>GRADE</div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 20px' }}>
                    <div style={{ fontSize: 42, fontWeight: 900, color: 'white', lineHeight: 1 }}>{result.overallScore}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>SCORE</div>
                  </div>
                </div>
              </div>

              {/* SCORE CIRCLES */}
              <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5, marginBottom: 24 }}>SCORES</div>
                <div style={{ display: 'flex', gap: 24, justifyContent: 'space-around', flexWrap: 'wrap' }}>
                  <ScoreCircle score={result.performanceScore} label="PERFORMANCE" />
                  <ScoreCircle score={result.seoScore} label="SEO" />
                  <ScoreCircle score={result.mobileScore} label="MOBILE" />
                  <ScoreCircle score={result.securityScore} label="SECURITY" />
                  <ScoreCircle score={result.speedMetrics?.desktop} label="DESKTOP" />
                  <ScoreCircle score={result.speedMetrics?.mobile} label="MOBILE SPEED" />
                </div>
                <div style={{ marginTop: 20, padding: '16px 20px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
                  {result.summary}
                </div>
              </div>

              {/* SPEED METRICS */}
              <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5, marginBottom: 20 }}>SPEED METRICS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Load Time', value: result.speedMetrics?.loadTime },
                    { label: 'Page Size', value: result.speedMetrics?.pageSize },
                    { label: 'HTTP Requests', value: String(result.speedMetrics?.requests) },
                  ].map(m => (
                      <div key={m.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '16px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#1e3a8a', marginBottom: 4 }}>{m.value}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{m.label}</div>
                      </div>
                  ))}
                </div>
              </div>

              {/* CORE WEB VITALS */}
              <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5, marginBottom: 8 }}>CORE WEB VITALS</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>Google's official ranking signals — poor scores directly impact your search position</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {result.coreWebVitals && Object.entries(result.coreWebVitals).map(([key, v]) => (
                      <div key={key} style={{ border: `1px solid ${getStatusColor(v.status)}30`, borderRadius: 12, padding: 20, borderLeft: `4px solid ${getStatusColor(v.status)}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 6, background: `${getStatusColor(v.status)}15`, color: getStatusColor(v.status) }}>{getStatusLabel(v.status)}</span>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{key.toUpperCase()}</span>
                          </div>
                          <span style={{ fontSize: 18, fontWeight: 800, color: getStatusColor(v.status) }}>{v.value}</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{v.description}</div>
                        <div style={{ fontSize: 13, color: '#1e3a8a', fontWeight: 500 }}>→ {v.fix}</div>
                      </div>
                  ))}
                </div>
              </div>

              {/* CRITICAL ISSUES */}
              {result.issues?.critical?.length > 0 && (
                  <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #fecaca', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🚨</div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', letterSpacing: 1.5 }}>CRITICAL ISSUES</div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>Fix these immediately — they are hurting your ranking and conversions</div>
                      </div>
                    </div>
                    {result.issues.critical.map((issue, i) => (
                        <div key={i} style={{ border: '1px solid #fecaca', borderRadius: 12, padding: 20, marginBottom: 12, borderLeft: '4px solid #dc2626' }}>
                          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#991b1b' }}>{issue.title}</div>
                          <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginBottom: 8 }}>Impact: {issue.impact}</div>
                          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>{issue.description}</div>
                          <div style={{ fontSize: 13, color: '#1e3a8a', fontWeight: 500, marginBottom: issue.plugin ? 6 : 0 }}>✓ Fix: {issue.fix}</div>
                          {issue.plugin && <div style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>🔌 Plugin: {issue.plugin}</div>}
                        </div>
                    ))}
                  </div>
              )}

              {/* WARNINGS */}
              {result.issues?.warnings?.length > 0 && (
                  <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #fde68a', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚠️</div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', letterSpacing: 1.5 }}>WARNINGS</div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>Fix these soon to improve performance and ranking</div>
                      </div>
                    </div>
                    {result.issues.warnings.map((issue, i) => (
                        <div key={i} style={{ border: '1px solid #fde68a', borderRadius: 12, padding: 20, marginBottom: 12, borderLeft: '4px solid #d97706' }}>
                          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#92400e' }}>{issue.title}</div>
                          <div style={{ fontSize: 12, color: '#d97706', fontWeight: 600, marginBottom: 8 }}>Impact: {issue.impact}</div>
                          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>{issue.description}</div>
                          <div style={{ fontSize: 13, color: '#1e3a8a', fontWeight: 500, marginBottom: issue.plugin ? 6 : 0 }}>✓ Fix: {issue.fix}</div>
                          {issue.plugin && <div style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>🔌 Plugin: {issue.plugin}</div>}
                        </div>
                    ))}
                  </div>
              )}

              {/* PASSING */}
              {result.issues?.passed?.length > 0 && (
                  <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #bbf7d0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', letterSpacing: 1.5, marginBottom: 16 }}>✓ PASSING CHECKS</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 }}>
                      {result.issues.passed.map((p, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                            <span style={{ color: '#16a34a', fontSize: 14 }}>✓</span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>{p.title}</div>
                              <div style={{ fontSize: 12, color: '#6b7280' }}>{p.description}</div>
                            </div>
                          </div>
                      ))}
                    </div>
                  </div>
              )}

              {/* SEO CHECKS */}
              <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5, marginBottom: 20 }}>SEO CHECKS</div>
                {result.seoChecks?.map((c, i) => (
                    <div key={i} style={{ padding: '14px 16px', borderRadius: 10, background: '#f8fafc', marginBottom: 10, borderLeft: `3px solid ${getStatusColor(c.status)}` }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${getStatusColor(c.status)}15`, color: getStatusColor(c.status) }}>{getStatusLabel(c.status)}</span>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{c.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Current: {c.current}</div>
                      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{c.issue}</div>
                      <div style={{ fontSize: 13, color: '#1e3a8a', fontWeight: 500 }}>→ {c.fix}</div>
                    </div>
                ))}
              </div>

              {/* WP SPECIFIC */}
              <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5, marginBottom: 20 }}>WORDPRESS ANALYSIS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
                  {[
                    { label: 'PHP Version', value: result.wordpressSpecific?.phpVersion },
                    { label: 'WP Version', value: result.wordpressSpecific?.wordpressVersion },
                    { label: 'Caching', value: result.wordpressSpecific?.caching },
                    { label: 'Image Optimization', value: result.wordpressSpecific?.imageOptimization },
                    { label: 'CDN', value: result.wordpressSpecific?.cdnDetected },
                    { label: 'GZIP', value: result.wordpressSpecific?.gzipEnabled },
                    { label: 'HTTPS', value: result.wordpressSpecific?.httpsEnabled },
                    { label: 'Plugin Bloat', value: result.wordpressSpecific?.pluginBloat },
                  ].map(m => (
                      <div key={m.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', border: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{m.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>{m.value}</div>
                      </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', letterSpacing: 1, marginBottom: 12 }}>PLUGIN RECOMMENDATIONS</div>
                {result.wordpressSpecific?.recommendations?.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14, padding: '14px 16px', borderRadius: 10, background: '#f8fafc', marginBottom: 8, border: '1px solid #e5e7eb', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: r.priority === 'high' ? '#fee2e2' : r.priority === 'medium' ? '#fef3c7' : '#f0fdf4', color: r.priority === 'high' ? '#dc2626' : r.priority === 'medium' ? '#d97706' : '#16a34a', whiteSpace: 'nowrap' }}>{r.priority.toUpperCase()}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{r.action}</div>
                        <div style={{ fontSize: 12, color: '#059669', marginBottom: 2 }}>🔌 {r.plugin}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{r.impact}</div>
                      </div>
                    </div>
                ))}
              </div>

              {/* TOP FIXES */}
              <div style={{ background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', borderRadius: 16, padding: 28, marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5, marginBottom: 16 }}>⚡ TOP PRIORITY FIXES</div>
                {result.topFixes?.map((fix, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', marginBottom: 8, alignItems: 'flex-start' }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', lineHeight: 1.5 }}>{fix}</span>
                    </div>
                ))}
              </div>

              {/* ACTION PLAN */}
              <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 24, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5, marginBottom: 20 }}>ACTION PLAN</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  {[
                    { label: 'DO TODAY', items: result.nextActions?.immediate, color: '#dc2626', bg: '#fee2e2' },
                    { label: 'THIS WEEK', items: result.nextActions?.shortTerm, color: '#d97706', bg: '#fef3c7' },
                    { label: 'THIS MONTH', items: result.nextActions?.longTerm, color: '#16a34a', bg: '#f0fdf4' },
                  ].map(g => (
                      <div key={g.label} style={{ background: g.bg, borderRadius: 12, padding: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: g.color, letterSpacing: 1, marginBottom: 12 }}>{g.label}</div>
                        {g.items?.map((a, i) => (
                            <div key={i} style={{ fontSize: 13, color: '#374151', marginBottom: 8, display: 'flex', gap: 8, lineHeight: 1.5 }}>
                              <span style={{ color: g.color, flexShrink: 0 }}>→</span>{a}
                            </div>
                        ))}
                      </div>
                  ))}
                </div>
              </div>

              {/* DOWNLOAD */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={downloadReport} style={{ padding: '16px 32px', borderRadius: 12, background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', border: 'none', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  ↓ Download Full Report
                </button>
                <button onClick={() => { setResult(null); setUrl(''); }} style={{ padding: '16px 32px', borderRadius: 12, background: 'white', border: '1px solid #e5e7eb', color: '#374151', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                  ↺ Audit Another Site
                </button>
              </div>
            </div>
        )}

        {/* FOOTER */}
        {!result && (
            <div style={{ background: '#0f172a', marginTop: 0, padding: '48px 40px 32px' }}>
              <div style={{ maxWidth: 900, margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 32, marginBottom: 40 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white" strokeWidth="0"/>
                        </svg>
                      </div>
                      <span style={{ fontWeight: 800, fontSize: 16, color: 'white' }}>WordPress Audit Pro</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#64748b', maxWidth: 280, lineHeight: 1.7, margin: 0 }}>
                      Professional WordPress speed & SEO audits powered by Google PageSpeed Insights and AI analysis.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 1.5, marginBottom: 14 }}>WHAT WE CHECK</div>
                      {['Core Web Vitals', 'SEO Analysis', 'Security Check', 'Mobile Score', 'Plugin Audit'].map(item => (
                          <div key={item} style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{item}</div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 1.5, marginBottom: 14 }}>POWERED BY</div>
                      {['Google PageSpeed API', 'Gemini AI Analysis', 'Lighthouse Metrics', 'Real-time Data'].map(item => (
                          <div key={item} style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{item}</div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ fontSize: 12, color: '#475569' }}>© 2026 WordPress Audit Pro · Free Professional Site Analysis</div>
                  <div style={{ fontSize: 12, color: '#475569' }}>Built for WordPress site owners who want real results</div>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}