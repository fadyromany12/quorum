/* Real password hashing (bcrypt) — server-side only. The old localStorage toy
   hash is gone; never import this from client components. */

import bcrypt from "bcryptjs";

export { DEFAULT_PASSWORD, MIN_PASSWORD, passwordProblem } from "./auth.js";

export const hashPassword = (password: string) => bcrypt.hashSync(password, 10);

export const verifyPassword = (password: string, passHash: string) => bcrypt.compareSync(password, passHash);
