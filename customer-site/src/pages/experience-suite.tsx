import { ExperienceLayout } from '../components/experience-layout'

export function SuiteDiningExperience() {
  return (
    <ExperienceLayout
      content={{
        tag: 'Private Suite Dining',
        title: ['ארוחת שף', 'בסוויטה הפרטית'],
        body: 'אין דבר יוקרתי יותר מארוחת גורמה אישית המוגשת בסוויטה שלכם. אנו מביאים את חווית מסעדת המישלן אליכם, עם שף פרטי שמבשל ומגיש מנות יצירתיות, כשרות ומרשימות מול הנוף הפנורמי של דובאי.',
        bullets: [
          { icon: 'ph:sparkle-fill', text: 'חווית Fine Dining פרטית ואינטימית' },
          { icon: 'ph:check-circle-fill', text: 'שף פרטי צמוד והגשה אישית' },
          { icon: 'ph:check-circle-fill', text: 'תפריט בהתאמה אישית מלאה' },
        ],
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/7LwAsxOnwJr.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/eOOVHEcx5tD.jpeg',
        galleryTitle: 'רגעי יוקרה',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/xE7I0jbpGOl.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/SuJ0WdhHMRh.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ktV7lQAiCxj.jpeg',
        ],
        galleryAlt: [
          'ארוחת שף פרטית וכשרה בסוויטת מלון בדובאי',
          'הגשה אינטימית ורומנטית בסוויטה פרטית',
          'מנת גורמה כשרה מוגשת מול נוף דובאי',
        ],
        ctaTitle: 'אינטימיות וטעם ללא פשרות',
        ctaBody: 'הופכים כל סוויטה לחוויה קולינרית יוצאת דופן. דברו איתנו עכשיו.',
      }}
    />
  )
}
