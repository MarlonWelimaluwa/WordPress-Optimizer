import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { url } = await req.json();
        if (!url) return NextResponse.json({ ok: false, error: 'URL is required' }, { status: 400 });

        const base = url.replace(/\/$/, '');

        // ── 1. Fetch homepage HTML ──
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
        } catch { html = ''; }

        // ── 2. Security checks in parallel (non-blocking) ──
        const [xmlrpcRes, wpAdminRes, authorRes] = await Promise.allSettled([
            fetch(`${base}/xmlrpc.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml', 'User-Agent': 'Mozilla/5.0' },
                body: '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>',
                signal: AbortSignal.timeout(8000),
                redirect: 'follow',
            }),
            fetch(`${base}/wp-admin`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000),
                redirect: 'follow',
            }),
            fetch(`${base}/?author=1`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000),
                redirect: 'follow',
            }),
        ]);

        // xmlrpc.php exposed = 200 or 405 response
        const xmlrpcExposed = xmlrpcRes.status === 'fulfilled'
            ? [200, 405].includes(xmlrpcRes.value.status)
            : false;

        // wp-admin exposed = redirects to wp-login.php (default login URL)
        const wpAdminUrl = wpAdminRes.status === 'fulfilled' ? wpAdminRes.value.url : '';
        const defaultLoginExposed = wpAdminUrl.includes('wp-login.php') || wpAdminUrl.includes('wp-admin');

        // User enumeration = ?author=1 redirects to /author/username/
        const authorUrl = authorRes.status === 'fulfilled' ? authorRes.value.url : '';
        const userEnumExposed = authorUrl.includes('/author/') && !authorUrl.includes('?author=');
        const exposedUsername = userEnumExposed
            ? authorUrl.match(/\/author\/([^/]+)/i)?.[1] || ''
            : '';

        // ── 3. Parse HTML for WP signals ──
        const getTag = (p: RegExp) => { const m = html.match(p); return m ? m[1]?.trim() : ''; };

        const title    = getTag(/<title[^>]*>([^<]+)<\/title>/i);
        const metaDesc = getTag(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
            || getTag(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        const h1       = getTag(/<h1[^>]*>([^<]+)<\/h1>/i);
        const generator = getTag(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i);

        const hasWPContent = html.includes('/wp-content/') || html.includes('/wp-includes/');
        const hasYoast     = /yoast|rank.?math|all.?in.?one.?seo/i.test(html);
        const hasWPRocket  = /wp.?rocket|w3.?total.?cache|litespeed.?cache|wp-super-cache/i.test(html);
        const hasSchema    = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
        const hasSitemap   = html.includes('sitemap') || html.includes('sitemap.xml');
        const hasLazyLoad  = /loading=["']lazy["']/i.test(html);
        const hasMinified  = /\.min\.js|\.min\.css/i.test(html);
        const hasCDN       = /cloudflare|cdn\.|bunnycdn|keycdn/i.test(html);
        const hasWooCommerce = html.includes('/wp-content/plugins/woocommerce/');
        const https        = finalUrl.startsWith('https://');

        // Plugin detection — extract unique plugin names from /wp-content/plugins/pluginname/
        const pluginMatches = [...html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//gi)];
        const pluginNames   = [...new Set(pluginMatches.map(m => m[1]))];
        const pluginCount   = pluginNames.length;

        // Theme detection — extract theme name from /wp-content/themes/themename/
        const themeMatch = html.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//i);
        const themeName  = themeMatch ? themeMatch[1] : 'Not detectable';

        // Page builder detection
        const hasElementor   = html.includes('elementor');
        const hasDivi        = html.includes('divi') || html.includes('et-pb');
        const hasAstra       = html.includes('astra');
        const hasBeaverBuilder = html.includes('fl-builder');
        const pageBuilder    = hasElementor ? 'Elementor'
            : hasDivi      ? 'Divi'
                : hasAstra     ? 'Astra'
                    : hasBeaverBuilder ? 'Beaver Builder'
                        : 'Not detected';

        // Image counts
        const imgTags  = [...html.matchAll(/<img[^>]+>/gi)].map(m => m[0]);
        const imgsNoAlt = imgTags.filter(t => !/alt=["'][^"']+["']/i.test(t)).length;

        return NextResponse.json({
            ok: true,
            data: {
                url: finalUrl,
                isWordPress: hasWPContent,
                title,
                metaDesc,
                h1,
                generator,
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
                hasWooCommerce,
                pluginCount,
                pluginNames: pluginNames.slice(0, 20),
                themeName,
                pageBuilder,
                // Security
                xmlrpcExposed,
                defaultLoginExposed,
                userEnumExposed,
                exposedUsername,
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Scrape failed';
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}