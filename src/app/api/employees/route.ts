/* GET  /api/employees — a paginated, scope-enforced window over the directory.
   POST /api/employees — admit a person (applicant or direct hire).

   Every read is narrowed by the caller's visibility scope in SQL. The scope is
   resolved server-side from the session and is never accepted from the request,
   because a filter the client can send is a filter the client can widen. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { listEmployees, createEmployee, visibilityScope } from "@/lib/employee-db";
import { writeAudit } from "@/lib/db";
import { isStage } from "@/lib/employee.js";

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const p = new URL(req.url).searchParams;

  /* One stage, or several comma-separated — the journey views ask for a set
     ("joining" is Applicant, Onboarding and Probation) and splitting that into
     three requests would be three screens for one question. */
  const stageParam = p.get("stage") || "";
  const stages = stageParam.split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of stages) {
    if (!isStage(s)) throw new GuardError(400, `Unknown stage "${s}".`);
  }
  const stage = stages.length ? stages : undefined;

  const result = await listEmployees({
    q: p.get("q") || undefined,
    account: p.get("account") || undefined,
    department: p.get("department") || undefined,
    stage,
    managerId: p.get("managerId") || undefined,
    includeExited: p.get("includeExited") === "1",
    includeApplicants: p.get("includeApplicants") === "1",
    sort: p.get("sort") || undefined,
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("pageSize")) || undefined,
    // Resolved from the session, never from the query string.
    scopeIds: (await visibilityScope(actor)) ?? undefined,
  });

  return NextResponse.json(result);
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("employeeWrite");
  const body = await req.json().catch(() => ({}));

  const fullNameEn = String(body.fullNameEn ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim().toLowerCase();
  if (!fullNameEn) throw new GuardError(400, "An English full name is required.");
  if (!workEmail) throw new GuardError(400, "A work email is required.");

  /* Applicant by default. Admitting straight to Active is allowed but has to be
     asked for explicitly — the safe default is the stage that grants nothing. */
  const stage = body.stage ? String(body.stage) : "Applicant";
  if (!isStage(stage)) throw new GuardError(400, `Unknown stage "${stage}".`);
  if (stage !== "Applicant" && !body.hireDate) {
    throw new GuardError(400, "A hire date is required for anyone past the applicant stage.");
  }

  let employee;
  try {
    employee = await createEmployee(
      {
        fullNameEn,
        workEmail,
        stage: stage as never,
        fullNameAr: String(body.fullNameAr ?? ""),
        preferredName: String(body.preferredName ?? ""),
        personalEmail: String(body.personalEmail ?? "").toLowerCase(),
        phone: String(body.phone ?? ""),
        gender: String(body.gender ?? ""),
        birthDate: String(body.birthDate ?? ""),
        addressAr: String(body.addressAr ?? ""),
        linkedInUrl: String(body.linkedInUrl ?? ""),
        jobTitle: String(body.jobTitle ?? ""),
        department: String(body.department ?? ""),
        account: String(body.account ?? ""),
        lob: String(body.lob ?? ""),
        grade: String(body.grade ?? ""),
        workSite: String(body.workSite ?? ""),
        hireDate: String(body.hireDate ?? ""),
        directManagerId: body.directManagerId ? String(body.directManagerId) : null,
        functionalManagerId: body.functionalManagerId ? String(body.functionalManagerId) : null,
        dottedManagerId: body.dottedManagerId ? String(body.dottedManagerId) : null,
        assets: Array.isArray(body.assets) ? body.assets : [],
      },
      actor,
    );
  } catch (err) {
    // The only unique columns a caller controls are the work email and empId.
    if ((err as { code?: string })?.code === "P2002") {
      throw new GuardError(409, "That work email or employee id is already in use.");
    }
    throw err;
  }

  await writeAudit({
    actor,
    action: "EMPLOYEE_CREATED",
    summary: `Created ${employee.fullNameEn} (${employee.empId}) as ${employee.stage}.`,
    meta: { employeeId: employee.id },
  });

  return NextResponse.json({ employee }, { status: 201 });
});
