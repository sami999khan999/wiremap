// Transactional boundaries as a domain concept. The implementation must genuinely
// enrol the repositories running inside `work()`; one that does not is worse than none.
export abstract class UnitOfWork {
  public abstract run<T>(work: () => Promise<T>): Promise<T>;
}
