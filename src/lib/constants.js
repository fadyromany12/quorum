import { DEFAULT_DCM } from "./dcm.js";

export const DEFAULT_ACCOUNTS = ["Hertz", "Lenovo", "Beko"];

export const DEFAULT_TLS = [
  "Salma Elhadad",
  "Ibrahim Kamel",
  "Mohamed Rashad",
  "Abdallah Ismail",
  "Ahmed Nagi",
  "Fady Bekhet",
  "Kirolos Nagi",
];

export const LEAVE_TYPES = ["Sick Leave", "Emergency Leave", "Annual Leave", "Work From Home", "Exam Leave", "Other"];

/** Lines of business the RTA reports break down by. */
export const LOBS = ["EMEA", "GTAP", "North America"];

/** Warnings expire this many days after the previous occurrence of the same violation. */
export const RESET_DAYS = 90;

/** Warning chains resetting within this many days are surfaced as "resetting soon". */
export const RESET_SOON_DAYS = 14;

/** Target turnaround for each open pipeline stage, in calendar days. A case
    waiting longer than its target is flagged as breaching SLA. */
export const SLA_DAYS = { review: 2, notify: 1, ops: 2, hr: 3 };

/** Emergency leave: 6 days a year, no more than 2 consecutive days in a month. */
export const EMERGENCY_QUOTA = 6;
export const EMERGENCY_MAX_CONSECUTIVE = 2;

/** Egyptian Labour Law No. 12 of 2003 (as amended by No. 14 of 2025). */
export const PER_INCIDENT_CAP = 5;
export const PER_MONTH_CAP = 5;
export const LAW_CITATION = "Egyptian Labour Law No. 12/2003 (am. 14/2025)";

export const DATA_VERSION = 4;

export const DEFAULTS = {
  version: DATA_VERSION,
  accounts: DEFAULT_ACCOUNTS,
  tls: DEFAULT_TLS,
  dcm: DEFAULT_DCM,
  entries: [],
  users: [], // seeded by normalize() so a fresh browser can always log in
};
