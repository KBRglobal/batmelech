'use strict';

// Server-side SEO for the customer site: the served index.html gets the
// correct per-page, per-locale <title>, description, OpenGraph/Twitter tags,
// canonical, hreflang alternates and <html lang/dir> BEFORE any JavaScript
// runs. Crawlers that skimp on JS still see the right head; the client app
// keeps updating the same tags on navigation (its upserts match these).
// Mirrors PAGE_META in customer-site/src/App.tsx — keep the two in sync.

const SITE_ORIGIN = 'https://www.batmelech.ae';

const PAGE_META = {
  he: {
    '/': { title: 'מטעמי בת מלך | אוכל ביתי כשר בדובאי', description: 'מטבח ביתי כשר בדובאי. תפריט יום חול ומארזי שבת יוקרתיים, מבושל טרי ומגיע חם אליכם.' },
    '/weekdays': { title: 'מטעמי יום חול | מטעמי בת מלך', description: 'תפריט יום חול טרי - בגטים, קובה, סלטים ועוד. משלוח כשר בכל רחבי דובאי.' },
    '/shabbat-order': { title: 'מטעמי שבת קודש | מטעמי בת מלך', description: 'הרכיבו מארז שבת זוגי יוקרתי - סלטים, ראשונות, עיקריות ועוד. כשר וטרי, מגיע עד אליכם.' },
    '/shabbat-extras': { title: 'חיזוקים לסופ״ש | מטעמי בת מלך', description: 'מנות שבת מלכותיות בהזמנה חופשית, בלי שום התחייבות למארז - כשר וטרי, מגיע עד אליכם.' },
    '/checkout': { title: 'סיכום הזמנה | מטעמי בת מלך', description: 'סיכום ההזמנה ופרטי המשלוח.' },
    '/story': { title: 'הסיפור שלנו | מטעמי בת מלך', description: 'הסיפור מאחורי מטעמי בת מלך - מטבח ביתי כשר בדובאי.' },
    '/legal': { title: 'תנאי שימוש ופרטיות | מטעמי בת מלך', description: 'תנאי שימוש, מדיניות פרטיות והצהרת אלרגיות.' },
    '/kashrut': { title: 'כשרות ואיכות | מטעמי בת מלך', description: 'הסטנדרטים המחמירים של הכשרות שלנו בדובאי.' },
    '/gallery': { title: 'גלריה | מטעמי בת מלך', description: 'תמונות מהאירועים והמנות של מטעמי בת מלך.' },
    '/how-it-works': { title: 'איך זה עובד | מטעמי בת מלך', description: 'מהתפריט ועד דלת המלון — בוחרים, מזמינים באתר או בוואטסאפ, אנחנו מבשלים טרי ומגיעים חם. התשלום רק במסירה.' },
    '/events': { title: 'חוויות קולינריות VIP | מטעמי בת מלך', description: 'BBQ פרטי, אירועי יאכטה, מסיבות בוילה, ארוחות בסוויטה וסעודות מדבר.' },
    '/experiences/bbq': { title: 'שף מנגליסט VIP | מטעמי בת מלך', description: 'חוויית BBQ פרטית עם שף מנגליסט בדובאי.' },
    '/experiences/yacht': { title: 'אירועים על יאכטה | מטעמי בת מלך', description: 'קייטרינג כשר יוקרתי ליאכטות בדובאי.' },
    '/experiences/villa': { title: 'מסיבות בוילה | מטעמי בת מלך', description: 'קייטרינג מלא למסיבות ואירועים בוילות בדובאי.' },
    '/experiences/suite': { title: 'ארוחות בסוויטה | מטעמי בת מלך', description: 'ארוחות שף פרטיות ואינטימיות בסוויטות מלון.' },
    '/experiences/desert': { title: 'סעודת מדבר VIP | מטעמי בת מלך', description: 'סעודת גורמה כשרה בלב מדבר דובאי.' },
  },
  en: {
    '/': { title: 'Bat Melech Kitchen | Kosher Homemade Food in Dubai', description: 'A kosher home kitchen in Dubai. Fresh weekday menu and elegant Shabbat packages, cooked fresh and delivered hot to your hotel.' },
    '/weekdays': { title: 'Weekday Menu | Bat Melech Kitchen', description: 'Fresh weekday favorites - baguettes, kubbeh soup, salads and more. Kosher delivery across Dubai.' },
    '/shabbat-order': { title: 'Shabbat Menu | Bat Melech Kitchen', description: 'Build your Shabbat package for two - salads, fish courses, mains and more. Kosher, fresh, delivered to you.' },
    '/shabbat-extras': { title: 'Shabbat Extras | Bat Melech Kitchen', description: 'Royal Shabbat dishes a la carte, no package required - kosher and fresh, delivered to you.' },
    '/checkout': { title: 'Your Order | Bat Melech Kitchen', description: 'Order summary and delivery details.' },
    '/story': { title: 'Our Story | Bat Melech Kitchen', description: 'The story behind Bat Melech - a kosher home kitchen in Dubai.' },
    '/legal': { title: 'Terms & Privacy | Bat Melech Kitchen', description: 'Terms of use, privacy policy and allergy notice.' },
    '/kashrut': { title: 'Kashrut & Quality | Bat Melech Kitchen', description: 'Our strict kashrut standards in Dubai.' },
    '/gallery': { title: 'Gallery | Bat Melech Kitchen', description: 'Photos from Bat Melech events and dishes.' },
    '/how-it-works': { title: 'How It Works | Bat Melech Kitchen', description: 'From the menu to your hotel door — browse, order on the site or WhatsApp, we cook fresh that day and deliver hot. Pay on delivery.' },
    '/events': { title: 'VIP Culinary Experiences | Bat Melech Kitchen', description: 'Private BBQ, yacht events, villa parties, in-suite dining and desert feasts.' },
    '/experiences/bbq': { title: 'Private BBQ Chef | Bat Melech Kitchen', description: 'A private kosher BBQ experience with a grill chef in Dubai.' },
    '/experiences/yacht': { title: 'Yacht Events | Bat Melech Kitchen', description: 'Luxury kosher catering for yachts in Dubai.' },
    '/experiences/villa': { title: 'Villa Parties | Bat Melech Kitchen', description: 'Full kosher catering for villa parties and events in Dubai.' },
    '/experiences/suite': { title: 'In-Suite Dining | Bat Melech Kitchen', description: 'Private, intimate chef dinners in hotel suites.' },
    '/experiences/desert': { title: 'VIP Desert Feast | Bat Melech Kitchen', description: 'A kosher gourmet feast in the heart of the Dubai desert.' },
  },
  fr: {
    '/': { title: 'Bat Melech | Cuisine casher maison à Dubaï', description: 'Une cuisine familiale casher à Dubaï. Menu de semaine et coffrets de Chabbat raffinés, cuisinés frais et livrés chauds à votre hôtel.' },
    '/weekdays': { title: 'Menu de semaine | Bat Melech', description: 'Les plats frais de la semaine - baguettes, soupe de kubés, salades et plus. Livraison casher dans tout Dubaï.' },
    '/shabbat-order': { title: 'Menu de Chabbat | Bat Melech', description: 'Composez votre coffret de Chabbat pour deux - salades, poissons, plats et plus. Casher, frais, livré chez vous.' },
    '/shabbat-extras': { title: 'Suppléments Chabbat | Bat Melech', description: 'Plats de Chabbat royaux à la carte, sans coffret obligatoire - casher et frais, livrés chez vous.' },
    '/checkout': { title: 'Votre commande | Bat Melech', description: 'Récapitulatif de commande et informations de livraison.' },
    '/story': { title: 'Notre histoire | Bat Melech', description: "L'histoire de Bat Melech - une cuisine familiale casher à Dubaï." },
    '/legal': { title: 'Conditions et confidentialité | Bat Melech', description: "Conditions d'utilisation, politique de confidentialité et allergènes." },
    '/kashrut': { title: 'Cacherout et qualité | Bat Melech', description: 'Nos standards stricts de cacherout à Dubaï.' },
    '/gallery': { title: 'Galerie | Bat Melech', description: 'Photos des événements et des plats de Bat Melech.' },
    '/how-it-works': { title: 'Comment ça marche | Bat Melech', description: 'Du menu à la porte de votre hôtel — choisissez, commandez sur le site ou par WhatsApp, nous cuisinons frais le jour même et livrons chaud. Paiement à la livraison.' },
    '/events': { title: 'Expériences culinaires VIP | Bat Melech', description: 'BBQ privé, événements sur yacht, soirées en villa, dîners en suite et festins dans le désert.' },
    '/experiences/bbq': { title: 'Chef BBQ privé | Bat Melech', description: 'Une expérience BBQ casher privée avec un chef grillades à Dubaï.' },
    '/experiences/yacht': { title: 'Événements sur yacht | Bat Melech', description: 'Traiteur casher de luxe pour yachts à Dubaï.' },
    '/experiences/villa': { title: 'Soirées en villa | Bat Melech', description: 'Traiteur casher complet pour fêtes et événements en villa à Dubaï.' },
    '/experiences/suite': { title: 'Dîner en suite | Bat Melech', description: "Dîners de chef privés et intimes en suite d'hôtel." },
    '/experiences/desert': { title: 'Festin du désert VIP | Bat Melech', description: 'Un festin gastronomique casher au cœur du désert de Dubaï.' },
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
  return `${SITE_ORIGIN}/site${prefix}${suffix}`;
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
  return output;
}

module.exports = { PAGE_META, parseSitePath, transformSiteIndexHtml };
