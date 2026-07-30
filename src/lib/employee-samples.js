/* A demo org chart.

   Like samples.js, nothing here is random filler — every record is placed to
   make one rule visible the moment the database is seeded:

     · hire dates land in each Art. 47 accrual tier (ineligible / 15 / 21 / 30)
     · one employee reaches the 30-day tier by age rather than by service — the
       easily-missed second route in Art. 47
     · one sits mid-probation with a confirmation date already computed
     · one is on a PIP, one is serving notice, one has exited, one is a live
       applicant — so the lifecycle board is populated rather than all-Active
     · agent empIds match the EG#### ids already carried by the sample cases, so
       violation history joins to the person instead of floating free

   Manager links are declared by email and resolved to ids after insert, so the
   fixture reads as an org chart rather than an insertion order. */

import { addDays, todayStr } from "./dates.js";

const T = todayStr();
const ago = (days) => addDays(T, -days);
const YEAR = 365;

/* ── Staff ────────────────────────────────────────────────────────────────
   Emails match SEED_USERS in seed-core.mjs, which is how each record gets
   linked to its login. */
const STAFF = [
  {
    empId: "EMP-1001", fullNameEn: "Fady Bekhet", fullNameAr: "فادي روماني بخيت",
    workEmail: "fady.bekhet@konecta.com", jobTitle: "Head of Workforce Compliance",
    department: "Workforce Management", grade: "M3", workSite: "Cairo GDC",
    hireDate: ago(YEAR * 6 + 40), birthDate: "1990-04-18", gender: "Male",
    stage: "Active", manager: null,
  },
  {
    empId: "EMP-1002", fullNameEn: "Abdallah Ismail", fullNameAr: "عبدالله إسماعيل",
    workEmail: "abdallah.ismail@konecta.com", jobTitle: "HR Business Partner",
    department: "People", grade: "M2", workSite: "Cairo GDC",
    // Past ten years' service: the long-service tier by the ordinary route.
    hireDate: ago(YEAR * 11 + 15), birthDate: "1986-09-02", gender: "Male",
    stage: "Active", manager: "fady.bekhet@konecta.com",
  },
  {
    empId: "EMP-1003", fullNameEn: "Mohamed Rashad", fullNameAr: "محمد رشاد",
    workEmail: "mohamed.rashad@konecta.com", jobTitle: "Operations Lead",
    department: "Operations", account: "Lenovo", lob: "EMEA", grade: "M1", workSite: "Cairo GDC",
    hireDate: ago(YEAR * 4 + 100), birthDate: "1992-01-27", gender: "Male",
    stage: "Active", manager: "fady.bekhet@konecta.com",
  },
  {
    empId: "EMP-1004", fullNameEn: "Ibrahim Kamel", fullNameAr: "إبراهيم كامل",
    workEmail: "ibrahim.kamel@konecta.com", jobTitle: "Project Manager",
    department: "Operations", account: "Hertz", lob: "North America", grade: "M1", workSite: "Cairo GDC",
    hireDate: ago(YEAR * 3 + 210), birthDate: "1989-11-05", gender: "Male",
    stage: "Active", manager: "fady.bekhet@konecta.com",
  },
  {
    empId: "EMP-1005", fullNameEn: "Salma Elhadad", fullNameAr: "سلمى الحداد",
    workEmail: "salma.elhadad@konecta.com", jobTitle: "WFM Analyst",
    department: "Workforce Management", grade: "S3", workSite: "Cairo GDC",
    hireDate: ago(YEAR * 2 + 30), birthDate: "1995-06-14", gender: "Female",
    stage: "Active", manager: "fady.bekhet@konecta.com",
  },
];

/* ── Agents ───────────────────────────────────────────────────────────────
   empIds are the EG#### ids the sample cases already reference. Managers are
   the operational leads; functional managers differ for the Lenovo cohort, so
   the two-stage leave routing has something real to route through. */
const AGENTS = [
  {
    empId: "EG0412", fullNameEn: "Nour Said", fullNameAr: "نور سعيد",
    workEmail: "nour.said@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Lenovo", lob: "EMEA", grade: "A2",
    // Two full years: the 21-day tier.
    hireDate: ago(YEAR * 2 + 60), birthDate: "1998-03-22", gender: "Female",
    stage: "Active", manager: "mohamed.rashad@konecta.com", functional: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0388", fullNameEn: "Karim Adel", fullNameAr: "كريم عادل",
    workEmail: "karim.adel@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Lenovo", lob: "EMEA", grade: "A2",
    hireDate: ago(YEAR * 3 + 12), birthDate: "1996-12-01", gender: "Male",
    // Three unauthorised absences in the sample ledger — this is why he is here.
    stage: "OnPip", manager: "mohamed.rashad@konecta.com", functional: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0533", fullNameEn: "Dina Samy", fullNameAr: "دينا سامي",
    workEmail: "dina.samy@demo.konecta", jobTitle: "Senior Customer Service Agent",
    department: "Operations", account: "Hertz", lob: "North America", grade: "A3",
    hireDate: ago(YEAR * 5 + 145), birthDate: "1994-07-09", gender: "Female",
    stage: "Active", manager: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0470", fullNameEn: "Youssef Hany", fullNameAr: "يوسف هاني",
    workEmail: "youssef.hany@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Lenovo", lob: "GTAP", grade: "A1",
    // Eight months: eligible, but still on the 15-day tier.
    hireDate: ago(240), birthDate: "2000-02-17", gender: "Male",
    stage: "Active", manager: "mohamed.rashad@konecta.com", functional: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0521", fullNameEn: "Mona Farid", fullNameAr: "منى فريد",
    workEmail: "mona.farid@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Hertz", lob: "North America", grade: "A2",
    // Under six months: not yet accruing anything at all.
    hireDate: ago(95), birthDate: "1999-10-30", gender: "Female",
    stage: "Probation", manager: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0517", fullNameEn: "Aya Magdy", fullNameAr: "آية مجدي",
    workEmail: "aya.magdy@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Hertz", lob: "EMEA", grade: "A2",
    // Short service but past 50: reaches the 30-day tier by age, not tenure.
    hireDate: ago(YEAR + 80), birthDate: "1974-05-11", gender: "Female",
    stage: "Active", manager: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0644", fullNameEn: "Tarek Hassan", fullNameAr: "طارق حسن",
    workEmail: "tarek.hassan@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Beko", lob: "EMEA", grade: "A1",
    hireDate: ago(YEAR + 200), birthDate: "1997-08-25", gender: "Male",
    // Two NCNS inside one month in the sample ledger.
    stage: "Notice", manager: "mohamed.rashad@konecta.com",
  },
  {
    empId: "EG0602", fullNameEn: "Omar Lotfy", fullNameAr: "عمر لطفي",
    workEmail: "omar.lotfy@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Beko", lob: "EMEA", grade: "A2",
    hireDate: ago(YEAR * 2 + 200), birthDate: "1993-04-03", gender: "Male",
    stage: "Active", manager: "mohamed.rashad@konecta.com",
  },
  {
    empId: "EG0455", fullNameEn: "Sara Adly", fullNameAr: "سارة عدلي",
    workEmail: "sara.adly@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Lenovo", lob: "GTAP", grade: "A2",
    hireDate: ago(YEAR + 40), birthDate: "1996-01-19", gender: "Female",
    stage: "Suspended", manager: "mohamed.rashad@konecta.com", functional: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EG0688", fullNameEn: "Ahmed Zaki", fullNameAr: "أحمد زكي",
    workEmail: "ahmed.zaki@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Beko", lob: "EMEA", grade: "A1",
    hireDate: ago(150), birthDate: "2001-09-12", gender: "Male",
    stage: "Probation", manager: "mohamed.rashad@konecta.com",
  },
];

/* ── Lifecycle edges ─────────────────────────────────────────────────────
   A directory where everyone is Active demonstrates nothing. These two make
   the ends of the lifecycle visible. */
const EDGES = [
  {
    empId: "EG0701", fullNameEn: "Hoda Mansour", fullNameAr: "هدى منصور",
    workEmail: "hoda.mansour@demo.konecta", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Hertz", lob: "EMEA", grade: "A2",
    hireDate: ago(YEAR * 2 + 15), birthDate: "1995-11-08", gender: "Female",
    stage: "Exited", exitDate: ago(25), exitType: "Resignation",
    exitReason: "Accepted an offer elsewhere. Assets returned, cleared by HR.",
    manager: "ibrahim.kamel@konecta.com",
  },
  {
    empId: "EMP-1006", fullNameEn: "Peter Wahba", fullNameAr: "بيتر وهبة",
    workEmail: "peter.wahba@konecta.com", jobTitle: "Customer Service Agent",
    department: "Operations", account: "Lenovo", lob: "EMEA", grade: "A1",
    // No hire date: an applicant has not been given one yet.
    hireDate: "", birthDate: "1999-02-14", gender: "Male",
    stage: "Applicant", manager: "mohamed.rashad@konecta.com",
  },
];

const ASSETS_BY_STAGE = {
  Applicant: [],
  Exited: [],
};
const DEFAULT_ASSETS = ["Laptop", "Voice Line"];

/**
 * Every seeded employee, flattened. Manager links stay as emails; the caller
 * resolves them to ids once every row exists.
 * @returns {Array<Record<string, unknown>>}
 */
export function buildEmployeeSeed() {
  return [...STAFF, ...AGENTS, ...EDGES].map((r) => ({
    empId: r.empId,
    fullNameEn: r.fullNameEn,
    fullNameAr: r.fullNameAr ?? "",
    preferredName: "",
    workEmail: r.workEmail,
    personalEmail: "",
    phone: "",
    gender: r.gender ?? "",
    birthDate: r.birthDate ?? "",
    addressAr: "",
    linkedInUrl: "",
    jobTitle: r.jobTitle ?? "",
    department: r.department ?? "",
    account: r.account ?? "",
    lob: r.lob ?? "",
    grade: r.grade ?? "",
    workSite: r.workSite ?? "Cairo GDC",
    stage: r.stage,
    hireDate: r.hireDate ?? "",
    exitDate: r.exitDate ?? "",
    exitType: r.exitType ?? null,
    exitReason: r.exitReason ?? "",
    assets: ASSETS_BY_STAGE[r.stage] ?? DEFAULT_ASSETS,
    // Resolved after insert.
    _managerEmail: r.manager ?? null,
    _functionalEmail: r.functional ?? null,
  }));
}

/** Emails of the seeded records, for linking logins and for assertions. */
export const seededEmails = () => buildEmployeeSeed().map((e) => e.workEmail);
