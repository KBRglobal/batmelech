import { ExperienceLayout } from '../components/experience-layout'

export function YachtPartyExperience() {
  return (
    <ExperienceLayout
      content={{
        tag: 'Luxury Yacht Events',
        title: ['חווית יוקרה', 'על היאכטה'],
        body: 'הפלגה בלב ים היא חוויה מדהימה, אבל עם הקייטרינג שלנו היא הופכת לאירוע של פעם בחיים. אנו מציעים תפריטי דגים, סלטים טריים ומגשי אירוח יוקרתיים בכשרות מהודרת, המותאמים במיוחד לאווירת הים והשמש.',
        bullets: [
          { icon: 'ph:anchor-fill', text: 'תפריט דגים וסושי כשר ויוקרתי' },
          { icon: 'ph:check-circle-fill', text: 'שירות אישי ומלצרים על הסיפון' },
          { icon: 'ph:check-circle-fill', text: 'הגשה מעוצבת וכלים יוקרתיים' },
        ],
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/sjRUzhRX09D.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Tr7Zvl6EB0X.jpeg',
        galleryTitle: 'רגעי קסם בים',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ciDIhEK0crg.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/s3QaubcTbIN.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/OIC46tu7QUo.jpeg',
        ],
        ctaTitle: 'מפליגים בטעם שלכם',
        ctaBody: 'אנחנו כאן כדי להפוך את ההפלגה הבאה שלכם לחוויה קולינרית מושלמת. דברו איתנו להצעת מחיר.',
      }}
    />
  )
}
