import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { url } = await req.json();
        if (!url) return NextResponse.json({ ok: false, error: 'URL is required' }, { status: 400 });

        // Just fetch the HTML — fast, well within 30s
        let html = '';
        let finalUrl = url;
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditBot/1.0)' },
                signal: AbortSignal.timeout(12000),
                redirect: 'follow',
            });
            finalUrl = res.url || url;
            html = await res.text();
        } catch {
            html = '';
        }

        // Extract useful signals from HTML
        const getTag = (pattern: RegExp) => { const m = html.match(pattern); return m ? m[1]?.trim() : ''; };
        const title       = getTag(/<title[^>]*>([^<]+)<\/title>/i);
        const metaDesc    = getTag(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
            || getTag(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        const h1          = getTag(/<h1[^>]*>([^<]+)<\/h1>/i);
        const hasYoast    = /yoast|rank.?math|all.?in.?one.?seo/i.test(html);
        const hasWPRocket = /wp.?rocket|w3.?total.?cache|litespeed.?cache|wp-super-cache/i.test(html);
        const hasWPContent= html.includes('/wp-content/') || html.includes('/wp-includes/');
        const generator   = getTag(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i);
        const wpVersion   = generator?.match(/WordPress\s+([\d.]+)/i)?.[1] || 'Not detectable';
        const hasSchema   = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
        const hasSitemap  = html.includes('sitemap') || html.includes('sitemap.xml');
        const imgTags     = [...html.matchAll(/<img[^>]+>/gi)].map(m => m[0]);
        const imgsNoAlt   = imgTags.filter(t => !/alt=["'][^"']+["']/i.test(t)).length;
        const hasLazyLoad = /loading=["']lazy["']/i.test(html);
        const https       = finalUrl.startsWith('https://');
        const hasMinified = /\.min\.js|\.min\.css/i.test(html);
        const hasGzip     = false; // can't tell from HTML
        const hasCDN      = /cloudflare|cdn\.|bunnycdn|keycdn/i.test(html);

        return NextResponse.json({
            ok: true,
            data: {
                url: finalUrl,
                isWordPress: hasWPContent,
                wpVersion,
                title,
                metaDesc,
                h1,
                hasYoast,
                hasWPRocket,
                hasSchema,
                hasSitemap,
                imgsTotal: imgTags.length,
                imgsNoAlt,
                hasLazyLoad,
                https,
                hasMinified,
                hasCDN,
                hasGzip,
                generator,
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Scrape failed';
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}