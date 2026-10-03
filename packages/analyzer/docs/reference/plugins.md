---
title: Plugins
description: What each framework plugin reads — Next.js, TanStack Start, NestJS, Laravel — what counts as a guard, and the cases each one misses.
---

# Plugins

A `FrameworkPlugin` turns on when a package depends on its framework, through `npm` names or
`composer` names. Each hook is optional:
- `classify` decides a file's role;
- `isEntry` marks entry points;
- `routes` reads the routes a file declares;
- `injects` reads its injections;
- `guard` runs once, after every file.

## NestJS

| Reads | As |
|---|---|
| `@Controller("prefix")` with `@Get` and the other verbs, or `@All` | Routes, at the decorator's line |
| `app.setGlobalPrefix("api")` | A prefix on every route |
| `@UseGuards(...)` on a class or a method | Guards |
| `consumer.apply(X).forRoutes({ path, method } \| Controller)` | `X` as a guard on the routes named |
| `useGlobalGuards` or an `APP_GUARD` provider | `global` on every route |
| Constructor parameter types, `@Inject(X)`, `@InjectRepository(X)` | `inject` edges |
| `@Module`, `@Entity`, `implements CanActivate` and the like | Roles |

It misses a prefix set from a variable, and versioned routes.

## Next.js

| Reads | As |
|---|---|
| `app/**/route.ts` exports named `GET`, `POST` and the rest | Routes. Route groups and slots are dropped, and a `_private` folder is not routable |
| `pages/api/**` | `ANY` routes |
| `page`, `layout`, `template`, `loading`, `error` | Roles and entry points |
| `middleware.ts` that mentions authentication | A guard on the paths its `matcher` names, or on every path when it has none |

A middleware that does not authenticate guards nothing, which is right more often than wrong.

## TanStack Start

| Reads | As |
|---|---|
| `createFileRoute("/path")` | A route file. `$id` becomes `:id`; `_layout` and `(group)` segments vanish |
| `server.handlers` (and `createServerFileRoute().methods`, `createAPIFileRoute()`) | Routes, at each handler's line |
| `middleware: [...]` or `.middleware([...])` | Guards |

## Laravel

| Reads | As |
|---|---|
| `Route::get` and the other verbs, `match`, `any` | Routes. The route points at the controller method when it resolves, and otherwise at the routes file line |
| `resource` and `apiResource`, with `only` and `except` | The standard actions |
| `prefix`, `middleware`, `controller` chains, and `Route::group([...])` | Scope for the routes inside |
| `routes/api.php` | The `/api` prefix |
| Middleware starting `auth`, `can:`, `verified`, `sanctum` and the like | Guards. Other middleware is not a guard |

With `artisan: true` the routes come from `route:list` instead, which is exact but needs PHP and an
installed `vendor/`.
