import { ExperienceLayout } from '../components/experience-layout'

export function PrivateBBQExperience() {
  return (
    <ExperienceLayout
      content={{
        tag: 'Private BBQ Catering',
        title: ['שף מנגליסט', 'VIP עד אליכם'],
        body: 'אנחנו מביאים את חוויית הגריל היוקרתית ביותר לווילה שלכם. שף פרטי שמגיע עם נתחי פרימיום בכשרות מהודרת, מנגל מקצועי ושפע של סלטי בוטיק – הכל נעשה טרי במקום מול העיניים שלכם.',
        bullets: [
          { icon: 'ph:fire-fill', text: 'שף פרטי וצוות שירות מקצועי' },
          { icon: 'ph:check-circle-fill', text: 'נתחי בשר מובחרים (Wagyu & Prime)' },
          { icon: 'ph:check-circle-fill', text: 'כשרות מהודרת ללא פשרות' },
        ],
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Pqb5NHS9yrn.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/tAiOfOnE1Pu.jpeg',
        galleryTitle: 'הסטנדרט שלנו',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/bq8wCPGKU11.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/EXGsZ8YfU8c.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/nsSTu1IMHv0.jpeg',
        ],
        galleryAlt: [
          'שף מנגליסט פרטי צולה נתחי בשר פרימיום בווילה בדובאי',
          'נתחי בשר כשרים מובחרים לצליה - קייטרינג BBQ פרטי',
          'שולחן ערוך לחוויית גריל VIP כשרה בדובאי',
        ],
        ctaTitle: 'בשר משובח בלב דובאי',
        ctaBody: 'מוכנים לחוויית בשרים שתשאיר את כולם פעורי פה? שלחו לנו הודעה ונתאים לכם תפריט שף מושלם.',
      }}
    />
  )
}
