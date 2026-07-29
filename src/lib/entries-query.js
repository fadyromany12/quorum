/* Pure Prisma query builder for the paginated case read API (GET /api/entries).

   Kept separate and side-effect-free so the where/order/skip/take logic is unit
   tested without a database. This is the server-side windowing primitive: a
   large ledger can be paged and filtered in the database instead of shipping
   every row to the client. (The staff workspace still loads the full ledger for
   its client-side engine aggregates; adopting these windows there is the
   follow-on that pairs with moving those aggregates server-side.) */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * @param {{ account?: string, stage?: string, q?: string, from?: string, to?: string,
 *           includeVoided?: boolean, page?: number, pageSize?: number }} [opts]
 */
export function buildCaseQuery(opts = {}) {
  const { account, stage, q, from, to, includeVoided = false, page = 1, pageSize = DEFAULT_PAGE_SIZE } = opts;
  const where = {};
  const and = [];

  if (account && account !== "All") where.account = account;
  if (stage) where.stage = stage;
  if (!includeVoided) where.voided = false;
  if (from) and.push({ date: { gte: String(from) } });
  if (to) and.push({ date: { lte: String(to) } });

  const needle = (q || "").trim();
  if (needle) {
    and.push({
      OR: [
        { email: { contains: needle, mode: "insensitive" } },
        { empId: { contains: needle, mode: "insensitive" } },
        { agentName: { contains: needle, mode: "insensitive" } },
      ],
    });
  }
  if (and.length) where.AND = and;

  const size = Math.min(Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const p = Math.max(1, Number(page) || 1);

  return {
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    skip: (p - 1) * size,
    take: size,
    page: p,
    pageSize: size,
  };
}
