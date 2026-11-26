/** Business error with an Arabic message safe to show to the user. */
export class AppError extends Error {
  constructor(public code: 'invalid-argument' | 'permission-denied' | 'not-found' | 'failed-precondition' | 'already-exists' | 'unauthenticated', message: string, public details?: unknown) {
    super(message);
  }
}
export const fail = {
  invalid: (m: string, d?: unknown) => new AppError('invalid-argument', m, d),
  denied: (m = 'ليست لديك صلاحية لتنفيذ هذه العملية') => new AppError('permission-denied', m),
  notFound: (what: string) => new AppError('not-found', `${what} غير موجود`),
  state: (m: string) => new AppError('failed-precondition', m),
  exists: (m: string) => new AppError('already-exists', m),
};
