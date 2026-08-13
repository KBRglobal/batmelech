import { ExperienceLayout } from '../components/experience-layout'

export function DesertSafariExperience() {
  return (
    <ExperienceLayout
      content={{
        tag: 'VIP Desert Dining',
        title: ['סעודת מדבר', 'יוקרתית VIP'],
        body: 'הקסם האמיתי של דובאי קורה תחת הכוכבים. אנו מפיקים סעודות גורמה כשרות בלב המדבר, עם אירוח מסורתי ברמה הגבוהה ביותר, שף פרטי שמבשל בשטח ושולחנות ערוכים בלב הדיונות.',
        bullets: [
          { icon: 'ph:moon-stars-fill', text: 'חוויית בישול שטח גורמה (כשר)' },
          { icon: 'ph:check-circle-fill', text: 'אירוח Majlis מפואר בלב הדיונות' },
          { icon: 'ph:check-circle-fill', text: 'אווירה קסומה מסביב למדורה' },
        ],
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/NBoBkJO5uOO.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/0z6cLGFdsyI.jpeg',
        galleryTitle: 'הקסם המדברי',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/3NjmofEbSU0.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hQfhwTbpf9J.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/fbh1mGqHGeE.jpeg',
        ],
        ctaTitle: 'סעודה בלתי נשכחת',
        ctaBody: 'מוכנים למשהו אחר לגמרי? דברו איתנו לתיאום סעודת המדבר הבאה שלכם.',
      }}
    />
  )
}
