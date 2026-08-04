/* Lightweight i18n. A cookie ("locale") selects the language; server components
   read it via lib/locale.ts and set `dir`, client components receive it as a
   prop. Arabic is right-to-left. The dictionary covers the agent-facing screens
   first (login, portal); the same t(locale, key) extends to the rest. */

export const LOCALES = ["en", "ar"];
export const DEFAULT_LOCALE = "en";
const RTL = new Set(["ar"]);

export const isRtl = (l) => RTL.has(l);
export const dirFor = (l) => (RTL.has(l) ? "rtl" : "ltr");

const DICT = {
  en: {
    "common.lang": "العربية", // label of the *other* language on the toggle
    "login.signIn": "Sign in",
    "login.email": "Email",
    "login.password": "Password",
    "login.invalid": "Invalid email or password.",
    "login.throttled": "Too many sign-in attempts. Wait about 15 minutes, then try once — retrying now will keep failing whatever you type.",
    "login.showPw": "Show password",
    "login.hidePw": "Hide password",
    "login.provisioned": "Accounts are provisioned by the Super Admin. First login uses the issued default password.",
    "portal.subtitle": "Agent self-service portal",
    "portal.pendingAcks": "Pending acknowledgements",
    "portal.pendingBlurb": "HR has finalized disciplinary action on your file. Review and sign each one — this replaces the paper acknowledgement form.",
    "portal.reviewSign": "Review & sign",
    "portal.appeal": "I disagree — appeal this decision",
    "portal.appealPending": "Your appeal is under review by HR.",
    "portal.appealPrompt": "Why are you contesting this decision?",
    "portal.appealSubmit": "Submit appeal",
    "portal.downloadLetter": "Download the formal warning letter (PDF)",
  },
  ar: {
    "common.lang": "English",
    "login.signIn": "تسجيل الدخول",
    "login.email": "البريد الإلكتروني",
    "login.password": "كلمة المرور",
    "login.invalid": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "login.throttled": "محاولات تسجيل دخول كثيرة. انتظر ١٥ دقيقة تقريبًا ثم حاول مرة واحدة — إعادة المحاولة الآن ستفشل مهما أدخلت.",
    "login.showPw": "إظهار كلمة المرور",
    "login.hidePw": "إخفاء كلمة المرور",
    "login.provisioned": "يتم إنشاء الحسابات بواسطة المشرف العام. تسجيل الدخول الأول يستخدم كلمة المرور الافتراضية.",
    "portal.subtitle": "بوابة الخدمة الذاتية للموظف",
    "portal.pendingAcks": "إقرارات معلّقة",
    "portal.pendingBlurb": "قامت الموارد البشرية باعتماد إجراء تأديبي في ملفك. راجع ووقّع كل إجراء — هذا يحل محل نموذج الإقرار الورقي.",
    "portal.reviewSign": "مراجعة وتوقيع",
    "portal.appeal": "لا أوافق — الطعن على هذا القرار",
    "portal.appealPending": "طعنك قيد المراجعة لدى الموارد البشرية.",
    "portal.appealPrompt": "ما سبب اعتراضك على هذا القرار؟",
    "portal.appealSubmit": "إرسال الطعن",
    "portal.downloadLetter": "تنزيل خطاب الإنذار الرسمي (PDF)",
  },
};

export function t(locale, key) {
  const l = LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  return (DICT[l] && DICT[l][key]) || DICT.en[key] || key;
}

/**
 * The display label of a taxonomy entry, in the reader's language.
 *
 * This exists because of a gap worth naming: the taxonomies carry 139 Arabic
 * labels — every leave type, exit reason, AUX state, schedule activity and
 * journey phase — written carefully, and not one of them was ever rendered.
 * Every component reached for `.label` and got English regardless of locale.
 *
 * So the translation work was already done and simply not connected, and one
 * function connects all of it. Anything without an Arabic label falls back to
 * the English one rather than showing a key or a blank, because a screen with
 * holes in it is worse than a screen with two languages on it.
 *
 * @param {{label?: string, labelAr?: string}|null|undefined} item
 * @param {string} locale
 * @param {string} [fallback] shown when the entry is unknown entirely
 */
export function labelOf(item, locale, fallback = "") {
  if (!item) return fallback;
  if (locale === "ar" && item.labelAr) return item.labelAr;
  return item.label || fallback;
}

/**
 * Label a code against a map, which is what nearly every call site actually
 * has: a stored string like "Casual" and the taxonomy it belongs to.
 *
 * An unknown code returns itself. That is deliberate — a code the taxonomy has
 * dropped is data that still exists in rows, and showing "Casual" is honest
 * where showing "" or "unknown" hides that a record refers to something the
 * system no longer defines.
 */
export function labelFor(map, code, locale) {
  const key = String(code ?? "");
  return labelOf(map?.[key], locale, key);
}
