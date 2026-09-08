import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { useLocale } from '../locale-context'

export function FestiveMenuLink() {
  const { locale, href } = useLocale()
  return <section className="festive-home-link"><div><p className="festive-eyebrow">{locale === 'he' ? 'שנה חדשה, שולחן חגיגי' : locale === 'fr' ? 'Une nouvelle année à partager' : 'A new year around the table'}</p><h2>{locale === 'he' ? 'תפריט חגיגי לראש השנה' : locale === 'fr' ? 'Le menu de Roch Hachana' : 'Your Rosh Hashanah feast'}</h2><p>{locale === 'he' ? 'ארוחה זוגית, ארוחה לארבעה או מארז משפחתי. החל מ־$350.' : locale === 'fr' ? 'Un dîner pour deux, pour quatre ou un coffret familial. À partir de $350.' : 'Dinner for two, a table for four or a family feast. From $350.'}</p></div><Link to={href('/rosh-hashanah')}>{locale === 'he' ? 'מרכיבים ארוחת חג' : locale === 'fr' ? 'Composer mon repas' : 'Build your holiday meal'}<Icon icon="ph:arrow-up-left-bold" className="ltr:-rotate-90" /></Link></section>
}
