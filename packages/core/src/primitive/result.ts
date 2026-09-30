abstract class ResultBase<T, E> {
  public abstract unwrapOr(fallback: T): T;
  public abstract mapOk<U>(fn: (value: T) => U): Result<U, E>;
  public abstract mapErr<F>(fn: (error: E) => F): Result<T, F>;
}

export class Ok<T, E> extends ResultBase<T, E> {
  public readonly kind = "ok" as const;

  public constructor(public readonly value: T) {
    super();
  }

  public override unwrapOr(_fallback: T): T {
    return this.value;
  }

  public override mapOk<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  public override mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value);
  }
}

export class Err<T, E> extends ResultBase<T, E> {
  public readonly kind = "err" as const;

  public constructor(public readonly error: E) {
    super();
  }

  public override unwrapOr(fallback: T): T {
    return fallback;
  }

  public override mapOk<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error);
  }

  public override mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }
}

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export class Results {
  private constructor() {}

  public static ok<T, E = never>(value: T): Result<T, E> {
    return new Ok(value);
  }

  public static err<E, T = never>(error: E): Result<T, E> {
    return new Err(error);
  }
}
