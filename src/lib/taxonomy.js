/* The reasons. Every leave, every exit, every state an agent can sit in, and
   every training a record can carry — named once, here, and read from
   everywhere else.

   This module exists because a reason typed into a text box is not data. Two
   people write "resigned - better offer" and "Resignation – better pay" and the
   attrition report shows two causes with one occurrence each, which is worse
   than no report because it looks like one. The same thing had already started
   here: leave types were declared twice, in constants.js and again inside the
   portal, with different values in each, and exit reasons were free text.

   Three rules held throughout:

     1. A code is stable, a label is not. Codes are what gets stored and
        reported on; labels are what people read and may be rewritten freely.
        Renaming "Better offer" must never orphan four years of leavers.

     2. Every entry carries the metadata that *drives behaviour*, not just a
        pretty name. Whether a leave is paid, whether it comes out of the annual
        balance, whether it needs a document — those decide what the system does
        and belong next to the name, not in a switch statement somewhere else.

     3. Arabic is a first-class label, not a translation table bolted on later.
        Payroll and the statutory filings are in Arabic and the workforce is
        Egyptian; a reason that only exists in English is a reason half the
        users cannot check.

   The day counts and quotas below reflect Egyptian practice and the articles the
   engine already implements. They are data, not law: confirm the figures with
   counsel before they drive a payslip, and change them here rather than in a
   component. */

/* ── Leave ──────────────────────────────────────────────────────────────────

   The groups separate two things that look alike and behave differently.
   "Statutory" leave is an entitlement the employee draws on and can choose to
   spend. "Directed" absence is compelled by an outside authority — a call-up, a
   summons, a health order — and the employee has no say in it. Only the first
   kind should ever be refused, and only the first kind is a balance.

   `deductsAnnual` is the field worth reading twice. Casual leave under Art. 51
   is *drawn from* the annual entitlement rather than added to it — an employee
   who takes six casual days has 15 annual days left, not 21. Treating it as a
   separate bucket is the single most common way a leave balance ends up wrong,
   and it is wrong in the employee's favour, so nobody reports it. */

/** @type {Record<string, {label: string, labelAr: string, group: string, paid: boolean, deductsAnnual: boolean, requiresEvidence: boolean, evidenceLabel?: string, maxDaysPerYear?: number, maxConsecutive?: number, minServiceMonths?: number, statute?: string, note?: string}>} */
export const LEAVE_TYPES = {
  Annual: {
    label: "Annual leave",
    labelAr: "إجازة سنوية",
    group: "Statutory",
    paid: true,
    deductsAnnual: true,
    requiresEvidence: false,
    statute: "Labour Law No. 12/2003, Art. 47",
    note: "15 days after six months, 21 after a full year, 30 after ten years or at age 50.",
  },
  Casual: {
    label: "Casual leave",
    labelAr: "إجازة عارضة",
    group: "Statutory",
    paid: true,
    // Comes out of the annual entitlement — not an extra six days.
    deductsAnnual: true,
    requiresEvidence: false,
    maxDaysPerYear: 6,
    maxConsecutive: 2,
    statute: "Labour Law No. 12/2003, Art. 51",
    note: "Unforeseen and taken at short notice. Capped at six days a year and two consecutively.",
  },
  Sick: {
    label: "Sick leave",
    labelAr: "إجازة مرضية",
    group: "Statutory",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Medical certificate",
    statute: "Labour Law No. 12/2003, Art. 54–55",
    note: "Paid through social insurance at the statutory rate. Needs a certificate from an approved authority.",
  },
  Maternity: {
    label: "Maternity leave",
    labelAr: "إجازة وضع",
    group: "Family",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Medical certificate / birth certificate",
    minServiceMonths: 10,
    statute: "Labour Law No. 12/2003, Art. 91",
    note: "Fully paid, and limited in number over the course of employment.",
  },
  Paternity: {
    label: "Paternity leave",
    labelAr: "إجازة أبوة",
    group: "Family",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Birth certificate",
    note: "Company policy rather than statute — set the entitlement in policy, not in code.",
  },
  ChildCare: {
    label: "Childcare leave",
    labelAr: "إجازة رعاية طفل",
    group: "Family",
    paid: false,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Birth certificate",
    statute: "Labour Law No. 12/2003, Art. 94",
    note: "Unpaid, for mothers in establishments above the statutory headcount threshold.",
  },
  Marriage: {
    label: "Marriage leave",
    labelAr: "إجازة زواج",
    group: "Family",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Marriage certificate",
    note: "Company policy. Usually taken once.",
  },
  Bereavement: {
    label: "Bereavement leave",
    labelAr: "إجازة وفاة",
    group: "Family",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: false,
    note: "Compassionate leave on the death of a close relative. Evidence is not demanded at the time.",
  },
  Hajj: {
    label: "Pilgrimage leave",
    labelAr: "إجازة حج",
    group: "Statutory",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Pilgrimage documents",
    minServiceMonths: 60,
    statute: "Labour Law No. 12/2003, Art. 53",
    note: "Once over the whole period of employment, after five years' service.",
  },
  Exam: {
    label: "Study / exam leave",
    labelAr: "إجازة امتحان",
    group: "Development",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Exam timetable or enrolment letter",
    statute: "Labour Law No. 12/2003, Art. 52",
    note: "For employees enrolled in recognised study.",
  },
  Military: {
    label: "Military service",
    labelAr: "الخدمة العسكرية",
    group: "Directed",
    paid: false,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Call-up papers",
    note: "Service is suspended rather than ended; the record stays open.",
  },
  CourtSummons: {
    label: "Court or official summons",
    labelAr: "استدعاء رسمي",
    group: "Directed",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Summons",
    note: "Attendance required by a court or public authority.",
  },
  Quarantine: {
    label: "Quarantine / public health",
    labelAr: "حجر صحي",
    group: "Directed",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: true,
    evidenceLabel: "Health authority instruction",
    note: "Directed absence on public-health grounds. Not sick leave and must not consume it.",
  },
  Unpaid: {
    label: "Unpaid leave",
    labelAr: "إجازة بدون أجر",
    group: "Other",
    paid: false,
    deductsAnnual: false,
    requiresEvidence: false,
    note: "Agreed in advance. Does not accrue and is deducted from pay.",
  },
  TimeOffInLieu: {
    label: "Time off in lieu",
    labelAr: "إجازة بدل راحة",
    group: "Other",
    paid: true,
    deductsAnnual: false,
    requiresEvidence: false,
    note: "Earned by approved overtime rather than drawn from any entitlement.",
  },
};

export const LEAVE_CODES = Object.keys(LEAVE_TYPES);
export const isLeaveType = (c) => Object.hasOwn(LEAVE_TYPES, c);
export const paidLeaveCodes = () => LEAVE_CODES.filter((c) => LEAVE_TYPES[c].paid);
export const evidencedLeaveCodes = () => LEAVE_CODES.filter((c) => LEAVE_TYPES[c].requiresEvidence);

/* ── Exits ──────────────────────────────────────────────────────────────────

   Split into the *type* — which is a legal characterisation and matches the
   database enum — and the *reason*, which is why it actually happened. The two
   are not the same question and collapsing them loses the one that matters:
   "Resignation" tells you nothing you can act on, "Resignation — compensation"
   tells you to look at pay bands.

   `rehireEligible` is recorded as a default rather than a verdict. It is the
   field a rehiring manager checks two years later, and a default that HR can
   override per leaver is more honest than either inventing the answer or
   leaving it blank. */

/** @type {Record<string, {label: string, labelAr: string, voluntary: boolean, noticeRequired: boolean, statute?: string, note?: string}>} */
export const EXIT_TYPES = {
  Resignation: {
    label: "Resignation",
    labelAr: "استقالة",
    voluntary: true,
    noticeRequired: true,
    note: "The employee chose to leave. Notice runs from acceptance.",
  },
  Termination: {
    label: "Termination",
    labelAr: "إنهاء خدمة",
    voluntary: false,
    noticeRequired: true,
    note: "Employer-initiated. Grounds must be documented before clearance opens.",
  },
  EndOfContract: {
    label: "End of contract",
    labelAr: "انتهاء العقد",
    voluntary: false,
    noticeRequired: false,
    note: "A fixed term reached its end. Neither party ended it early.",
  },
  Retirement: {
    label: "Retirement",
    labelAr: "تقاعد",
    voluntary: true,
    noticeRequired: true,
  },
  Abandonment: {
    label: "Abandonment of post",
    labelAr: "ترك العمل",
    voluntary: false,
    noticeRequired: false,
    statute: "Labour Law No. 12/2003, Art. 69",
    note: "Absence without leave beyond the statutory threshold, after written notice.",
  },
};

export const EXIT_TYPE_CODES = Object.keys(EXIT_TYPES);

/** @type {Record<string, {label: string, labelAr: string, exitType: string, category: string, rehireEligible: boolean, requiresEvidence?: boolean, statute?: string}>} */
export const EXIT_REASONS = {
  // ── Voluntary ──
  BetterOffer: { label: "Accepted another offer", labelAr: "قبول عرض آخر", exitType: "Resignation", category: "Market", rehireEligible: true },
  Compensation: { label: "Pay and benefits", labelAr: "الأجر والمزايا", exitType: "Resignation", category: "Market", rehireEligible: true },
  CareerGrowth: { label: "Limited career progression", labelAr: "محدودية التطور الوظيفي", exitType: "Resignation", category: "Career", rehireEligible: true },
  Management: { label: "Relationship with management", labelAr: "العلاقة مع الإدارة", exitType: "Resignation", category: "Culture", rehireEligible: true },
  WorkEnvironment: { label: "Work environment", labelAr: "بيئة العمل", exitType: "Resignation", category: "Culture", rehireEligible: true },
  ShiftPattern: { label: "Shift pattern or working hours", labelAr: "نظام الورديات", exitType: "Resignation", category: "Schedule", rehireEligible: true },
  Commute: { label: "Commute or relocation of site", labelAr: "المواصلات أو موقع العمل", exitType: "Resignation", category: "Logistics", rehireEligible: true },
  Relocation: { label: "Moving away", labelAr: "الانتقال لمحافظة أخرى", exitType: "Resignation", category: "Logistics", rehireEligible: true },
  Emigration: { label: "Travelling abroad", labelAr: "السفر للخارج", exitType: "Resignation", category: "Logistics", rehireEligible: true },
  Study: { label: "Returning to study", labelAr: "استكمال الدراسة", exitType: "Resignation", category: "Personal", rehireEligible: true },
  Health: { label: "Health reasons", labelAr: "أسباب صحية", exitType: "Resignation", category: "Personal", rehireEligible: true },
  Family: { label: "Family circumstances", labelAr: "ظروف عائلية", exitType: "Resignation", category: "Personal", rehireEligible: true },
  MilitaryCallUp: { label: "Military service", labelAr: "التجنيد", exitType: "Resignation", category: "Statutory", rehireEligible: true },
  CareerChange: { label: "Changing industry", labelAr: "تغيير المجال", exitType: "Resignation", category: "Career", rehireEligible: true },
  PersonalOther: { label: "Personal — not stated", labelAr: "أسباب شخصية", exitType: "Resignation", category: "Personal", rehireEligible: true },

  // ── Employer-initiated ──
  GrossMisconduct: { label: "Gross misconduct", labelAr: "خطأ جسيم", exitType: "Termination", category: "Conduct", rehireEligible: false, requiresEvidence: true },
  RepeatedMisconduct: { label: "Repeated misconduct — warning chain exhausted", labelAr: "تكرار المخالفات", exitType: "Termination", category: "Conduct", rehireEligible: false, requiresEvidence: true },
  Attendance: { label: "Attendance and punctuality", labelAr: "الانتظام والحضور", exitType: "Termination", category: "Conduct", rehireEligible: false, requiresEvidence: true },
  Performance: { label: "Performance — after a plan", labelAr: "الأداء بعد خطة تحسين", exitType: "Termination", category: "Performance", rehireEligible: false, requiresEvidence: true },
  ProbationNotConfirmed: { label: "Probation not confirmed", labelAr: "عدم اجتياز فترة الاختبار", exitType: "Termination", category: "Performance", rehireEligible: true, statute: "Labour Law No. 12/2003, Art. 33" },
  Fraud: { label: "Fraud or dishonesty", labelAr: "غش أو تدليس", exitType: "Termination", category: "Integrity", rehireEligible: false, requiresEvidence: true },
  DataBreach: { label: "Breach of confidentiality or client data", labelAr: "إفشاء بيانات", exitType: "Termination", category: "Integrity", rehireEligible: false, requiresEvidence: true },
  PolicyBreach: { label: "Breach of company policy", labelAr: "مخالفة سياسات الشركة", exitType: "Termination", category: "Conduct", rehireEligible: false, requiresEvidence: true },
  Redundancy: { label: "Role no longer required", labelAr: "إلغاء الوظيفة", exitType: "Termination", category: "Business", rehireEligible: true },

  // ── Neither party ended it ──
  FixedTermEnded: { label: "Fixed term reached its end", labelAr: "انتهاء مدة العقد", exitType: "EndOfContract", category: "Business", rehireEligible: true },
  ProjectEnded: { label: "Project or campaign closed", labelAr: "انتهاء المشروع", exitType: "EndOfContract", category: "Business", rehireEligible: true },
  AccountLost: { label: "Client account ended", labelAr: "انتهاء التعاقد مع العميل", exitType: "EndOfContract", category: "Business", rehireEligible: true },
  SeasonalEnd: { label: "Seasonal engagement ended", labelAr: "انتهاء التعاقد الموسمي", exitType: "EndOfContract", category: "Business", rehireEligible: true },

  // ── Retirement ──
  RetirementAge: { label: "Reached retirement age", labelAr: "بلوغ سن المعاش", exitType: "Retirement", category: "Statutory", rehireEligible: false },
  EarlyRetirement: { label: "Early retirement", labelAr: "معاش مبكر", exitType: "Retirement", category: "Statutory", rehireEligible: false },
  MedicalRetirement: { label: "Medical retirement", labelAr: "إحالة للمعاش لأسباب صحية", exitType: "Retirement", category: "Statutory", rehireEligible: false },

  // ── Abandonment ──
  NoShow: { label: "Stopped attending without notice", labelAr: "انقطاع عن العمل", exitType: "Abandonment", category: "Conduct", rehireEligible: false, requiresEvidence: true },
  UnreachableAfterNotice: { label: "Unreachable after written notice", labelAr: "عدم الرد بعد الإنذار", exitType: "Abandonment", category: "Conduct", rehireEligible: false, requiresEvidence: true },

  // ── Neither, and not a performance question ──
  Deceased: { label: "Deceased", labelAr: "الوفاة", exitType: "EndOfContract", category: "Statutory", rehireEligible: false },
};

export const EXIT_REASON_CODES = Object.keys(EXIT_REASONS);
export const isExitReason = (c) => Object.hasOwn(EXIT_REASONS, c);

/** The reasons that make sense for an exit type — what a dependent dropdown shows. */
export const exitReasonsFor = (exitType) =>
  EXIT_REASON_CODES.filter((c) => EXIT_REASONS[c].exitType === exitType);

/** Whether an exit reason represents the employee's own choice. */
export function isVoluntaryExit(reasonCode) {
  const r = EXIT_REASONS[reasonCode];
  if (!r) return null; // unknown is not "involuntary" — say so rather than guess
  return EXIT_TYPES[r.exitType]?.voluntary ?? null;
}

/* Attrition splits on this and nothing else. Regretted attrition — someone the
   business wanted to keep — is the number that should drive action, and it is
   invisible if voluntary and involuntary leavers are counted together. */
export const attritionClass = (reasonCode) => {
  const v = isVoluntaryExit(reasonCode);
  if (v === null) return "unclassified";
  return v ? "voluntary" : "involuntary";
};

/* ── Activity states (AUX) ──────────────────────────────────────────────────

   What an agent is doing while logged in. These drive occupancy and adherence,
   so `productive` and `paid` are not descriptions — they are the inputs to the
   two numbers operations is measured on.

   Prayer time is on the list deliberately. In an Egyptian contact centre it
   happens several times a shift whether or not the system has a code for it,
   and without one it lands in Break and eats an agent's break allowance. A
   state that exists in the building but not in the tool does not disappear; it
   just gets logged as something else and corrupts the something else. */

/** @type {Record<string, {label: string, labelAr: string, group: string, productive: boolean, paid: boolean, limitSeconds?: number, maxPerShift?: number, countsToAdherence: boolean}>} */
export const ACTIVITY_STATES = {
  Available: { label: "Available", labelAr: "متاح", group: "Productive", productive: true, paid: true, countsToAdherence: true },
  InCall: { label: "On a contact", labelAr: "في مكالمة", group: "Productive", productive: true, paid: true, countsToAdherence: true },
  AfterCallWork: { label: "After-contact work", labelAr: "أعمال ما بعد المكالمة", group: "Productive", productive: true, paid: true, countsToAdherence: true, limitSeconds: 300 },
  BackOffice: { label: "Back office", labelAr: "أعمال إدارية", group: "Productive", productive: true, paid: true, countsToAdherence: true },
  Outbound: { label: "Outbound / callbacks", labelAr: "مكالمات صادرة", group: "Productive", productive: true, paid: true, countsToAdherence: true },

  Break: { label: "Break", labelAr: "استراحة", group: "Rest", productive: false, paid: true, limitSeconds: 900, maxPerShift: 2, countsToAdherence: true },
  Lunch: { label: "Lunch", labelAr: "الغداء", group: "Rest", productive: false, paid: false, limitSeconds: 1800, maxPerShift: 1, countsToAdherence: true },
  Prayer: { label: "Prayer", labelAr: "صلاة", group: "Rest", productive: false, paid: true, limitSeconds: 600, countsToAdherence: true },

  Meeting: { label: "Meeting", labelAr: "اجتماع", group: "Scheduled", productive: false, paid: true, countsToAdherence: true },
  Training: { label: "Training", labelAr: "تدريب", group: "Scheduled", productive: false, paid: true, countsToAdherence: true },
  Coaching: { label: "Coaching", labelAr: "جلسة توجيه", group: "Scheduled", productive: false, paid: true, countsToAdherence: true },
  OneToOne: { label: "One-to-one", labelAr: "اجتماع فردي", group: "Scheduled", productive: false, paid: true, countsToAdherence: true },
  QualitySession: { label: "Quality session", labelAr: "جلسة جودة", group: "Scheduled", productive: false, paid: true, countsToAdherence: true },

  /* Not the agent's fault, and adherence must not say otherwise. An agent sat
     through a system outage was exactly where they were supposed to be. */
  Technical: { label: "Technical issue", labelAr: "عطل تقني", group: "Unplanned", productive: false, paid: true, countsToAdherence: false },
  SystemOutage: { label: "System outage", labelAr: "توقف الأنظمة", group: "Unplanned", productive: false, paid: true, countsToAdherence: false },
  NoWorkAvailable: { label: "No contacts available", labelAr: "لا يوجد عمل", group: "Unplanned", productive: false, paid: true, countsToAdherence: false },

  Idle: { label: "Idle", labelAr: "خامل", group: "Unplanned", productive: false, paid: true, countsToAdherence: true },
  FloorSupport: { label: "Floor support", labelAr: "دعم الفريق", group: "Scheduled", productive: false, paid: true, countsToAdherence: true },
  Personal: { label: "Personal time", labelAr: "وقت شخصي", group: "Rest", productive: false, paid: false, limitSeconds: 600, countsToAdherence: true },
};

export const ACTIVITY_CODES = Object.keys(ACTIVITY_STATES);
export const isActivity = (c) => Object.hasOwn(ACTIVITY_STATES, c);
export const productiveCodes = () => ACTIVITY_CODES.filter((c) => ACTIVITY_STATES[c].productive);
export const unpaidCodes = () => ACTIVITY_CODES.filter((c) => !ACTIVITY_STATES[c].paid);
/** States excluded from adherence because the agent was not the cause. */
export const excusedCodes = () => ACTIVITY_CODES.filter((c) => !ACTIVITY_STATES[c].countsToAdherence);

/* ── Why a session ended ────────────────────────────────────────────────────
   A system logout is not the agent's doing, and adherence must be able to tell
   the difference between someone who left properly and someone whose session
   was reaped. */
/** @type {Record<string, {label: string, labelAr: string, agentInitiated: boolean, expected: boolean}>} */
export const LOGOUT_REASONS = {
  EndOfShift: { label: "End of shift", labelAr: "نهاية الوردية", agentInitiated: true, expected: true },
  Break: { label: "Left for a break", labelAr: "استراحة", agentInitiated: true, expected: true },
  Supervisor: { label: "Logged out by supervisor", labelAr: "تسجيل خروج بواسطة المشرف", agentInitiated: false, expected: true },
  SystemSweep: { label: "Session closed by the system", labelAr: "إغلاق تلقائي للجلسة", agentInitiated: false, expected: false },
  TechnicalFailure: { label: "Technical failure", labelAr: "عطل تقني", agentInitiated: false, expected: false },
  SentHome: { label: "Sent home", labelAr: "الانصراف المبكر", agentInitiated: false, expected: true },
};
export const LOGOUT_REASON_CODES = Object.keys(LOGOUT_REASONS);

/* ── Training ───────────────────────────────────────────────────────────────
   The middle of the journey nobody models: an agent is hired, trained, moved
   between accounts, retrained, and none of it is on their record. */

/** @type {Record<string, {label: string, labelAr: string, group: string, mandatory: boolean, blocksProduction: boolean, expires?: boolean, note?: string}>} */
export const TRAINING_TYPES = {
  Induction: { label: "Induction", labelAr: "تعريف بالشركة", group: "Onboarding", mandatory: true, blocksProduction: true },
  ProductInitial: { label: "Product training — initial", labelAr: "تدريب المنتج", group: "Onboarding", mandatory: true, blocksProduction: true },
  SystemsTraining: { label: "Systems and tools", labelAr: "الأنظمة والأدوات", group: "Onboarding", mandatory: true, blocksProduction: true },
  Nesting: { label: "Nesting / on-the-job", labelAr: "التدريب العملي", group: "Onboarding", mandatory: true, blocksProduction: true },
  Certification: { label: "Client certification", labelAr: "اعتماد العميل", group: "Onboarding", mandatory: true, blocksProduction: true, expires: true },

  Refresher: { label: "Refresher", labelAr: "تدريب تنشيطي", group: "Ongoing", mandatory: false, blocksProduction: false },
  ProductUpdate: { label: "Product update", labelAr: "تحديث المنتج", group: "Ongoing", mandatory: true, blocksProduction: false },
  ProcessUpdate: { label: "Process change", labelAr: "تغيير في الإجراءات", group: "Ongoing", mandatory: true, blocksProduction: false },
  SoftSkills: { label: "Soft skills", labelAr: "المهارات الشخصية", group: "Ongoing", mandatory: false, blocksProduction: false },
  Language: { label: "Language", labelAr: "اللغة", group: "Ongoing", mandatory: false, blocksProduction: false },

  Compliance: { label: "Compliance", labelAr: "الالتزام", group: "Mandatory", mandatory: true, blocksProduction: false, expires: true },
  DataProtection: { label: "Data protection", labelAr: "حماية البيانات", group: "Mandatory", mandatory: true, blocksProduction: false, expires: true },
  HealthAndSafety: { label: "Health and safety", labelAr: "الصحة والسلامة", group: "Mandatory", mandatory: true, blocksProduction: false, expires: true },
  Security: { label: "Information security", labelAr: "أمن المعلومات", group: "Mandatory", mandatory: true, blocksProduction: false, expires: true },

  CrossSkill: { label: "Cross-skilling to another account", labelAr: "تأهيل لحساب آخر", group: "Development", mandatory: false, blocksProduction: true },
  Leadership: { label: "Leadership development", labelAr: "إعداد القيادات", group: "Development", mandatory: false, blocksProduction: false },
  RemedialCoaching: { label: "Remedial coaching", labelAr: "تدريب علاجي", group: "Development", mandatory: true, blocksProduction: false, note: "Attached to a performance plan." },
};

export const TRAINING_CODES = Object.keys(TRAINING_TYPES);
/** Training that must be complete before an agent takes live contacts. */
export const blockingTraining = () => TRAINING_CODES.filter((c) => TRAINING_TYPES[c].blocksProduction);
/** Training that lapses and has to be redone. */
export const expiringTraining = () => TRAINING_CODES.filter((c) => TRAINING_TYPES[c].expires);

/* ── Joining ────────────────────────────────────────────────────────────────
   The mirror of exit clearance. Same shape on purpose — a checklist with real
   dependencies, so the same gate can run both ends of the journey. */

export const ONBOARDING_STEPS = [
  { key: "offer-accepted", label: "Offer accepted", labelAr: "قبول العرض", owner: "HR", dependsOn: "" },
  { key: "documents", label: "Documents collected", labelAr: "استلام المستندات", owner: "HR", dependsOn: "offer-accepted" },
  { key: "contract", label: "Contract signed", labelAr: "توقيع العقد", owner: "HR", dependsOn: "documents" },
  { key: "social-insurance", label: "Social insurance registered", labelAr: "التأمينات الاجتماعية", owner: "HR", dependsOn: "documents" },
  { key: "bank-account", label: "Payroll account recorded", labelAr: "الحساب البنكي", owner: "Finance", dependsOn: "documents" },
  { key: "it-account", label: "IT accounts created", labelAr: "إنشاء الحسابات", owner: "IT", dependsOn: "contract" },
  { key: "equipment", label: "Equipment issued", labelAr: "تسليم المعدات", owner: "IT", dependsOn: "contract" },
  { key: "badge", label: "Access badge issued", labelAr: "كارت الدخول", owner: "Facilities", dependsOn: "contract" },
  { key: "induction", label: "Induction completed", labelAr: "إتمام التعريف", owner: "Training", dependsOn: "it-account" },
  { key: "product-training", label: "Product training completed", labelAr: "إتمام تدريب المنتج", owner: "Training", dependsOn: "induction" },
  { key: "buddy", label: "Buddy assigned", labelAr: "تعيين مرشد", owner: "Manager", dependsOn: "induction" },
  { key: "go-live", label: "Cleared for live contacts", labelAr: "الجاهزية للعمل", owner: "Manager", dependsOn: "*" },
];

/* ── Movement ───────────────────────────────────────────────────────────────
   Why someone's job changed. Recorded so a timeline can say "promoted"
   rather than "record updated". */

/** @type {Record<string, {label: string, labelAr: string, affectsPay: boolean, voluntary: boolean}>} */
export const MOVEMENT_REASONS = {
  Promotion: { label: "Promotion", labelAr: "ترقية", affectsPay: true, voluntary: true },
  LateralMove: { label: "Lateral move", labelAr: "نقل أفقي", affectsPay: false, voluntary: true },
  AccountTransfer: { label: "Account transfer", labelAr: "نقل بين الحسابات", affectsPay: false, voluntary: true },
  SiteTransfer: { label: "Site transfer", labelAr: "نقل بين المواقع", affectsPay: false, voluntary: true },
  ShiftChange: { label: "Shift change", labelAr: "تغيير الوردية", affectsPay: false, voluntary: true },
  Reorganisation: { label: "Reorganisation", labelAr: "إعادة هيكلة", affectsPay: false, voluntary: false },
  Demotion: { label: "Demotion", labelAr: "خفض درجة", affectsPay: true, voluntary: false },
  ManagerChange: { label: "Manager change", labelAr: "تغيير المدير", affectsPay: false, voluntary: false },
  ProbationConfirmed: { label: "Probation confirmed", labelAr: "تثبيت بعد الاختبار", affectsPay: true, voluntary: true },
  ReturnFromLeave: { label: "Return from long leave", labelAr: "العودة من إجازة", affectsPay: false, voluntary: true },
};
export const MOVEMENT_CODES = Object.keys(MOVEMENT_REASONS);

/* ── Lookup ─────────────────────────────────────────────────────────────────*/

/**
 * The human label for a code, in the requested language.
 *
 * Falls back to the English label, then to the code itself — a screen showing a
 * raw code is ugly, but a screen showing nothing is a bug report.
 *
 * @param {Record<string, {label: string, labelAr?: string}>} set
 * @param {string} code
 * @param {"en"|"ar"} lang
 */
export function labelOf(set, code, lang = "en") {
  const e = set?.[code];
  if (!e) return code ?? "";
  return (lang === "ar" ? e.labelAr : e.label) || e.label || code;
}

/**
 * A set as an options array, ready for a `<select>`.
 * @param {Record<string, {label: string, labelAr?: string, group?: string}>} set
 */
export function optionsOf(set, lang = "en") {
  return Object.keys(set).map((code) => ({
    value: code,
    label: labelOf(set, code, lang),
    group: set[code].group ?? "",
  }));
}

/** Options bucketed by their group, for a grouped dropdown. */
export function groupedOptions(set, lang = "en") {
  const out = new Map();
  for (const o of optionsOf(set, lang)) {
    if (!out.has(o.group)) out.set(o.group, []);
    out.get(o.group).push(o);
  }
  return [...out.entries()].map(([group, options]) => ({ group, options }));
}
