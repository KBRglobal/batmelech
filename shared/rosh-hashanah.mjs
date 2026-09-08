// One catalog and quota calculator for the customer builder and server intake.
// Prices are USD whole units. A fish-ball portion consumes two fish units.
export const packageOptions = Object.freeze({
  couple: { price: 350, adults: 2, children: 0, salads: 1, fish: 2, mains: 1, sides: 1, challah: 2, name: { he: 'ארוחה זוגית', en: 'Dinner for two', fr: 'Dîner pour deux' } },
  four: { price: 650, adults: 4, children: 0, salads: 2, fish: 4, mains: 2, sides: 2, challah: 4, name: { he: 'ארוחה ל־4 מבוגרים', en: 'Dinner for four adults', fr: 'Dîner pour quatre adultes' } },
  family: { price: 450, adults: 2, children: 2, salads: 1, fish: 2, mains: 1, sides: 1, challah: 2, name: { he: 'מארז משפחתי', en: 'Family feast', fr: 'Coffret familial' } },
});
const item = (id, he, en, fr, units = 1) => ({ id, name: { he, en, fr }, units });
export const catalog = {
  blessings: [
    item('apple', 'תפוח ודבש', 'Apple and honey', 'Pomme et miel'), item('dates', 'תמרים', 'Dates', 'Dattes'),
    item('pomegranate', 'רימון', 'Pomegranate', 'Grenade'), item('head', 'ראש דג', 'Fish head', 'Tête de poisson'),
    item('beet', 'סלק', 'Beetroot', 'Betterave'), item('leek', 'כרישה', 'Leek', 'Poireau'),
    item('pumpkin', 'דלעת', 'Pumpkin', 'Courge'), item('beans', 'שעועית ירוקה', 'Green beans', 'Haricots verts'),
  ],
  salads: [
    item('matbucha', 'מטבוחה פיקנטית', 'Spicy matbucha', 'Matbouha relevée'),
    item('tahini', 'טחינה ביתית', 'Homemade tahini', 'Tehina maison'),
    item('carrot', 'גזר מרוקאי', 'Moroccan carrots', 'Carottes à la marocaine'),
    item('chirshi', 'צ׳ירשי', 'Chirshi pumpkin salad', 'Chirchi'),
    item('beet', 'סלק מבושל', 'Cooked beetroot', 'Betteraves cuites'),
    item('pickles', 'מסייר (חמוצים)', 'Msayer pickles', 'Msayer (légumes marinés)'),
    item('coleslaw', 'קולסלאו', 'Coleslaw', 'Coleslaw'),
    item('purple', 'כרוב סגול במיונז', 'Red cabbage with mayonnaise', 'Chou rouge à la mayonnaise'),
    item('cabbage', 'כרוב לבן קלאסי', 'Classic white cabbage', 'Chou blanc classique'),
    item('corn', 'כרוב לבן עם תירס', 'White cabbage with corn', 'Chou blanc au maïs'),
    item('potato', 'סלט תפוחי אדמה', 'Potato salad', 'Salade de pommes de terre'),
    item('egg', 'סלט ביצים', 'Egg salad', 'Salade aux œufs'),
  ],
  fish: [
    item('moroccan', 'דג ברוטב מרוקאי', 'Fish fillet in Moroccan sauce', 'Filet de poisson à la marocaine'),
    item('chraime', 'דג ברוטב חריימה', 'Fish fillet in chraime sauce', 'Filet de poisson sauce hraïmé'),
    item('balls', 'קציצות דגים ברוטב מרוקאי', 'Moroccan fish balls, portion for two', 'Boulettes de poisson à la marocaine, portion pour deux', 2),
  ],
  mains: [
    item('peas', 'קציצות בקר ברוטב אפונה וארטישוק', 'Beef meatballs with peas and artichokes', 'Boulettes de bœuf aux petits pois et artichauts'),
    item('chestnut', 'קציצות בקר בריבת בצל וערמונים', 'Beef meatballs with onion jam and chestnuts', 'Boulettes de bœuf au confit d’oignons et aux châtaignes'),
    item('tomato', 'קציצות בקר ברוטב עגבניות', 'Beef meatballs in tomato sauce', 'Boulettes de bœuf à la sauce tomate'),
    item('moroccan', 'תבשיל עוף מרוקאי עם גרגרי חומוס', 'Moroccan chicken with chickpeas', 'Poulet à la marocaine aux pois chiches'),
    item('yellow', 'טבחת עוף צהובה עם תפוחי אדמה', 'Golden chicken stew with potatoes', 'Tafina de poulet jaune aux pommes de terre'),
    item('maple', 'כרעי עוף ברוטב מייפל עם תפוחי אדמה', 'Maple chicken legs with potatoes', 'Cuisses de poulet à l’érable et pommes de terre'),
  ],
  sides: [item('white', 'אורז לבן קלאסי', 'Classic white rice', 'Riz blanc classique'), item('saffron', 'אורז זהוב עם זעפרן', 'Golden saffron rice', 'Riz doré au safran')],
  childSides: [item('rice', 'אורז', 'Rice', 'Riz'), item('red', 'פסטה אדומה', 'Pasta in tomato sauce', 'Pâtes à la sauce tomate'), item('white', 'פסטה לבנה', 'Plain pasta', 'Pâtes nature')],
  childFixed: [item('schnitzel', 'שניצלונים', 'Mini schnitzels', 'Mini schnitzels'), item('vegetable', 'ירק', 'Vegetable', 'Légume'), item('juice', 'מיץ אישי', 'Individual juice', 'Jus individuel'), item('coloring', 'דפי צביעה + צבעים', 'Coloring pages and colors', 'Coloriages et crayons')],
};
export function emptyChild() { return { rice: 0, red: 0, white: 0 }; }
const empty = (rows) => Object.fromEntries(rows.map(x => [x.id, 0]));
export function initialSelection(packageId = 'couple') {
  if (!Object.hasOwn(packageOptions, packageId)) throw new Error('Unknown festive package');
  const p = packageOptions[packageId];
  return { packageId, salads: p.salads, fish: empty(catalog.fish), mains: empty(catalog.mains), sides: empty(catalog.sides), challah: p.challah, jam: 1, children: Array.from({ length: p.children }, emptyChild) };
}
function quantity(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Quantities must be non-negative whole numbers');
  return n;
}
function count(selection, rows) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).some(key => !rows.some(x => x.id === key))) throw new Error('Unknown selection');
  return rows.reduce((sum, row) => sum + quantity(selection[row.id] ?? 0) * row.units, 0);
}
export function quote(selection) {
  if (!selection || !Object.hasOwn(packageOptions, selection.packageId)) throw new Error('Unknown festive package');
  const p = packageOptions[selection.packageId];
  const salads = quantity(selection.salads), challah = quantity(selection.challah);
  quantity(selection.jam);
  if (salads < p.salads || challah < p.challah) throw new Error('Included fixed quantities cannot be removed');
  if (!Array.isArray(selection.children) || (p.children === 0 && selection.children.length !== 0) || selection.children.length < p.children) throw new Error('Children are available only with the family package');
  const fish = count(selection.fish, catalog.fish), mains = count(selection.mains, catalog.mains), sides = count(selection.sides, catalog.sides);
  const childCounts = selection.children.map(child => count(child, catalog.childSides));
  const extras = {
    salads: Math.max(0, salads - p.salads) * 60,
    fish: Math.max(0, fish - p.fish) * 30,
    mains: Math.max(0, mains - p.mains) * 100,
    sides: Math.max(0, sides - p.sides) * 25,
    challah: Math.max(0, challah - p.challah) * 10,
    children: (selection.children.length - p.children) * 49,
    childSides: childCounts.reduce((sum, n) => sum + Math.max(0, n - 1) * 15, 0),
  };
  const total = p.price + Object.values(extras).reduce((sum, n) => sum + n, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Order total is too large');
  return { base: p.price, total, extras, counts: { fish, mains, sides }, ready: fish >= p.fish && mains >= p.mains && sides >= p.sides && childCounts.every(n => n >= 1) };
}
export function kitchenNote(s, locale = 'he') {
  const q = quote(s);
  const chosen = (values, rows) => rows.filter(x => values[x.id] > 0).map(x => `${x.name[locale]} × ${values[x.id]}`).join(', ');
  const names = rows => rows.map(x => x.name[locale]).join(', ');
  if (locale === 'fr') return [
    `Assiette de simanim × 1 : ${names(catalog.blessings)}`,
    `Coffret de 12 salades × ${s.salads} : ${names(catalog.salads)}`,
    chosen(s.fish, catalog.fish), chosen(s.mains, catalog.mains), chosen(s.sides, catalog.sides),
    `Hallot × ${s.challah}`, `Confitures maison × ${s.jam} (sans supplément)`,
    ...s.children.map((child,i) => `Enfant ${i+1} : ${names(catalog.childFixed)} ; ${chosen(child,catalog.childSides)}`),
    `Coffret $${q.base} ; suppléments $${q.total-q.base} ; total $${q.total}`,
  ].filter(Boolean).join(' | ');
  if (locale === 'en') return [
    `Blessings plate × 1: ${names(catalog.blessings)}`,
    `12-salad set × ${s.salads}: ${names(catalog.salads)}`,
    chosen(s.fish, catalog.fish), chosen(s.mains, catalog.mains), chosen(s.sides, catalog.sides),
    `Challahs × ${s.challah}`, `Homemade jam sets × ${s.jam} (no extra charge)`,
    ...s.children.map((child,i) => `Child ${i+1}: ${names(catalog.childFixed)}; ${chosen(child,catalog.childSides)}`),
    `Package $${q.base}; extras $${q.total-q.base}; total $${q.total}`,
  ].filter(Boolean).join(' | ');
  return [
    `צלחת ברכות × 1: ${names(catalog.blessings)}`,
    `מארז 12 סלטי הבית × ${s.salads}: ${names(catalog.salads)}`,
    chosen(s.fish, catalog.fish), chosen(s.mains, catalog.mains), chosen(s.sides, catalog.sides),
    `חלות × ${s.challah}`, `ריבות ביתיות × ${s.jam} (ללא תוספת תשלום)`,
    ...s.children.map((child, i) => `ילד ${i + 1}: ${names(catalog.childFixed)}; ${chosen(child, catalog.childSides)}`),
    `חבילה $${q.base}; תוספות $${q.total - q.base}; סה״כ $${q.total}`,
  ].filter(Boolean).join(' | ');
}

export function selectionNames(s) {
  quote(s);
  return [
    ...catalog.blessings, ...catalog.salads,
    ...['fish','mains','sides'].flatMap(category => catalog[category].filter(item => s[category][item.id] > 0)),
    ...(s.children.length ? catalog.childFixed : []),
    ...catalog.childSides.filter(item => s.children.some(child => child[item.id] > 0)),
  ].map(item => item.name.he).concat('חלה', ...(s.jam > 0 ? ['ריבות ביתיות'] : []));
}
export function unavailableSelections(s, out) {
  const normalize = name => name.normalize('NFKC').replace(/[׳‘’]/g, "'").replace(/[״“”]/g, '"').replace(/\s+/g,' ').trim().toLowerCase();
  const blocked = (Array.isArray(out) ? out : []).filter(x => typeof x === 'string').map(normalize).filter(Boolean);
  return selectionNames(s).filter(name => blocked.some(b => {
    const n = normalize(name);
    return n === b || (n.length >= 2 && b.length >= 2 && (n.includes(b) || b.includes(n)));
  }));
}

export function quotePackages(packages = []) {
  if (!Array.isArray(packages)) throw new Error('Invalid festive packages');
  const labels = { salads:'מארזי סלטים נוספים',fish:'דגים מעבר למכסה',mains:'עיקריות נוספות',sides:'תוספות לעיקרית',challah:'חלות נוספות',children:'ילדים נוספים',childSides:'תוספות ילדים' };
  const lines = [];
  let ready = true;
  for (const entry of packages) {
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) throw new Error('Invalid package quantity');
    const result = quote(entry.selection);
    ready = ready && result.ready;
    const name = `ראש השנה · ${packageOptions[entry.selection.packageId].name.he}`;
    lines.push({ name, quantity: entry.quantity, unitPrice: result.base, amount: result.base * entry.quantity });
    for (const [category,amount] of Object.entries(result.extras)) {
      if (amount > 0) lines.push({name:`${name} · ${labels[category]}`, quantity:entry.quantity,unitPrice:amount,amount:amount*entry.quantity});
    }
  }
  const total = lines.reduce((sum,line) => sum + line.amount, 0);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(total * 100)) throw new Error('Festive total is too large');
  return { lines, total, ready };
}
export function withFestiveNotes(notes, packages) {
  quotePackages(packages);
  const clean = String(notes || '').replace(/\n?\[ROSH_HASHANAH\][\s\S]*?\[\/ROSH_HASHANAH\]\n?/g,'').trim();
  if (packages.length === 0) return clean;
  const details = packages.map(entry => `ראש השנה · ${packageOptions[entry.selection.packageId].name.he} × ${entry.quantity}\n${kitchenNote(entry.selection)}`).join('\n\n');
  return [clean,`[ROSH_HASHANAH]\n${details}\n[/ROSH_HASHANAH]`].filter(Boolean).join('\n\n');
}
