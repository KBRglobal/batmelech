'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Server-side SEO for the customer site: the served index.html gets the
// correct per-page, per-locale <title>, description, OpenGraph/Twitter tags,
// canonical, hreflang alternates and <html lang/dir> BEFORE any JavaScript
// runs. Crawlers that skimp on JS still see the right head; the client app
// keeps updating the same tags on navigation (its upserts match these).
// Mirrors PAGE_META in customer-site/src/App.tsx — keep the two in sync.

const SITE_ORIGIN = 'https://www.batmelech.ae';

const PAGE_META = {
  he: {
    '/': { title: 'אוכל כשר בדובאי — משלוח מארזי שבת ואוכל ביתי | מטעמי בת מלך', description: 'מטבח ביתי כשר בדובאי. מארזי שבת ותפריט יום חול, מבושל טרי ומגיע חם למלון, לוילה או ליאכטה. משלוחים בכל האמירויות.' },
    '/weekdays': { title: 'משלוח אוכל כשר בדובאי — תפריט יום חול | מטעמי בת מלך', description: 'תפריט יום חול טרי: בגטים, קובה, סלטים ומנות עיקריות. משלוח כשר בדובאי ובכל האמירויות.' },
    '/shabbat-order': { title: 'מארז שבת כשר בדובאי — הזמנה ומשלוח | מטעמי בת מלך', description: 'מארז שבת זוגי עם 12 סלטים, דגים, עיקריות וקינוח. כשר, מבושל טרי, מגיע חם עד אליכם. הזמנות עד חמישי ב-18:00.' },
    '/shabbat-extras': { title: 'מנות שבת כשרות בדובאי להזמנה בודדת | מטעמי בת מלך', description: 'מנות שבת להזמנה חופשית בלי מארז — חמין, דגים, קוגלים ועוד. כשר וטרי, מגיע עד אליכם בדובאי.' },
    '/checkout': { title: 'סיכום הזמנה | מטעמי בת מלך', description: 'סיכום ההזמנה ופרטי המשלוח.' },
    '/story': { title: 'מי אנחנו — מטבח כשר ישראלי בדובאי | מטעמי בת מלך', description: 'הסיפור של לין, המטבח הביתי הכשר שעבר מישראל לדובאי.' },
    '/legal': { title: 'תנאי שימוש | מטעמי בת מלך', description: 'תנאי ההזמנה והמשלוח, הצהרת אלרגנים ופרטי החברה. מדיניות הפרטיות בעמוד נפרד.' },
    '/accessibility': { title: 'הצהרת נגישות | מטעמי בת מלך', description: 'מה נגיש באתר, מה עוד לא, ואיך לדווח על בעיה.' },
    '/privacy': { title: 'מדיניות פרטיות | מטעמי בת מלך', description: 'איזה מידע נאסף, מי עוד רואה אותו, כמה זמן הוא נשמר ומה אפשר לבקש.' },
    '/kashrut': { title: 'כשרות — אוכל כשר בהשגחה בדובאי | מטעמי בת מלך', description: 'איך נשמרת הכשרות במטבח: מטבח ייעודי, חומרי גלם ותהליכי עבודה.' },
    '/gallery': { title: 'גלריה — אוכל כשר ואירועים בדובאי | מטעמי בת מלך', description: 'תמונות אמיתיות ממנות, ממארזי שבת ומאירועים שהפקנו בדובאי.' },
    '/how-it-works': { title: 'איך מזמינים אוכל כשר בדובאי | מטעמי בת מלך', description: 'בוחרים מהתפריט, מזמינים באתר או בוואטסאפ, אנחנו מבשלים טרי ומגיעים חם עד הדלת.' },
    '/events': { title: 'קייטרינג כשר בדובאי לאירועים פרטיים | מטעמי בת מלך', description: 'קייטרינג כשר לאירועים בדובאי: מנגל פרטי, יאכטה, וילה, סוויטה ומדבר.' },
    '/experiences/bbq': { title: 'שף על האש בדובאי — מנגל כשר לאירוע | מטעמי בת מלך', description: 'שף מנגליסט מגיע אליכם עם בשרים כשרים וסלטים טריים.' },
    '/experiences/yacht': { title: 'קייטרינג כשר ליאכטה בדובאי | מטעמי בת מלך', description: 'ארוחות ואירועים כשרים על יאכטה, עם הגשה מלאה.' },
    '/experiences/villa': { title: 'קייטרינג כשר לוילה בדובאי | מטעמי בת מלך', description: 'קייטרינג מלא למסיבות ואירועים בוילות בדובאי.' },
    '/experiences/suite': { title: 'שף פרטי בסוויטה בדובאי — ארוחה כשרה | מטעמי בת מלך', description: 'ארוחת שף פרטית בסוויטת המלון שלכם, כשרה ומוגשת.' },
    '/experiences/desert': { title: 'סעודת מדבר כשרה בדובאי | מטעמי בת מלך', description: 'סעודה כשרה בלב הדיונות, עם בישול שטח והגשה.' },
  },
  en: {
    '/': { title: 'Kosher Food Delivery in Dubai — Shabbat Meals | Bat Melech', description: 'A kosher home kitchen in Dubai. Shabbat packages and a weekday menu, cooked fresh and delivered hot to your hotel, villa or yacht. Delivery across the UAE.' },
    '/weekdays': { title: 'Kosher Food Delivery Dubai — Weekday Menu | Bat Melech', description: 'Fresh weekday dishes: baguettes, kubbeh soup, salads and mains. Kosher delivery in Dubai and across the UAE.' },
    '/shabbat-order': { title: 'Kosher Shabbat Meals in Dubai — Order & Delivery | Bat Melech', description: 'A Shabbat package for two with 12 salads, fish, mains and dessert. Kosher, cooked fresh, delivered hot. Orders close Thursday 18:00.' },
    '/shabbat-extras': { title: 'Kosher Shabbat Dishes in Dubai, A La Carte | Bat Melech', description: 'Shabbat dishes ordered on their own, no package required — cholent, fish, kugels and more, delivered across Dubai.' },
    '/checkout': { title: 'Your Order | Bat Melech Kitchen', description: 'Order summary and delivery details.' },
    '/story': { title: 'About Us — An Israeli Kosher Kitchen in Dubai | Bat Melech', description: 'Lynn\'s story: the kosher home kitchen that moved from Israel to Dubai.' },
    '/legal': { title: 'Terms of Service | Bat Melech Kitchen', description: 'Ordering and delivery terms, the allergen notice and company details. Privacy has its own page.' },
    '/accessibility': { title: 'Accessibility Statement | Bat Melech Kitchen', description: 'What this site does for accessibility, what is unfinished, and how to report a problem.' },
    '/privacy': { title: 'Privacy Policy | Bat Melech Kitchen', description: 'What we collect, who else sees it, how long we keep it and what you can ask for.' },
    '/kashrut': { title: 'Kashrut — Supervised Kosher Food in Dubai | Bat Melech', description: 'How kashrut is kept in the kitchen: a dedicated kitchen, ingredients and working practice.' },
    '/gallery': { title: 'Gallery — Kosher Food & Events in Dubai | Bat Melech', description: 'Real photos of dishes, Shabbat packages and events we catered in Dubai.' },
    '/how-it-works': { title: 'How to Order Kosher Food in Dubai | Bat Melech', description: 'Choose from the menu, order on the site or WhatsApp, we cook fresh that day and deliver hot to your door.' },
    '/events': { title: 'Kosher Catering in Dubai for Private Events | Bat Melech', description: 'Kosher catering for events in Dubai: private BBQ, yacht, villa, hotel suite and desert.' },
    '/experiences/bbq': { title: 'Private Kosher BBQ Chef in Dubai | Bat Melech', description: 'A grill chef comes to you with kosher meats and fresh salads.' },
    '/experiences/yacht': { title: 'Kosher Catering for Yachts in Dubai | Bat Melech', description: 'Kosher meals and events on a yacht, fully served.' },
    '/experiences/villa': { title: 'Kosher Catering for Villa Parties in Dubai | Bat Melech', description: 'Full kosher catering for parties and events in Dubai villas.' },
    '/experiences/suite': { title: 'Private Kosher Chef, Hotel Suite Dubai | Bat Melech', description: 'A private chef dinner in your hotel suite, kosher and served.' },
    '/experiences/desert': { title: 'Kosher Desert Feast in Dubai | Bat Melech', description: 'A kosher feast in the heart of the dunes, cooked on site and served.' },
  },
  fr: {
    '/': { title: 'Traiteur casher à Dubaï — repas de Chabbat | Bat Melech', description: 'Une cuisine familiale cachère à Dubaï. Coffrets de Chabbat et menu de semaine, cuisinés frais et livrés chauds à votre hôtel, villa ou yacht. Livraison dans tous les Émirats.' },
    '/weekdays': { title: 'Livraison de repas cachers à Dubaï — menu semaine | Bat Melech', description: 'Les plats frais de la semaine : baguettes, soupe de kubés, salades et plats. Livraison cachère à Dubaï et dans tous les Émirats.' },
    '/shabbat-order': { title: 'Coffret de Chabbat casher à Dubaï — commande | Bat Melech', description: 'Un coffret de Chabbat pour deux : 12 salades, poisson, plats et dessert. Casher, cuisiné frais, livré chaud. Commandes jusqu’au jeudi 18h00.' },
    '/shabbat-extras': { title: 'Plats de Chabbat cachers à Dubaï, à la carte | Bat Melech', description: 'Des plats de Chabbat commandés seuls, sans coffret : hamin, poissons, kugels et plus, livrés à Dubaï.' },
    '/checkout': { title: 'Votre commande | Bat Melech', description: 'Récapitulatif de commande et informations de livraison.' },
    '/story': { title: 'Qui sommes-nous — cuisine casher israélienne à Dubaï | Bat Melech', description: 'L\'histoire de Lynn : la cuisine familiale cachère passée d\'Israël à Dubaï.' },
    '/legal': { title: 'Conditions d\'utilisation | Bat Melech', description: 'Conditions de commande et de livraison, allergènes et informations légales. La confidentialité a sa propre page.' },
    '/accessibility': { title: 'Déclaration d’accessibilité | Bat Melech', description: 'Ce que ce site fait pour l’accessibilité, ce qui reste à faire, et comment signaler un problème.' },
    '/privacy': { title: 'Politique de confidentialité | Bat Melech', description: 'Ce que nous collectons, qui y a accès, la durée de conservation et vos droits.' },
    '/kashrut': { title: 'Cacherout — cuisine casher supervisée à Dubaï | Bat Melech', description: 'Comment la cacherout est tenue en cuisine : cuisine dédiée, ingrédients et méthodes.' },
    '/gallery': { title: 'Galerie — cuisine casher et événements à Dubaï | Bat Melech', description: 'De vraies photos de plats, de coffrets de Chabbat et d’événements à Dubaï.' },
    '/how-it-works': { title: 'Comment commander casher à Dubaï | Bat Melech', description: 'Choisissez au menu, commandez sur le site ou par WhatsApp, nous cuisinons frais et livrons chaud.' },
    '/events': { title: 'Traiteur casher à Dubaï pour événements privés | Bat Melech', description: 'Traiteur casher pour vos événements à Dubaï : BBQ privé, yacht, villa, suite et désert.' },
    '/experiences/bbq': { title: 'Chef BBQ casher privé à Dubaï | Bat Melech', description: 'Un chef grillades vient chez vous avec viandes cachères et salades fraîches.' },
    '/experiences/yacht': { title: 'Traiteur casher pour yacht à Dubaï | Bat Melech', description: 'Repas et événements cachers sur un yacht, entièrement servis.' },
    '/experiences/villa': { title: 'Traiteur casher pour villa à Dubaï | Bat Melech', description: 'Traiteur casher complet pour fêtes et événements en villa à Dubaï.' },
    '/experiences/suite': { title: 'Chef privé casher en suite à Dubaï | Bat Melech', description: 'Un dîner de chef privé dans votre suite, casher et servi.' },
    '/experiences/desert': { title: 'Festin casher dans le désert de Dubaï | Bat Melech', description: 'Un festin casher au cœur des dunes, cuisiné sur place et servi.' },
  },
};

const OG_LOCALES = { he: 'he_IL', en: 'en_US', fr: 'fr_FR' };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "/en/weekdays" -> { locale: 'en', page: '/weekdays' }
function parseSitePath(requestPath) {
  let path = String(requestPath || '/');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/+$/u, '') || '/';
  let locale = 'he';
  for (const candidate of ['en', 'fr']) {
    if (path === `/${candidate}`) return { locale: candidate, page: '/' };
    if (path.startsWith(`/${candidate}/`)) {
      locale = candidate;
      path = path.slice(candidate.length + 1);
      break;
    }
  }
  return { locale, page: path };
}

function localizedSiteUrl(locale, page) {
  const prefix = locale === 'he' ? '' : `/${locale}`;
  const suffix = page === '/' ? (locale === 'he' ? '/' : '') : page;
  return `${SITE_ORIGIN}${prefix}${suffix}`;
}

// --- Prerendered page bodies (scripts/prerender-site.mjs) ---
// Without these the served document is an empty <div id="root">, so a crawler
// that does not run the bundle indexes a blank page. The stored markup is the
// same page the visitor sees; React replaces it on boot.
const PRERENDER_DIR = path.join(__dirname, '..', 'site', 'prerender');
const prerenderCache = new Map();

// "/en/experiences/yacht" -> "en_experiences_yacht"; "/" -> "index"
function prerenderSlug(requestPath) {
  const trimmed = String(requestPath || '/').replace(/^\/+|\/+$/gu, '');
  if (trimmed === '') return 'index';
  if (!/^[a-z0-9/_-]+$/iu.test(trimmed)) return null;
  return trimmed.replace(/\//gu, '_');
}

function prerenderedBody(requestPath) {
  const slug = prerenderSlug(requestPath);
  if (slug === null) return '';
  if (prerenderCache.has(slug)) return prerenderCache.get(slug);
  let markup = '';
  try {
    markup = fs.readFileSync(path.join(PRERENDER_DIR, `${slug}.html`), 'utf8');
  } catch {
    markup = '';
  }
  prerenderCache.set(slug, markup);
  return markup;
}

// --- Per-page structured data ---
// The shell carries the business and the website. A menu page needs to say it
// IS a menu, and the Shabbat page needs to carry the three prices, or an
// answer engine asked "what does a Shabbat box cost in Dubai" has nothing to
// quote. Prices mirror server/domain/package-rules.js — keep them in step.
const SHABBAT_OFFERS = [
  { sku: 'couple', priceUsd: 299, he: 'מארז שבת זוגי, כולל משלוח בדובאי', en: 'Shabbat package for two, Dubai delivery included', fr: 'Coffret de Chabbat pour deux, livraison à Dubaï incluse' },
  { sku: 'addon-diner', priceUsd: 149, he: 'סועד נוסף על מארז זוגי', en: 'Extra diner added to a couple package', fr: 'Convive supplémentaire sur un coffret pour deux' },
  { sku: 'solo-diner', priceUsd: 169, he: 'סועד יחיד, כולל משלוח', en: 'Single diner, delivery included', fr: 'Convive seul, livraison incluse' },
];

const MENU_PAGE_NAMES = {
  '/weekdays': { he: 'תפריט יום חול', en: 'Weekday menu', fr: 'Menu de semaine' },
  '/shabbat-order': { he: 'מארז שבת', en: 'Shabbat package', fr: 'Coffret de Chabbat' },
  '/shabbat-extras': { he: 'מנות שבת בהזמנה חופשית', en: 'Shabbat dishes a la carte', fr: 'Plats de Chabbat à la carte' },
};

function pageStructuredData(locale, page) {
  const menuName = MENU_PAGE_NAMES[page];
  if (!menuName) return '';
  const url = localizedSiteUrl(locale, page);
  const nodes = [
    {
      '@type': 'Menu',
      '@id': `${url}#menu`,
      name: menuName[locale],
      url,
      inLanguage: locale,
      provider: { '@id': `${SITE_ORIGIN}/#business` },
    },
  ];
  if (page === '/shabbat-order') {
    nodes.push({
      '@type': 'Product',
      '@id': `${url}#package`,
      name: menuName[locale],
      brand: { '@id': `${SITE_ORIGIN}/#business` },
      offers: SHABBAT_OFFERS.map((offer) => ({
        '@type': 'Offer',
        sku: offer.sku,
        name: offer[locale],
        price: String(offer.priceUsd),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        areaServed: { '@type': 'City', name: 'Dubai' },
        url,
      })),
    });
  }
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
  // A closing tag inside JSON would end the script element early.
  return `<script type="application/ld+json">${json.replace(/</gu, '\\u003c')}</script>`;
}

// Rewrites the head of the built index.html for one request path. Unknown
// pages fall back to the home meta of the resolved locale — never an error.
function transformSiteIndexHtml(html, requestPath) {
  const { locale, page } = parseSitePath(requestPath);
  const meta = PAGE_META[locale][page] || PAGE_META[locale]['/'];
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = localizedSiteUrl(locale, page);
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  let output = html;
  output = output.replace(/<html\s+lang="[^"]*"\s+dir="[^"]*"/u, `<html lang="${locale}" dir="${dir}"`);
  output = output.replace(/<title>[^<]*<\/title>/u, `<title>${title}</title>`);
  output = output.replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/u,
    `$1${description}$2`
  );
  for (const property of ['og:title', 'twitter:title']) {
    output = output.replace(
      new RegExp(`(<meta\\s+(?:property|name)="${property}"\\s+content=")[^"]*(")`, 'u'),
      `$1${title}$2`
    );
  }
  for (const property of ['og:description', 'twitter:description']) {
    output = output.replace(
      new RegExp(`(<meta\\s+(?:property|name)="${property}"\\s+content=")[^"]*(")`, 'u'),
      `$1${description}$2`
    );
  }
  output = output.replace(
    /(<meta\s+property="og:url"\s+content=")[^"]*(")/u,
    `$1${escapeHtml(canonical)}$2`
  );
  output = output.replace(
    /(<meta\s+property="og:locale"\s+content=")[^"]*(")/u,
    `$1${OG_LOCALES[locale]}$2`
  );
  output = output.replace(
    /(<link\s+rel="canonical"\s+href=")[^"]*(")/u,
    `$1${escapeHtml(canonical)}$2`
  );

  const alternates = ['he', 'en', 'fr']
    .map((alt) => `<link rel="alternate" hreflang="${alt}" href="${escapeHtml(localizedSiteUrl(alt, page))}" />`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(localizedSiteUrl('he', page))}" />`)
    .join('\n    ');
  output = output.replace('</head>', `    ${alternates}\n  </head>`);

  const pageSchema = pageStructuredData(locale, page);
  if (pageSchema) output = output.replace('</head>', `    ${pageSchema}\n  </head>`);

  const body = prerenderedBody(requestPath);
  if (body) {
    output = output.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  }
  return output;
}

module.exports = { PAGE_META, parseSitePath, transformSiteIndexHtml, prerenderedBody };
