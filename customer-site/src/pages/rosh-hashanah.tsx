import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Link, useNavigate } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useCart } from '../cart-context'
import { useLocale } from '../locale-context'
import { useSiteStatus } from '../site-status-context'
import { catalog, emptyChild, initialSelection, kitchenNote, packageOptions, quote, selectionNames, type MenuItem, type PackageId, type Selection } from '../../../shared/rosh-hashanah.mjs'

const DRAFT_KEY = 'bm-rosh-hashanah-draft-v1'
const FEAST_IMAGE = 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/L5fzK0kRQ4N.jpeg'
function readDraft(): Selection {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as Selection
    quote(saved)
    return saved
  } catch { return initialSelection() }
}

function Counter({ name, value, min = 0, onChange, disabled = false }: { name: string; value: number; min?: number; onChange: (n: number) => void; disabled?: boolean }) {
  const { locale } = useLocale()
  return <div className="festive-counter" dir="ltr">
    <button type="button" aria-label={`${locale === 'he' ? 'הפחתה' : locale === 'fr' ? 'Retirer' : 'Remove'}: ${name}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}><Icon icon="ph:minus-bold" /></button>
    <input aria-label={name} type="number" inputMode="numeric" min={min} step="1" value={value} disabled={disabled} onChange={e => {
      const n = Number(e.target.value)
      if (Number.isSafeInteger(n) && n >= min) onChange(n)
    }} />
    <button type="button" aria-label={`${locale === 'he' ? 'הוספה' : locale === 'fr' ? 'Ajouter' : 'Add'}: ${name}`} disabled={disabled || value >= Number.MAX_SAFE_INTEGER} onClick={() => onChange(value + 1)}><Icon icon="ph:plus-bold" /></button>
  </div>
}
function Section({ number, title, children, description, total }: { number: string; title: string; description?: ReactNode; children: ReactNode; total?: ReactNode }) {
  return <section className="festive-section">
    <div className="festive-section-heading"><span className="festive-step" aria-hidden="true">{number}</span><div className="min-w-0 flex-1"><h2>{title}</h2>{description && <div className="festive-description">{description}</div>}</div>{total}</div>
    {children}
  </section>
}
function Contents({ items }: { items: MenuItem[] }) {
  const { locale } = useLocale()
  return <ul className="festive-contents">{items.map(item => <li key={item.id}><Icon icon="ph:check-bold" aria-hidden="true" /><span>{item.name[locale]}</span></li>)}</ul>
}

export function RoshHashanah() {
  const { locale, href } = useLocale()
  const { addLine } = useCart()
  const { orderingOpen, isOutOfStock } = useSiteStatus()
  const navigate = useNavigate()
  const [selection, setSelectionState] = useState<Selection>(readDraft)
  const [quantityError, setQuantityError] = useState(false)
  const setSelection = (next: Selection | ((current: Selection) => Selection)) => {
    const candidate = typeof next === 'function' ? next(selection) : next
    try {
      quote(candidate)
      setSelectionState(candidate)
      setQuantityError(false)
    } catch { setQuantityError(true) }
  }
  const p = packageOptions[selection.packageId]
  const result = quote(selection)
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(selection)) } catch { /* Cart remains usable without storage. */ } }, [selection])
  const update = (field: 'salads'|'challah'|'jam', n: number) => setSelection(s => ({ ...s, [field]: n }))
  const updateDish = (category: 'fish'|'mains'|'sides', id: string, n: number) => setSelection(s => ({ ...s, [category]: { ...s[category], [id]: n } }))
  const extra = (amount: number) => <span className={`festive-charge ${amount > 0 ? 'festive-charge-paid' : ''}`}>{amount > 0 ? <bdi>+${amount}</bdi> : locale === 'he' ? 'כלול' : locale === 'fr' ? 'Inclus' : 'Included'}</span>
  const quota = (n: number, selected: number, price: number) => <>
    {locale === 'he' ? <>{n} יחידות כלולות · נבחרו {selected}. כל יחידה מעבר למכסה: <bdi>${price}</bdi>.</> : locale === 'fr' ? <>{n} unité(s) incluse(s) · {selected} choisie(s). Au-delà : <bdi>${price}</bdi> par unité.</> : <>{n} units included · {selected} selected. Each unit above the allowance: <bdi>${price}</bdi>.</>}
  </>
  const selectedOutOfStock = selectionNames(selection).some(isOutOfStock)
  const canAdd = result.ready && orderingOpen && !selectedOutOfStock && !quantityError && result.total <= 100000
  const add = () => {
    if (!canAdd) return
    addLine({ id: `rh-${selection.packageId}-${crypto.randomUUID()}`, name: `ראש השנה · ${p.name.he}`, displayName: `${locale === 'he' ? 'ראש השנה' : locale === 'fr' ? 'Roch Hachana' : 'Rosh Hashanah'} · ${p.name[locale]}`, unitPrice: result.total, qty: 1, note: kitchenNote(selection), festive: structuredClone(selection) })
    navigate(href('/checkout'))
  }
  const dishes = (category: 'fish'|'mains'|'sides') => <div className="festive-dishes">{catalog[category].map(item => <div className="festive-dish" key={item.id}>
    <div className="min-w-0"><h3>{item.name[locale]}</h3>{category === 'fish' && <p>{item.units === 2 ? (locale === 'he' ? 'מנה זוגית · 2 יחידות מהמכסה' : locale === 'fr' ? 'Portion pour deux · 2 unités' : 'Portion for two · 2 allowance units') : (locale === 'he' ? 'פילה אחד · יחידה אחת מהמכסה' : locale === 'fr' ? 'Un filet · 1 unité' : 'One fillet · 1 allowance unit')}</p>}{isOutOfStock(item.name.he) && <p>{locale === 'he' ? 'אזל מהמלאי' : locale === 'fr' ? 'Épuisé' : 'Sold out'}</p>}</div>
    <Counter name={item.name[locale]} value={selection[category][item.id]} onChange={n => updateDish(category, item.id, n)} disabled={isOutOfStock(item.name.he) && selection[category][item.id] === 0} />
  </div>)}</div>
  return <div className="festive-page">
    <PageHero active="/rosh-hashanah" image={FEAST_IMAGE} badge={locale === 'he' ? 'מטעמי החג' : locale === 'fr' ? 'À votre table de fête' : 'For your holiday table'} title={locale === 'he' ? ['תפריט חגיגי','לראש השנה'] : locale === 'fr' ? ['Le menu de','Roch Hachana'] : ['A festive','Rosh Hashanah']} subtitle={locale === 'he' ? 'הטעמים של הבית, לשולחן של שנה חדשה. בוחרים חבילה ומרכיבים את ארוחת החג.' : locale === 'fr' ? 'Les saveurs de la maison pour accueillir la nouvelle année. Choisissez votre coffret, puis composez votre repas.' : 'The comfort of home for a sweet new year. Choose a package and make your holiday meal your own.'}>
      <a href="#festive-packages" className="festive-hero-link">{locale === 'he' ? 'לבחירת חבילה' : locale === 'fr' ? 'Choisir mon coffret' : 'Choose your package'}<Icon icon="ph:arrow-down-bold" /></a>
    </PageHero>
    <main className="festive-main" id="festive-packages">
      <div className="festive-intro">
        <div><p className="festive-eyebrow">{locale === 'he' ? 'מתחילים סביב השולחן' : locale === 'fr' ? 'Tout commence à table' : 'It starts around the table'}</p><h2>{locale === 'he' ? 'כמה נהיה בחג?' : locale === 'fr' ? 'Combien serez-vous ?' : 'Who’s coming to dinner?'}</h2></div>
        <p>{locale === 'he' ? 'המחיר כולל את מכסות החבילה. משלמים תוספת רק על מה שבוחרים מעבר להן, בכל קטגוריה בנפרד.' : locale === 'fr' ? 'Chaque coffret comprend ses quantités incluses. Seul le dépassement est facturé, catégorie par catégorie.' : 'Your package covers its included quantities. Only selections above each category’s allowance cost extra.'}</p>
      </div>
      <div className="festive-packages" role="radiogroup" aria-label={locale === 'he' ? 'חבילת חג' : locale === 'fr' ? 'Coffret de fête' : 'Holiday package'}>
        {(Object.keys(packageOptions) as PackageId[]).map(id => {
          const pack = packageOptions[id]
          return <label className={`festive-package ${selection.packageId === id ? 'is-selected' : ''}`} key={id}>
            <input type="radio" name="festive-package" value={id} checked={selection.packageId === id} onChange={() => setSelection(initialSelection(id))} />
            <div className="flex items-center justify-between gap-3"><Icon icon={id === 'family' ? 'ph:users-three' : id === 'four' ? 'ph:users-four' : 'ph:users'} className="text-3xl" /><span className="festive-radio-dot" aria-hidden="true" /></div>
            <h3>{pack.name[locale]}</h3><p>{locale === 'he' ? `${pack.adults} מבוגרים${pack.children ? ' + 2 ילדים' : ''}` : locale === 'fr' ? `${pack.adults} adultes${pack.children ? ' + 2 enfants' : ''}` : `${pack.adults} adults${pack.children ? ' + 2 children' : ''}`}</p>
            <strong className="festive-package-price"><bdi>${pack.price}</bdi></strong>
            <div className="festive-package-foot">{locale === 'he' ? <>{pack.salads} מארזי סלטים · {pack.fish} יחידות דג<br />{pack.mains} עיקריות · {pack.sides} תוספות · {pack.challah} חלות</> : locale === 'fr' ? <>{pack.salads} coffret(s) de salades · {pack.fish} unités de poisson<br />{pack.mains} plat(s) · {pack.sides} accompagnement(s) · {pack.challah} hallot</> : <>{pack.salads} salad set(s) · {pack.fish} fish units<br />{pack.mains} main(s) · {pack.sides} side(s) · {pack.challah} challahs</>}</div>
          </label>
        })}
      </div>
      <div className="festive-layout">
        <div className="festive-sections">
          <Section number="01" title={locale === 'he' ? 'פותחים בברכה' : locale === 'fr' ? 'Les simanim de la fête' : 'Start with the blessings'} description={locale === 'he' ? 'צלחת ברכות אחת מצורפת אוטומטית לכל חבילה. התכולה קבועה ואינה ניתנת לשינוי.' : locale === 'fr' ? 'Une assiette de simanim est ajoutée automatiquement à chaque coffret. Sa composition est fixe.' : 'One blessings plate is automatically included with every package. Its contents are fixed.'} total={extra(0)}><Contents items={catalog.blessings} /></Section>
          <Section number="02" title={locale === 'he' ? '12 סלטי הבית' : locale === 'fr' ? 'Les 12 salades maison' : 'All 12 house salads'} description={locale === 'he' ? `כל מארז מיועד לזוג מבוגרים וכולל את כל הסלטים, ללא החלפות. ${p.salads} מארזים כלולים; כל מארז נוסף $60.` : locale === 'fr' ? `Chaque coffret pour deux adultes contient les 12 salades, sans substitution. ${p.salads} coffret(s) inclus ; $60 par coffret supplémentaire.` : `Each set serves two adults and contains all 12 salads, with no substitutions. ${p.salads} set(s) included; $60 per extra set.`} total={extra(result.extras.salads)}>
            <Contents items={catalog.salads} /><div className="festive-quantity-row"><span>{locale === 'he' ? 'כמות מארזי סלטים' : locale === 'fr' ? 'Nombre de coffrets' : 'Number of salad sets'}</span><Counter name={locale === 'he' ? 'מארזי סלטים' : locale === 'fr' ? 'Coffrets de salades' : 'Salad sets'} value={selection.salads} min={p.salads} onChange={n => update('salads',n)} /></div>
          </Section>
          <Section number="03" title={locale === 'he' ? 'מנה ראשונה · דגים' : locale === 'fr' ? 'Le poisson en entrée' : 'The fish course'} description={<>{quota(p.fish,result.counts.fish,30)}<p>{locale === 'he' ? 'מנת קציצות דגים שווה ל־2 פילה. מנה נוספת מלאה: $60; ניצול המכסה מחושב לפי יחידות, גם בשילוב מנות.' : locale === 'fr' ? 'Une portion de boulettes vaut 2 filets. Une portion entière en supplément coûte $60. Les assortiments sont comptés en unités.' : 'One fish-ball portion equals 2 fillets. A full extra portion is $60. Mixed selections use the same unit allowance.'}</p></>} total={extra(result.extras.fish)}>{dishes('fish')}</Section>
          <Section number="04" title={locale === 'he' ? 'העיקר של הארוחה' : locale === 'fr' ? 'Les plats à partager' : 'The heart of the meal'} description={quota(p.mains,result.counts.mains,100)} total={extra(result.extras.mains)}>{dishes('mains')}</Section>
          <Section number="05" title={locale === 'he' ? 'לצד העיקרית' : locale === 'fr' ? 'Les accompagnements' : 'On the side'} description={quota(p.sides,result.counts.sides,25)} total={extra(result.extras.sides)}>{dishes('sides')}</Section>
          <Section number="06" title={locale === 'he' ? 'חלות לשולחן החג' : locale === 'fr' ? 'Les hallot de la fête' : 'Challahs for the table'} description={locale === 'he' ? `${p.challah} חלות כלולות. כל חלה נוספת $10. ילדים אינם מוסיפים חלות למכסה.` : locale === 'fr' ? `${p.challah} hallot incluses. $10 par halla supplémentaire. Les enfants n’augmentent pas la quantité incluse.` : `${p.challah} challahs included. $10 per extra challah. Children do not add to the challah allowance.`} total={extra(result.extras.challah)}><Counter name={locale === 'he' ? 'חלות' : locale === 'fr' ? 'Hallot' : 'Challahs'} value={selection.challah} min={p.challah} onChange={n => update('challah',n)} /></Section>
          <Section number="07" title={locale === 'he' ? 'מסיימים במתוק' : locale === 'fr' ? 'Une touche de douceur' : 'A sweet finish'} description={locale === 'he' ? 'ריבות ביתיות, ללא בחירת טעמים. כמה מארזים שתרצו, ללא הגבלה וללא תוספת תשלום.' : locale === 'fr' ? 'Des confitures maison, sans choix de parfum. Autant de coffrets que vous souhaitez, sans supplément.' : 'Homemade jams, with no flavor selection. As many sets as you like, with no extra charge.'} total={extra(0)}><Counter name={locale === 'he' ? 'מארזי ריבות' : locale === 'fr' ? 'Coffrets de confitures' : 'Jam sets'} value={selection.jam} onChange={n => update('jam',n)} /></Section>
          {selection.packageId === 'family' && <Section number="08" title={locale === 'he' ? 'גם לקטנים יש חג' : locale === 'fr' ? 'La fête des enfants' : 'A feast for the little ones'} description={locale === 'he' ? '2 מארזי ילדים כלולים. כל ילד נוסף $49, עם מארז מלא ותוספת אחת לבחירה. כל תוספת נוספת לאותו ילד $15.' : locale === 'fr' ? '2 coffrets enfants inclus. $49 par enfant supplémentaire, avec un coffret complet et un accompagnement au choix. Chaque accompagnement en plus pour le même enfant coûte $15.' : '2 children’s meals included. Each extra child is $49 for a complete meal and one chosen side. Each additional side for that child is $15.'} total={extra(result.extras.children+result.extras.childSides)}>
            <Contents items={catalog.childFixed} />
            <p className="festive-description mt-4">{locale === 'he' ? 'תכולת המארז קבועה. בוחרים תוספת לכל ילד בנפרד.' : locale === 'fr' ? 'Le contenu du coffret est fixe. Choisissez les accompagnements de chaque enfant séparément.' : 'The meal contents are fixed. Choose sides separately for each child.'}</p>
            {selection.children.map((child,index) => <fieldset className="festive-child" key={index}><legend>{locale === 'he' ? `ילד ${index+1}` : locale === 'fr' ? `Enfant ${index+1}` : `Child ${index+1}`}</legend>
              {catalog.childSides.map(item => <div className="festive-dish" key={item.id}><span>{item.name[locale]}</span><Counter name={`${locale === 'he' ? 'ילד' : locale === 'fr' ? 'Enfant' : 'Child'} ${index+1}: ${item.name[locale]}`} value={child[item.id]} onChange={n => setSelection(s => ({ ...s, children: s.children.map((c,i) => i === index ? { ...c, [item.id]: n } : c) }))} /></div>)}
              <div className="flex items-center justify-between gap-4 mt-4">{extra(Math.max(0,Object.values(child).reduce((sum,n)=>sum+n,0)-1)*15)}{index >= 2 && <button type="button" className="festive-text-button" onClick={() => setSelection(s => ({ ...s, children: s.children.filter((_,i)=>i!==index) }))}>{locale === 'he' ? 'הסרת ילד נוסף' : locale === 'fr' ? 'Retirer cet enfant' : 'Remove extra child'}</button>}</div>
            </fieldset>)}
            <button type="button" className="festive-secondary-button" onClick={() => setSelection(s => ({ ...s, children: [...s.children,emptyChild()] }))}><Icon icon="ph:plus-bold" />{locale === 'he' ? 'ילד נוסף · $49' : locale === 'fr' ? 'Un enfant de plus · $49' : 'Add a child · $49'}</button>
          </Section>}
        </div>
        <aside className="festive-summary" aria-label={locale === 'he' ? 'סיכום חבילת החג' : locale === 'fr' ? 'Récapitulatif du coffret' : 'Holiday package summary'}>
          <Icon icon="ph:sparkle" className="text-3xl text-[#F5A83A]" /><h2>{locale === 'he' ? 'החג שלכם, מסודר' : locale === 'fr' ? 'Votre repas de fête' : 'Your holiday, all set'}</h2><p className="text-white/80">{p.name[locale]}</p>
          <div className="festive-summary-lines"><div><span>{locale === 'he' ? 'מחיר החבילה' : locale === 'fr' ? 'Prix du coffret' : 'Package price'}</span><bdi>${result.base}</bdi></div>
            <div><span>{locale === 'he' ? 'מארזי סלטים נוספים' : locale === 'fr' ? 'Salades supplémentaires' : 'Extra salad sets'}</span><bdi>${result.extras.salads}</bdi></div>
            <div><span>{locale === 'he' ? 'דגים מעבר למכסה' : locale === 'fr' ? 'Poisson en supplément' : 'Extra fish units'}</span><bdi>${result.extras.fish}</bdi></div>
            <div><span>{locale === 'he' ? 'עיקריות נוספות' : locale === 'fr' ? 'Plats supplémentaires' : 'Extra mains'}</span><bdi>${result.extras.mains}</bdi></div>
            <div><span>{locale === 'he' ? 'תוספות לעיקרית' : locale === 'fr' ? 'Accompagnements en plus' : 'Extra sides'}</span><bdi>${result.extras.sides}</bdi></div>
            <div><span>{locale === 'he' ? 'חלות נוספות' : locale === 'fr' ? 'Hallot supplémentaires' : 'Extra challahs'}</span><bdi>${result.extras.challah}</bdi></div>
            {selection.packageId === 'family' && <><div><span>{locale === 'he' ? 'ילדים נוספים' : locale === 'fr' ? 'Enfants supplémentaires' : 'Extra children'}</span><bdi>${result.extras.children}</bdi></div><div><span>{locale === 'he' ? 'תוספות ילדים' : locale === 'fr' ? 'Accompagnements enfants en plus' : 'Extra children’s sides'}</span><bdi>${result.extras.childSides}</bdi></div></>}
          </div>
          <div className="festive-summary-total" aria-live="polite" aria-atomic="true"><span>{locale === 'he' ? 'סה״כ לחבילה' : locale === 'fr' ? 'Total du coffret' : 'Package total'}</span><strong data-testid="festive-total"><bdi>${result.total}</bdi></strong></div>
          <p className="text-sm text-white/80">{locale === 'he' ? 'בדולר ארה״ב. דמי משלוח לפי הכתובת יופיעו בסיכום ההזמנה.' : locale === 'fr' ? 'En dollars américains. Les frais de livraison selon votre adresse figurent à l’étape suivante.' : 'In US dollars. Delivery charges for your address appear at checkout.'}</p>
          <button className="festive-add-button" disabled={!canAdd} onClick={add}>{locale === 'he' ? 'הוספת החבילה להזמנה' : locale === 'fr' ? 'Ajouter le coffret à ma commande' : 'Add package to order'}<Icon icon="ph:basket-bold" /></button>
          {quantityError && <p role="alert" className="festive-validation">{locale === 'he' ? 'הכמות גדולה מדי לחישוב. הזינו כמות קטנה יותר.' : locale === 'fr' ? 'Cette quantité est trop élevée. Veuillez saisir une quantité plus petite.' : 'This quantity is too large to calculate. Please enter a smaller quantity.'}</p>}
          <p className="festive-validation" aria-live="polite">{!orderingOpen ? (locale === 'he' ? 'ההזמנות סגורות כרגע.' : locale === 'fr' ? 'Les commandes sont fermées pour le moment.' : 'Ordering is currently closed.') : selectedOutOfStock ? (locale === 'he' ? 'אחד מפריטי החבילה אזל מהמלאי.' : locale === 'fr' ? 'Un article du coffret est épuisé.' : 'A package item is sold out.') : !result.ready ? (locale === 'he' ? 'השלימו את בחירת הדגים, העיקריות והתוספות הכלולות. במארז משפחתי בחרו תוספת לכל ילד.' : locale === 'fr' ? 'Complétez le poisson, les plats et les accompagnements inclus, ainsi qu’un accompagnement par enfant.' : 'Choose your included fish, mains and sides, plus at least one side for each child.') : result.total > 100000 ? (locale === 'he' ? 'הכמות חורגת מסכום ההזמנה המותר באתר.' : locale === 'fr' ? 'Le montant dépasse la limite de commande du site.' : 'This amount exceeds the site’s order limit.') : (locale === 'he' ? 'כל הבחירות בפנים. אפשר להתקדם להזמנה.' : locale === 'fr' ? 'Votre sélection est complète. Vous pouvez passer commande.' : 'Your selection is complete. Ready to order.')}</p>
          <Link to={href('/shabbat-order')} className="festive-existing-link">{locale === 'he' ? 'לתפריט שבת הקיים' : locale === 'fr' ? 'Voir aussi le menu de Chabbat' : 'Browse the Shabbat menu'}</Link>
        </aside>
      </div>
    </main>
    <Footer />
    <div className="festive-mobile-bar"><div><small>{locale === 'he' ? 'סה״כ לחבילה' : locale === 'fr' ? 'Total du coffret' : 'Package total'}</small><strong><bdi>${result.total}</bdi></strong></div><button type="button" disabled={!canAdd} onClick={add}>{locale === 'he' ? 'הוספה להזמנה' : locale === 'fr' ? 'Ajouter' : 'Add to order'}<Icon icon="ph:basket-bold" /></button></div>
  </div>
}
