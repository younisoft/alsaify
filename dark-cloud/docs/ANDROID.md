# DARK-CLOUD على أندرويد — التثبيت والتحديث (PWA)

> **الحالة:** التطبيق جاهز للتثبيت تقنياً (اجتاز فحص Chrome الرسمي لقابلية التثبيت بلا أخطاء)، لكنه **غير منشور بعد** على رابط HTTPS.
> النشر على بيئة التجربة (staging) يتطلب مشروع Firebase منفصلاً وصلاحيات — راجع «ما المطلوب» أدناه. لا يوجد رابط تثبيت حتى يتم النشر والتحقق فعلياً.

## التثبيت عبر Google Chrome على أندرويد
1. افتح رابط التثبيت (أو امسح رمز QR من `docs/install-qr.png`) في **Google Chrome**.
2. سجّل الدخول بحساب Google المدعو من المدير العام.
3. اضغط زر **«تثبيت التطبيق على الجهاز»** في القائمة الجانبية، أو من قائمة Chrome (⋮) اختر **«تثبيت التطبيق»** / **«إضافة إلى الشاشة الرئيسية»**.
4. أكّد **تثبيت**. تظهر أيقونة DARK-CLOUD على الشاشة الرئيسية وفي قائمة التطبيقات، ويفتح التطبيق بملء الشاشة بدون شريط المتصفح.
5. اختصارات سريعة: اضغط مطولاً على الأيقونة → لوحة التحكم، الدفعات، سند قبض، الموزعون.

## التحديث
- لا حاجة لمتجر Google Play. عند نشر إصدار جديد يكتشفه التطبيق تلقائياً (عند الفتح، وكل 30 دقيقة) ويظهر شريط **«يتوفر إصدار جديد — تحديث الآن»**.
- اضغط **تحديث الآن** فيُعاد تحميل التطبيق بالإصدار الجديد. لا يُفرض التحديث أثناء إدخال بيانات.
- رقم الإصدار يظهر أسفل كل صفحة («إصدار …») للتأكد.
- إذا تعذّر التحديث: أغلق التطبيق من قائمة التطبيقات الحديثة وافتحه مجدداً.

## الاتصال والأمان
- **البيانات المالية لا تُحفظ على الهاتف**: تُعرض مباشرة من الخادم وتُمسح من الذاكرة عند إغلاق التطبيق.
- ذاكرة التخزين (Service Worker) تحتفظ **فقط** بواجهة التطبيق العامة (الصفحات، الأيقونات، الخطوط) — ولا تعترض أي طلب إلى Firebase.
- مؤشر أعلى الشاشة: **متصل ومتزامن** / **جارٍ الحفظ…** (العملية لم تُعتبر محفوظة بعد) / **غير متصل**.
- بدون إنترنت: زر الحفظ معطّل ولا تظهر أي عملية كأنها نجحت. عند فتح التطبيق بلا اتصال تظهر شاشة واضحة، ويعود تلقائياً عند رجوع الشبكة.
- جلسة الدخول يحفظها Firebase Authentication في تخزين المتصفح الخاص بالموقع (المعيار القياسي). لإنهائها: «تسجيل الخروج». إيقاف الحساب من المدير العام يسري فوراً.

## ما تم التحقق منه (محلياً، محاكاة Pixel 7 / Chrome أندرويد)
- فحص Chrome الرسمي لقابلية التثبيت: **0 أخطاء**؛ Manifest سليم؛ Service Worker يتحكم بالصفحة.
- 21 شاشة: **بدون تمرير أفقي**، وكل عناصر اللمس ≥ 36px (الأزرار 40–44px على شاشات اللمس).
- النماذج تفتح كورقة سفلية بعرض الهاتف؛ السلوك دون اتصال؛ عدم تخزين بيانات حساسة.
- لقطات الشاشة: `docs/screenshots/android/`.

## ما المطلوب للنشر على staging (منك)
1. **مشروع Firebase منفصل للتجربة** (مثل `darkcloud-staging`) على **خطة Blaze** — لا تستخدم مشروع الإنتاج ولا مشروع AI Studio القديم.
2. في المشروع: تفعيل Authentication → Google، وإنشاء Firestore (الوضع الأصلي) و Storage.
3. صلاحية نشر واحدة من:
   - تشغيل الأمر على جهازك بعد `npx firebase login`، **أو**
   - ملف حساب خدمة (Service Account) بدور Firebase Admin لمشروع staging فقط، يُضاف كسر آمن للبيئة — لا تلصقه في المحادثة.
4. إعدادات تطبيق الويب للمشروع (Project settings → Your apps → Web) في `web/.env.staging`.
5. ثم: `STAGING_PROJECT=<id> ./scripts/deploy-staging.sh` — يرفض أي مشروع إنتاج، يختبر، يبني، ينشر، يتحقق من رابط HTTPS ويولّد رمز QR.
6. مرة واحدة: `node scripts/bootstrap-owner.mjs --project <id> --email <بريد المدير العام> --name "المهندس توهيب السيفي"`.

---
**English summary.** Installable PWA (manifest, 13 icons incl. maskable/monochrome, standalone, scope `/`, start `/?source=pwa`, shortcuts, install screenshots). Safe service worker caches only the public shell; never intercepts Firebase/Google API traffic or non-GET requests; Firestore uses memory-only cache. Verified locally on Pixel 7 emulation (Chrome installability API: 0 errors; 54/54 checks). **Not deployed**: no staging project or credentials were available in this environment; use `scripts/deploy-staging.sh` once they exist. APK not needed (PWA preferred); a Trusted Web Activity APK can be generated later from the same PWA if Play Store distribution is wanted.
