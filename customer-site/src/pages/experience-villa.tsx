import { ExperienceLayout } from '../components/experience-layout'

export function VillaPartyExperience() {
  return (
    <ExperienceLayout
      content={{
        tag: 'Villa & Pool Catering',
        title: ['מסיבות', 'בוילה פרטית'],
        body: 'אירוע בוילה הוא תמיד מיוחד, אבל עם הקייטרינג שלנו הוא הופך לבלתי נשכח. אנו מציעים פתרונות הסעדה מלאים הכוללים בופט עשיר, עמדות שף פעילות ושירות VIP, הכל בכשרות מהודרת ובטעם של בית.',
        bullets: [
          { icon: 'ph:drop-half-bottom-fill', text: 'בופט יוקרתי ומעוצב לצד הבריכה' },
          { icon: 'ph:check-circle-fill', text: 'צוות הפקה ומלצרים מקצועי' },
          { icon: 'ph:check-circle-fill', text: 'תפריט בהתאמה אישית לכל אירוע' },
        ],
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/T9Q0QhPImYP.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hqJqmcg5k3O.jpeg',
        galleryTitle: 'האירועים שלנו',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Ows6YIFL56o.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Lh0FCekcbt7.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/twpm8363MgJ.jpeg',
        ],
        galleryAlt: [
          'בופט קייטרינג יוקרתי לצד הבריכה בוילה בדובאי',
          'מסיבת וילה עם קייטרינג כשר מלא',
          'הגשת מנות בוטיק באירוע וילה פרטי',
        ],
        ctaTitle: 'חגיגה שלא תישכח',
        ctaBody: 'הופכים כל וילה למסעדת יוקרה. צרו איתנו קשר לתיאום האירוע שלכם.',
      }}
    />
  )
}
